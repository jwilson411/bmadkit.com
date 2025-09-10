import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';
import { customBrandingManager } from './custom-branding-manager';

export type ExportFormat = 'markdown' | 'pdf' | 'docx' | 'json' | 'yaml' | 'html';

export interface ExportRequest {
  exportId: string;
  userId: string;
  sessionId: string;
  format: ExportFormat;
  options: ExportOptions;
  templateId?: string;
  customization?: {
    branding?: any;
    template?: string;
    variables?: Record<string, any>;
  };
  metadata: {
    title: string;
    description?: string;
    author?: string;
    tags?: string[];
  };
}

export interface ExportOptions {
  includeMetadata: boolean;
  includeTOC: boolean;
  includePageNumbers: boolean;
  includeTimestamp: boolean;
  includeWatermark: boolean;
  compressImages: boolean;
  optimizeForPrint: boolean;
  customCSS?: string;
  pageSize?: 'A4' | 'Letter' | 'Legal' | 'A3';
  orientation?: 'portrait' | 'landscape';
  margins?: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  quality?: 'draft' | 'standard' | 'high';
}

export interface ExportResult {
  exportId: string;
  success: boolean;
  format: ExportFormat;
  filePath?: string;
  fileUrl?: string;
  fileName: string;
  fileSize: number;
  generatedAt: Date;
  processingTime: number;
  metadata: {
    pages?: number;
    wordCount?: number;
    characterCount?: number;
    sections?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface BatchExportRequest {
  batchId: string;
  userId: string;
  sessionIds: string[];
  format: ExportFormat;
  options: ExportOptions;
  archiveFormat: 'zip' | 'tar';
  includeIndex: boolean;
  customization?: {
    branding?: any;
    template?: string;
    variables?: Record<string, any>;
  };
}

export interface BatchExportResult {
  batchId: string;
  success: boolean;
  archivePath?: string;
  archiveUrl?: string;
  archiveName: string;
  archiveSize: number;
  totalFiles: number;
  successfulExports: number;
  failedExports: number;
  generatedAt: Date;
  processingTime: number;
  individualResults: ExportResult[];
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ExportHistory {
  exportId: string;
  userId: string;
  sessionId?: string; // undefined for batch exports
  batchId?: string;
  format: ExportFormat;
  fileName: string;
  fileSize: number;
  downloadCount: number;
  createdAt: Date;
  expiresAt?: Date;
  lastDownloadedAt?: Date;
  status: 'processing' | 'completed' | 'failed' | 'expired';
  metadata: {
    title: string;
    description?: string;
    tags?: string[];
  };
  isArchived: boolean;
  sharedWith?: string[];
}

export interface DocumentContent {
  sessionId: string;
  title: string;
  content: any; // Structured document content
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    author?: string;
    tags?: string[];
    category?: string;
  };
  sections: Array<{
    id: string;
    title: string;
    content: string;
    type: 'text' | 'code' | 'table' | 'image' | 'chart';
    order: number;
    metadata?: any;
  }>;
}

class ExportProcessor extends EventEmitter {
  private exportHistory: Map<string, ExportHistory> = new Map();
  private processingQueue: Map<string, ExportRequest | BatchExportRequest> = new Map();
  private readonly EXPORT_STORAGE_PATH = process.env.EXPORT_STORAGE_PATH || './exports';
  private readonly MAX_CONCURRENT_EXPORTS = 5;
  private readonly DEFAULT_EXPIRY_DAYS = 30;

  constructor() {
    super();
    this.initializeStorageDirectory();
  }

  async exportDocument(request: ExportRequest): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      // Validate user permissions and limits
      const userContext = await subscriptionValidator.validateUserSubscription(request.userId);
      await this.validateExportPermissions(request, userContext);

      // Track usage
      await subscriptionValidator.trackUsage(request.userId, 'exportsPerMonth', 1);

      // Add to processing queue
      this.processingQueue.set(request.exportId, request);

      // Get document content
      const documentContent = await this.getDocumentContent(request.sessionId, request.userId);
      if (!documentContent) {
        throw new Error('Document content not found or access denied');
      }

      // Apply branding if available
      let branding = null;
      if (request.customization?.branding && userContext.features.includes(FeatureFlag.CUSTOM_BRANDING)) {
        branding = await customBrandingManager.getBrandingConfiguration(
          request.customization.branding.brandingId,
          request.userId
        );
      }

      // Generate export based on format
      const result = await this.processExport(request, documentContent, branding, userContext);

      // Save to export history
      const historyEntry: ExportHistory = {
        exportId: request.exportId,
        userId: request.userId,
        sessionId: request.sessionId,
        format: request.format,
        fileName: result.fileName,
        fileSize: result.fileSize,
        downloadCount: 0,
        createdAt: new Date(),
        expiresAt: this.calculateExpiryDate(userContext.tier),
        status: result.success ? 'completed' : 'failed',
        metadata: request.metadata,
        isArchived: false
      };

      await this.saveExportHistory(historyEntry);
      this.exportHistory.set(request.exportId, historyEntry);

      // Remove from processing queue
      this.processingQueue.delete(request.exportId);

      this.emit('exportCompleted', {
        userId: request.userId,
        exportId: request.exportId,
        format: request.format,
        success: result.success,
        processingTime: Date.now() - startTime
      });

      return {
        ...result,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      this.processingQueue.delete(request.exportId);
      
      this.emit('exportFailed', {
        userId: request.userId,
        exportId: request.exportId,
        format: request.format,
        error: error.message,
        processingTime: Date.now() - startTime
      });

      return {
        exportId: request.exportId,
        success: false,
        format: request.format,
        fileName: '',
        fileSize: 0,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata: {},
        error: {
          code: 'EXPORT_PROCESSING_ERROR',
          message: error.message
        }
      };
    }
  }

  async exportBatch(request: BatchExportRequest): Promise<BatchExportResult> {
    const startTime = Date.now();

    try {
      // Validate user permissions
      const userContext = await subscriptionValidator.validateUserSubscription(request.userId);
      await this.validateBatchExportPermissions(request, userContext);

      // Track usage for batch export
      await subscriptionValidator.trackUsage(request.userId, 'exportsPerMonth', request.sessionIds.length);

      // Add to processing queue
      this.processingQueue.set(request.batchId, request);

      const individualResults: ExportResult[] = [];
      let successfulExports = 0;
      let failedExports = 0;

      // Process each document
      for (const sessionId of request.sessionIds) {
        try {
          const exportRequest: ExportRequest = {
            exportId: `${request.batchId}_${sessionId}`,
            userId: request.userId,
            sessionId,
            format: request.format,
            options: request.options,
            customization: request.customization,
            metadata: {
              title: `Document ${sessionId}`,
              description: `Batch export document from session ${sessionId}`
            }
          };

          const result = await this.exportDocument(exportRequest);
          individualResults.push(result);

          if (result.success) {
            successfulExports++;
          } else {
            failedExports++;
          }

        } catch (error) {
          failedExports++;
          individualResults.push({
            exportId: `${request.batchId}_${sessionId}`,
            success: false,
            format: request.format,
            fileName: '',
            fileSize: 0,
            generatedAt: new Date(),
            processingTime: 0,
            metadata: {},
            error: {
              code: 'BATCH_EXPORT_ITEM_ERROR',
              message: error.message
            }
          });
        }
      }

      // Create archive
      const archiveResult = await this.createArchive(request, individualResults.filter(r => r.success));

      // Save batch export history
      const batchHistory: ExportHistory = {
        exportId: request.batchId,
        userId: request.userId,
        batchId: request.batchId,
        format: request.format,
        fileName: archiveResult.archiveName,
        fileSize: archiveResult.archiveSize,
        downloadCount: 0,
        createdAt: new Date(),
        expiresAt: this.calculateExpiryDate(userContext.tier),
        status: archiveResult.success ? 'completed' : 'failed',
        metadata: {
          title: `Batch Export ${request.batchId}`,
          description: `Batch export of ${request.sessionIds.length} documents`
        },
        isArchived: false
      };

      await this.saveExportHistory(batchHistory);
      this.exportHistory.set(request.batchId, batchHistory);

      // Remove from processing queue
      this.processingQueue.delete(request.batchId);

      const result: BatchExportResult = {
        batchId: request.batchId,
        success: archiveResult.success,
        archivePath: archiveResult.archivePath,
        archiveUrl: archiveResult.archiveUrl,
        archiveName: archiveResult.archiveName,
        archiveSize: archiveResult.archiveSize,
        totalFiles: request.sessionIds.length,
        successfulExports,
        failedExports,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        individualResults,
        error: archiveResult.success ? undefined : {
          code: 'BATCH_ARCHIVE_ERROR',
          message: 'Failed to create batch archive'
        }
      };

      this.emit('batchExportCompleted', {
        userId: request.userId,
        batchId: request.batchId,
        format: request.format,
        totalFiles: request.sessionIds.length,
        successfulExports,
        failedExports,
        processingTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      this.processingQueue.delete(request.batchId);
      
      this.emit('batchExportFailed', {
        userId: request.userId,
        batchId: request.batchId,
        error: error.message,
        processingTime: Date.now() - startTime
      });

      return {
        batchId: request.batchId,
        success: false,
        archiveName: '',
        archiveSize: 0,
        totalFiles: request.sessionIds.length,
        successfulExports: 0,
        failedExports: request.sessionIds.length,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        individualResults: [],
        error: {
          code: 'BATCH_EXPORT_ERROR',
          message: error.message
        }
      };
    }
  }

  async getExportHistory(userId: string, options: {
    page?: number;
    limit?: number;
    format?: ExportFormat;
    sortBy?: 'createdAt' | 'fileName' | 'fileSize';
    sortOrder?: 'asc' | 'desc';
    includeExpired?: boolean;
  } = {}): Promise<{
    history: ExportHistory[];
    totalCount: number;
    totalPages: number;
  }> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Export history is premium feature
      if (!userContext.features.includes(FeatureFlag.UNLIMITED_SESSION_HISTORY)) {
        throw new Error('Export history requires Premium subscription');
      }

      const history = await this.getUserExportHistory(userId, options);
      return history;

    } catch (error) {
      this.emit('exportHistoryError', { userId, error: error.message });
      throw error;
    }
  }

  async downloadExport(exportId: string, userId: string): Promise<{
    filePath: string;
    fileName: string;
    mimeType: string;
  }> {
    try {
      const historyEntry = await this.getExportHistoryEntry(exportId, userId);
      if (!historyEntry) {
        throw new Error('Export not found or access denied');
      }

      if (historyEntry.status !== 'completed') {
        throw new Error('Export is not ready for download');
      }

      if (historyEntry.expiresAt && historyEntry.expiresAt < new Date()) {
        throw new Error('Export has expired');
      }

      // Update download count and last downloaded date
      historyEntry.downloadCount++;
      historyEntry.lastDownloadedAt = new Date();
      await this.saveExportHistory(historyEntry);

      const filePath = await this.getExportFilePath(exportId);
      const mimeType = this.getMimeTypeForFormat(historyEntry.format);

      this.emit('exportDownloaded', {
        userId,
        exportId,
        format: historyEntry.format,
        downloadCount: historyEntry.downloadCount
      });

      return {
        filePath,
        fileName: historyEntry.fileName,
        mimeType
      };

    } catch (error) {
      this.emit('exportDownloadError', { userId, exportId, error: error.message });
      throw error;
    }
  }

  async deleteExport(exportId: string, userId: string): Promise<void> {
    try {
      const historyEntry = await this.getExportHistoryEntry(exportId, userId);
      if (!historyEntry) {
        throw new Error('Export not found or access denied');
      }

      // Delete physical file
      const filePath = await this.getExportFilePath(exportId);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // File might already be deleted, log but don't fail
        console.warn(`Could not delete export file: ${filePath}`);
      }

      // Remove from history
      await this.deleteExportHistory(exportId);
      this.exportHistory.delete(exportId);

      this.emit('exportDeleted', { userId, exportId });

    } catch (error) {
      this.emit('exportDeleteError', { userId, exportId, error: error.message });
      throw error;
    }
  }

