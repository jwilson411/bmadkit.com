export interface UserFriendlyError {
  title: string;
  message: string;
  suggestions: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'technical' | 'business' | 'user' | 'system';
  recoverable: boolean;
  supportContact?: {
    email: string;
    subject: string;
    includeErrorId: boolean;
  };
  learnMore?: {
    url: string;
    title: string;
  };
}

export interface ErrorMappingContext {
  userType?: 'free' | 'premium' | 'admin';
  userJourneyStep?: string;
  previousErrors?: string[];
  sessionContext?: Record<string, any>;
  deviceInfo?: {
    browser: string;
    os: string;
    mobile: boolean;
  };
}

class ErrorMessageMapper {
  private errorMappings: Map<string, (context?: ErrorMappingContext) => UserFriendlyError> = new Map();
  private fallbackMessages: Record<string, UserFriendlyError> = {};

  constructor() {
    this.initializeErrorMappings();
    this.initializeFallbackMessages();
  }

  /**
   * Map an error to a user-friendly message
   */
  mapError(error: Error, context?: ErrorMappingContext): UserFriendlyError {
    const errorKey = this.extractErrorKey(error);
    const mapper = this.errorMappings.get(errorKey);
    
    if (mapper) {
      return mapper(context);
    }
    
    // Try to find a pattern match
    const patternMatch = this.findPatternMatch(error.message);
    if (patternMatch) {
      return patternMatch(context);
    }
    
    // Use fallback based on error type
    const errorType = this.classifyError(error);
    return this.fallbackMessages[errorType] || this.fallbackMessages.unknown;
  }

