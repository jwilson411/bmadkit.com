import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import SplitScreenLayout from './SplitScreenLayout';
import DocumentViewer from './DocumentViewer';
import DocumentTabs from './DocumentTabs';
import useDocumentStream from '../hooks/useDocumentStream';

export interface DocumentStreamingInterfaceProps {
  workflowExecutionId: string;
  conversationPanel: React.ReactNode;
  className?: string;
  theme?: 'light' | 'dark';
  onDocumentChange?: (documentId: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export const DocumentStreamingInterface: React.FC<DocumentStreamingInterfaceProps> = ({
  workflowExecutionId,
  conversationPanel,
  className,
  theme = 'light',
  onDocumentChange,
  onConnectionChange
}) => {
  const [activeDocumentId, setActiveDocumentId] = useState<string>('');
  const [layout, setLayout] = useState<'split' | 'mobile-tabs'>('split');
  const [showConnectionStatus, setShowConnectionStatus] = useState(false);

  // WebSocket document streaming
  const {
    isConnected,
    connectionError,
    isReconnecting,
    documents,
    getDocument,
    recentUpdates,
    subscribeToWorkflow,
    connect,
    disconnect,
    refreshDocuments
  } = useDocumentStream({
    workflowExecutionId,
    autoConnect: true,
    onConnectionChange: (connected) => {
      onConnectionChange?.(connected);
      setShowConnectionStatus(!connected);
      
      // Auto-hide connection status after successful connection
      if (connected) {
        setTimeout(() => setShowConnectionStatus(false), 3000);
      }
    },
    onDocumentUpdate: (event) => {
      console.log('Document update received:', event);
      
      // Automatically switch to updated document if no document is active
      if (!activeDocumentId && event.documentId) {
        setActiveDocumentId(event.documentId);
      }
    },
    onError: (error) => {
      console.error('Document stream error:', error);
    }
  });

  // Set initial active document
  useEffect(() => {
    if (documents.length > 0 && !activeDocumentId) {
      setActiveDocumentId(documents[0].id);
    }
  }, [documents, activeDocumentId]);

  // Handle tab changes
  const handleTabChange = useCallback((documentId: string) => {
    setActiveDocumentId(documentId);
    onDocumentChange?.(documentId);
  }, [onDocumentChange]);

  // Handle layout changes
  const handleLayoutChange = useCallback((newLayout: 'split' | 'mobile-tabs') => {
    setLayout(newLayout);
  }, []);

  // Get active document
  const activeDocument = getDocument(activeDocumentId);

  // Sort documents by type for consistent order
  const sortedDocuments = [...documents].sort((a, b) => {
    const typeOrder = ['PROJECT_BRIEF', 'PRD', 'TECHNICAL_ARCHITECTURE', 'USER_STORIES'];
    const aIndex = typeOrder.indexOf(a.type);
    const bIndex = typeOrder.indexOf(b.type);
    
    if (aIndex === -1 && bIndex === -1) return a.type.localeCompare(b.type);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  // Connection status component
  const ConnectionStatus = () => (
    <AnimatePresence>
      {showConnectionStatus && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50"
        >
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg border text-sm',
            isConnected 
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          )}>
            <div className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-green-400' : 'bg-red-400'
            )} />
            {isReconnecting ? (
              <>
                <div className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                <span>Reconnecting...</span>
              </>
            ) : isConnected ? (
              <span>Connected to document stream</span>
            ) : (
              <span>
                Connection lost
                {connectionError && `: ${connectionError}`}
              </span>
            )}
            
            {!isConnected && !isReconnecting && (
              <button
                onClick={connect}
                className="ml-2 px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Empty state component
  const EmptyState = () => (
    <div className="h-full flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No documents yet</h3>
        <p className="text-gray-600 mb-4">
          Start a conversation with our AI planning assistant to generate your project documents in real-time.
        </p>
        
        {!isConnected && (
          <div className="text-sm text-red-600 mb-4">
            Unable to connect to document stream. 
            <button 
              onClick={connect}
              className="ml-1 underline hover:no-underline"
            >
              Try reconnecting
            </button>
          </div>
        )}

        <div className="flex justify-center gap-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="w-2 h-2 bg-gray-300 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  // Document panel component
  const DocumentPanel = () => (
    <div className="h-full flex flex-col bg-white">
      {/* Document Tabs */}
      {sortedDocuments.length > 0 && (
        <DocumentTabs
          documents={sortedDocuments}
          activeDocumentId={activeDocumentId}
          showTabIcons={true}
          showUpdateIndicators={true}
          allowReordering={false}
          onTabChange={handleTabChange}
        />
      )}

      {/* Document Viewer */}
      <div className="flex-1 overflow-hidden">
        {sortedDocuments.length === 0 ? (
          <EmptyState />
        ) : (
          <DocumentViewer
            document={activeDocument}
            isLoading={!activeDocument && isConnected}
            theme={theme}
            showTableOfContents={true}
            showProgress={true}
            showMetadata={true}
            enableHighlighting={true}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className={cn('h-screen w-screen bg-gray-100 relative overflow-hidden', className)}>
      {/* Connection Status Overlay */}
      <ConnectionStatus />

      {/* Main Interface */}
      <SplitScreenLayout
        leftPanel={conversationPanel}
        rightPanel={<DocumentPanel />}
        defaultLeftWidth={45}
        minLeftWidth={30}
        maxLeftWidth={70}
        resizable={true}
        mobileBreakpoint={768}
        onLayoutChange={handleLayoutChange}
        className="h-full"
      />

      {/* Floating Action Button (mobile) */}
      {layout === 'mobile-tabs' && (
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors z-40"
          onClick={refreshDocuments}
          title="Refresh documents"
        >
          <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </motion.button>
      )}

      {/* Performance Monitor (development only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 left-4 text-xs text-gray-500 bg-white px-2 py-1 rounded shadow z-50">
          <div>Documents: {documents.length}</div>
          <div>Updates: {recentUpdates.length}</div>
          <div>Connection: {isConnected ? 'OK' : 'ERROR'}</div>
        </div>
      )}
    </div>
  );
};

export default DocumentStreamingInterface;