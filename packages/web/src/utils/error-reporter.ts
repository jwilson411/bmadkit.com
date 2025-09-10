import * as Sentry from '@sentry/react';

interface ErrorContext {
  level: 'application' | 'route' | 'component' | 'feature' | 'manual';
  errorInfo?: React.ErrorInfo;
  errorId: string;
  retryCount?: number;
  timestamp: string;
  userAgent?: string;
  url?: string;
  userId?: string;
  sessionId?: string;
  context?: Record<string, any>;
}

interface UserFeedback {
  errorId: string;
  error: string;
  stack?: string;
  level: string;
  timestamp: string;
  userFeedback: string;
}

class ErrorReporter {
  private isInitialized = false;
  private errorQueue: Array<{ error: Error; context: ErrorContext }> = [];

  constructor() {
    this.initializeSentry();
  }

  private initializeSentry() {
    if (typeof window === 'undefined') return;

    try {
      Sentry.init({
        dsn: process.env.REACT_APP_SENTRY_DSN,
        environment: process.env.NODE_ENV,
        integrations: [
          new Sentry.BrowserTracing({
            tracePropagationTargets: [
              'localhost',
              /^https:\/\/api\.bmadkit\.com/,
              /^https:\/\/bmadkit\.com/
            ],
          }),
        ],
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        beforeSend: (event) => {
          // Sanitize sensitive data
          if (event.exception) {
            event.exception.values?.forEach(exception => {
              if (exception.stacktrace) {
                exception.stacktrace.frames?.forEach(frame => {
                  // Remove sensitive file paths
                  if (frame.filename) {
                    frame.filename = frame.filename.replace(/\/Users\/[^\/]+/, '/Users/***');
                  }
                });
              }
            });
          }

          // Remove PII from extra data
          if (event.extra) {
            Object.keys(event.extra).forEach(key => {
              if (key.toLowerCase().includes('password') || 
                  key.toLowerCase().includes('secret') ||
                  key.toLowerCase().includes('token')) {
                event.extra![key] = '[Redacted]';
              }
            });
          }

          return event;
        }
      });

      this.isInitialized = true;
      this.flushQueue();
    } catch (error) {
      console.warn('Failed to initialize Sentry:', error);
    }
  }

  private flushQueue() {
    while (this.errorQueue.length > 0) {
      const { error, context } = this.errorQueue.shift()!;
      this.captureException(error, context);
    }
  }

  captureException(error: Error, context: ErrorContext) {
    // Always log to console for development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[${context.level.toUpperCase()}] Error ${context.errorId}:`, error);
      console.error('Context:', context);
    }

    // Log to local storage for offline recovery
    this.logToLocalStorage(error, context);

    if (!this.isInitialized) {
      this.errorQueue.push({ error, context });
      return;
    }

    try {
      Sentry.withScope(scope => {
        scope.setTag('errorLevel', context.level);
        scope.setTag('errorId', context.errorId);
        scope.setContext('errorDetails', {
          timestamp: context.timestamp,
          retryCount: context.retryCount,
          url: context.url,
          userAgent: context.userAgent
        });

        if (context.userId) {
          scope.setUser({ id: context.userId });
        }

        if (context.sessionId) {
          scope.setTag('sessionId', context.sessionId);
        }

        if (context.errorInfo) {
          scope.setContext('reactErrorInfo', {
            componentStack: context.errorInfo.componentStack,
          });
        }

        if (context.context) {
          scope.setContext('additionalContext', context.context);
        }

        scope.setLevel(this.mapLevelToSentryLevel(context.level));
        
        Sentry.captureException(error);
      });
    } catch (sentryError) {
      console.warn('Failed to report error to Sentry:', sentryError);
    }

    // Report to backend analytics
    this.reportToBackend(error, context);
  }

  private mapLevelToSentryLevel(level: string): Sentry.SeverityLevel {
    switch (level) {
      case 'application':
        return 'fatal';
      case 'route':
        return 'error';
      case 'feature':
        return 'warning';
      case 'component':
        return 'info';
      default:
        return 'error';
    }
  }

  private logToLocalStorage(error: Error, context: ErrorContext) {
    try {
      const errorLog = {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        context,
        timestamp: new Date().toISOString()
      };

      const existingLogs = JSON.parse(localStorage.getItem('bmad_error_logs') || '[]');
      existingLogs.push(errorLog);

      // Keep only last 50 errors
      if (existingLogs.length > 50) {
        existingLogs.splice(0, existingLogs.length - 50);
      }

      localStorage.setItem('bmad_error_logs', JSON.stringify(existingLogs));
    } catch (localStorageError) {
      console.warn('Failed to log error to localStorage:', localStorageError);
    }
  }

  private async reportToBackend(error: Error, context: ErrorContext) {
    try {
      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          errorId: context.errorId,
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name
          },
          context: {
            level: context.level,
            timestamp: context.timestamp,
            url: context.url,
            userAgent: context.userAgent,
            userId: context.userId,
            sessionId: context.sessionId,
            retryCount: context.retryCount
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Backend error reporting failed: ${response.status}`);
      }
    } catch (backendError) {
      console.warn('Failed to report error to backend:', backendError);
    }
  }

  reportUserFeedback(feedback: UserFeedback) {
    if (this.isInitialized) {
      try {
        Sentry.captureUserFeedback({
          event_id: feedback.errorId,
          name: 'Anonymous User',
          email: 'user@bmadkit.com',
          comments: `${feedback.userFeedback}\n\nError: ${feedback.error}\nLevel: ${feedback.level}\nTimestamp: ${feedback.timestamp}`
        });
      } catch (error) {
        console.warn('Failed to report user feedback to Sentry:', error);
      }
    }

    // Also send to backend
    this.reportFeedbackToBackend(feedback);
  }

  private async reportFeedbackToBackend(feedback: UserFeedback) {
    try {
      await fetch('/api/errors/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(feedback)
      });
    } catch (error) {
      console.warn('Failed to report feedback to backend:', error);
    }
  }

  // Get error logs for debugging or support
  getStoredErrors(): any[] {
    try {
      return JSON.parse(localStorage.getItem('bmad_error_logs') || '[]');
    } catch {
      return [];
    }
  }

  // Clear stored error logs
  clearStoredErrors() {
    try {
      localStorage.removeItem('bmad_error_logs');
    } catch {
      // Ignore
    }
  }

  // Check if error reporting is available
  isAvailable(): boolean {
    return this.isInitialized;
  }
}

export const errorReporter = new ErrorReporter();