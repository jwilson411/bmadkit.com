import { Router, Request, Response } from 'express';
import { 
  requireFeature, 
  requireTier, 
  checkUsageLimit, 
  addSubscriptionContext,
  premiumOnly,
  enterpriseOnly,
  requireAdvancedPlanning,
  requirePriorityProcessing,
  requireUnlimitedHistory,
  requireCustomBranding,
  checkPlanningSessionLimit,
  checkDocumentLimit,
  checkExportLimit,
  FeatureGatedRequest
} from '../middleware/feature-gate';
import { premiumTemplateManager } from '../services/premium-template-manager';
import { sessionHistoryManager } from '../services/session-history-manager';
import { customBrandingManager } from '../services/custom-branding-manager';
import { premiumUserExperience } from '../services/premium-user-experience';
import { premiumProcessor } from '../services/premium-processor';
import { FeatureFlag, UserTier } from '../services/feature-flag-manager';

const router = Router();

// Apply subscription context to all premium routes
router.use(addSubscriptionContext);

// Premium Template Routes
router.get('/templates', requireFeature(FeatureFlag.PREMIUM_TEMPLATE_LIBRARY), async (req: FeatureGatedRequest, res: Response) => {
  try {
    const templates = await premiumTemplateManager.getAvailableTemplates(req.user!.id);
    res.json({
      success: true,
      data: {
        templates,
        userTier: req.user!.tier
      }
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

router.get('/templates/:templateId', requireFeature(FeatureFlag.PREMIUM_TEMPLATE_LIBRARY), async (req: FeatureGatedRequest, res: Response) => {
  try {
    const template = await premiumTemplateManager.getTemplateById(req.params.templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found'
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

router.post('/templates/:templateId/generate', 
  requireFeature(FeatureFlag.PREMIUM_TEMPLATE_LIBRARY),
  checkDocumentLimit,
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const result = await premiumTemplateManager.generateTemplate({
        templateId: req.params.templateId,
        userId: req.user!.id,
        projectData: req.body.projectData,
        analysisDepth: req.body.analysisDepth || 'detailed',
        customization: req.body.customization,
        outputFormat: req.body.outputFormat || 'markdown'
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'TEMPLATE_GENERATION_ERROR',
          message: error.message
        }
      });
    }
  }
);

// Advanced Planning Routes
router.post('/planning/advanced', 
  requireAdvancedPlanning,
  checkPlanningSessionLimit,
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const jobId = await premiumProcessor.submitAdvancedPlanningSession({
        userId: req.user!.id,
        projectData: req.body.projectData,
        customRequirements: req.body.customRequirements,
        analysisDepth: req.body.analysisDepth || 'detailed'
      });

      res.json({
        success: true,
        data: {
          jobId,
          message: 'Advanced planning session queued for processing',
          estimatedCompletionTime: '5-10 minutes'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'ADVANCED_PLANNING_ERROR',
          message: error.message
        }
      });
    }
  }
);

router.get('/planning/advanced/:jobId/status', requireAdvancedPlanning, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const status = await premiumProcessor.getJobStatus(req.params.jobId, req.user!.id);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Planning job not found'
        }
      });
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'JOB_STATUS_ERROR',
        message: error.message
      }
    });
  }
});

// Session History Routes
router.get('/sessions', requireUnlimitedHistory, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const options = {
      includeArchived: req.query.includeArchived === 'true',
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
      sortBy: req.query.sortBy as string || 'updatedAt',
      sortOrder: req.query.sortOrder as 'asc' | 'desc' || 'desc'
    };

    const result = await sessionHistoryManager.getSessionHistory(req.user!.id, options);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_HISTORY_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/sessions/search', requireUnlimitedHistory, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const searchParams = {
      userId: req.user!.id,
      ...req.body
    };

    const results = await sessionHistoryManager.searchSessions(searchParams);
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_SEARCH_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/sessions/:sessionId/export', 
  requireUnlimitedHistory,
  checkExportLimit,
  async (req: FeatureGatedRequest, res: Response) => {
    try {
      const format = req.query.format as 'json' | 'markdown' | 'pdf' | 'html' || 'json';
      const exportData = await sessionHistoryManager.exportSession(req.params.sessionId, req.user!.id, format);

      res.setHeader('Content-Type', `application/${format}`);
      res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.sessionId}.${format}"`);
      res.send(exportData);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'SESSION_EXPORT_ERROR',
          message: error.message
        }
      });
    }
  }
);

router.get('/sessions/analytics', requireUnlimitedHistory, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const period = req.query.period as '7d' | '30d' | '90d' | '1y' | 'all' || '30d';
    const analytics = await sessionHistoryManager.getSessionAnalytics(req.user!.id, period);

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_ANALYTICS_ERROR',
        message: error.message
      }
    });
  }
});

