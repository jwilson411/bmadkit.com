import { EventEmitter } from 'events';
import { z } from 'zod';
import { logger } from '../utils/logger';
import {
  Document,
  DocumentSection,
  DocumentTemplate,
  DocumentGenerationRequest,
  DocumentPreview,
  DocumentUpdateEvent,
  DocumentType,
  BMAD_DOCUMENT_TEMPLATES,
  AGENT_PHASE_DOCUMENT_MAPPING,
  createDocumentSection
} from '../models/document';
import { WorkflowContext, AgentPhase } from '../models/workflow-models';
import { TemplateProcessor, TemplateContext } from './template-processor';
import { DocumentCompiler, CompilationOptions } from './document-compiler';
import { DocumentStateManager } from './document-state-manager';

export interface DocumentGenerationOptions {
  realTimeUpdates: boolean;
  enablePreview: boolean;
  templateId?: string;
  customSections?: string[];
  compilationOptions?: Partial<CompilationOptions>;
}

export interface DocumentGenerationResult {
  success: boolean;
  document: Document;
  preview?: DocumentPreview;
  errors?: Array<{
    code: string;
    message: string;
    section?: string;
  }>;
  warnings?: string[];
  metadata: {
    generationTime: number;
    sectionsGenerated: number;
    wordsGenerated: number;
    templateId: string;
  };
}

export interface GenerationProgress {
  documentId: string;
  phase: AgentPhase;
  sectionId: string;
  progress: number;
  estimatedCompletion?: Date;
}

export class DocumentGenerator extends EventEmitter {
  private templateProcessor: TemplateProcessor;
  private documentCompiler: DocumentCompiler;
  private stateManager: DocumentStateManager;
  private templates: Map<string, DocumentTemplate> = new Map();
  private activeGenerations: Map<string, GenerationProgress> = new Map();

  constructor() {
    super();
    
    this.templateProcessor = new TemplateProcessor();
    this.documentCompiler = new DocumentCompiler();
    this.stateManager = new DocumentStateManager({
      enableVersioning: true,
      maxVersionsPerDocument: 10,
      enableAutosave: true,
      autosaveIntervalMs: 30000
    });

    this.setupEventHandlers();
    this.initializeDefaultTemplates();

    logger.info('Document generator initialized');
  }

  /**
   * Generate document from workflow context
   */
  async generateDocument(
    request: DocumentGenerationRequest,
    workflowContext: WorkflowContext,
    options: Partial<DocumentGenerationOptions> = {}
  ): Promise<DocumentGenerationResult> {
    
    const startTime = Date.now();
    const generationOptions: DocumentGenerationOptions = {
      realTimeUpdates: true,
      enablePreview: false,
      ...options
    };

    try {
      logger.info('Starting document generation', {
        workflowExecutionId: request.workflowExecutionId,
        documentType: request.documentType,
        options: generationOptions
      });

      // Get or create document template
      const templateId = generationOptions.templateId || BMAD_DOCUMENT_TEMPLATES[request.documentType];
      const template = await this.getDocumentTemplate(templateId);

      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Create or get existing document
      let document = await this.stateManager.queryDocuments({
        workflowExecutionId: request.workflowExecutionId,
        type: request.documentType
      }).then(docs => docs[0] || null);

      if (!document) {
        document = await this.stateManager.createDocument(
          request.workflowExecutionId,
          request.documentType,
          request.title || this.generateDefaultTitle(request.documentType, workflowContext),
          templateId
        );
      }

      // Update document status to generating
      document = await this.stateManager.updateDocument(document.id, {
        status: 'GENERATING',
        generationProgress: 0
      });

      // Track generation progress
      this.trackGenerationProgress(document.id, workflowContext);

      // Generate document sections based on available agent outputs
      const sectionsGenerated = await this.generateDocumentSections(
        document,
        template,
        workflowContext,
        generationOptions
      );

      // Update document with generated sections
      document = await this.stateManager.updateDocument(document.id, {
        sections: sectionsGenerated,
        status: 'COMPLETED',
        generationProgress: 100
      });

      // Generate preview if requested
      let preview: DocumentPreview | undefined;
      if (generationOptions.enablePreview) {
        preview = await this.documentCompiler.generatePreview(
          document,
          template,
          generationOptions.compilationOptions
        );
      }

      const generationTime = Date.now() - startTime;
      const wordsGenerated = document.metadata?.wordCount || 0;

      const result: DocumentGenerationResult = {
        success: true,
        document,
        preview,
        metadata: {
          generationTime,
          sectionsGenerated: sectionsGenerated.length,
          wordsGenerated,
          templateId: template.id
        }
      };

      this.activeGenerations.delete(document.id);

      logger.info('Document generation completed', {
        documentId: document.id,
        generationTime,
        sectionsGenerated: sectionsGenerated.length,
        wordsGenerated
      });

      this.emit('generation-completed', {
        documentId: document.id,
        result
      });

      return result;

    } catch (error) {
      const generationTime = Date.now() - startTime;
      
      logger.error('Document generation failed', {
        workflowExecutionId: request.workflowExecutionId,
        documentType: request.documentType,
        error: (error as Error).message,
        generationTime
      });

      // Create error result
      const result: DocumentGenerationResult = {
        success: false,
        document: {} as Document, // Will be empty on failure
        errors: [{
          code: 'GENERATION_ERROR',
          message: (error as Error).message
        }],
        metadata: {
          generationTime,
          sectionsGenerated: 0,
          wordsGenerated: 0,
          templateId: generationOptions.templateId || 'unknown'
        }
      };

      this.emit('generation-failed', {
        workflowExecutionId: request.workflowExecutionId,
        error: error as Error,
        result
      });

      return result;
    }
  }

