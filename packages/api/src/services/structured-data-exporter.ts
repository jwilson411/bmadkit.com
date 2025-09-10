import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ExportRequest, ExportOptions, DocumentContent, ExportResult } from './export-processor';

export interface StructuredExportOptions extends ExportOptions {
  includeRawContent?: boolean;
  includeParsedContent?: boolean;
  includeAnalytics?: boolean;
  includeRelationships?: boolean;
  schemaVersion?: string;
  customFields?: Record<string, any>;
  outputStyle?: 'flat' | 'nested' | 'normalized';
  dateFormat?: 'iso' | 'unix' | 'readable';
  indentation?: number;
  sortKeys?: boolean;
  includeNulls?: boolean;
}

export interface ProjectManagementSchema {
  // Common schema for project management tools integration
  project: {
    id: string;
    name: string;
    description?: string;
    status: 'draft' | 'in_progress' | 'completed' | 'archived';
    priority: 'low' | 'medium' | 'high' | 'critical';
    createdAt: string;
    updatedAt: string;
    dueDate?: string;
    tags: string[];
  };
  metadata: {
    exportVersion: string;
    exportedAt: string;
    exportedBy?: string;
    sourceSystem: string;
    schemaVersion: string;
  };
  sections: Section[];
  requirements?: Requirement[];
  tasks?: Task[];
  stakeholders?: Stakeholder[];
  risks?: Risk[];
  timeline?: TimelineEvent[];
  resources?: Resource[];
  dependencies?: Dependency[];
}

export interface Section {
  id: string;
  title: string;
  type: 'text' | 'code' | 'table' | 'image' | 'chart' | 'diagram';
  order: number;
  content: {
    raw: string;
    parsed?: any;
    formatted?: string;
  };
  metadata?: {
    complexity?: 'simple' | 'moderate' | 'complex';
    estimatedReadTime?: number;
    wordCount?: number;
    lastModified?: string;
  };
  tags?: string[];
  relationships?: {
    dependsOn?: string[];
    relatedTo?: string[];
    childOf?: string;
    parentOf?: string[];
  };
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  type: 'functional' | 'non_functional' | 'business' | 'technical';
  priority: 'must_have' | 'should_have' | 'could_have' | 'wont_have';
  status: 'identified' | 'analyzed' | 'approved' | 'implemented' | 'tested';
  acceptanceCriteria?: string[];
  source?: string;
  stakeholder?: string;
  estimatedEffort?: number;
  dependencies?: string[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: 'development' | 'design' | 'testing' | 'documentation' | 'review';
  status: 'todo' | 'in_progress' | 'blocked' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
  dueDate?: string;
  completedDate?: string;
  dependencies?: string[];
  subtasks?: string[];
  labels?: string[];
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  email?: string;
  department?: string;
  influence: 'low' | 'medium' | 'high';
  interest: 'low' | 'medium' | 'high';
  communicationPreference?: 'email' | 'meetings' | 'slack' | 'reports';
  responsibilities?: string[];
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  category: 'technical' | 'business' | 'operational' | 'external';
  probability: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  impact: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  riskScore: number;
  status: 'identified' | 'assessed' | 'mitigated' | 'accepted' | 'transferred';
  owner?: string;
  mitigationStrategy?: string;
  contingencyPlan?: string;
  reviewDate?: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  type: 'milestone' | 'task' | 'review' | 'delivery' | 'meeting';
  startDate: string;
  endDate?: string;
  duration?: number;
  dependencies?: string[];
  assignee?: string;
  status: 'planned' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
}

export interface Resource {
  id: string;
  name: string;
  type: 'human' | 'financial' | 'technical' | 'material';
  role?: string;
  availability?: number; // percentage
  cost?: number;
  costPeriod?: 'hourly' | 'daily' | 'monthly' | 'project';
  skills?: string[];
  allocation?: TimelineEvent[];
}

export interface Dependency {
  id: string;
  source: string;
  target: string;
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  lag?: number; // days
  critical?: boolean;
  description?: string;
}

class StructuredDataExporter extends EventEmitter {
  private readonly SCHEMA_VERSION = '1.0.0';
  private readonly DATE_FORMATS = {
    iso: (date: Date) => date.toISOString(),
    unix: (date: Date) => Math.floor(date.getTime() / 1000),
    readable: (date: Date) => date.toLocaleString()
  };