  // Private helper methods

  private async validateExportPermissions(request: ExportRequest, userContext: UserSubscriptionContext): Promise<void> {
    // Check export limits
    const usageLimits = await subscriptionValidator.checkUsageLimits(userContext.userId);
    const exportLimit = usageLimits.exceededLimits.find(limit => limit.type === 'exportsPerMonth');
    
    if (exportLimit) {
      throw new Error(`Export limit exceeded. You have used ${exportLimit.used} of ${exportLimit.limit} exports this month.`);
    }

    // Check format-specific permissions
    if (request.format === 'pdf' && !userContext.features.includes(FeatureFlag.PREMIUM_TEMPLATE_LIBRARY)) {
      throw new Error('PDF export requires Premium subscription');
    }

    if (request.customization?.branding && !userContext.features.includes(FeatureFlag.CUSTOM_BRANDING)) {
      throw new Error('Custom branding in exports requires Enterprise subscription');
    }
  }

  private async validateBatchExportPermissions(request: BatchExportRequest, userContext: UserSubscriptionContext): Promise<void> {
    // Batch export is premium feature
    if (userContext.tier === UserTier.FREE || userContext.tier === UserTier.EMAIL_CAPTURED) {
      throw new Error('Batch export requires Premium subscription');
    }

    // Check batch size limits
    let maxBatchSize = 10;
    if (userContext.tier === UserTier.PREMIUM) {
      maxBatchSize = 50;
    } else if (userContext.tier === UserTier.ENTERPRISE) {
      maxBatchSize = 200;
    }

    if (request.sessionIds.length > maxBatchSize) {
      throw new Error(`Batch export limit exceeded. Maximum ${maxBatchSize} documents per batch for your tier.`);
    }
  }