  /**
   * Update document with new agent output
   */
  async updateDocumentFromAgent(
    documentId: string,
    agentPhase: AgentPhase,
    agentOutput: Record<string, any>
  ): Promise<DocumentUpdateEvent> {
    
    logger.debug('Updating document from agent output', {
      documentId,
      agentPhase,
      outputKeys: Object.keys(agentOutput)
    });

    try {
      const document = await this.stateManager.getDocument(documentId);
      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      // Get relevant sections for this agent phase
      const relevantSections = AGENT_PHASE_DOCUMENT_MAPPING[agentPhase] || [];
      
      const updatedSections: DocumentSection[] = [...document.sections];
      let sectionsUpdated = 0;

      for (const sectionKey of relevantSections) {
        const existingSection = updatedSections.find(s => s.id === sectionKey);
        const sectionContent = await this.generateSectionContent(sectionKey, agentOutput, agentPhase);

        if (existingSection) {
          // Update existing section
          existingSection.content = sectionContent;
          existingSection.completionPercentage = 100;
          existingSection.lastUpdated = new Date();
          sectionsUpdated++;
        } else {
          // Create new section
          const newSection = createDocumentSection(
            this.generateSectionTitle(sectionKey),
            sectionContent,
            updatedSections.length + 1,
            agentPhase
          );
          updatedSections.push(newSection);
          sectionsUpdated++;
        }
      }

      // Update document with new sections
      await this.stateManager.updateDocument(documentId, {
        sections: updatedSections,
        metadata: {
          ...document.metadata,
          lastAgentPhase: agentPhase
        }
      });

      const updateEvent: DocumentUpdateEvent = {
        documentId,
        type: 'SECTION_UPDATED',
        progress: this.calculateProgressFromAgentPhase(agentPhase),
        timestamp: new Date()
      };

      this.emit('document-updated-from-agent', {
        documentId,
        agentPhase,
        sectionsUpdated,
        event: updateEvent
      });

      return updateEvent;

    } catch (error) {
      logger.error('Failed to update document from agent output', {
        documentId,
        agentPhase,
        error: (error as Error).message
      });

      const errorEvent: DocumentUpdateEvent = {
        documentId,
        type: 'ERROR_OCCURRED',
        error: {
          code: 'AGENT_UPDATE_ERROR',
          message: (error as Error).message
        },
        timestamp: new Date()
      };

      this.emit('agent-update-error', errorEvent);

      return errorEvent;
    }
  }