  constructor() {
    super();
  }

  async exportJSON(
    request: ExportRequest,
    content: DocumentContent,
    branding?: any
  ): Promise<ExportResult> {
    return this.exportStructuredData(request, content, 'json', branding);
  }

  async exportYAML(
    request: ExportRequest,
    content: DocumentContent,
    branding?: any
  ): Promise<ExportResult> {
    return this.exportStructuredData(request, content, 'yaml', branding);
  }

  private async exportStructuredData(
    request: ExportRequest,
    content: DocumentContent,
    format: 'json' | 'yaml',
    branding?: any
  ): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      const options = request.options as StructuredExportOptions;
      
      // Generate structured data based on output style
      let structuredData: any;
      
      switch (options.outputStyle || 'nested') {
        case 'flat':
          structuredData = this.generateFlatStructure(content, options, branding);
          break;
        case 'normalized':
          structuredData = this.generateNormalizedStructure(content, options, branding);
          break;
        default:
          structuredData = this.generateNestedStructure(content, options, branding);
      }

      // Apply custom fields if provided
      if (options.customFields) {
        structuredData = { ...structuredData, ...options.customFields };
      }

      // Generate output string
      let outputContent: string;
      const fileName = `${content.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.${format}`;

      if (format === 'json') {
        outputContent = JSON.stringify(
          structuredData,
          options.includeNulls ? null : this.replaceNulls,
          options.indentation || 2
        );
      } else {
        const yamlOptions: yaml.DumpOptions = {
          indent: options.indentation || 2,
          sortKeys: options.sortKeys || false,
          skipInvalid: !options.includeNulls,
          flowLevel: -1,
          styles: {
            '!!null': 'empty' // Don't output null values
          }
        };
        outputContent = yaml.dump(structuredData, yamlOptions);
      }

      // Save to file
      const filePath = path.join(process.env.EXPORT_STORAGE_PATH || './exports', fileName);
      await fs.writeFile(filePath, outputContent, 'utf8');
      const stats = await fs.stat(filePath);

      // Calculate metadata
      const metadata = {
        wordCount: this.countWords(outputContent),
        characterCount: outputContent.length,
        sections: content.sections.length,
        dataPoints: this.countDataPoints(structuredData),
        schemaVersion: this.SCHEMA_VERSION,
        format: format.toUpperCase()
      };

      const result: ExportResult = {
        exportId: request.exportId,
        success: true,
        format: format as any,
        filePath,
        fileUrl: `/api/exports/${request.exportId}/download`,
        fileName,
        fileSize: stats.size,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata
      };

      this.emit('structuredDataExported', {
        exportId: request.exportId,
        userId: request.userId,
        format: format.toUpperCase(),
        fileName,
        fileSize: stats.size,
        dataPoints: metadata.dataPoints,
        processingTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      this.emit('structuredExportError', {
        exportId: request.exportId,
        userId: request.userId,
        format: format.toUpperCase(),
        error: error.message,
        processingTime: Date.now() - startTime
      });

      return {
        exportId: request.exportId,
        success: false,
        format: format as any,
        fileName: '',
        fileSize: 0,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata: {},
        error: {
          code: 'STRUCTURED_EXPORT_ERROR',
          message: error.message
        }
      };
    }
  }

  private generateNestedStructure(
    content: DocumentContent,
    options: StructuredExportOptions,
    branding?: any
  ): ProjectManagementSchema {
    const dateFormatter = this.DATE_FORMATS[options.dateFormat || 'iso'];

    const schema: ProjectManagementSchema = {
      project: {
        id: content.sessionId,
        name: content.title,
        description: this.extractDescription(content),
        status: 'draft',
        priority: this.inferPriority(content),
        createdAt: dateFormatter(content.metadata.createdAt),
        updatedAt: dateFormatter(content.metadata.updatedAt),
        tags: content.metadata.tags || []
      },
      metadata: {
        exportVersion: this.SCHEMA_VERSION,
        exportedAt: dateFormatter(new Date()),
        exportedBy: content.metadata.author,
        sourceSystem: 'BMAD Kit',
        schemaVersion: options.schemaVersion || this.SCHEMA_VERSION
      },
      sections: this.convertSectionsToStructured(content.sections, options)
    };

    // Add optional components based on content analysis
    if (options.includeAnalytics !== false) {
      schema.requirements = this.extractRequirements(content);
      schema.tasks = this.extractTasks(content);
      schema.stakeholders = this.extractStakeholders(content);
      schema.risks = this.extractRisks(content);
      schema.timeline = this.extractTimeline(content);
      schema.resources = this.extractResources(content);
      schema.dependencies = this.extractDependencies(content);
    }

    return schema;
  }