  private async processExport(
    request: ExportRequest,
    content: DocumentContent,
    branding: any,
    userContext: UserSubscriptionContext
  ): Promise<ExportResult> {
    const processor = this.getFormatProcessor(request.format);
    if (!processor) {
      throw new Error(`Unsupported export format: ${request.format}`);
    }

    return await processor.process(request, content, branding, userContext);
  }

  private getFormatProcessor(format: ExportFormat): any {
    // This would return format-specific processors
    // For now, returning a mock processor
    return {
      process: async (request: ExportRequest, content: DocumentContent, branding: any, userContext: UserSubscriptionContext): Promise<ExportResult> => {
        // Mock implementation - each format would have its own processor
        const fileName = `${content.title}-${Date.now()}.${format}`;
        const filePath = path.join(this.EXPORT_STORAGE_PATH, fileName);
        
        // Generate content based on format
        let generatedContent = '';
        
        switch (format) {
          case 'markdown':
            generatedContent = await this.generateMarkdown(content, request.options, branding);
            break;
          case 'pdf':
            // Would use PDF generator
            generatedContent = 'PDF content placeholder';
            break;
          case 'docx':
            // Would use Word generator
            generatedContent = 'Word content placeholder';
            break;
          case 'json':
            generatedContent = JSON.stringify(content, null, 2);
            break;
          case 'yaml':
            generatedContent = this.convertToYAML(content);
            break;
          case 'html':
            generatedContent = await this.generateHTML(content, request.options, branding);
            break;
          default:
            throw new Error(`Unsupported format: ${format}`);
        }

        // Write file
        await fs.writeFile(filePath, generatedContent, 'utf8');
        const stats = await fs.stat(filePath);

        return {
          exportId: request.exportId,
          success: true,
          format: request.format,
          filePath,
          fileUrl: `/api/exports/${request.exportId}/download`,
          fileName,
          fileSize: stats.size,
          generatedAt: new Date(),
          processingTime: 0, // Will be set by caller
          metadata: {
            wordCount: this.countWords(generatedContent),
            characterCount: generatedContent.length,
            sections: content.sections.length
          }
        };
      }
    };
  }

