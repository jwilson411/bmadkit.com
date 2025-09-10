import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { Readable } from 'stream';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';
import { ExportFormat, ExportRequest, ExportResult, BatchExportRequest, BatchExportResult } from './export-processor';

export interface BatchJob {
  batchId: string;
  userId: string;
  sessionIds: string[];
  format: ExportFormat;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    completed: number;
    failed: number;
    percentage: number;
  };
  results: ExportResult[];
  archive?: {
    path: string;
    url: string;
    name: string;
    size: number;
  };
  timing: {
    queuedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    estimatedCompletion?: Date;
  };
  options: {
    archiveFormat: 'zip' | 'tar' | 'tar.gz';
    includeIndex: boolean;
    includeMetadata: boolean;
    customization?: any;
  };
  error?: {
    code: string;
    message: string;
    failedItems: string[];
  };
}

export interface BatchProgress {
  batchId: string;
  status: string;
  progress: number;
  currentItem?: string;
  estimatedTimeRemaining?: number;
  completedItems: number;
  totalItems: number;
  failedItems: number;
  results: ExportResult[];
}

export interface IndexDocument {
  generatedAt: string;
  batchId: string;
  totalDocuments: number;
  successfulExports: number;
  failedExports: number;
  format: ExportFormat;
  user: string;
  documents: Array<{
    sessionId: string;
    title: string;
    fileName: string;
    status: 'success' | 'failed';
    size?: number;
    error?: string;
  }>;
  metadata: {
    exportDuration: string;
    archiveSize: string;
    compression: string;
  };
}

class BatchExportManager extends EventEmitter {
  private activeBatches: Map<string, BatchJob> = new Map();
  private processingQueue: BatchJob[] = [];
  private readonly MAX_CONCURRENT_BATCHES = 3;
  private readonly MAX_BATCH_SIZE = 100;
  private readonly BATCH_TIMEOUT = 1000 * 60 * 30; // 30 minutes
  
  constructor() {
    super();
    this.startBatchProcessor();
  }

  async createBatchExport(request: BatchExportRequest): Promise<string> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(request.userId);
      
      // Validate batch export permissions
      await this.validateBatchExportPermissions(request, userContext);

      const batchJob: BatchJob = {
        batchId: request.batchId,
        userId: request.userId,
        sessionIds: request.sessionIds,
        format: request.format,
        status: 'queued',
        progress: {
          total: request.sessionIds.length,
          completed: 0,
          failed: 0,
          percentage: 0
        },
        results: [],
        timing: {
          queuedAt: new Date()
        },
        options: {
          archiveFormat: request.archiveFormat,
          includeIndex: request.includeIndex,
          includeMetadata: true,
          customization: request.customization
        }
      };

      // Add to processing queue
      this.activeBatches.set(request.batchId, batchJob);
      this.processingQueue.push(batchJob);

      // Track usage
      await subscriptionValidator.trackUsage(request.userId, 'exportsPerMonth', request.sessionIds.length);

      this.emit('batchQueued', {
        batchId: request.batchId,
        userId: request.userId,
        totalItems: request.sessionIds.length,
        format: request.format
      });