  private generateFlatStructure(
    content: DocumentContent,
    options: StructuredExportOptions,
    branding?: any
  ): any {
    const dateFormatter = this.DATE_FORMATS[options.dateFormat || 'iso'];
    const flat: any = {};

    // Flatten all data into a single level
    flat.project_id = content.sessionId;
    flat.project_name = content.title;
    flat.project_description = this.extractDescription(content);
    flat.project_status = 'draft';
    flat.project_priority = this.inferPriority(content);
    flat.project_created_at = dateFormatter(content.metadata.createdAt);
    flat.project_updated_at = dateFormatter(content.metadata.updatedAt);
    flat.project_tags = (content.metadata.tags || []).join(',');

    flat.export_version = this.SCHEMA_VERSION;
    flat.exported_at = dateFormatter(new Date());
    flat.exported_by = content.metadata.author || '';
    flat.source_system = 'BMAD Kit';
    flat.schema_version = options.schemaVersion || this.SCHEMA_VERSION;

    // Flatten sections
    content.sections.forEach((section, index) => {
      const prefix = `section_${index + 1}`;
      flat[`${prefix}_id`] = section.id;
      flat[`${prefix}_title`] = section.title;
      flat[`${prefix}_type`] = section.type;
      flat[`${prefix}_order`] = section.order;
      flat[`${prefix}_content`] = section.content;
      
      if (section.metadata) {
        Object.entries(section.metadata).forEach(([key, value]) => {
          flat[`${prefix}_${key}`] = value;
        });
      }
    });

    return flat;
  }

  private generateNormalizedStructure(
    content: DocumentContent,
    options: StructuredExportOptions,
    branding?: any
  ): any {
    const dateFormatter = this.DATE_FORMATS[options.dateFormat || 'iso'];

    // Normalized structure with separate tables/collections
    return {
      projects: [{
        id: content.sessionId,
        name: content.title,
        description: this.extractDescription(content),
        status: 'draft',
        priority: this.inferPriority(content),
        createdAt: dateFormatter(content.metadata.createdAt),
        updatedAt: dateFormatter(content.metadata.updatedAt),
        tags: content.metadata.tags || []
      }],
      sections: this.convertSectionsToNormalized(content.sections, options),
      requirements: this.extractRequirements(content),
      tasks: this.extractTasks(content),
      stakeholders: this.extractStakeholders(content),
      risks: this.extractRisks(content),
      timeline: this.extractTimeline(content),
      resources: this.extractResources(content),
      dependencies: this.extractDependencies(content),
      metadata: {
        exportVersion: this.SCHEMA_VERSION,
        exportedAt: dateFormatter(new Date()),
        exportedBy: content.metadata.author,
        sourceSystem: 'BMAD Kit',
        schemaVersion: options.schemaVersion || this.SCHEMA_VERSION
      }
    };
  }

  private convertSectionsToStructured(sections: any[], options: StructuredExportOptions): Section[] {
    return sections.map(section => {
      const structuredSection: Section = {
        id: section.id,
        title: section.title,
        type: section.type,
        order: section.order,
        content: {
          raw: section.content
        }
      };

      if (options.includeParsedContent !== false) {
        structuredSection.content.parsed = this.parseContent(section.content, section.type);
      }

      if (options.includeAnalytics !== false) {
        structuredSection.metadata = {
          complexity: this.assessComplexity(section.content),
          estimatedReadTime: this.estimateReadTime(section.content),
          wordCount: this.countWords(section.content),
          lastModified: section.metadata?.updatedAt || new Date().toISOString()
        };
      }

      if (options.includeRelationships !== false) {
        structuredSection.relationships = this.analyzeRelationships(section, sections);
      }

      return structuredSection;
    });
  }