  private async generateMarkdown(content: DocumentContent, options: ExportOptions, branding: any): Promise<string> {
    let markdown = '';

    // Add title
    markdown += `# ${content.title}\n\n`;

    // Add metadata if requested
    if (options.includeMetadata) {
      markdown += `**Created:** ${content.metadata.createdAt.toISOString().split('T')[0]}\n`;
      markdown += `**Updated:** ${content.metadata.updatedAt.toISOString().split('T')[0]}\n`;
      if (content.metadata.author) {
        markdown += `**Author:** ${content.metadata.author}\n`;
      }
      if (content.metadata.tags && content.metadata.tags.length > 0) {
        markdown += `**Tags:** ${content.metadata.tags.join(', ')}\n`;
      }
      markdown += '\n';
    }

    // Add timestamp if requested
    if (options.includeTimestamp) {
      markdown += `*Generated on ${new Date().toISOString()}*\n\n`;
    }

    // Add table of contents if requested
    if (options.includeTOC && content.sections.length > 1) {
      markdown += '## Table of Contents\n\n';
      for (const section of content.sections) {
        const anchor = section.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        markdown += `- [${section.title}](#${anchor})\n`;
      }
      markdown += '\n';
    }

    // Add sections
    for (const section of content.sections.sort((a, b) => a.order - b.order)) {
      markdown += `## ${section.title}\n\n`;
      
      switch (section.type) {
        case 'text':
          markdown += `${section.content}\n\n`;
          break;
        case 'code':
          markdown += `\`\`\`\n${section.content}\n\`\`\`\n\n`;
          break;
        case 'table':
          // Convert table data to markdown table format
          markdown += this.convertTableToMarkdown(section.content);
          break;
        case 'image':
          markdown += `![${section.title}](${section.content})\n\n`;
          break;
        default:
          markdown += `${section.content}\n\n`;
      }
    }

    // Add branding footer if available
    if (branding && branding.companyInfo?.name) {
      markdown += `---\n\n*Generated by ${branding.companyInfo.name}*\n`;
    }

    return markdown;
  }

