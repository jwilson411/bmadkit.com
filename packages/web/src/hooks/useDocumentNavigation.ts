import { useState, useEffect, useCallback, useRef } from 'react';

export interface NavigationSection {
  id: string;
  title: string;
  level: number;
  element?: HTMLElement;
  offsetTop: number;
  isVisible: boolean;
  progress: number; // 0-1 based on scroll position within section
}

export interface UseDocumentNavigationOptions {
  rootMargin?: string;
  threshold?: number | number[];
  scrollOffset?: number; // Offset for active section detection
  smoothScrollDuration?: number;
  onActiveChange?: (sectionId: string) => void;
  onProgressChange?: (sectionId: string, progress: number) => void;
}

export interface UseDocumentNavigationReturn {
  sections: NavigationSection[];
  activeSection: string;
  scrollProgress: number; // Overall document scroll progress (0-1)
  isAtTop: boolean;
  isAtBottom: boolean;
  
  // Navigation functions
  scrollToSection: (sectionId: string, options?: ScrollIntoViewOptions) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  scrollBy: (pixels: number) => void;
  
  // Section management
  registerSection: (id: string, title: string, level: number, element: HTMLElement) => void;
  unregisterSection: (id: string) => void;
  refreshSections: () => void;
  
  // Search and filtering
  searchSections: (query: string) => NavigationSection[];
  getSectionsByLevel: (level: number) => NavigationSection[];
}

