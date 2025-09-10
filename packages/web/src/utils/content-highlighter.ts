/**
 * Content highlighter utility for detecting and highlighting changes in document content
 */

export interface ContentChange {
  type: 'added' | 'modified' | 'removed';
  startIndex: number;
  endIndex: number;
  oldText?: string;
  newText: string;
  confidence: number; // 0-1 confidence score
}

export interface HighlightConfig {
  addedClassName?: string;
  modifiedClassName?: string;
  removedClassName?: string;
  duration?: number; // Animation duration in ms
  fadeOut?: boolean;
  scrollToChange?: boolean;
}

export interface DiffResult {
  changes: ContentChange[];
  hasChanges: boolean;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

export class ContentHighlighter {
  private static instance: ContentHighlighter;
  private highlightTimeouts: Map<string, NodeJS.Timeout> = new Map();

  static getInstance(): ContentHighlighter {
    if (!ContentHighlighter.instance) {
      ContentHighlighter.instance = new ContentHighlighter();
    }
    return ContentHighlighter.instance;
  }

  /**
   * Compare two content strings and identify changes
   */
  diff(oldContent: string, newContent: string): DiffResult {
    const changes: ContentChange[] = [];

    // Simple word-level diff implementation
    const oldWords = this.tokenize(oldContent);
    const newWords = this.tokenize(newContent);

    const diffMatrix = this.computeLCS(oldWords, newWords);
    const diffOperations = this.traceback(diffMatrix, oldWords, newWords);

    let oldIndex = 0;
    let newIndex = 0;

    for (const operation of diffOperations) {
      switch (operation.type) {
        case 'equal':
          oldIndex += operation.count;
          newIndex += operation.count;
          break;

        case 'delete':
          const deletedText = oldWords.slice(oldIndex, oldIndex + operation.count).join(' ');
          changes.push({
            type: 'removed',
            startIndex: this.getCharIndex(newContent, newIndex),
            endIndex: this.getCharIndex(newContent, newIndex),
            oldText: deletedText,
            newText: '',
            confidence: 0.9
          });
          oldIndex += operation.count;
          break;

        case 'insert':
          const insertedText = newWords.slice(newIndex, newIndex + operation.count).join(' ');
          const startIdx = this.getCharIndex(newContent, newIndex);
          const endIdx = this.getCharIndex(newContent, newIndex + operation.count);
          
          changes.push({
            type: 'added',
            startIndex: startIdx,
            endIndex: endIdx,
            newText: insertedText,
            confidence: 0.9
          });
          newIndex += operation.count;
          break;

        case 'replace':
          const oldText = oldWords.slice(oldIndex, oldIndex + operation.oldCount).join(' ');
          const newText = newWords.slice(newIndex, newIndex + operation.newCount).join(' ');
          const replaceStartIdx = this.getCharIndex(newContent, newIndex);
          const replaceEndIdx = this.getCharIndex(newContent, newIndex + operation.newCount);

          changes.push({
            type: 'modified',
            startIndex: replaceStartIdx,
            endIndex: replaceEndIdx,
            oldText,
            newText,
            confidence: 0.8
          });
          oldIndex += operation.oldCount;
          newIndex += operation.newCount;
          break;
      }
    }

    return {
      changes,
      hasChanges: changes.length > 0,
      addedCount: changes.filter(c => c.type === 'added').length,
      modifiedCount: changes.filter(c => c.type === 'modified').length,
      removedCount: changes.filter(c => c.type === 'removed').length
    };
  }