  /**
   * Generate real-time document preview
   */
  async generatePreview(documentId: string): Promise<DocumentPreview> {
    logger.debug('Generating document preview', { documentId });

    const document = await this.stateManager.getDocument(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    const templateId = document.templateId;
    const template = await this.getDocumentTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const preview = await this.documentCompiler.generatePreview(document, template, {
      format: 'html',
      includeTableOfContents: true,
      sectionAnchors: true
    });

    this.emit('preview-generated', {
      documentId,
      preview
    });

    return preview;
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<Document | null> {
    return this.stateManager.getDocument(documentId);
  }

  /**
   * Query documents
   */
  async queryDocuments(query: any): Promise<Document[]> {
    return this.stateManager.queryDocuments(query);
  }

  /**
   * Generate document sections based on workflow context
   */
  private async generateDocumentSections(
    document: Document,
    template: DocumentTemplate,
    workflowContext: WorkflowContext,
    options: DocumentGenerationOptions
  ): Promise<DocumentSection[]> {
    
    logger.debug('Generating document sections', {
      documentId: document.id,
      templateId: template.id,
      sectionCount: template.sections.length
    });

    const sections: DocumentSection[] = [];
    let sectionOrder = 1;

    // Process each template section
    for (const templateSection of template.sections) {
      try {
        // Check if we should generate this section
        if (options.customSections && !options.customSections.includes(templateSection.id)) {
          continue;
        }

        // Generate section content using template processor
        const templateContext: TemplateContext = {
          workflowContext,
          documentData: {
            title: document.title,
            type: document.type
          },
          agentOutputs: this.extractAgentOutputs(workflowContext),
          metadata: {
            generatedAt: new Date(),
            documentType: document.type as DocumentType,
            version: '1.0.0',
            projectName: workflowContext.projectInput
          }
        };

        // Create mini-template for the section
        const sectionTemplate: DocumentTemplate = {
          ...template,
          template: templateSection.template,
          sections: [templateSection]
        };

        const processingResult = await this.templateProcessor.processTemplate(
          sectionTemplate,
          templateContext
        );

        if (processingResult.success) {
          const section = createDocumentSection(
            templateSection.title,
            processingResult.content,
            sectionOrder++,
            this.determineSourceAgentPhase(templateSection, workflowContext)
          );

          // Set completion percentage based on available data
          section.completionPercentage = this.calculateSectionCompletion(
            templateSection,
            workflowContext
          );

          sections.push(section);

          // Emit real-time update if enabled
          if (options.realTimeUpdates) {
            this.emit('section-generated', {
              documentId: document.id,
              section,
              progress: Math.round((sectionOrder / template.sections.length) * 100)
            });
          }

        } else {
          logger.warn('Section generation failed', {
            documentId: document.id,
            sectionId: templateSection.id,
            errors: processingResult.errors
          });

          // Create placeholder section
          const placeholderSection = createDocumentSection(
            templateSection.title,
            `*${templateSection.title} content will be generated during the workflow.*`,
            sectionOrder++
          );
          placeholderSection.completionPercentage = 0;
          sections.push(placeholderSection);
        }

      } catch (error) {
        logger.error('Section generation error', {
          documentId: document.id,
          sectionId: templateSection.id,
          error: (error as Error).message
        });

        // Create error section
        const errorSection = createDocumentSection(
          templateSection.title,
          `*Error generating ${templateSection.title}: ${(error as Error).message}*`,
          sectionOrder++
        );
        sections.push(errorSection);
      }
    }

    return sections;
  }

  /**
   * Extract agent outputs from workflow context
   */
  private extractAgentOutputs(workflowContext: WorkflowContext): Record<string, any> {
    const agentOutputs: Record<string, any> = {};

    // Extract from context based on known agent output patterns
    if (workflowContext.businessRequirements) {
      agentOutputs.ANALYST = workflowContext.businessRequirements;
    }

    if (workflowContext.projectScope) {
      agentOutputs.PM = workflowContext.projectScope;
    }

    if (workflowContext.userExperience) {
      agentOutputs.UX_EXPERT = workflowContext.userExperience;
    }

    if (workflowContext.technicalArchitecture) {
      agentOutputs.ARCHITECT = workflowContext.technicalArchitecture;
    }

    return agentOutputs;
  }

  /**
   * Determine source agent phase for section
   */
  private determineSourceAgentPhase(
    templateSection: any,
    workflowContext: WorkflowContext
  ): AgentPhase | undefined {
    
    // Check if section depends on specific agent phase
    if (templateSection.dependsOnAgentPhase) {
      return templateSection.dependsOnAgentPhase[0] as AgentPhase;
    }

    // Infer from section content and available context
    const sectionId = templateSection.id.toLowerCase();
    
    if (sectionId.includes('business') || sectionId.includes('requirements') || sectionId.includes('market')) {
      return 'ANALYST';
    }
    
    if (sectionId.includes('scope') || sectionId.includes('feature') || sectionId.includes('story')) {
      return 'PM';
    }
    
    if (sectionId.includes('user') || sectionId.includes('ux') || sectionId.includes('design')) {
      return 'UX_EXPERT';
    }
    
    if (sectionId.includes('technical') || sectionId.includes('architecture') || sectionId.includes('implementation')) {
      return 'ARCHITECT';
    }

    return undefined;
  }

  /**
   * Calculate section completion percentage
   */
  private calculateSectionCompletion(
    templateSection: any,
    workflowContext: WorkflowContext
  ): number {
    
    const sourcePhase = this.determineSourceAgentPhase(templateSection, workflowContext);
    
    // If we have output from the source agent phase, section is complete
    if (sourcePhase) {
      const hasOutput = this.extractAgentOutputs(workflowContext)[sourcePhase];
      return hasOutput ? 100 : 25; // 25% for placeholder content
    }

    return 50; // Default partial completion
  }

  /**
   * Calculate progress based on agent phase
   */
  private calculateProgressFromAgentPhase(agentPhase: AgentPhase): number {
    const phaseProgress = {
      ANALYST: 25,
      PM: 50,
      UX_EXPERT: 75,
      ARCHITECT: 100
    };

    return phaseProgress[agentPhase] || 0;
  }

  /**
   * Generate section content for specific section key
   */
  private async generateSectionContent(
    sectionKey: string,
    agentOutput: Record<string, any>,
    agentPhase: AgentPhase
  ): Promise<string> {
    
    // Generate content based on section key and agent output
    switch (sectionKey) {
      case 'business-overview':
        return this.generateBusinessOverviewContent(agentOutput);
      case 'market-analysis':
        return this.generateMarketAnalysisContent(agentOutput);
      case 'project-scope':
        return this.generateProjectScopeContent(agentOutput);
      case 'feature-prioritization':
        return this.generateFeaturePrioritizationContent(agentOutput);
      case 'user-experience':
        return this.generateUserExperienceContent(agentOutput);
      case 'technical-architecture':
        return this.generateTechnicalArchitectureContent(agentOutput);
      default:
        return this.generateGenericContent(sectionKey, agentOutput);
    }
  }

  /**
   * Generate business overview content
   */
  private generateBusinessOverviewContent(agentOutput: Record<string, any>): string {
    const overview = agentOutput.businessOverview || {};
    
    let content = '';
    if (overview.problemStatement) {
      content += `### Problem Statement\n\n${overview.problemStatement}\n\n`;
    }
    
    if (overview.solutionApproach) {
      content += `### Solution Approach\n\n${overview.solutionApproach}\n\n`;
    }
    
    if (overview.targetMarket) {
      content += `### Target Market\n\n${overview.targetMarket}\n\n`;
    }
    
    return content || '*Business overview content will be available after analyst phase completion.*';
  }

  /**
   * Generate market analysis content
   */
  private generateMarketAnalysisContent(agentOutput: Record<string, any>): string {
    const analysis = agentOutput.marketAnalysis || {};
    
    let content = '';
    if (analysis.marketSize) {
      content += `### Market Size\n\n${analysis.marketSize}\n\n`;
    }
    
    if (analysis.competitors) {
      content += `### Competitive Landscape\n\n`;
      analysis.competitors.forEach((competitor: any) => {
        content += `**${competitor.name}**: ${competitor.description}\n\n`;
      });
    }
    
    if (analysis.opportunities) {
      content += `### Market Opportunities\n\n`;
      analysis.opportunities.forEach((opportunity: string, index: number) => {
        content += `${index + 1}. ${opportunity}\n`;
      });
    }
    
    return content || '*Market analysis will be available after analyst phase completion.*';
  }

  /**
   * Generate project scope content
   */
  private generateProjectScopeContent(agentOutput: Record<string, any>): string {
    const scope = agentOutput;
    
    let content = '';
    if (scope.features) {
      content += `### Core Features\n\n`;
      scope.features.forEach((feature: any) => {
        content += `**${feature.name}** (${feature.priority} priority)\n`;
        content += `${feature.description}\n\n`;
      });
    }
    
    if (scope.outOfScope) {
      content += `### Out of Scope\n\n`;
      scope.outOfScope.forEach((item: string, index: number) => {
        content += `${index + 1}. ${item}\n`;
      });
    }
    
    return content || '*Project scope will be defined during PM phase.*';
  }

  /**
   * Generate generic content for unknown sections
   */
  private generateGenericContent(sectionKey: string, agentOutput: Record<string, any>): string {
    const sectionTitle = this.generateSectionTitle(sectionKey);
    return `*${sectionTitle} content will be generated based on ${Object.keys(agentOutput).join(', ')} outputs.*`;
  }

  /**
   * Generate human-readable section title
   */
  private generateSectionTitle(sectionKey: string): string {
    return sectionKey
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Generate other content methods (abbreviated for brevity)
   */
  private generateFeaturePrioritizationContent(agentOutput: Record<string, any>): string {
    return '*Feature prioritization content will be generated from PM agent output.*';
  }

  private generateUserExperienceContent(agentOutput: Record<string, any>): string {
    return '*User experience content will be generated from UX Expert agent output.*';
  }

  private generateTechnicalArchitectureContent(agentOutput: Record<string, any>): string {
    return '*Technical architecture content will be generated from Architect agent output.*';
  }

  /**
   * Get document template
   */
  private async getDocumentTemplate(templateId: string): Promise<DocumentTemplate | null> {
    return this.templates.get(templateId) || null;
  }

  /**
   * Generate default title based on document type and context
   */
  private generateDefaultTitle(documentType: string, workflowContext: WorkflowContext): string {
    const projectName = workflowContext.projectInput || 'Untitled Project';
    
    switch (documentType) {
      case 'PROJECT_BRIEF':
        return `${projectName} - Project Brief`;
      case 'PRD':
        return `${projectName} - Product Requirements Document`;
      case 'TECHNICAL_ARCHITECTURE':
        return `${projectName} - Technical Architecture`;
      case 'USER_STORIES':
        return `${projectName} - User Stories`;
      default:
        return `${projectName} - ${documentType}`;
    }
  }

  /**
   * Track generation progress
   */
  private trackGenerationProgress(documentId: string, workflowContext: WorkflowContext): void {
    // This would track progress in a real implementation
    this.activeGenerations.set(documentId, {
      documentId,
      phase: 'ANALYST', // Current phase would be determined from context
      sectionId: 'initial',
      progress: 0,
      estimatedCompletion: new Date(Date.now() + 300000) // 5 minutes estimate
    });
  }

  /**
   * Initialize default BMAD document templates
   */
  private initializeDefaultTemplates(): void {
    // This would load actual template files in a real implementation
    // For now, create basic template structures
    
    const templates: DocumentTemplate[] = [
      {
        id: 'project-brief',
        name: 'Project Brief Template',
        type: 'PROJECT_BRIEF',
        description: 'High-level project overview and objectives',
        template: '{{> header}}\n\n## Executive Summary\n\n{{businessRequirements.projectOverview}}',
        sections: [
          {
            id: 'executive-summary',
            title: 'Executive Summary',
            required: true,
            order: 1,
            template: '{{businessRequirements.projectOverview}}'
          }
        ],
        variables: [
          {
            name: 'businessRequirements',
            type: 'object',
            required: true,
            description: 'Business requirements from analyst agent'
          }
        ],
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date()
      }
      // Additional templates would be added here
    ];

    templates.forEach(template => {
      this.templates.set(template.id, template);
    });

    logger.debug('Default templates initialized', { templateCount: templates.length });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.templateProcessor.on('template-processed', (event) => {
      this.emit('template-processed', event);
    });

    this.documentCompiler.on('document-compiled', (event) => {
      this.emit('document-compiled', event);
    });

    this.stateManager.on('document-updated', (event) => {
      this.emit('document-state-updated', event);
    });
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stateManager.cleanup();
    this.activeGenerations.clear();
    logger.info('Document generator cleanup completed');
  }
}