  private convertSectionsToNormalized(sections: any[], options: StructuredExportOptions): any[] {
    return sections.map(section => ({
      id: section.id,
      project_id: section.sessionId || 'unknown',
      title: section.title,
      type: section.type,
      order: section.order,
      content_raw: section.content,
      content_parsed: options.includeParsedContent !== false ? this.parseContent(section.content, section.type) : null,
      word_count: this.countWords(section.content),
      complexity: this.assessComplexity(section.content),
      estimated_read_time: this.estimateReadTime(section.content)
    }));
  }

  // Content analysis methods
  private extractDescription(content: DocumentContent): string {
    // Extract description from first section or metadata
    if (content.sections.length > 0) {
      const firstSection = content.sections.find(s => s.type === 'text');
      if (firstSection && firstSection.content) {
        return firstSection.content.substring(0, 200) + '...';
      }
    }
    return content.metadata.description || '';
  }

  private inferPriority(content: DocumentContent): 'low' | 'medium' | 'high' | 'critical' {
    const text = content.sections.map(s => s.content).join(' ').toLowerCase();
    
    if (text.includes('urgent') || text.includes('critical') || text.includes('asap')) {
      return 'critical';
    } else if (text.includes('important') || text.includes('priority') || text.includes('deadline')) {
      return 'high';
    } else if (text.includes('moderate') || text.includes('standard')) {
      return 'medium';
    }
    
    return 'low';
  }

  private extractRequirements(content: DocumentContent): Requirement[] {
    const requirements: Requirement[] = [];
    
    // Analyze content for requirement patterns
    content.sections.forEach((section, index) => {
      const requirementKeywords = ['requirement', 'must', 'should', 'shall', 'feature'];
      const text = section.content.toLowerCase();
      
      if (requirementKeywords.some(keyword => text.includes(keyword))) {
        requirements.push({
          id: `req_${index + 1}`,
          title: section.title,
          description: section.content.substring(0, 500),
          type: this.inferRequirementType(section.content),
          priority: 'should_have',
          status: 'identified'
        });
      }
    });

    return requirements;
  }

  private extractTasks(content: DocumentContent): Task[] {
    const tasks: Task[] = [];
    
    content.sections.forEach((section, index) => {
      const taskKeywords = ['implement', 'develop', 'create', 'build', 'design', 'test'];
      const text = section.content.toLowerCase();
      
      if (taskKeywords.some(keyword => text.includes(keyword))) {
        tasks.push({
          id: `task_${index + 1}`,
          title: `Implement ${section.title}`,
          description: section.content.substring(0, 300),
          type: this.inferTaskType(section.content),
          status: 'todo',
          priority: 'medium',
          estimatedHours: this.estimateEffort(section.content)
        });
      }
    });

    return tasks;
  }

  private extractStakeholders(content: DocumentContent): Stakeholder[] {
    const stakeholders: Stakeholder[] = [];
    
    // Look for stakeholder mentions in content
    const stakeholderPatterns = [
      /stakeholder[s]?/gi,
      /user[s]?/gi,
      /client[s]?/gi,
      /customer[s]?/gi,
      /team[s]?/gi
    ];

    const mentions = new Set<string>();
    content.sections.forEach(section => {
      stakeholderPatterns.forEach(pattern => {
        const matches = section.content.match(pattern);
        if (matches) {
          matches.forEach(match => mentions.add(match.toLowerCase()));
        }
      });
    });

    mentions.forEach((mention, index) => {
      stakeholders.push({
        id: `stakeholder_${index + 1}`,
        name: mention.charAt(0).toUpperCase() + mention.slice(1),
        role: this.inferStakeholderRole(mention),
        influence: 'medium',
        interest: 'high'
      });
    });

    return stakeholders;
  }

  private extractRisks(content: DocumentContent): Risk[] {
    const risks: Risk[] = [];
    
    const riskKeywords = ['risk', 'issue', 'problem', 'challenge', 'concern', 'blocker'];
    
    content.sections.forEach((section, index) => {
      const text = section.content.toLowerCase();
      
      if (riskKeywords.some(keyword => text.includes(keyword))) {
        risks.push({
          id: `risk_${index + 1}`,
          title: `${section.title} Risk`,
          description: section.content.substring(0, 300),
          category: this.inferRiskCategory(section.content),
          probability: 'medium',
          impact: 'medium',
          riskScore: 25, // medium * medium
          status: 'identified'
        });
      }
    });

    return risks;
  }

