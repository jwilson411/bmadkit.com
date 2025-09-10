import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';

export interface SplitScreenLayoutProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  resizable?: boolean;
  mobileBreakpoint?: number;
  className?: string;
  onLayoutChange?: (layout: 'split' | 'mobile-tabs') => void;
}

interface LayoutState {
  leftWidth: number;
  isResizing: boolean;
  isMobileLayout: boolean;
  activeTab: 'conversation' | 'document';
}

export const SplitScreenLayout: React.FC<SplitScreenLayoutProps> = ({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 50,
  minLeftWidth = 25,
  maxLeftWidth = 75,
  resizable = true,
  mobileBreakpoint = 768,
  className,
  onLayoutChange
}) => {
  const [layoutState, setLayoutState] = useState<LayoutState>({
    leftWidth: defaultLeftWidth,
    isResizing: false,
    isMobileLayout: false,
    activeTab: 'conversation'
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);

  // Handle window resize for responsive layout
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < mobileBreakpoint;
      setLayoutState(prev => {
        if (prev.isMobileLayout !== isMobile) {
          onLayoutChange?.(isMobile ? 'mobile-tabs' : 'split');
          return { ...prev, isMobileLayout: isMobile };
        }
        return prev;
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileBreakpoint, onLayoutChange]);

  // Mouse event handlers for resizing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!resizable || layoutState.isMobileLayout) return;
    
    e.preventDefault();
    setLayoutState(prev => ({ ...prev, isResizing: true }));

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      
      const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidth));
      
      setLayoutState(prev => ({ ...prev, leftWidth: clampedWidth }));
    };

    const handleMouseUp = () => {
      setLayoutState(prev => ({ ...prev, isResizing: false }));
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [resizable, layoutState.isMobileLayout, minLeftWidth, maxLeftWidth]);

  // Touch event handlers for mobile resizing (if needed)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!resizable || layoutState.isMobileLayout) return;
    
    const touch = e.touches[0];
    const startX = touch.clientX;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;

      const touch = e.touches[0];
      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((touch.clientX - containerRect.left) / containerRect.width) * 100;
      
      const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidth));
      setLayoutState(prev => ({ ...prev, leftWidth: clampedWidth }));
    };

    const handleTouchEnd = () => {
      setLayoutState(prev => ({ ...prev, isResizing: false }));
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    setLayoutState(prev => ({ ...prev, isResizing: true }));
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [resizable, layoutState.isMobileLayout, minLeftWidth, maxLeftWidth]);

  // Tab switching for mobile layout
  const handleTabSwitch = useCallback((tab: 'conversation' | 'document') => {
    setLayoutState(prev => ({ ...prev, activeTab: tab }));
  }, []);

  // Keyboard navigation for accessibility
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!layoutState.isMobileLayout) return;
    
    if (e.key === 'ArrowLeft') {
      handleTabSwitch('conversation');
    } else if (e.key === 'ArrowRight') {
      handleTabSwitch('document');
    }
  }, [layoutState.isMobileLayout, handleTabSwitch]);

  // Mobile tab bar component
  const MobileTabBar = () => (
    <div className="flex bg-white border-b border-gray-200 sticky top-0 z-10">
      <button
        onClick={() => handleTabSwitch('conversation')}
        className={cn(
          'flex-1 py-3 px-4 text-sm font-medium text-center border-b-2 transition-colors',
          layoutState.activeTab === 'conversation'
            ? 'border-blue-500 text-blue-600 bg-blue-50'
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        )}
        role="tab"
        aria-selected={layoutState.activeTab === 'conversation'}
        aria-controls="conversation-panel"
      >
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-4.126-.98L3 20l1.98-5.874A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
          </svg>
          Conversation
        </span>
      </button>
      <button
        onClick={() => handleTabSwitch('document')}
        className={cn(
          'flex-1 py-3 px-4 text-sm font-medium text-center border-b-2 transition-colors',
          layoutState.activeTab === 'document'
            ? 'border-blue-500 text-blue-600 bg-blue-50'
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        )}
        role="tab"
        aria-selected={layoutState.activeTab === 'document'}
        aria-controls="document-panel"
      >
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Documents
        </span>
      </button>
    </div>
  );

  // Desktop split-screen layout
  if (!layoutState.isMobileLayout) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'flex h-full w-full bg-gray-50 relative',
          layoutState.isResizing && 'select-none cursor-col-resize',
          className
        )}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="main"
        aria-label="Split screen layout"
      >
        {/* Left Panel - Conversation */}
        <motion.div
          className="bg-white border-r border-gray-200 flex flex-col overflow-hidden shadow-sm"
          style={{ width: `${layoutState.leftWidth}%` }}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex-1 overflow-hidden">
            {leftPanel}
          </div>
        </motion.div>

        {/* Resizer */}
        {resizable && (
          <div
            ref={resizerRef}
            className={cn(
              'w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex items-center justify-center relative group transition-colors',
              layoutState.isResizing && 'bg-blue-500'
            )}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            tabIndex={0}
          >
            {/* Resizer handle */}
            <div className="absolute w-1 h-8 bg-gray-400 rounded group-hover:bg-blue-500 transition-colors" />
            
            {/* Resizer tooltip */}
            <div className="absolute top-1/2 left-2 transform -translate-y-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
              Drag to resize
            </div>
          </div>
        )}

        {/* Right Panel - Document */}
        <motion.div
          className="bg-white flex flex-col overflow-hidden shadow-sm"
          style={{ width: `${100 - layoutState.leftWidth}%` }}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="flex-1 overflow-hidden">
            {rightPanel}
          </div>
        </motion.div>
      </div>
    );
  }

  // Mobile tabbed layout
  return (
    <div
      className={cn('flex flex-col h-full w-full bg-gray-50', className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="main"
      aria-label="Mobile tabbed layout"
    >
      <MobileTabBar />
      
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {layoutState.activeTab === 'conversation' && (
            <motion.div
              key="conversation"
              className="absolute inset-0 bg-white"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              id="conversation-panel"
              role="tabpanel"
              aria-labelledby="conversation-tab"
            >
              <div className="h-full overflow-hidden">
                {leftPanel}
              </div>
            </motion.div>
          )}
          
          {layoutState.activeTab === 'document' && (
            <motion.div
              key="document"
              className="absolute inset-0 bg-white"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              id="document-panel"
              role="tabpanel"
              aria-labelledby="document-tab"
            >
              <div className="h-full overflow-hidden">
                {rightPanel}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default SplitScreenLayout;