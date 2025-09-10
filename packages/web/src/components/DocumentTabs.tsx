import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import type { Document } from './DocumentViewer';

export interface DocumentTab {
  id: string;
  document: Document;
  isActive: boolean;
  hasUpdates: boolean;
  isDirty: boolean; // Has unsaved changes
}

export interface DocumentTabsProps {
  documents: Document[];
  activeDocumentId?: string;
  maxTabs?: number;
  showTabIcons?: boolean;
  showCloseButtons?: boolean;
  showUpdateIndicators?: boolean;
  allowReordering?: boolean;
  className?: string;
  onTabChange?: (documentId: string) => void;
  onTabClose?: (documentId: string) => void;
  onTabReorder?: (documentIds: string[]) => void;
  onNewTab?: () => void;
}

const DOCUMENT_TYPE_ICONS = {
  PROJECT_BRIEF: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  PRD: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  TECHNICAL_ARCHITECTURE: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  USER_STORIES: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  ),
  DEFAULT: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
};

const DOCUMENT_TYPE_LABELS = {
  PROJECT_BRIEF: 'Project Brief',
  PRD: 'PRD',
  TECHNICAL_ARCHITECTURE: 'Architecture',
  USER_STORIES: 'User Stories',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  IMPLEMENTATION_PLAN: 'Implementation Plan'
};

