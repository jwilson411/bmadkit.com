import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';
import { errorReporter } from '../utils/error-reporter';

interface Props {
  children: ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level: 'application' | 'route' | 'component' | 'feature';
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId?: string;
}

export interface ErrorFallbackProps {
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId?: string;
  onRetry: () => void;
  onReport: () => void;
  level: string;
}

class ErrorBoundary extends Component<Props, State> {
  private retryCount = 0;
  private maxRetries = 3;
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorId = this.state.errorId || `error_${Date.now()}`;
    
    // Report error with context
    errorReporter.captureException(error, {
      level: this.props.level,
      errorInfo,
      errorId,
      retryCount: this.retryCount,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: this.getUserId(),
      sessionId: this.getSessionId()
    });

    this.setState({ errorInfo });
    
    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  private getUserId(): string | undefined {
    // Get from auth context or session storage
    return sessionStorage.getItem('userId') || undefined;
  }

  private getSessionId(): string | undefined {
    // Get from session context
    return sessionStorage.getItem('sessionId') || undefined;
  }

  private handleRetry = () => {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      this.setState({
        hasError: false,
        error: undefined,
        errorInfo: undefined,
        errorId: undefined
      });
    }
  };

  private handleReport = () => {
    const { error, errorInfo, errorId } = this.state;
    if (error && errorId) {
      errorReporter.reportUserFeedback({
        errorId,
        error: error.message,
        stack: error.stack,
        level: this.props.level,
        timestamp: new Date().toISOString(),
        userFeedback: 'User requested additional support for this error'
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || ErrorFallback;
      
      return (
        <FallbackComponent
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          errorId={this.state.errorId}
          onRetry={this.handleRetry}
          onReport={this.handleReport}
          level={this.props.level}
        />
      );
    }

    return this.props.children;
  }
}

// Higher-order component for easier usage
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps} level={errorBoundaryProps?.level || 'component'}>
      <Component {...props} />
    </ErrorBoundary>
  );
  
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

// Hook for programmatic error reporting
export function useErrorHandler() {
  const reportError = React.useCallback((error: Error, context?: Record<string, any>) => {
    errorReporter.captureException(error, {
      level: 'manual',
      context,
      timestamp: new Date().toISOString(),
      userId: sessionStorage.getItem('userId') || undefined,
      sessionId: sessionStorage.getItem('sessionId') || undefined
    });
  }, []);

  return { reportError };
}

export default ErrorBoundary;