  private extractTimeline(content: DocumentContent): TimelineEvent[] {
    const timeline: TimelineEvent[] = [];
    
    content.sections.forEach((section, index) => {
      timeline.push({
        id: `event_${index + 1}`,
        title: section.title,
        type: 'task',
        startDate: new Date().toISOString(),
        duration: this.estimateTaskDuration(section.content),
        status: 'planned'
      });
    });

    return timeline;
  }

  private extractResources(content: DocumentContent): Resource[] {
    const resources: Resource[] = [];
    
    // Identify resource requirements from content
    const resourceKeywords = ['developer', 'designer', 'tester', 'manager', 'architect'];
    const text = content.sections.map(s => s.content).join(' ').toLowerCase();
    
    resourceKeywords.forEach((resource, index) => {
      if (text.includes(resource)) {
        resources.push({
          id: `resource_${index + 1}`,
          name: resource.charAt(0).toUpperCase() + resource.slice(1),
          type: 'human',
          role: resource,
          availability: 100
        });
      }
    });

    return resources;
  }

  private extractDependencies(content: DocumentContent): Dependency[] {
    const dependencies: Dependency[] = [];
    
    // Analyze section relationships for dependencies
    for (let i = 0; i < content.sections.length - 1; i++) {
      dependencies.push({
        id: `dep_${i + 1}`,
        source: content.sections[i].id,
        target: content.sections[i + 1].id,
        type: 'finish_to_start',
        critical: false,
        description: `${content.sections[i].title} must complete before ${content.sections[i + 1].title}`
      });
    }

    return dependencies;
  }

  // Helper methods for content analysis
  private parseContent(content: string, type: string): any {
    switch (type) {
      case 'code':
        return {
          language: this.detectLanguage(content),
          lines: content.split('\n').length,
          hasComments: content.includes('//') || content.includes('/*'),
          functions: this.extractFunctions(content)
        };
      case 'table':
        return {
          rows: content.split('\n').length,
          columns: this.estimateColumns(content),
          hasHeaders: true // assumption
        };
      case 'text':
        return {
          sentences: content.split(/[.!?]+/).length,
          paragraphs: content.split(/\n\s*\n/).length,
          readingLevel: this.assessReadingLevel(content)
        };
      default:
        return { type, length: content.length };
    }
  }

  private assessComplexity(content: string): 'simple' | 'moderate' | 'complex' {
    const wordCount = this.countWords(content);
    const sentenceCount = content.split(/[.!?]+/).length;
    const avgWordsPerSentence = wordCount / sentenceCount;

    if (wordCount < 100 && avgWordsPerSentence < 15) return 'simple';
    if (wordCount < 500 && avgWordsPerSentence < 20) return 'moderate';
    return 'complex';
  }

  private estimateReadTime(content: string): number {
    // Average reading speed: 200 words per minute
    const wordCount = this.countWords(content);
    return Math.ceil(wordCount / 200);
  }

  private analyzeRelationships(section: any, allSections: any[]): any {
    const relationships: any = {};
    
    // Simple keyword-based relationship detection
    const sectionKeywords = this.extractKeywords(section.content);
    
    const related = allSections.filter(other => 
      other.id !== section.id && 
      this.calculateSimilarity(sectionKeywords, this.extractKeywords(other.content)) > 0.3
    );

    if (related.length > 0) {
      relationships.relatedTo = related.map(r => r.id);
    }

    return Object.keys(relationships).length > 0 ? relationships : undefined;
  }

  private inferRequirementType(content: string): 'functional' | 'non_functional' | 'business' | 'technical' {
    const text = content.toLowerCase();
    
    if (text.includes('performance') || text.includes('security') || text.includes('scalability')) {
      return 'non_functional';
    } else if (text.includes('business') || text.includes('revenue') || text.includes('cost')) {
      return 'business';
    } else if (text.includes('technical') || text.includes('architecture') || text.includes('system')) {
      return 'technical';
    }
    
    return 'functional';
  }

  private inferTaskType(content: string): 'development' | 'design' | 'testing' | 'documentation' | 'review' {
    const text = content.toLowerCase();
    
    if (text.includes('test') || text.includes('qa')) return 'testing';
    if (text.includes('design') || text.includes('ui') || text.includes('ux')) return 'design';
    if (text.includes('document') || text.includes('spec')) return 'documentation';
    if (text.includes('review') || text.includes('audit')) return 'review';
    
    return 'development';
  }