export const DocumentTabs: React.FC<DocumentTabsProps> = ({
  documents,
  activeDocumentId,
  maxTabs = 6,
  showTabIcons = true,
  showCloseButtons = false,
  showUpdateIndicators = true,
  allowReordering = true,
  className,
  onTabChange,
  onTabClose,
  onTabReorder,
  onNewTab
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [recentUpdates, setRecentUpdates] = useState<Set<string>>(new Set());
  
  const tabsRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Track recent updates for indicator
  useEffect(() => {
    const newUpdates = new Set<string>();
    documents.forEach(doc => {
      const lastUpdate = new Date(doc.updatedAt);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastUpdate > fiveMinutesAgo) {
        newUpdates.add(doc.id);
      }
    });
    setRecentUpdates(newUpdates);

    // Clear update indicators after 30 seconds
    const timeout = setTimeout(() => {
      setRecentUpdates(new Set());
    }, 30000);

    return () => clearTimeout(timeout);
  }, [documents]);

  // Handle tab clicks
  const handleTabClick = useCallback((documentId: string) => {
    if (documentId !== activeDocumentId) {
      onTabChange?.(documentId);
    }
  }, [activeDocumentId, onTabChange]);

  // Handle tab close
  const handleTabClose = useCallback((e: React.MouseEvent, documentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onTabClose?.(documentId);
  }, [onTabClose]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = documents.findIndex(doc => doc.id === activeDocumentId);
    
    switch (e.key) {
      case 'ArrowLeft':
        if (currentIndex > 0) {
          onTabChange?.(documents[currentIndex - 1].id);
        }
        break;
      case 'ArrowRight':
        if (currentIndex < documents.length - 1) {
          onTabChange?.(documents[currentIndex + 1].id);
        }
        break;
      case 'Home':
        if (documents.length > 0) {
          onTabChange?.(documents[0].id);
        }
        break;
      case 'End':
        if (documents.length > 0) {
          onTabChange?.(documents[documents.length - 1].id);
        }
        break;
    }
  }, [activeDocumentId, documents, onTabChange]);

  // Handle drag and drop for reordering
  const handleDragStart = useCallback((e: React.DragEvent, documentId: string) => {
    if (!allowReordering) return;
    
    setDraggedTab(documentId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', documentId);
  }, [allowReordering]);

  const handleDragOver = useCallback((e: React.DragEvent, documentId: string) => {
    if (!allowReordering || !draggedTab || draggedTab === documentId) return;
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTab(documentId);
  }, [allowReordering, draggedTab]);

  const handleDragLeave = useCallback(() => {
    if (allowReordering) {
      setDragOverTab(null);
    }
  }, [allowReordering]);

  const handleDrop = useCallback((e: React.DragEvent, targetDocumentId: string) => {
    if (!allowReordering || !draggedTab || draggedTab === targetDocumentId) return;
    
    e.preventDefault();
    
    const draggedIndex = documents.findIndex(doc => doc.id === draggedTab);
    const targetIndex = documents.findIndex(doc => doc.id === targetDocumentId);
    
    if (draggedIndex !== -1 && targetIndex !== -1) {
      const newOrder = [...documents];
      const [removed] = newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, removed);
      
      onTabReorder?.(newOrder.map(doc => doc.id));
    }
    
    setDraggedTab(null);
    setDragOverTab(null);
  }, [allowReordering, draggedTab, documents, onTabReorder]);

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
    setDragOverTab(null);
  }, []);

  // Get tab display name
  const getTabDisplayName = useCallback((document: Document): string => {
    const typeLabel = DOCUMENT_TYPE_LABELS[document.type as keyof typeof DOCUMENT_TYPE_LABELS];
    return typeLabel || document.type.replace(/_/g, ' ');
  }, []);

  // Get tab icon
  const getTabIcon = useCallback((document: Document): React.ReactNode => {
    return DOCUMENT_TYPE_ICONS[document.type as keyof typeof DOCUMENT_TYPE_ICONS] || DOCUMENT_TYPE_ICONS.DEFAULT;
  }, []);

  // Scroll to active tab
  useEffect(() => {
    if (activeDocumentId && tabsRef.current) {
      const activeTab = tabsRef.current.querySelector(`[data-document-id="${activeDocumentId}"]`) as HTMLElement;
      if (activeTab) {
        activeTab.scrollIntoView({
          behavior: 'smooth',
          inline: 'nearest',
          block: 'nearest'
        });
      }
    }
  }, [activeDocumentId]);

  // Show overflow indicator if needed
  const visibleDocuments = documents.slice(0, maxTabs);
  const hiddenCount = Math.max(0, documents.length - maxTabs);

  if (documents.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-12 bg-gray-50 border-b border-gray-200', className)}>
        <div className="text-sm text-gray-500">No documents available</div>
      </div>
    );
  }

  return (
    <div 
      className={cn('flex items-center bg-white border-b border-gray-200 overflow-hidden', className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="tablist"
      aria-label="Document tabs"
    >
      <div 
        ref={tabsRef}
        className="flex flex-1 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <AnimatePresence mode="popLayout">
          {visibleDocuments.map((document, index) => {
            const isActive = document.id === activeDocumentId;
            const hasRecentUpdate = recentUpdates.has(document.id);
            const isGenerating = document.status === 'GENERATING';
            const hasError = document.status === 'ERROR';
            const isDragging = draggedTab === document.id;
            const isDraggedOver = dragOverTab === document.id;

            return (
              <motion.div
                key={document.id}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ 
                  opacity: isDragging ? 0.5 : 1,
                  x: 0,
                  scale: isDragging ? 0.95 : 1
                }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  'flex items-center relative group cursor-pointer select-none',
                  'border-r border-gray-200 last:border-r-0',
                  isActive 
                    ? 'bg-white border-b-2 border-b-blue-500' 
                    : 'bg-gray-50 hover:bg-gray-100 border-b-2 border-b-transparent',
                  hasError && 'bg-red-50 hover:bg-red-100',
                  isDraggedOver && 'bg-blue-50',
                  'transition-all duration-150'
                )}
                data-document-id={document.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`document-panel-${document.id}`}
                tabIndex={isActive ? 0 : -1}
                draggable={allowReordering}
                onDragStart={(e) => handleDragStart(e, document.id)}
                onDragOver={(e) => handleDragOver(e, document.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, document.id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleTabClick(document.id)}
              >
                <div className="flex items-center gap-2 px-4 py-3 min-w-0">
                  {/* Tab Icon */}
                  {showTabIcons && (
                    <div className={cn(
                      'flex-shrink-0 transition-colors',
                      isActive ? 'text-blue-600' : 'text-gray-400',
                      hasError && 'text-red-500',
                      isGenerating && 'text-blue-500'
                    )}>
                      {getTabIcon(document)}
                    </div>
                  )}

                  {/* Tab Label */}
                  <span className={cn(
                    'text-sm font-medium truncate min-w-0',
                    isActive ? 'text-gray-900' : 'text-gray-600',
                    hasError && 'text-red-700'
                  )}>
                    {getTabDisplayName(document)}
                  </span>

                  {/* Status Indicators */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Update Indicator */}
                    {showUpdateIndicators && hasRecentUpdate && !isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-2 h-2 bg-blue-500 rounded-full"
                        title="Recently updated"
                      />
                    )}

                    {/* Generation Progress */}
                    {isGenerating && (
                      <motion.div
                        className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        title="Generating content"
                      />
                    )}

                    {/* Error Indicator */}
                    {hasError && (
                      <div className="w-3 h-3 text-red-500" title="Error occurred">
                        <svg fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Close Button */}
                  {showCloseButtons && (
                    <button
                      onClick={(e) => handleTabClose(e, document.id)}
                      className={cn(
                        'flex-shrink-0 w-4 h-4 rounded-sm opacity-0 group-hover:opacity-100',
                        'hover:bg-gray-200 transition-all duration-150',
                        'flex items-center justify-center',
                        isActive && 'opacity-100'
                      )}
                      title="Close document"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Active Tab Indicator */}
                {isActive && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                    layoutId="activeTab"
                  />
                )}

                {/* Drag Drop Indicator */}
                {isDraggedOver && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Overflow Indicator */}
      {hiddenCount > 0 && (
        <div className="flex items-center px-3 py-2 bg-gray-100 border-l border-gray-200 text-xs text-gray-600">
          +{hiddenCount} more
        </div>
      )}

      {/* New Tab Button */}
      {onNewTab && (
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-10 h-12 bg-gray-50 hover:bg-gray-100 border-l border-gray-200 transition-colors"
          title="New document"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default DocumentTabs;