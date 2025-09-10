import { marked } from 'marked';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import {
  Document,
  DocumentSection,
  DocumentTemplate,
  DocumentType,
  DocumentPreview,
  DocumentUpdateEvent,
  calculateReadingTime
} from '../models/document';

export interface CompilationOptions {
  format: 'markdown' | 'html';
  includeTableOfContents: boolean;
  enableSyntaxHighlighting: boolean;
  customStyles?: string;
  watermark?: string;
  sectionAnchors: boolean;
}

export interface CompilationResult {
  success: boolean;
  content: string;
  format: string;
  metadata: {
    wordCount: number;
    readingTime: number;
    sectionCount: number;
    lastUpdated: Date;
    checksum: string;
  };
  errors?: Array<{
    code: string;
    message: string;
    section?: string;
  }>;
  warnings?: string[];
  performanceMetrics: {
    compilationTime: number;
    memoryUsed: number;
    cacheHits: number;
  };
}

export interface SectionCompilationContext {
  section: DocumentSection;
  document: Document;
  template: DocumentTemplate;
  isIncremental: boolean;
  previousContent?: string;
}

export class DocumentCompiler extends EventEmitter {
  private markedInstance: typeof marked;
  private compilationCache: Map<string, { content: string; checksum: string; timestamp: Date }> = new Map();
  private sectionCache: Map<string, string> = new Map();

  constructor() {
    super();
    this.initializeMarked();
  }

  /**
   * Compile a complete document from sections
   */
  async compileDocument(
    document: Document,
    template: DocumentTemplate,
    options: Partial<CompilationOptions> = {}
  ): Promise<CompilationResult> {
    
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    try {
      logger.info('Starting document compilation', {
        documentId: document.id,
        documentType: document.type,
        sectionCount: document.sections.length
      });

      // Validate inputs
      this.validateCompilationInputs(document, template);

      // Set default options
      const compilationOptions: CompilationOptions = {
        format: 'markdown',
        includeTableOfContents: false,
        enableSyntaxHighlighting: true,
        sectionAnchors: true,
        ...options
      };

      // Sort sections by order
      const sortedSections = [...document.sections].sort((a, b) => a.order - b.order);

      // Compile sections
      const compiledSections: string[] = [];
      let cacheHits = 0;

      for (const section of sortedSections) {
        const sectionResult = await this.compileSection({
          section,
          document,
          template,
          isIncremental: false
        });

        if (sectionResult.fromCache) {
          cacheHits++;
        }

        compiledSections.push(sectionResult.content);
      }

      // Assemble final document
      let finalContent = '';

      // Add table of contents if requested
      if (compilationOptions.includeTableOfContents) {
        finalContent += this.generateTableOfContents(sortedSections);
        finalContent += '\n\n---\n\n';
      }

      // Combine sections
      finalContent += compiledSections.join('\n\n---\n\n');

      // Add watermark if specified
      if (compilationOptions.watermark) {
        finalContent += `\n\n*${compilationOptions.watermark}*`;
      }

      // Process final content based on format
      if (compilationOptions.format === 'html') {
        finalContent = await this.convertToHtml(finalContent, compilationOptions);
      }

      // Calculate metadata
      const wordCount = this.calculateWordCount(finalContent);
      const readingTime = calculateReadingTime(wordCount);
      const checksum = this.generateChecksum(finalContent);

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      const result: CompilationResult = {
        success: true,
        content: finalContent,
        format: compilationOptions.format,
        metadata: {
          wordCount,
          readingTime,
          sectionCount: sortedSections.length,
          lastUpdated: new Date(),
          checksum
        },
        performanceMetrics: {
          compilationTime: endTime - startTime,
          memoryUsed: endMemory - startMemory,
          cacheHits
        }
      };

      // Cache the result
      this.cacheCompilationResult(document.id, result);

      // Emit compilation event
      this.emit('document-compiled', {
        documentId: document.id,
        success: true,
        metadata: result.metadata,
        performance: result.performanceMetrics
      });

      logger.info('Document compilation completed', {
        documentId: document.id,
        wordCount,
        compilationTime: result.performanceMetrics.compilationTime,
        cacheHits
      });

      return result;

    } catch (error) {
      const endTime = Date.now();
      
      logger.error('Document compilation failed', {
        documentId: document.id,
        error: (error as Error).message,
        compilationTime: endTime - startTime
      });

      const result: CompilationResult = {
        success: false,
        content: '',
        format: options.format || 'markdown',
        metadata: {
          wordCount: 0,
          readingTime: 0,
          sectionCount: 0,
          lastUpdated: new Date(),
          checksum: ''
        },
        errors: [{
          code: 'COMPILATION_ERROR',
          message: (error as Error).message
        }],
        performanceMetrics: {
          compilationTime: endTime - startTime,
          memoryUsed: 0,
          cacheHits: 0
        }
      };

      this.emit('compilation-error', {
        documentId: document.id,
        error: error as Error
      });

      return result;
    }
  }