  private async generateHTML(content: DocumentContent, options: ExportOptions, branding: any): Promise<string> {
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${content.title}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1, h2, h3, h4, h5, h6 { color: #2c3e50; }
        code { 
            background-color: #f4f4f4; 
            padding: 2px 4px; 
            border-radius: 3px; 
            font-family: 'Monaco', 'Consolas', monospace;
        }
        pre { 
            background-color: #f8f8f8; 
            padding: 15px; 
            border-radius: 5px; 
            overflow-x: auto;
        }
        table { 
            border-collapse: collapse; 
            width: 100%; 
            margin: 20px 0;
        }
        th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
        }
        th { background-color: #f2f2f2; }
        .metadata { 
            background-color: #f9f9f9; 
            padding: 15px; 
            border-left: 4px solid #3498db;
            margin: 20px 0;
        }
        .toc {
            background-color: #f9f9f9;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .toc ul { list-style-type: none; padding-left: 20px; }
        .toc a { text-decoration: none; color: #3498db; }
        .toc a:hover { text-decoration: underline; }
        ${options.customCSS || ''}
    </style>
</head>
<body>
`;

    // Add title
    html += `<h1>${content.title}</h1>\n`;

    // Add metadata if requested
    if (options.includeMetadata) {
      html += '<div class="metadata">\n';
      html += `<strong>Created:</strong> ${content.metadata.createdAt.toLocaleDateString()}<br>\n`;
      html += `<strong>Updated:</strong> ${content.metadata.updatedAt.toLocaleDateString()}<br>\n`;
      if (content.metadata.author) {
        html += `<strong>Author:</strong> ${content.metadata.author}<br>\n`;
      }
      if (content.metadata.tags && content.metadata.tags.length > 0) {
        html += `<strong>Tags:</strong> ${content.metadata.tags.join(', ')}<br>\n`;
      }
      html += '</div>\n';
    }

    // Add timestamp if requested
    if (options.includeTimestamp) {
      html += `<p><em>Generated on ${new Date().toLocaleString()}</em></p>\n`;
    }

    // Add table of contents if requested
    if (options.includeTOC && content.sections.length > 1) {
      html += '<div class="toc">\n<h2>Table of Contents</h2>\n<ul>\n';
      for (const section of content.sections) {
        const anchor = section.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        html += `<li><a href="#${anchor}">${section.title}</a></li>\n`;
      }
      html += '</ul>\n</div>\n';
    }

    // Add sections
    for (const section of content.sections.sort((a, b) => a.order - b.order)) {
      const anchor = section.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      html += `<h2 id="${anchor}">${section.title}</h2>\n`;
      
      switch (section.type) {
        case 'text':
          html += `<p>${section.content.replace(/\n/g, '</p>\n<p>')}</p>\n`;
          break;
        case 'code':
          html += `<pre><code>${section.content}</code></pre>\n`;
          break;
        case 'table':
          html += this.convertTableToHTML(section.content);
          break;
        case 'image':
          html += `<img src="${section.content}" alt="${section.title}" style="max-width: 100%; height: auto;">\n`;
          break;
        default:
          html += `<div>${section.content}</div>\n`;
      }
    }

    // Add branding footer if available
    if (branding && branding.companyInfo?.name) {
      html += `<hr>\n<footer><em>Generated by ${branding.companyInfo.name}</em></footer>\n`;
    }

    html += '</body>\n</html>';
    return html;
  }

  private convertToYAML(content: DocumentContent): string {
    // Simple YAML conversion - would use proper YAML library in production
    const yamlData = {
      title: content.title,
      metadata: content.metadata,
      sections: content.sections
    };
    
    // Mock YAML conversion
    return JSON.stringify(yamlData, null, 2).replace(/"/g, '').replace(/,$/gm, '');
  }

  private convertTableToMarkdown(tableData: any): string {
    // Mock table conversion - would parse actual table data
    return '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Data 1 | Data 2 | Data 3 |\n\n';
  }

  private convertTableToHTML(tableData: any): string {
    // Mock table conversion - would parse actual table data
    return '<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>Data 1</td><td>Data 2</td><td>Data 3</td></tr></tbody></table>\n';
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  private async createArchive(request: BatchExportRequest, results: ExportResult[]): Promise<{
    success: boolean;
    archivePath?: string;
    archiveUrl?: string;
    archiveName: string;
    archiveSize: number;
  }> {
    try {
      const archiveName = `batch-export-${request.batchId}.${request.archiveFormat}`;
      const archivePath = path.join(this.EXPORT_STORAGE_PATH, archiveName);

      // Mock archive creation - would use archiver library
      let totalSize = 0;
      for (const result of results) {
        if (result.filePath) {
          totalSize += result.fileSize;
        }
      }

      // Create mock archive file
      await fs.writeFile(archivePath, `Archive containing ${results.length} files`, 'utf8');
      
      return {
        success: true,
        archivePath,
        archiveUrl: `/api/exports/batch/${request.batchId}/download`,
        archiveName,
        archiveSize: totalSize
      };

    } catch (error) {
      return {
        success: false,
        archiveName: `batch-export-${request.batchId}.${request.archiveFormat}`,
        archiveSize: 0
      };
    }
  }

  private calculateExpiryDate(tier: UserTier): Date | undefined {
    if (tier === UserTier.FREE || tier === UserTier.EMAIL_CAPTURED) {
      // Free tier exports expire after 7 days
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      return expiry;
    } else if (tier === UserTier.PREMIUM) {
      // Premium exports expire after 90 days
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      return expiry;
    }
    // Enterprise exports don't expire
    return undefined;
  }

  private getMimeTypeForFormat(format: ExportFormat): string {
    const mimeTypes: Record<ExportFormat, string> = {
      markdown: 'text/markdown',
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      json: 'application/json',
      yaml: 'application/x-yaml',
      html: 'text/html'
    };

    return mimeTypes[format] || 'application/octet-stream';
  }

  private async initializeStorageDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.EXPORT_STORAGE_PATH, { recursive: true });
    } catch (error) {
      console.error('Failed to initialize export storage directory:', error);
    }
  }

  // Database operations (would be implemented with your chosen database)
  private async getDocumentContent(sessionId: string, userId: string): Promise<DocumentContent | null> {
    // Mock implementation - would fetch from database
    return {
      sessionId,
      title: 'Sample Document',
      content: {},
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        author: 'User',
        tags: ['planning', 'architecture'],
        category: 'planning'
      },
      sections: [
        {
          id: '1',
          title: 'Introduction',
          content: 'This is the introduction section.',
          type: 'text',
          order: 1
        },
        {
          id: '2', 
          title: 'Technical Details',
          content: 'console.log("Hello World");',
          type: 'code',
          order: 2
        }
      ]
    };
  }

  private async saveExportHistory(history: ExportHistory): Promise<void> {
    // Save to database
  }

  private async deleteExportHistory(exportId: string): Promise<void> {
    // Delete from database
  }

  private async getExportHistoryEntry(exportId: string, userId: string): Promise<ExportHistory | null> {
    // Fetch from database
    return this.exportHistory.get(exportId) || null;
  }

  private async getUserExportHistory(userId: string, options: any): Promise<{
    history: ExportHistory[];
    totalCount: number;
    totalPages: number;
  }> {
    // Fetch from database with pagination
    return {
      history: [],
      totalCount: 0,
      totalPages: 0
    };
  }

  private async getExportFilePath(exportId: string): Promise<string> {
    // Get file path for export
    return path.join(this.EXPORT_STORAGE_PATH, `${exportId}.txt`);
  }

  generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const exportProcessor = new ExportProcessor();