      return request.batchId;

    } catch (error) {
      this.emit('batchError', {
        batchId: request.batchId,
        userId: request.userId,
        error: error.message
      });
      throw error;
    }
  }

  async getBatchProgress(batchId: string, userId: string): Promise<BatchProgress | null> {
    try {
      const batch = this.activeBatches.get(batchId);
      if (!batch || batch.userId !== userId) {
        return null;
      }

      // Calculate estimated time remaining
      let estimatedTimeRemaining: number | undefined;
      if (batch.status === 'processing' && batch.timing.startedAt) {
        const elapsed = Date.now() - batch.timing.startedAt.getTime();
        const avgTimePerItem = elapsed / Math.max(batch.progress.completed, 1);
        const remainingItems = batch.progress.total - batch.progress.completed;
        estimatedTimeRemaining = Math.round((remainingItems * avgTimePerItem) / 1000); // seconds
      }

      return {
        batchId,
        status: batch.status,
        progress: batch.progress.percentage,
        currentItem: this.getCurrentProcessingItem(batch),
        estimatedTimeRemaining,
        completedItems: batch.progress.completed,
        totalItems: batch.progress.total,
        failedItems: batch.progress.failed,
        results: batch.results
      };

    } catch (error) {
      this.emit('progressError', { batchId, userId, error: error.message });
      return null;
    }
  }

  async cancelBatchExport(batchId: string, userId: string): Promise<void> {
    try {
      const batch = this.activeBatches.get(batchId);
      if (!batch || batch.userId !== userId) {
        throw new Error('Batch export not found or access denied');
      }

      if (batch.status === 'completed') {
        throw new Error('Cannot cancel completed batch export');
      }

      // Update status
      batch.status = 'cancelled';
      batch.timing.completedAt = new Date();

      // Remove from processing queue if not started
      if (batch.status === 'queued') {
        this.processingQueue = this.processingQueue.filter(job => job.batchId !== batchId);
      }

      this.emit('batchCancelled', { batchId, userId });

    } catch (error) {
      this.emit('cancelError', { batchId, userId, error: error.message });
      throw error;
    }
  }

  async getBatchResult(batchId: string, userId: string): Promise<BatchExportResult | null> {
    try {
      const batch = this.activeBatches.get(batchId);
      if (!batch || batch.userId !== userId) {
        return null;
      }

      if (batch.status !== 'completed' && batch.status !== 'failed') {
        return null;
      }

      const processingTime = batch.timing.completedAt && batch.timing.startedAt
        ? batch.timing.completedAt.getTime() - batch.timing.startedAt.getTime()
        : 0;

      const result: BatchExportResult = {
        batchId: batch.batchId,
        success: batch.status === 'completed',
        archivePath: batch.archive?.path,
        archiveUrl: batch.archive?.url,
        archiveName: batch.archive?.name || '',
        archiveSize: batch.archive?.size || 0,
        totalFiles: batch.progress.total,
        successfulExports: batch.progress.completed,
        failedExports: batch.progress.failed,
        generatedAt: batch.timing.completedAt || new Date(),
        processingTime,
        individualResults: batch.results,
        error: batch.error
      };

      return result;

    } catch (error) {
      this.emit('resultError', { batchId, userId, error: error.message });
      return null;
    }
  }

  async downloadBatchArchive(batchId: string, userId: string): Promise<{
    filePath: string;
    fileName: string;
    mimeType: string;
  }> {
    try {
      const batch = this.activeBatches.get(batchId);
      if (!batch || batch.userId !== userId) {
        throw new Error('Batch export not found or access denied');
      }

      if (!batch.archive || batch.status !== 'completed') {
        throw new Error('Batch archive is not ready for download');
      }

      // Verify file exists
      try {
        await fs.access(batch.archive.path);
      } catch {
        throw new Error('Batch archive file not found');
      }

      const mimeType = this.getMimeTypeForArchive(batch.options.archiveFormat);

      return {
        filePath: batch.archive.path,
        fileName: batch.archive.name,
        mimeType
      };

    } catch (error) {
      this.emit('downloadError', { batchId, userId, error: error.message });
      throw error;
    }
  }

  // Private methods

  private async validateBatchExportPermissions(request: BatchExportRequest, userContext: UserSubscriptionContext): Promise<void> {
    // Batch export is premium feature
    if (userContext.tier === UserTier.FREE) {
      throw new Error('Batch export requires Premium subscription');
    }

    // Check batch size limits
    let maxBatchSize = 10;
    if (userContext.tier === UserTier.EMAIL_CAPTURED) {
      maxBatchSize = 25;
    } else if (userContext.tier === UserTier.PREMIUM) {
      maxBatchSize = 50;
    } else if (userContext.tier === UserTier.ENTERPRISE) {
      maxBatchSize = this.MAX_BATCH_SIZE;
    }

    if (request.sessionIds.length > maxBatchSize) {
      throw new Error(`Batch size exceeds limit. Your tier allows up to ${maxBatchSize} items per batch.`);
    }

    // Check export limits
    const usageLimits = await subscriptionValidator.checkUsageLimits(userContext.userId);
    const exportLimit = usageLimits.exceededLimits.find(limit => limit.type === 'exportsPerMonth');
    
    if (exportLimit && exportLimit.used + request.sessionIds.length > exportLimit.limit) {
      throw new Error(`Export limit would be exceeded. You need ${request.sessionIds.length} exports but only have ${exportLimit.limit - exportLimit.used} remaining.`);
    }
  }

  private startBatchProcessor(): void {
    setInterval(async () => {
      await this.processBatches();
    }, 5000); // Check every 5 seconds

    // Cleanup completed batches
    setInterval(() => {
      this.cleanupCompletedBatches();
    }, 1000 * 60 * 60); // Every hour
  }

  private async processBatches(): Promise<void> {
    const activeBatchCount = Array.from(this.activeBatches.values())
      .filter(batch => batch.status === 'processing').length;

    if (activeBatchCount >= this.MAX_CONCURRENT_BATCHES || this.processingQueue.length === 0) {
      return;
    }

    const nextBatch = this.processingQueue.shift();
    if (nextBatch) {
      await this.processBatch(nextBatch);
    }
  }

  private async processBatch(batch: BatchJob): Promise<void> {
    try {
      batch.status = 'processing';
      batch.timing.startedAt = new Date();

      this.emit('batchStarted', {
        batchId: batch.batchId,
        userId: batch.userId,
        totalItems: batch.progress.total
      });

      // Process each session
      for (let i = 0; i < batch.sessionIds.length; i++) {
        const sessionId = batch.sessionIds[i];

        try {
          // Create export request for this session
          const exportRequest: ExportRequest = {
            exportId: `${batch.batchId}_${sessionId}`,
            userId: batch.userId,
            sessionId,
            format: batch.format,
            options: {
              includeMetadata: batch.options.includeMetadata,
              includeTOC: false,
              includePageNumbers: true,
              includeTimestamp: true,
              includeWatermark: false,
              compressImages: true,
              optimizeForPrint: false
            },
            customization: batch.options.customization,
            metadata: {
              title: `Document ${sessionId}`,
              description: `Batch export document from session ${sessionId}`
            }
          };

          // Export the document (would call actual export processor)
          const result = await this.exportSingleDocument(exportRequest);
          batch.results.push(result);

          if (result.success) {
            batch.progress.completed++;
          } else {
            batch.progress.failed++;
          }

        } catch (error) {
          console.error(`Failed to export session ${sessionId}:`, error);
          batch.progress.failed++;
          
          batch.results.push({
            exportId: `${batch.batchId}_${sessionId}`,
            success: false,
            format: batch.format,
            fileName: '',
            fileSize: 0,
            generatedAt: new Date(),
            processingTime: 0,
            metadata: {},
            error: {
              code: 'EXPORT_FAILED',
              message: error.message
            }
          });
        }

        // Update progress
        batch.progress.percentage = Math.round(
          ((batch.progress.completed + batch.progress.failed) / batch.progress.total) * 100
        );

        this.emit('batchProgress', {
          batchId: batch.batchId,
          progress: batch.progress.percentage,
          completed: batch.progress.completed,
          failed: batch.progress.failed
        });

        // Check for timeout
        if (batch.timing.startedAt && Date.now() - batch.timing.startedAt.getTime() > this.BATCH_TIMEOUT) {
          throw new Error('Batch export timeout');
        }
      }

      // Create archive
      await this.createBatchArchive(batch);

      // Mark as completed
      batch.status = 'completed';
      batch.timing.completedAt = new Date();

      this.emit('batchCompleted', {
        batchId: batch.batchId,
        userId: batch.userId,
        successfulExports: batch.progress.completed,
        failedExports: batch.progress.failed,
        archiveSize: batch.archive?.size
      });

    } catch (error) {
      batch.status = 'failed';
      batch.timing.completedAt = new Date();
      batch.error = {
        code: 'BATCH_PROCESSING_ERROR',
        message: error.message,
        failedItems: []
      };

      this.emit('batchFailed', {
        batchId: batch.batchId,
        userId: batch.userId,
        error: error.message
      });
    }
  }

  private async exportSingleDocument(request: ExportRequest): Promise<ExportResult> {
    // Mock export implementation - would call actual export processor
    const fileName = `document_${request.sessionId}_${Date.now()}.${request.format}`;
    const filePath = path.join(process.env.EXPORT_STORAGE_PATH || './exports', fileName);
    
    // Simulate export processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000)); // 1-3 seconds
    
    // Create mock file
    const content = `Mock ${request.format} content for session ${request.sessionId}`;
    await fs.writeFile(filePath, content, 'utf8');
    const stats = await fs.stat(filePath);

    return {
      exportId: request.exportId,
      success: Math.random() > 0.1, // 90% success rate for demo
      format: request.format,
      filePath,
      fileUrl: `/api/exports/${request.exportId}/download`,
      fileName,
      fileSize: stats.size,
      generatedAt: new Date(),
      processingTime: Math.random() * 3000 + 1000,
      metadata: {
        wordCount: content.length,
        sections: 1
      }
    };
  }

  private async createBatchArchive(batch: BatchJob): Promise<void> {
    const archiveName = `batch_${batch.batchId}.${batch.options.archiveFormat}`;
    const archivePath = path.join(process.env.EXPORT_STORAGE_PATH || './exports', archiveName);

    try {
      // Create archive based on format
      if (batch.options.archiveFormat === 'zip') {
        await this.createZipArchive(batch, archivePath);
      } else {
        throw new Error(`Archive format ${batch.options.archiveFormat} not yet supported`);
      }

      const stats = await fs.stat(archivePath);
      
      batch.archive = {
        path: archivePath,
        url: `/api/exports/batch/${batch.batchId}/download`,
        name: archiveName,
        size: stats.size
      };

    } catch (error) {
      throw new Error(`Failed to create archive: ${error.message}`);
    }
  }

  private async createZipArchive(batch: BatchJob, archivePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(archivePath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Best compression
      });

      output.on('close', () => {
        console.log(`Archive created: ${archive.pointer()} total bytes`);
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add successful exports to archive
      const successfulResults = batch.results.filter(r => r.success && r.filePath);
      
      for (const result of successfulResults) {
        if (result.filePath) {
          try {
            archive.file(result.filePath, { name: result.fileName });
          } catch (error) {
            console.warn(`Failed to add file to archive: ${result.fileName}`);
          }
        }
      }

      // Add index document if requested
      if (batch.options.includeIndex) {
        const indexDoc = this.generateIndexDocument(batch);
        archive.append(JSON.stringify(indexDoc, null, 2), { name: 'index.json' });
      }

      // Add metadata file
      const metadata = this.generateBatchMetadata(batch);
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      archive.finalize();
    });
  }

  private generateIndexDocument(batch: BatchJob): IndexDocument {
    const processingTime = batch.timing.completedAt && batch.timing.startedAt
      ? batch.timing.completedAt.getTime() - batch.timing.startedAt.getTime()
      : 0;

    return {
      generatedAt: new Date().toISOString(),
      batchId: batch.batchId,
      totalDocuments: batch.progress.total,
      successfulExports: batch.progress.completed,
      failedExports: batch.progress.failed,
      format: batch.format,
      user: batch.userId,
      documents: batch.results.map(result => ({
        sessionId: result.exportId.split('_').pop() || '',
        title: result.fileName.replace(/\.[^/.]+$/, ''), // Remove extension
        fileName: result.fileName,
        status: result.success ? 'success' : 'failed',
        size: result.success ? result.fileSize : undefined,
        error: result.error?.message
      })),
      metadata: {
        exportDuration: this.formatDuration(processingTime),
        archiveSize: this.formatFileSize(batch.archive?.size || 0),
        compression: batch.options.archiveFormat
      }
    };
  }

  private generateBatchMetadata(batch: BatchJob): any {
    return {
      batchId: batch.batchId,
      userId: batch.userId,
      format: batch.format,
      options: batch.options,
      timing: batch.timing,
      progress: batch.progress,
      results: {
        total: batch.results.length,
        successful: batch.results.filter(r => r.success).length,
        failed: batch.results.filter(r => !r.success).length
      },
      generatedAt: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  private getCurrentProcessingItem(batch: BatchJob): string | undefined {
    if (batch.status !== 'processing') return undefined;
    
    const currentIndex = batch.progress.completed + batch.progress.failed;
    if (currentIndex < batch.sessionIds.length) {
      return batch.sessionIds[currentIndex];
    }
    
    return undefined;
  }

  private getMimeTypeForArchive(format: string): string {
    const mimeTypes: Record<string, string> = {
      'zip': 'application/zip',
      'tar': 'application/x-tar',
      'tar.gz': 'application/gzip'
    };
    return mimeTypes[format] || 'application/octet-stream';
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  private cleanupCompletedBatches(): void {
    const cutoff = Date.now() - (1000 * 60 * 60 * 24); // 24 hours ago
    
    for (const [batchId, batch] of this.activeBatches) {
      const completedTime = batch.timing.completedAt?.getTime();
      
      if (completedTime && completedTime < cutoff) {
        // Clean up batch files
        this.cleanupBatchFiles(batch);
        
        // Remove from active batches
        this.activeBatches.delete(batchId);
        
        console.log(`Cleaned up batch ${batchId}`);
      }
    }
  }

  private async cleanupBatchFiles(batch: BatchJob): Promise<void> {
    try {
      // Delete individual export files
      for (const result of batch.results) {
        if (result.filePath) {
          try {
            await fs.unlink(result.filePath);
          } catch {
            // File might already be deleted
          }
        }
      }

      // Delete archive file
      if (batch.archive?.path) {
        try {
          await fs.unlink(batch.archive.path);
        } catch {
          // Archive might already be deleted
        }
      }

    } catch (error) {
      console.warn(`Error cleaning up batch files for ${batch.batchId}:`, error);
    }
  }

  // Public utility methods

  generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getActiveBatchCount(): number {
    return Array.from(this.activeBatches.values())
      .filter(batch => batch.status === 'processing').length;
  }

  getQueuedBatchCount(): number {
    return this.processingQueue.length;
  }
}

export const batchExportManager = new BatchExportManager();