  /**
   * Compile a single section (for incremental updates)
   */
  async compileSection(context: SectionCompilationContext): Promise<{
    content: string;
    fromCache: boolean;
    checksum: string;
  }> {
    
    const { section, document, template } = context;
    const cacheKey = `${document.id}_${section.id}_${section.lastUpdated.getTime()}`;
    
    // Check cache first
    if (this.sectionCache.has(cacheKey)) {
      const cachedContent = this.sectionCache.get(cacheKey)!;
      return {
        content: cachedContent,
        fromCache: true,
        checksum: this.generateChecksum(cachedContent)
      };
    }

    logger.debug('Compiling section', {
      documentId: document.id,
      sectionId: section.id,
      sectionTitle: section.title
    });

    try {
      // Find section template
      const sectionTemplate = template.sections.find(s => s.id === section.id);
      
      let compiledContent = '';

      // Add section header
      if (section.title) {
        const headerLevel = this.determineSectionHeaderLevel(section, document);
        compiledContent += `${'#'.repeat(headerLevel)} ${section.title}\n\n`;
      }

      // Add section content
      if (section.content) {
        // Process any embedded templates or variables
        compiledContent += await this.processEmbeddedTemplates(section.content, context);
      } else if (sectionTemplate) {
        // Use template default content or placeholder
        compiledContent += `*${sectionTemplate.title} content will be generated during the ${section.sourceAgentPhase?.toLowerCase() || 'planning'} phase.*`;
      }

      // Add section anchor if needed
      if (section.id) {
        compiledContent = `<a id="${section.id}"></a>\n\n${compiledContent}`;
      }

      const checksum = this.generateChecksum(compiledContent);

      // Cache the compiled section
      this.sectionCache.set(cacheKey, compiledContent);

      return {
        content: compiledContent,
        fromCache: false,
        checksum
      };

    } catch (error) {
      logger.error('Section compilation failed', {
        documentId: document.id,
        sectionId: section.id,
        error: (error as Error).message
      });

      // Return error placeholder
      const errorContent = `### ${section.title}\n\n*Error: Unable to generate content for this section. ${(error as Error).message}*`;
      return {
        content: errorContent,
        fromCache: false,
        checksum: this.generateChecksum(errorContent)
      };
    }
  }

  /**
   * Generate document preview
   */
  async generatePreview(
    document: Document,
    template: DocumentTemplate,
    options: Partial<CompilationOptions> = {}
  ): Promise<DocumentPreview> {
    
    logger.debug('Generating document preview', { documentId: document.id });

    const compilationResult = await this.compileDocument(document, template, {
      format: 'html',
      includeTableOfContents: true,
      sectionAnchors: true,
      ...options
    });

    if (!compilationResult.success) {
      throw new Error(`Preview generation failed: ${compilationResult.errors?.[0]?.message}`);
    }

    // Generate section previews with anchors
    const sectionPreviews = document.sections
      .sort((a, b) => a.order - b.order)
      .map(section => ({
        id: section.id,
        title: section.title,
        content: section.content.substring(0, 500) + (section.content.length > 500 ? '...' : ''),
        anchor: `#${section.id}`
      }));

    const preview: DocumentPreview = {
      documentId: document.id,
      content: compilationResult.content,
      sections: sectionPreviews,
      metadata: {
        wordCount: compilationResult.metadata.wordCount,
        readingTime: compilationResult.metadata.readingTime,
        lastUpdated: compilationResult.metadata.lastUpdated,
        completionPercentage: this.calculateCompletionPercentage(document)
      }
    };

    this.emit('preview-generated', {
      documentId: document.id,
      wordCount: preview.metadata.wordCount,
      completionPercentage: preview.metadata.completionPercentage
    });

    return preview;
  }

  /**
   * Process incremental section update
   */
  async processIncrementalUpdate(
    document: Document,
    updatedSection: DocumentSection,
    template: DocumentTemplate
  ): Promise<DocumentUpdateEvent> {
    
    logger.debug('Processing incremental section update', {
      documentId: document.id,
      sectionId: updatedSection.id
    });

    try {
      const compilationResult = await this.compileSection({
        section: updatedSection,
        document,
        template,
        isIncremental: true
      });

      const updateEvent: DocumentUpdateEvent = {
        documentId: document.id,
        type: 'SECTION_UPDATED',
        sectionId: updatedSection.id,
        content: compilationResult.content,
        progress: this.calculateCompletionPercentage(document),
        timestamp: new Date()
      };

      this.emit('section-updated', updateEvent);

      return updateEvent;

    } catch (error) {
      const errorEvent: DocumentUpdateEvent = {
        documentId: document.id,
        type: 'ERROR_OCCURRED',
        sectionId: updatedSection.id,
        error: {
          code: 'INCREMENTAL_UPDATE_ERROR',
          message: (error as Error).message
        },
        timestamp: new Date()
      };

      this.emit('update-error', errorEvent);

      return errorEvent;
    }
  }