export const useDocumentNavigation = (
  containerRef: React.RefObject<HTMLElement>,
  options: UseDocumentNavigationOptions = {}
): UseDocumentNavigationReturn => {
  
  const {
    rootMargin = '0px 0px -50% 0px',
    threshold = [0, 0.25, 0.5, 0.75, 1],
    scrollOffset = 100,
    smoothScrollDuration = 500,
    onActiveChange,
    onProgressChange
  } = options;

  const [sections, setSections] = useState<NavigationSection[]>([]);
  const [activeSection, setActiveSection] = useState<string>('');
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isAtTop, setIsAtTop] = useState<boolean>(true);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(false);

  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const sectionsMapRef = useRef<Map<string, NavigationSection>>(new Map());
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize intersection observer
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const sectionId = entry.target.getAttribute('id');
          if (!sectionId) return;

          const section = sectionsMapRef.current.get(sectionId);
          if (!section) return;

          // Update visibility and progress
          const updatedSection: NavigationSection = {
            ...section,
            isVisible: entry.isIntersecting,
            progress: entry.intersectionRatio
          };

          sectionsMapRef.current.set(sectionId, updatedSection);
          
          // Notify progress change
          onProgressChange?.(sectionId, entry.intersectionRatio);

          // Update state
          setSections(prev => prev.map(s => 
            s.id === sectionId ? updatedSection : s
          ));
        });

        // Find the most visible section to set as active
        const visibleSections = Array.from(sectionsMapRef.current.values())
          .filter(section => section.isVisible)
          .sort((a, b) => b.progress - a.progress);

        if (visibleSections.length > 0) {
          const newActiveSection = visibleSections[0].id;
          if (newActiveSection !== activeSection) {
            setActiveSection(newActiveSection);
            onActiveChange?.(newActiveSection);
          }
        }
      },
      {
        root: containerRef.current,
        rootMargin,
        threshold
      }
    );

    intersectionObserverRef.current = observer;

    return () => {
      observer.disconnect();
    };
  }, [containerRef, rootMargin, threshold, activeSection, onActiveChange, onProgressChange]);

  // Handle scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Throttle scroll events
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        // Calculate overall scroll progress
        const maxScroll = scrollHeight - clientHeight;
        const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
        setScrollProgress(progress);

        // Check if at top or bottom
        setIsAtTop(scrollTop <= 10);
        setIsAtBottom(scrollTop >= maxScroll - 10);

        // Update section positions
        const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach((heading) => {
          const sectionId = heading.getAttribute('id');
          if (sectionId && sectionsMapRef.current.has(sectionId)) {
            const section = sectionsMapRef.current.get(sectionId)!;
            const rect = heading.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            const updatedSection: NavigationSection = {
              ...section,
              offsetTop: rect.top - containerRect.top + scrollTop
            };
            
            sectionsMapRef.current.set(sectionId, updatedSection);
          }
        });

      }, 50);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [containerRef]);

  // Register a new section
  const registerSection = useCallback((id: string, title: string, level: number, element: HTMLElement) => {
    const section: NavigationSection = {
      id,
      title,
      level,
      element,
      offsetTop: element.offsetTop,
      isVisible: false,
      progress: 0
    };

    sectionsMapRef.current.set(id, section);
    setSections(prev => {
      const newSections = prev.filter(s => s.id !== id);
      newSections.push(section);
      return newSections.sort((a, b) => a.offsetTop - b.offsetTop);
    });

    // Start observing the element
    if (intersectionObserverRef.current) {
      intersectionObserverRef.current.observe(element);
    }
  }, []);

  // Unregister a section
  const unregisterSection = useCallback((id: string) => {
    const section = sectionsMapRef.current.get(id);
    if (section?.element && intersectionObserverRef.current) {
      intersectionObserverRef.current.unobserve(section.element);
    }

    sectionsMapRef.current.delete(id);
    setSections(prev => prev.filter(s => s.id !== id));
  }, []);

  // Refresh sections (re-scan the document)
  const refreshSections = useCallback(() => {
    if (!containerRef.current) return;

    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const newSections: NavigationSection[] = [];

    headings.forEach((heading) => {
      const id = heading.getAttribute('id');
      const title = heading.textContent || '';
      const level = parseInt(heading.tagName.charAt(1));
      
      if (id) {
        const section: NavigationSection = {
          id,
          title,
          level,
          element: heading as HTMLElement,
          offsetTop: (heading as HTMLElement).offsetTop,
          isVisible: false,
          progress: 0
        };

        newSections.push(section);
        sectionsMapRef.current.set(id, section);

        // Start observing
        if (intersectionObserverRef.current) {
          intersectionObserverRef.current.observe(heading);
        }
      }
    });

    setSections(newSections.sort((a, b) => a.offsetTop - b.offsetTop));
  }, [containerRef]);

  // Navigation functions
  const scrollToSection = useCallback((sectionId: string, scrollOptions?: ScrollIntoViewOptions) => {
    const section = sectionsMapRef.current.get(sectionId);
    if (section?.element) {
      section.element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        ...scrollOptions
      });
    }
  }, []);

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [containerRef]);

  const scrollBy = useCallback((pixels: number) => {
    containerRef.current?.scrollBy({
      top: pixels,
      behavior: 'smooth'
    });
  }, [containerRef]);

  // Search sections
  const searchSections = useCallback((query: string): NavigationSection[] => {
    if (!query.trim()) return sections;
    
    const lowerQuery = query.toLowerCase();
    return sections.filter(section =>
      section.title.toLowerCase().includes(lowerQuery) ||
      section.id.toLowerCase().includes(lowerQuery)
    );
  }, [sections]);

  // Get sections by level
  const getSectionsByLevel = useCallback((level: number): NavigationSection[] => {
    return sections.filter(section => section.level === level);
  }, [sections]);

  // Auto-refresh sections when container changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial scan
    refreshSections();

    // Watch for DOM changes
    const mutationObserver = new MutationObserver(() => {
      // Debounce the refresh
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      scrollTimeoutRef.current = setTimeout(refreshSections, 500);
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id']
    });

    return () => {
      mutationObserver.disconnect();
    };
  }, [containerRef, refreshSections]);

  return {
    sections,
    activeSection,
    scrollProgress,
    isAtTop,
    isAtBottom,
    scrollToSection,
    scrollToTop,
    scrollToBottom,
    scrollBy,
    registerSection,
    unregisterSection,
    refreshSections,
    searchSections,
    getSectionsByLevel
  };
};

export default useDocumentNavigation;