import { Router, Request, Response } from 'express';
import { 
  addSubscriptionContext,
  checkExportLimit,
  requireFeature,
  requireTier,
  FeatureGatedRequest
} from '../middleware/feature-gate';
import { FeatureFlag, UserTier } from '../services/feature-flag-manager';
import { exportProcessor } from '../services/export-processor';
import { pdfGenerator } from '../services/pdf-generator';
import { wordGenerator } from '../services/word-generator';
import { structuredDataExporter } from '../services/structured-data-exporter';
import { customTemplateEngine } from '../services/custom-template-engine';
import { batchExportManager } from '../services/batch-export-manager';

const router = Router();

// Apply subscription context to all export routes
router.use(addSubscriptionContext);

// Single Document Export Routes
router.post('/export/single', checkExportLimit, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { sessionId, format, options, templateId, customization, metadata } = req.body;

    if (!sessionId || !format) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'sessionId and format are required'
        }
      });
    }

    const supportedFormats = ['markdown', 'pdf', 'docx', 'json', 'yaml', 'html'];
    if (!supportedFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: `Supported formats: ${supportedFormats.join(', ')}`
        }
      });
    }

    // Check format-specific permissions
    if (format === 'pdf' && !req.user!.features.includes(FeatureFlag.PREMIUM_TEMPLATE_LIBRARY)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PREMIUM_FEATURE_REQUIRED',
          message: 'PDF export requires Premium subscription'
        }
      });
    }

    const exportRequest = {
      exportId: exportProcessor.generateExportId(),
      userId: req.user!.id,
      sessionId,
      format,
      options: options || {},
      templateId,
      customization,
      metadata: metadata || { title: 'Document Export' }
    };

    const result = await exportProcessor.exportDocument(exportRequest);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_ERROR',
        message: error.message
      }
    });
  }
});

// Batch Export Routes
router.post('/export/batch', 
  requireTier(UserTier.EMAIL_CAPTURED),
  checkExportLimit,
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const { sessionIds, format, options, archiveFormat, includeIndex, customization } = req.body;

      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'sessionIds array is required and cannot be empty'
          }
        });
      }

      if (!format) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'format is required'
          }
        });
      }

      const batchRequest = {
        batchId: batchExportManager.generateBatchId(),
        userId: req.user!.id,
        sessionIds,
        format,
        options: options || {},
        archiveFormat: archiveFormat || 'zip',
        includeIndex: includeIndex !== false,
        customization
      };

      const batchId = await batchExportManager.createBatchExport(batchRequest);

      res.json({
        success: true,
        data: {
          batchId,
          message: 'Batch export queued for processing',
          totalItems: sessionIds.length,
          estimatedTime: `${Math.ceil(sessionIds.length * 2 / 60)} minutes`
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'BATCH_EXPORT_ERROR',
          message: error.message
        }
      });
    }
  }
);

// Batch Export Status
router.get('/export/batch/:batchId/status', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const progress = await batchExportManager.getBatchProgress(batchId, req.user!.id);

    if (!progress) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BATCH_NOT_FOUND',
          message: 'Batch export not found or access denied'
        }
      });
    }

    res.json({
      success: true,
      data: progress
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BATCH_STATUS_ERROR',
        message: error.message
      }
    });
  }
});

// Batch Export Result
router.get('/export/batch/:batchId/result', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const result = await batchExportManager.getBatchResult(batchId, req.user!.id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BATCH_NOT_FOUND',
          message: 'Batch export not found or not ready'
        }
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BATCH_RESULT_ERROR',
        message: error.message
      }
    });
  }
});

// Batch Export Download
router.get('/export/batch/:batchId/download', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const downloadInfo = await batchExportManager.downloadBatchArchive(batchId, req.user!.id);

    res.setHeader('Content-Type', downloadInfo.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadInfo.fileName}"`);
    res.sendFile(downloadInfo.filePath);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BATCH_DOWNLOAD_ERROR',
        message: error.message
      }
    });
  }
});

// Cancel Batch Export
router.post('/export/batch/:batchId/cancel', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    await batchExportManager.cancelBatchExport(batchId, req.user!.id);

    res.json({
      success: true,
      message: 'Batch export cancelled successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BATCH_CANCEL_ERROR',
        message: error.message
      }
    });
  }
});

// Export History Routes
router.get('/export/history', 
  requireFeature(FeatureFlag.UNLIMITED_SESSION_HISTORY),
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const options = {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
        format: req.query.format as any,
        sortBy: req.query.sortBy as any || 'createdAt',
        sortOrder: req.query.sortOrder as any || 'desc',
        includeExpired: req.query.includeExpired === 'true'
      };

      const history = await exportProcessor.getExportHistory(req.user!.id, options);

      res.json({
        success: true,
        data: history
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'EXPORT_HISTORY_ERROR',
          message: error.message
        }
      });
    }
  }
);