  private initializeErrorMappings() {
    // Authentication Errors
    this.errorMappings.set('AUTHENTICATION_FAILED', (context) => ({
      title: 'Authentication Required',
      message: 'You need to sign in to continue using BMAD. Your session may have expired.',
      suggestions: [
        'Sign in with your account',
        'Check if you have an active internet connection',
        'Clear your browser cache and try again',
        'Contact support if you continue having issues'
      ],
      severity: 'medium',
      category: 'user',
      recoverable: true,
      supportContact: {
        email: 'support@bmadkit.com',
        subject: 'Authentication Issue',
        includeErrorId: true
      }
    }));

    // Session Errors
    this.errorMappings.set('SESSION_EXPIRED', (context) => ({
      title: 'Session Expired',
      message: 'Your planning session has expired for security reasons. Don\'t worry - your work has been saved automatically.',
      suggestions: [
        'Sign in again to continue',
        'Your recent work will be restored automatically',
        'Create a manual backup before long breaks',
        'Enable auto-save in your preferences'
      ],
      severity: 'medium',
      category: 'user',
      recoverable: true,
      learnMore: {
        url: '/help/sessions',
        title: 'Understanding Sessions'
      }
    }));

    // LLM Provider Errors
    this.errorMappings.set('LLM_PROVIDER_UNAVAILABLE', (context) => ({
      title: 'AI Assistant Temporarily Unavailable',
      message: 'Our AI assistant is experiencing high demand. We\'re automatically switching to backup systems.',
      suggestions: [
        'Your request will be processed automatically',
        'Try again in a few moments if the issue persists',
        'Continue working on other parts of your plan',
        'Save your progress manually as a precaution'
      ],
      severity: 'medium',
      category: 'technical',
      recoverable: true,
      supportContact: {
        email: 'support@bmadkit.com',
        subject: 'AI Assistant Issue',
        includeErrorId: true
      }
    }));

    // Rate Limiting
    this.errorMappings.set('RATE_LIMIT_EXCEEDED', (context) => {
      const isFreeTier = context?.userType === 'free';
      return {
        title: 'Usage Limit Reached',
        message: isFreeTier 
          ? 'You\'ve reached your free tier usage limit for this hour. Upgrade to premium for unlimited access.'
          : 'You\'ve made many requests recently. Please wait a moment before trying again.',
        suggestions: isFreeTier 
          ? [
              'Upgrade to premium for unlimited usage',
              'Wait an hour for your limit to reset',
              'Review your current progress while waiting',
              'Save your work to continue later'
            ]
          : [
              'Wait a few moments before trying again',
              'Review your recent requests',
              'Contact support if this seems incorrect',
              'Consider spreading requests over time'
            ],
        severity: 'medium',
        category: isFreeTier ? 'business' : 'technical',
        recoverable: true,
        learnMore: {
          url: '/pricing',
          title: 'Upgrade to Premium'
        }
      };
    });

    // Network Errors
    this.errorMappings.set('NETWORK_ERROR', (context) => ({
      title: 'Connection Problem',
      message: 'We couldn\'t connect to our servers. Your work is saved locally and will sync when connection is restored.',
      suggestions: [
        'Check your internet connection',
        'Try refreshing the page',
        'Your work is saved offline and will sync automatically',
        'Contact your IT department if using corporate network'
      ],
      severity: 'high',
      category: 'technical',
      recoverable: true,
      learnMore: {
        url: '/help/offline-mode',
        title: 'Working Offline'
      }
    }));

    // Validation Errors
    this.errorMappings.set('VALIDATION_ERROR', (context) => {
      const step = context?.userJourneyStep || 'current step';
      return {
        title: 'Input Validation Error',
        message: `Please check the information you entered in the ${step}. Some required fields may be missing or contain invalid data.`,
        suggestions: [
          'Review highlighted fields for errors',
          'Ensure all required fields are completed',
          'Check that email addresses and URLs are properly formatted',
          'Try using simpler text if you\'re seeing formatting issues'
        ],
        severity: 'low',
        category: 'user',
        recoverable: true
      };
    });

    // Document Generation Errors
    this.errorMappings.set('DOCUMENT_GENERATION_FAILED', (context) => ({
      title: 'Document Creation Failed',
      message: 'We encountered an issue while creating your business plan document. Your planning data is safe.',
      suggestions: [
        'Try generating the document again',
        'Check if you have all required sections completed',
        'Try a different document format (PDF, Word, etc.)',
        'Contact support with your session ID for assistance'
      ],
      severity: 'medium',
      category: 'technical',
      recoverable: true,
      supportContact: {
        email: 'support@bmadkit.com',
        subject: 'Document Generation Issue',
        includeErrorId: true
      }
    }));

    // Payment Errors
    this.errorMappings.set('PAYMENT_FAILED', (context) => ({
      title: 'Payment Processing Failed',
      message: 'Your payment could not be processed. No charges were made to your account.',
      suggestions: [
        'Check your payment method details',
        'Ensure you have sufficient funds available',
        'Try a different payment method',
        'Contact your bank if the issue persists'
      ],
      severity: 'high',
      category: 'business',
      recoverable: true,
      supportContact: {
        email: 'billing@bmadkit.com',
        subject: 'Payment Issue',
        includeErrorId: true
      },
      learnMore: {
        url: '/help/billing',
        title: 'Payment Help'
      }
    }));

    // Template Errors
    this.errorMappings.set('TEMPLATE_NOT_FOUND', (context) => ({
      title: 'Template Unavailable',
      message: 'The selected business plan template is temporarily unavailable. We\'ll help you choose an alternative.',
      suggestions: [
        'Try selecting a different template',
        'Use the default template to get started',
        'Your existing work will be preserved',
        'Contact support if you need this specific template'
      ],
      severity: 'medium',
      category: 'technical',
      recoverable: true
    }));

    // Export Errors
    this.errorMappings.set('EXPORT_FAILED', (context) => ({
      title: 'Export Failed',
      message: 'We couldn\'t export your business plan in the requested format. Your data is safe and you can try again.',
      suggestions: [
        'Try exporting in a different format (PDF, Word, etc.)',
        'Refresh the page and try again',
        'Check if your plan has all required sections',
        'Contact support if you need help with specific formats'
      ],
      severity: 'medium',
      category: 'technical',
      recoverable: true,
      supportContact: {
        email: 'support@bmadkit.com',
        subject: 'Export Issue',
        includeErrorId: true
      }
    }));

    // Server Errors
    this.errorMappings.set('SERVER_ERROR', (context) => ({
      title: 'Server Error',
      message: 'Our servers are experiencing issues. Your work is automatically saved and we\'re working to resolve this quickly.',
      suggestions: [
        'Try again in a few moments',
        'Your work is saved and will be restored',
        'Check our status page for updates',
        'Contact support if the issue continues'
      ],
      severity: 'high',
      category: 'technical',
      recoverable: true,
      supportContact: {
        email: 'support@bmadkit.com',
        subject: 'Server Error',
        includeErrorId: true
      },
      learnMore: {
        url: 'https://status.bmadkit.com',
        title: 'System Status'
      }
    }));
  }