  /**
   * Highlight content changes in HTML
   */
  highlightChanges(
    htmlContent: string,
    changes: ContentChange[],
    config: HighlightConfig = {}
  ): string {
    const {
      addedClassName = 'content-added',
      modifiedClassName = 'content-modified',
      removedClassName = 'content-removed',
      duration = 3000,
      fadeOut = true
    } = config;

    let highlightedContent = htmlContent;
    let offset = 0;

    // Sort changes by position to apply them correctly
    const sortedChanges = [...changes].sort((a, b) => a.startIndex - b.startIndex);

    for (const change of sortedChanges) {
      const className = {
        added: addedClassName,
        modified: modifiedClassName,
        removed: removedClassName
      }[change.type];

      const startPos = change.startIndex + offset;
      const endPos = change.endIndex + offset;

      // Create highlight wrapper
      const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const before = highlightedContent.substring(0, startPos);
      const content = highlightedContent.substring(startPos, endPos);
      const after = highlightedContent.substring(endPos);

      const wrapper = `<span id="${highlightId}" class="${className} highlight-animate" data-change-type="${change.type}">${content}</span>`;
      
      highlightedContent = before + wrapper + after;
      offset += wrapper.length - content.length;

      // Set up fade out timer if enabled
      if (fadeOut && duration > 0) {
        const timeout = setTimeout(() => {
          this.fadeOutHighlight(highlightId);
          this.highlightTimeouts.delete(highlightId);
        }, duration);

        this.highlightTimeouts.set(highlightId, timeout);
      }
    }

    return highlightedContent;
  }

  /**
   * Apply highlight animations to DOM elements
   */
  animateHighlights(container: HTMLElement, config: HighlightConfig = {}): void {
    const { scrollToChange = true } = config;
    const highlights = container.querySelectorAll('.highlight-animate');

    highlights.forEach((element, index) => {
      const htmlElement = element as HTMLElement;
      
      // Add CSS classes for animation
      htmlElement.classList.add('highlight-enter');

      // Stagger animations
      setTimeout(() => {
        htmlElement.classList.add('highlight-enter-active');
        htmlElement.classList.remove('highlight-enter');

        // Scroll to first change
        if (scrollToChange && index === 0) {
          this.scrollToElement(htmlElement);
        }
      }, index * 100);
    });
  }

  /**
   * Scroll smoothly to an element
   */
  private scrollToElement(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const isVisible = (
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight
    );

    if (!isVisible) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      // Add temporary visual indicator
      element.classList.add('scroll-target');
      setTimeout(() => {
        element.classList.remove('scroll-target');
      }, 2000);
    }
  }

  /**
   * Fade out a highlight after specified duration
   */
  private fadeOutHighlight(highlightId: string): void {
    const element = document.getElementById(highlightId);
    if (element) {
      element.classList.add('highlight-exit');
      
      setTimeout(() => {
        element.classList.remove('highlight-animate', 'highlight-exit');
        element.removeAttribute('id');
        
        // Remove the wrapper span, keeping the content
        const parent = element.parentNode;
        if (parent) {
          while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
          }
          parent.removeChild(element);
        }
      }, 300); // Match CSS transition duration
    }
  }

  /**
   * Clear all active highlights
   */
  clearHighlights(container: HTMLElement): void {
    // Clear all timeouts
    this.highlightTimeouts.forEach(timeout => clearTimeout(timeout));
    this.highlightTimeouts.clear();

    // Remove highlight elements
    const highlights = container.querySelectorAll('.highlight-animate');
    highlights.forEach(element => {
      const parent = element.parentNode;
      if (parent) {
        while (element.firstChild) {
          parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
      }
    });
  }

  /**
   * Detect incremental content changes (for real-time updates)
   */
  detectIncrementalChanges(
    previousContent: string,
    newContent: string,
    threshold: number = 0.1
  ): { hasSignificantChange: boolean; changeRatio: number; changes: ContentChange[] } {
    const changes = this.diff(previousContent, newContent).changes;
    
    const totalLength = Math.max(previousContent.length, newContent.length);
    const changedLength = changes.reduce((sum, change) => 
      sum + Math.abs(change.endIndex - change.startIndex), 0
    );
    
    const changeRatio = totalLength > 0 ? changedLength / totalLength : 0;
    const hasSignificantChange = changeRatio > threshold;

    return {
      hasSignificantChange,
      changeRatio,
      changes
    };
  }

  /**
   * Tokenize content into words/tokens
   */
  private tokenize(content: string): string[] {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Compute Longest Common Subsequence matrix for diff
   */
  private computeLCS(seq1: string[], seq2: string[]): number[][] {
    const m = seq1.length;
    const n = seq2.length;
    const matrix: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1] === seq2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
        } else {
          matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
      }
    }

    return matrix;
  }

  /**
   * Traceback through LCS matrix to find diff operations
   */
  private traceback(matrix: number[][], seq1: string[], seq2: string[]): Array<{
    type: 'equal' | 'delete' | 'insert' | 'replace';
    count: number;
    oldCount?: number;
    newCount?: number;
  }> {
    const operations: Array<any> = [];
    let i = seq1.length;
    let j = seq2.length;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && seq1[i - 1] === seq2[j - 1]) {
        operations.unshift({ type: 'equal', count: 1 });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
        operations.unshift({ type: 'insert', count: 1 });
        j--;
      } else if (i > 0) {
        operations.unshift({ type: 'delete', count: 1 });
        i--;
      }
    }

    // Merge consecutive operations of the same type
    const mergedOperations: Array<any> = [];
    let current = operations[0];

    for (let k = 1; k < operations.length; k++) {
      if (current.type === operations[k].type) {
        current.count += operations[k].count;
      } else {
        mergedOperations.push(current);
        current = operations[k];
      }
    }
    
    if (current) {
      mergedOperations.push(current);
    }

    return mergedOperations;
  }

  /**
   * Get character index from word index
   */
  private getCharIndex(content: string, wordIndex: number): number {
    const words = content.split(/\s+/);
    if (wordIndex >= words.length) return content.length;
    
    let charIndex = 0;
    for (let i = 0; i < wordIndex; i++) {
      charIndex += words[i].length + 1; // +1 for space
    }
    
    return Math.max(0, charIndex - 1); // -1 to account for trailing space
  }
}