  private inferStakeholderRole(mention: string): string {
    const roleMap: Record<string, string> = {
      'user': 'End User',
      'client': 'Client',
      'customer': 'Customer',
      'team': 'Development Team',
      'stakeholder': 'Business Stakeholder'
    };
    
    return roleMap[mention] || 'Stakeholder';
  }

  private inferRiskCategory(content: string): 'technical' | 'business' | 'operational' | 'external' {
    const text = content.toLowerCase();
    
    if (text.includes('technical') || text.includes('code') || text.includes('system')) {
      return 'technical';
    } else if (text.includes('business') || text.includes('market') || text.includes('revenue')) {
      return 'business';
    } else if (text.includes('operational') || text.includes('process') || text.includes('team')) {
      return 'operational';
    }
    
    return 'external';
  }

  private estimateEffort(content: string): number {
    // Estimate effort in hours based on content complexity
    const wordCount = this.countWords(content);
    const complexity = this.assessComplexity(content);
    
    let baseHours = Math.ceil(wordCount / 100); // 1 hour per 100 words
    
    switch (complexity) {
      case 'simple': return baseHours;
      case 'moderate': return baseHours * 2;
      case 'complex': return baseHours * 4;
      default: return baseHours;
    }
  }

  private estimateTaskDuration(content: string): number {
    // Estimate task duration in days
    const effortHours = this.estimateEffort(content);
    return Math.max(1, Math.ceil(effortHours / 8)); // 8 hour workday
  }

  private detectLanguage(code: string): string {
    // Simple language detection based on patterns
    if (code.includes('function') || code.includes('const') || code.includes('let')) return 'javascript';
    if (code.includes('def ') || code.includes('import ')) return 'python';
    if (code.includes('public class') || code.includes('private ')) return 'java';
    if (code.includes('#include') || code.includes('int main')) return 'c++';
    
    return 'unknown';
  }

  private extractFunctions(code: string): string[] {
    // Extract function names (simplified)
    const functionPattern = /function\s+(\w+)|def\s+(\w+)|(\w+)\s*\(/g;
    const functions: string[] = [];
    let match;
    
    while ((match = functionPattern.exec(code)) !== null) {
      functions.push(match[1] || match[2] || match[3]);
    }
    
    return functions;
  }

  private estimateColumns(tableContent: string): number {
    const lines = tableContent.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return 0;
    
    // Estimate columns by counting separators in first line
    const firstLine = lines[0];
    const separators = (firstLine.match(/[|,\t]/g) || []).length;
    return separators + 1;
  }

  private assessReadingLevel(text: string): 'elementary' | 'intermediate' | 'advanced' {
    const sentences = text.split(/[.!?]+/).length;
    const words = this.countWords(text);
    const syllables = this.countSyllables(text);
    
    // Simplified Flesch Reading Ease approximation
    const avgWordsPerSentence = words / sentences;
    const avgSyllablesPerWord = syllables / words;
    
    if (avgWordsPerSentence < 15 && avgSyllablesPerWord < 1.5) return 'elementary';
    if (avgWordsPerSentence < 20 && avgSyllablesPerWord < 2) return 'intermediate';
    return 'advanced';
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
      
    const stopWords = new Set(['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'have']);
    return words.filter(word => !stopWords.has(word));
  }

  private calculateSimilarity(keywords1: string[], keywords2: string[]): number {
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  private countSyllables(text: string): number {
    // Simplified syllable counting
    return text.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/[aeiou]{2,}/g, 'a') // Replace multiple vowels with single
      .match(/[aeiou]/g)?.length || 1;
  }

  private countDataPoints(data: any): number {
    // Recursively count data points in structured data
    let count = 0;
    
    const countRecursive = (obj: any): void => {
      if (Array.isArray(obj)) {
        count += obj.length;
        obj.forEach(item => countRecursive(item));
      } else if (typeof obj === 'object' && obj !== null) {
        Object.values(obj).forEach(value => countRecursive(value));
      } else {
        count++;
      }
    };
    
    countRecursive(data);
    return count;
  }

  private replaceNulls(key: string, value: any): any {
    return value === null ? undefined : value;
  }
}

export const structuredDataExporter = new StructuredDataExporter();