  private initializeFallbackMessages() {
    this.fallbackMessages = {
      authentication: {
        title: 'Authentication Issue',
        message: 'There was a problem with your authentication. Please sign in again.',
        suggestions: ['Sign in to your account', 'Clear browser cache', 'Contact support if needed'],
        severity: 'medium',
        category: 'user',
        recoverable: true
      },
      network: {
        title: 'Connection Issue',
        message: 'We\'re having trouble connecting to our servers. Your work is saved locally.',
        suggestions: ['Check internet connection', 'Try again shortly', 'Work will sync when connected'],
        severity: 'high',
        category: 'technical',
        recoverable: true
      },
      server: {
        title: 'Server Error',
        message: 'Our servers are temporarily unavailable. We\'re working to fix this.',
        suggestions: ['Try again in a few minutes', 'Check our status page', 'Contact support if persistent'],
        severity: 'high',
        category: 'technical',
        recoverable: true
      },
      validation: {
        title: 'Invalid Input',
        message: 'Please check the information you entered and try again.',
        suggestions: ['Review form fields', 'Ensure required fields are filled', 'Check formatting'],
        severity: 'low',
        category: 'user',
        recoverable: true
      },
      unknown: {
        title: 'Unexpected Error',
        message: 'Something unexpected happened. Don\'t worry - your work is safe.',
        suggestions: ['Try refreshing the page', 'Check your connection', 'Contact support with error details'],
        severity: 'medium',
        category: 'system',
        recoverable: true,
        supportContact: {
          email: 'support@bmadkit.com',
          subject: 'Unexpected Error',
          includeErrorId: true
        }
      }
    };
  }

  private extractErrorKey(error: Error): string {
    // Extract structured error key from error message or name
    if (error.name && error.name !== 'Error') {
      return error.name;
    }
    
    // Look for error codes in message
    const codeMatch = error.message.match(/^([A-Z_]+):/);
    if (codeMatch) {
      return codeMatch[1];
    }
    
    // Look for HTTP status codes
    const statusMatch = error.message.match(/(\d{3})/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED';
      if (status === 429) return 'RATE_LIMIT_EXCEEDED';
      if (status >= 500) return 'SERVER_ERROR';
      if (status >= 400) return 'VALIDATION_ERROR';
    }
    
    return 'UNKNOWN_ERROR';
  }

  private findPatternMatch(message: string): ((context?: ErrorMappingContext) => UserFriendlyError) | null {
    const patterns: Array<[RegExp, string]> = [
      [/network|connection|fetch/i, 'NETWORK_ERROR'],
      [/session.*expired|unauthorized/i, 'SESSION_EXPIRED'],
      [/rate.?limit|too.?many.?requests/i, 'RATE_LIMIT_EXCEEDED'],
      [/payment|billing|charge/i, 'PAYMENT_FAILED'],
      [/template.*not.*found/i, 'TEMPLATE_NOT_FOUND'],
      [/document.*generation|pdf.*failed/i, 'DOCUMENT_GENERATION_FAILED'],
      [/export.*failed|download.*error/i, 'EXPORT_FAILED'],
      [/llm|ai|assistant.*unavailable/i, 'LLM_PROVIDER_UNAVAILABLE'],
      [/validation.*error|invalid.*input/i, 'VALIDATION_ERROR'],
      [/server.*error|internal.*error/i, 'SERVER_ERROR']
    ];
    
    for (const [pattern, key] of patterns) {
      if (pattern.test(message)) {
        return this.errorMappings.get(key) || null;
      }
    }
    
    return null;
  }

  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('auth') || message.includes('login')) return 'authentication';
    if (message.includes('network') || message.includes('connection')) return 'network';
    if (message.includes('server') || message.includes('500')) return 'server';
    if (message.includes('validation') || message.includes('invalid')) return 'validation';
    
    return 'unknown';
  }

  /**
   * Get contextual suggestions based on user journey
   */
  getContextualSuggestions(error: Error, context?: ErrorMappingContext): string[] {
    const baseError = this.mapError(error, context);
    const contextualSuggestions = [...baseError.suggestions];
    
    // Add journey-specific suggestions
    if (context?.userJourneyStep) {
      const journeyStep = context.userJourneyStep;
      
      if (journeyStep === 'onboarding') {
        contextualSuggestions.unshift('Don\'t worry - this is common during setup');
      } else if (journeyStep === 'planning') {
        contextualSuggestions.unshift('Your planning progress has been saved');
      } else if (journeyStep === 'document-generation') {
        contextualSuggestions.unshift('Your business plan data is safe');
      }
    }
    
    // Add device-specific suggestions
    if (context?.deviceInfo?.mobile) {
      contextualSuggestions.push('Try switching to desktop for complex operations');
    }
    
    // Add user type specific suggestions
    if (context?.userType === 'free') {
      contextualSuggestions.push('Consider upgrading to premium for priority support');
    }
    
    return contextualSuggestions;
  }

  /**
   * Check if an error is recoverable
   */
  isRecoverable(error: Error, context?: ErrorMappingContext): boolean {
    return this.mapError(error, context).recoverable;
  }

  /**
   * Get error severity level
   */
  getErrorSeverity(error: Error, context?: ErrorMappingContext): 'low' | 'medium' | 'high' | 'critical' {
    return this.mapError(error, context).severity;
  }
}

export const errorMessageMapper = new ErrorMessageMapper();