  /**
   * Initialize marked with custom configuration
   */
  private initializeMarked(): void {
    this.markedInstance = marked;

    // Configure marked options
    this.markedInstance.setOptions({
      gfm: true, // GitHub Flavored Markdown
      breaks: true, // Convert line breaks to <br>
      pedantic: false,
      sanitize: false, // We'll handle sanitization separately
      smartLists: true,
      smartypants: true
    });

    // Add custom renderer for enhanced functionality
    const renderer = new this.markedInstance.Renderer();
    
    // Custom heading renderer with anchors
    renderer.heading = (text: string, level: number) => {
      const anchor = text.toLowerCase().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
      return `<h${level} id="${anchor}">${text}</h${level}>`;
    };

    // Custom table renderer with styling
    renderer.table = (header: string, body: string) => {
      return `<div class="table-container"><table class="bmad-table">${header}${body}</table></div>`;
    };

    // Custom code renderer with syntax highlighting placeholders
    renderer.code = (code: string, language?: string) => {
      const lang = language || 'text';
      return `<pre class="code-block language-${lang}"><code>${code}</code></pre>`;
    };

    this.markedInstance.use({ renderer });
  }

  /**
   * Validate compilation inputs
   */
  private validateCompilationInputs(document: Document, template: DocumentTemplate): void {
    if (!document) {
      throw new Error('Document is required for compilation');
    }
    
    if (!template) {
      throw new Error('Template is required for compilation');
    }
    
    if (document.type !== template.type) {
      throw new Error(`Document type ${document.type} does not match template type ${template.type}`);
    }
  }

  /**
   * Generate table of contents
   */
  private generateTableOfContents(sections: DocumentSection[]): string {
    let toc = '## Table of Contents\n\n';
    
    sections.forEach((section, index) => {
      const anchor = section.id || section.title.toLowerCase().replace(/\s+/g, '-');
      toc += `${index + 1}. [${section.title}](#${anchor})\n`;
    });
    
    return toc;
  }

  /**
   * Convert markdown to HTML
   */
  private async convertToHtml(content: string, options: CompilationOptions): Promise<string> {
    try {
      let htmlContent = await this.markedInstance.parse(content);
      
      // Add custom styles if provided
      if (options.customStyles) {
        htmlContent = `<style>${options.customStyles}</style>\n${htmlContent}`;
      }
      
      // Wrap in document structure
      htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BMAD Document</title>
  <style>
    .bmad-table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    .bmad-table th, .bmad-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .bmad-table th { background-color: #f5f5f5; font-weight: bold; }
    .code-block { background-color: #f8f8f8; padding: 1em; border-radius: 4px; overflow-x: auto; }
    .table-container { overflow-x: auto; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2em; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
      
      return htmlContent;
      
    } catch (error) {
      throw new Error(`HTML conversion failed: ${(error as Error).message}`);
    }
  }

  /**
   * Process embedded templates within section content
   */
  private async processEmbeddedTemplates(content: string, context: SectionCompilationContext): Promise<string> {
    // For now, return content as-is
    // This could be enhanced to support embedded Handlebars expressions
    return content;
  }

  /**
   * Determine appropriate header level for section
   */
  private determineSectionHeaderLevel(section: DocumentSection, document: Document): number {
    // Start with h2 for main sections, h3 for subsections, etc.
    const baseLevel = 2;
    
    // Could be enhanced to analyze section hierarchy
    return baseLevel;
  }

  /**
   * Calculate word count
   */
  private calculateWordCount(content: string): number {
    // Remove markdown syntax and count words
    const plainText = content
      .replace(/[#*`_\[\]()]/g, '') // Remove markdown characters
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();
    
    if (!plainText) return 0;
    
    return plainText.split(/\s+/).length;
  }

  /**
   * Calculate document completion percentage
   */
  private calculateCompletionPercentage(document: Document): number {
    if (document.sections.length === 0) return 0;
    
    const totalCompletion = document.sections.reduce((sum, section) => sum + section.completionPercentage, 0);
    return Math.round(totalCompletion / document.sections.length);
  }

  /**
   * Generate content checksum
   */
  private generateChecksum(content: string): string {
    // Simple hash function for content verification
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Cache compilation result
   */
  private cacheCompilationResult(documentId: string, result: CompilationResult): void {
    this.compilationCache.set(documentId, {
      content: result.content,
      checksum: result.metadata.checksum,
      timestamp: new Date()
    });

    // Cleanup old cache entries (keep last 100)
    if (this.compilationCache.size > 100) {
      const entries = Array.from(this.compilationCache.entries());
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
      
      // Remove oldest 20 entries
      for (let i = 0; i < 20; i++) {
        this.compilationCache.delete(entries[i][0]);
      }
    }
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.compilationCache.clear();
    this.sectionCache.clear();
    logger.debug('Document compiler caches cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    compilationCacheSize: number;
    sectionCacheSize: number;
  } {
    return {
      compilationCacheSize: this.compilationCache.size,
      sectionCacheSize: this.sectionCache.size
    };
  }
}