// Export singleton instance
export const contentHighlighter = ContentHighlighter.getInstance();

// CSS styles for highlighting (to be added to your CSS file)
export const highlightCSS = `
.content-added {
  background-color: rgba(34, 197, 94, 0.2);
  border-bottom: 2px solid rgba(34, 197, 94, 0.6);
  animation: pulse-added 0.5s ease-in-out;
}

.content-modified {
  background-color: rgba(251, 191, 36, 0.2);
  border-bottom: 2px solid rgba(251, 191, 36, 0.6);
  animation: pulse-modified 0.5s ease-in-out;
}

.content-removed {
  background-color: rgba(239, 68, 68, 0.2);
  border-bottom: 2px solid rgba(239, 68, 68, 0.6);
  animation: pulse-removed 0.5s ease-in-out;
  text-decoration: line-through;
}

.highlight-animate {
  transition: all 0.3s ease;
  position: relative;
}

.highlight-enter {
  opacity: 0;
  transform: translateY(-10px);
}

.highlight-enter-active {
  opacity: 1;
  transform: translateY(0);
}

.highlight-exit {
  opacity: 0;
  transform: scale(0.95);
  transition: all 0.3s ease;
}

.scroll-target {
  animation: scroll-indicator 2s ease-in-out;
}

@keyframes pulse-added {
  0%, 100% { background-color: rgba(34, 197, 94, 0.2); }
  50% { background-color: rgba(34, 197, 94, 0.4); }
}

@keyframes pulse-modified {
  0%, 100% { background-color: rgba(251, 191, 36, 0.2); }
  50% { background-color: rgba(251, 191, 36, 0.4); }
}

@keyframes pulse-removed {
  0%, 100% { background-color: rgba(239, 68, 68, 0.2); }
  50% { background-color: rgba(239, 68, 68, 0.4); }
}

@keyframes scroll-indicator {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
  50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
}
`;

// Utility functions
export const detectChanges = (oldContent: string, newContent: string) => {
  return contentHighlighter.diff(oldContent, newContent);
};

export const highlightContentChanges = (
  htmlContent: string,
  changes: ContentChange[],
  config?: HighlightConfig
) => {
  return contentHighlighter.highlightChanges(htmlContent, changes, config);
};

export const animateContentHighlights = (container: HTMLElement, config?: HighlightConfig) => {
  return contentHighlighter.animateHighlights(container, config);
};

export const clearContentHighlights = (container: HTMLElement) => {
  return contentHighlighter.clearHighlights(container);
};