// Custom Branding Routes (Enterprise)
router.post('/branding', enterpriseOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const brandingId = await customBrandingManager.createBrandingConfiguration(req.user!.id, req.body);
    
    res.status(201).json({
      success: true,
      data: {
        brandingId,
        message: 'Branding configuration created successfully'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BRANDING_CREATION_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/branding/:brandingId', requireCustomBranding, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const branding = await customBrandingManager.getBrandingConfiguration(req.params.brandingId, req.user!.id);
    
    if (!branding) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BRANDING_NOT_FOUND',
          message: 'Branding configuration not found'
        }
      });
    }

    res.json({
      success: true,
      data: branding
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BRANDING_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

router.put('/branding/:brandingId', requireCustomBranding, async (req: FeatureGatedRequest, res: Response) => {
  try {
    await customBrandingManager.updateBrandingConfiguration(req.params.brandingId, req.user!.id, req.body);
    
    res.json({
      success: true,
      message: 'Branding configuration updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BRANDING_UPDATE_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/branding/:brandingId/activate', requireCustomBranding, async (req: FeatureGatedRequest, res: Response) => {
  try {
    await customBrandingManager.activateBranding(req.params.brandingId, req.user!.id);
    
    res.json({
      success: true,
      message: 'Branding configuration activated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BRANDING_ACTIVATION_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/branding/:brandingId/preview', requireCustomBranding, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const branding = await customBrandingManager.getBrandingConfiguration(req.params.brandingId, req.user!.id);
    
    if (!branding) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BRANDING_NOT_FOUND',
          message: 'Branding configuration not found'
        }
      });
    }

    const preview = await customBrandingManager.generateBrandingPreview(branding);
    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'BRANDING_PREVIEW_ERROR',
        message: error.message
      }
    });
  }
});

// Premium User Experience Routes
router.get('/user/profile', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    let profile = await premiumUserExperience.getPremiumUserProfile(req.user!.id);
    
    if (!profile) {
      // Create profile if it doesn't exist
      profile = await premiumUserExperience.createPremiumUserProfile(req.user!.id, {
        displayName: 'Premium User',
        email: req.user?.email || ''
      });
    }

    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_PROFILE_ERROR',
        message: error.message
      }
    });
  }
});

router.put('/user/preferences', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    await premiumUserExperience.updateUserPreferences(req.user!.id, req.body);
    
    res.json({
      success: true,
      message: 'User preferences updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'PREFERENCES_UPDATE_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/user/experience', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const experience = await premiumUserExperience.getPremiumExperience(req.user!.id);
    
    res.json({
      success: true,
      data: experience
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_EXPERIENCE_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/user/onboarding', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const onboarding = await premiumUserExperience.initializeUserOnboarding(req.user!.id);
    
    res.json({
      success: true,
      data: onboarding
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'ONBOARDING_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/user/onboarding/:stepId/complete', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const onboarding = await premiumUserExperience.updateOnboardingProgress(
      req.user!.id,
      req.params.stepId,
      req.body.personalizations
    );
    
    res.json({
      success: true,
      data: onboarding
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'ONBOARDING_PROGRESS_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/user/feature-discovery', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const discovery = await premiumUserExperience.getFeatureDiscovery(req.user!.id);
    
    res.json({
      success: true,
      data: discovery
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FEATURE_DISCOVERY_ERROR',
        message: error.message
      }
    });
  }
});

router.post('/user/feature-discovery/:feature/mark-discovered', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    await premiumUserExperience.markFeatureAsDiscovered(req.user!.id, req.params.feature as FeatureFlag);
    
    res.json({
      success: true,
      message: 'Feature marked as discovered'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FEATURE_DISCOVERY_MARK_ERROR',
        message: error.message
      }
    });
  }
});

router.get('/user/insights', requireFeature(FeatureFlag.PREMIUM_USER_SUPPORT), async (req: FeatureGatedRequest, res: Response) => {
  try {
    const period = req.query.period as '7d' | '30d' | '90d' || '30d';
    const insights = await premiumUserExperience.getPremiumInsights(req.user!.id, period);
    
    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_INSIGHTS_ERROR',
        message: error.message
      }
    });
  }
});

// Support Routes
router.post('/support/ticket', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const { subject, description, priority } = req.body;
    const ticketId = await premiumUserExperience.createSupportTicket(req.user!.id, subject, description, priority);
    
    res.status(201).json({
      success: true,
      data: {
        ticketId,
        message: 'Support ticket created successfully'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SUPPORT_TICKET_ERROR',
        message: error.message
      }
    });
  }
});

// Priority Processing Status Route
router.get('/processing/status', requirePriorityProcessing, async (req: FeatureGatedRequest, res: Response) => {
  try {
    const metrics = await premiumProcessor.getProcessingMetrics(req.user!.id);
    
    res.json({
      success: true,
      data: {
        ...metrics,
        userTier: req.user!.tier,
        hasPriorityProcessing: req.user!.features.includes(FeatureFlag.PRIORITY_PROCESSING)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'PROCESSING_STATUS_ERROR',
        message: error.message
      }
    });
  }
});

// Usage and Limits Routes
router.get('/usage', premiumOnly, async (req: FeatureGatedRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        userId: req.user!.id,
        tier: req.user!.tier,
        limits: req.user!.limits,
        usage: req.user!.usage,
        features: req.user!.features,
        subscriptionId: req.user!.subscriptionId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'USAGE_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

// Feature flags endpoint for frontend
router.get('/features', addSubscriptionContext, async (req: FeatureGatedRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        tier: req.user?.tier || UserTier.FREE,
        features: req.user?.features || [],
        limits: req.user?.limits || {},
        usage: req.user?.usage || {}
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FEATURES_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

export default router;