import React from 'react';
import { ErrorFallbackProps } from './ErrorBoundary';

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  errorId,
  onRetry,
  onReport,
  level
}) => {
  const getErrorMessage = () => {
    switch (level) {
      case 'application':
        return "The application encountered an unexpected error. Don't worry - your session data has been saved.";
      case 'route':
        return "Unable to load this page. Your planning progress is safe and we'll help you continue.";
      case 'feature':
        return "This feature is temporarily unavailable. You can continue using other parts of the application.";
      case 'component':
        return "A component failed to load properly. We'll try to recover automatically.";
      default:
        return "Something unexpected happened, but we're working to fix it.";
    }
  };

  const getRecoveryOptions = () => {
    switch (level) {
      case 'application':
        return [
          { label: 'Restore Session', action: () => window.location.reload(), primary: true },
          { label: 'Start Fresh', action: () => window.location.href = '/', primary: false },
          { label: 'Contact Support', action: onReport, primary: false }
        ];
      case 'route':
        return [
          { label: 'Try Again', action: onRetry, primary: true },
          { label: 'Go to Dashboard', action: () => window.location.href = '/dashboard', primary: false },
          { label: 'Report Issue', action: onReport, primary: false }
        ];
      case 'feature':
        return [
          { label: 'Retry Feature', action: onRetry, primary: true },
          { label: 'Continue Without Feature', action: () => window.location.reload(), primary: false },
          { label: 'Report Problem', action: onReport, primary: false }
        ];
      default:
        return [
          { label: 'Try Again', action: onRetry, primary: true },
          { label: 'Refresh Page', action: () => window.location.reload(), primary: false },
          { label: 'Get Help', action: onReport, primary: false }
        ];
    }
  };

  const getSeverityIcon = () => {
    const severity = level === 'application' ? 'critical' : level === 'route' ? 'high' : 'medium';
    
    switch (severity) {
      case 'critical':
        return (
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        );
      case 'high':
        return (
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
    }
  };

  const recoveryOptions = getRecoveryOptions();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
        {getSeverityIcon()}
        
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {level === 'application' ? 'Application Error' : 
           level === 'route' ? 'Page Loading Error' :
           level === 'feature' ? 'Feature Unavailable' : 'Something Went Wrong'}
        </h1>
        
        <p className="text-gray-600 mb-6">
          {getErrorMessage()}
        </p>

        {errorId && (
          <div className="mb-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs text-gray-600">
              Error ID: <code className="font-mono text-gray-800">{errorId}</code>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Save this ID when contacting support
            </p>
          </div>
        )}

        {process.env.NODE_ENV === 'development' && error && (
          <details className="mb-6 text-left">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 mb-2">
              Error Details (Development Only)
            </summary>
            <div className="bg-gray-100 rounded p-3 text-xs font-mono text-red-600 overflow-auto max-h-32">
              <div className="mb-2">
                <strong>Error:</strong> {error.message}
              </div>
              <div className="mb-2">
                <strong>Level:</strong> {level}
              </div>
              {error.stack && (
                <div>
                  <strong>Stack:</strong>
                  <pre className="whitespace-pre-wrap mt-1 text-xs">
                    {error.stack}
                  </pre>
                </div>
              )}
              {errorInfo && (
                <div className="mt-2">
                  <strong>Component Stack:</strong>
                  <pre className="whitespace-pre-wrap mt-1 text-xs">
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}
        
        <div className="space-y-3">
          {recoveryOptions.map((option, index) => (
            <button
              key={index}
              onClick={option.action}
              className={option.primary ? "btn-primary w-full" : "btn-secondary w-full"}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            Need immediate help?{' '}
            <a 
              href="mailto:support@bmadkit.com?subject=Error%20Report&body=Error%20ID:%20${errorId}"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Contact Support
            </a>{' '}
            or{' '}
            <a 
              href="/help/troubleshooting"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              View Troubleshooting Guide
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};