// Download Export
router.get('/export/:exportId/download', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { exportId } = req.params;
    const downloadInfo = await exportProcessor.downloadExport(exportId, req.user!.id);

    res.setHeader('Content-Type', downloadInfo.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadInfo.fileName}"`);
    res.sendFile(downloadInfo.filePath);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_DOWNLOAD_ERROR',
        message: error.message
      }
    });
  }
});

// Delete Export
router.delete('/export/:exportId', 
  requireFeature(FeatureFlag.UNLIMITED_SESSION_HISTORY),
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const { exportId } = req.params;
      await exportProcessor.deleteExport(exportId, req.user!.id);

      res.json({
        success: true,
        message: 'Export deleted successfully'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'EXPORT_DELETE_ERROR',
          message: error.message
        }
      });
    }
  }
);

// Custom Template Routes
router.get('/templates', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const options = {
      category: req.query.category as string,
      search: req.query.search as string,
      sortBy: req.query.sortBy as any || 'updated',
      sortOrder: req.query.sortOrder as any || 'desc',
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20
    };

    const library = await customTemplateEngine.getTemplateLibrary(req.user!.id, options);

    res.json({
      success: true,
      data: library
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATE_LIBRARY_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/templates', 
  requireTier(UserTier.EMAIL_CAPTURED),
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const templateId = await customTemplateEngine.createTemplate(req.user!.id, req.body);

      res.status(201).json({
        success: true,
        data: {
          templateId,
          message: 'Custom template created successfully'
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'TEMPLATE_CREATION_ERROR',
          message: error.message
        }
      });
    }
  }
);

router.get('/templates/:templateId', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const template = await customTemplateEngine.getTemplate(templateId, req.user!.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied'
        }
      });
    }

    res.json({
      success: true,
      data: template
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATE_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

router.put('/templates/:templateId', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    await customTemplateEngine.updateTemplate(templateId, req.user!.id, req.body);

    res.json({
      success: true,
      message: 'Template updated successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATE_UPDATE_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/templates/:templateId/preview', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const { sampleData } = req.body;
    
    const preview = await customTemplateEngine.previewTemplate(templateId, req.user!.id, sampleData);

    res.json({
      success: true,
      data: preview
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATE_PREVIEW_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/templates/:templateId/render', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const { data, variables, options } = req.body;

    const renderContext = {
      templateId,
      userId: req.user!.id,
      data,
      variables,
      options
    };

    const rendered = await customTemplateEngine.renderTemplate(renderContext);

    res.json({
      success: true,
      data: {
        rendered,
        templateId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATE_RENDER_ERROR',
        message: error.message
      }
    });
  }
});

// Export Format-Specific Routes

// JSON/YAML Structured Export
router.post('/export/structured', checkExportLimit, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { sessionId, format, options, customization } = req.body;

    if (!sessionId || !format) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'sessionId and format are required'
        }
      });
    }

    if (!['json', 'yaml'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FORMAT',
          message: 'Format must be json or yaml'
        }
      });
    }

    // Get document content (mock implementation)
    const documentContent = {
      sessionId,
      title: 'Structured Export',
      content: {},
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        author: req.user!.id,
        tags: ['export', 'structured']
      },
      sections: []
    };

    const exportRequest = {
      exportId: exportProcessor.generateExportId(),
      userId: req.user!.id,
      sessionId,
      format,
      options: options || {},
      customization,
      metadata: { title: `Structured Export (${format.toUpperCase()})` }
    };

    let result;
    if (format === 'json') {
      result = await structuredDataExporter.exportJSON(exportRequest, documentContent, customization?.branding);
    } else {
      result = await structuredDataExporter.exportYAML(exportRequest, documentContent, customization?.branding);
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STRUCTURED_EXPORT_ERROR',
        message: error.message
      }
    });
  }
});

// Export Statistics
router.get('/export/stats', async (req: FeatureGatedRequest, res: Response) => {
  try {
    const stats = {
      activeBatches: batchExportManager.getActiveBatchCount(),
      queuedBatches: batchExportManager.getQueuedBatchCount(),
      userTier: req.user!.tier,
      features: req.user!.features,
      limits: {
        exportsPerMonth: req.user!.limits?.exportsPerMonth || -1,
        used: req.user!.usage?.exportsPerMonth || 0
      },
      supportedFormats: {
        single: ['markdown', 'pdf', 'docx', 'json', 'yaml', 'html'],
        batch: ['markdown', 'pdf', 'docx', 'json', 'yaml', 'html'],
        premium: ['pdf'],
        enterprise: ['pdf', 'docx']
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_STATS_ERROR',
        message: error.message
      }
    });
  }
});

export default router;