import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../utils/cn';
import { renderMarkdown, type MarkdownSection } from '../utils/markdown-renderer';
import {
  contentHighlighter,
  animateContentHighlights,
  clearContentHighlights,
  type ContentChange
} from '../utils/content-highlighter';

export interface Document {
  id: string;
  workflowExecutionId: string;
  type: string;
  title: string;
  status: 'DRAFT' | 'GENERATING' | 'COMPLETED' | 'ERROR' | 'ARCHIVED';
  sections: DocumentSection[];
  generationProgress: number;
  metadata?: {
    wordCount?: number;
    readingTime?: number;
    lastAgentPhase?: string;
  };
  updatedAt: Date | string;
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  order: number;
  sourceAgentPhase?: string;
  lastUpdated: Date | string;
  completionPercentage: number;
}

export interface DocumentViewerProps {
  document: Document | null;
  isLoading?: boolean;
  className?: string;
  theme?: 'light' | 'dark';
  showTableOfContents?: boolean;
  showProgress?: boolean;
  showMetadata?: boolean;
  enableHighlighting?: boolean;
  onSectionClick?: (sectionId: string) => void;
  onDocumentScroll?: (scrollTop: number) => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  document,
  isLoading = false,
  className,
  theme = 'light',
  showTableOfContents = true,
  showProgress = true,
  showMetadata = true,
  enableHighlighting = true,
  onSectionClick,
  onDocumentScroll
}) => {
  const [renderedContent, setRenderedContent] = useState<string>('');
  const [sections, setSections] = useState<MarkdownSection[]>([]);
  const [activeSection, setActiveSection] = useState<string>('');
  const [previousContent, setPreviousContent] = useState<string>('');

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Handle document content updates
  useEffect(() => {
    if (!document) {
      setRenderedContent('');
      setSections([]);
      return;
    }

    // Combine all sections into markdown content
    const markdownContent = document.sections
      .sort((a, b) => a.order - b.order)
      .map(section => {
        const completionIndicator = section.completionPercentage < 100 
          ? ' *[In Progress]*' 
          : '';
        return `## ${section.title}${completionIndicator}\n\n${section.content || '*Content will be generated...*'}\n\n`;
      })
      .join('---\n\n');

    // Render markdown to HTML
    const renderResult = renderMarkdown(markdownContent, {
      enableSyntaxHighlighting: true,
      enableTableOfContents: false, // We'll handle TOC separately
      theme
    });

    // Handle content highlighting for changes
    if (enableHighlighting && previousContent && previousContent !== markdownContent) {
      const diffResult = contentHighlighter.diff(previousContent, markdownContent);
      
      if (diffResult.hasChanges) {
        const highlightedContent = contentHighlighter.highlightChanges(
          renderResult.html,
          diffResult.changes,
          {
            duration: 5000,
            fadeOut: true,
            scrollToChange: true
          }
        );
        setRenderedContent(highlightedContent);

        // Animate highlights after render
        setTimeout(() => {
          if (contentRef.current) {
            animateContentHighlights(contentRef.current, {
              scrollToChange: true
            });
          }
        }, 100);
      } else {
        setRenderedContent(renderResult.html);
      }
    } else {
      setRenderedContent(renderResult.html);
    }

    setSections(renderResult.sections);
    setPreviousContent(markdownContent);

  }, [document, theme, enableHighlighting, previousContent]);

  // Handle scroll events for active section detection
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    
    // Throttle scroll events
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      onDocumentScroll?.(target.scrollTop);

      // Find active section based on scroll position
      const headings = contentRef.current?.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings) {
        let currentSection = '';
        const scrollTop = target.scrollTop + 100; // Offset for header

        for (let i = headings.length - 1; i >= 0; i--) {
          const heading = headings[i] as HTMLElement;
          if (heading.offsetTop <= scrollTop) {
            currentSection = heading.id || '';
            break;
          }
        }

        setActiveSection(currentSection);
      }
    }, 100);
  }, [onDocumentScroll]);

  // Handle section navigation
  const handleSectionClick = useCallback((sectionId: string, anchor: string) => {
    const element = document.getElementById(anchor);
    if (element && contentRef.current) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
    onSectionClick?.(sectionId);
  }, [onSectionClick]);

  // Handle syntax highlighting in code blocks
  const enhanceCodeBlocks = useCallback((content: string): string => {
    return content.replace(
      /<pre class="code-block bg-gray-900[^>]*><code class="language-([^"]*)"([^>]*)>(.*?)<\/code><\/pre>/gs,
      (match, language, attrs, code) => {
        // This would be replaced with actual SyntaxHighlighter component in JSX
        return `<div data-language="${language}" class="syntax-highlight-block">${code}</div>`;
      }
    );
  }, []);

  // Loading skeleton
  if (isLoading || !document) {
    return (
      <div className={cn('h-full flex flex-col bg-white', className)}>
        {/* Header skeleton */}
        <div className="p-6 border-b border-gray-200">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 p-6">
          <div className="animate-pulse space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 rounded w-4/6"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('h-full flex bg-white', className)}>
      {/* Table of Contents */}
      {showTableOfContents && sections.length > 0 && (
        <motion.div
          className="w-64 border-r border-gray-200 bg-gray-50 overflow-y-auto"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 256, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Contents</h3>
            <nav className="space-y-1">
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  onClick={() => handleSectionClick(section.id, section.anchor)}
                  className={cn(
                    'w-full text-left px-2 py-1 text-sm rounded transition-colors',
                    activeSection === section.anchor
                      ? 'bg-blue-100 text-blue-800 font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    `ml-${Math.max(0, (section.level - 1) * 2)}`
                  )}
                >
                  <span className="truncate block">{section.title}</span>
                </button>
              ))}
            </nav>
          </div>
        </motion.div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Document Header */}
        <div className="p-6 border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{document.title}</h1>
              <div className="flex items-center gap-4 mt-2">
                {showMetadata && (
                  <>
                    <span className="text-sm text-gray-500">
                      {document.metadata?.wordCount || 0} words
                    </span>
                    <span className="text-sm text-gray-500">
                      {document.metadata?.readingTime || 0} min read
                    </span>
                    <span className={cn(
                      'text-xs px-2 py-1 rounded-full font-medium',
                      document.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      document.status === 'GENERATING' ? 'bg-blue-100 text-blue-800' :
                      document.status === 'ERROR' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    )}>
                      {document.status.toLowerCase()}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Progress Indicator */}
            {showProgress && document.status === 'GENERATING' && (
              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-600">
                  {document.generationProgress}%
                </div>
                <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-500"
                    initial={{ width: '0%' }}
                    animate={{ width: `${document.generationProgress}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Document Content */}
        <div
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          <div className="max-w-none">
            {document.sections.length === 0 ? (
              <div className="p-12 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Document is being generated</h3>
                <p className="text-gray-600 max-w-sm mx-auto">
                  Your planning document will appear here as our AI agents complete their analysis and recommendations.
                </p>
              </div>
            ) : (
              <div
                ref={contentRef}
                className="prose prose-lg max-w-none px-8 py-6"
                dangerouslySetInnerHTML={{ 
                  __html: enhanceCodeBlocks(renderedContent)
                }}
                style={{
                  '--tw-prose-body': theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '--tw-prose-headings': theme === 'dark' ? 'rgb(243, 244, 246)' : 'rgb(17, 24, 39)',
                  '--tw-prose-links': theme === 'dark' ? 'rgb(96, 165, 250)' : 'rgb(59, 130, 246)',
                  '--tw-prose-bold': theme === 'dark' ? 'rgb(243, 244, 246)' : 'rgb(17, 24, 39)',
                  '--tw-prose-counters': theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                  '--tw-prose-bullets': theme === 'dark' ? 'rgb(75, 85, 99)' : 'rgb(209, 213, 219)',
                  '--tw-prose-hr': theme === 'dark' ? 'rgb(55, 65, 81)' : 'rgb(229, 231, 235)',
                  '--tw-prose-quotes': theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                  '--tw-prose-quote-borders': theme === 'dark' ? 'rgb(55, 65, 81)' : 'rgb(229, 231, 235)',
                  '--tw-prose-captions': theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                  '--tw-prose-code': theme === 'dark' ? 'rgb(243, 244, 246)' : 'rgb(17, 24, 39)',
                  '--tw-prose-pre-code': theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '--tw-prose-pre-bg': theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(249, 250, 251)',
                  '--tw-prose-th-borders': theme === 'dark' ? 'rgb(75, 85, 99)' : 'rgb(209, 213, 219)',
                  '--tw-prose-td-borders': theme === 'dark' ? 'rgb(55, 65, 81)' : 'rgb(229, 231, 235)',
                } as React.CSSProperties}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Last updated: {new Date(document.updatedAt).toLocaleString()}
            </span>
            <span>
              {document.sections.filter(s => s.completionPercentage === 100).length} of {document.sections.length} sections complete
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;