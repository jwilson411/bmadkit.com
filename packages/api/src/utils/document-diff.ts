import { z } from 'zod';
import { DocumentSection, DocumentVersion, DocumentDiff } from '../models/document';
import { logger } from './logger';

export interface DiffOperation {
  type: 'ADDED' | 'REMOVED' | 'MODIFIED';
  path: string;
  oldValue?: any;
  newValue?: any;
  lineNumber?: number;
}

export interface SectionDiff {
  sectionId: string;
  type: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  operations: DiffOperation[];
}

export class DocumentDiffGenerator {
  
  /**
   * Generate diff between two document versions
   */
  generateVersionDiff(
    fromVersion: DocumentVersion,
    toVersion: DocumentVersion
  ): DocumentDiff {
    
    logger.debug('Generating version diff', {
      fromVersion: fromVersion.version,
      toVersion: toVersion.version,
      documentId: fromVersion.documentId
    });

    const changes: DocumentDiff['changes'] = [];
    let sectionsAdded = 0;
    let sectionsModified = 0;
    let sectionsRemoved = 0;
    let wordsAdded = 0;
    let wordsRemoved = 0;

    // Create maps for easier lookup
    const fromSections = new Map(fromVersion.sections.map(s => [s.id, s]));
    const toSections = new Map(toVersion.sections.map(s => [s.id, s]));

    // Check for added and modified sections
    for (const [sectionId, toSection] of toSections) {
      const fromSection = fromSections.get(sectionId);
      
      if (!fromSection) {
        // Section added
        changes.push({
          type: 'ADDED',
          section: toSection.title,
          content: toSection.content,
          lineNumber: this.findSectionLineNumber(toVersion.content, toSection.title)
        });
        sectionsAdded++;
        wordsAdded += this.countWords(toSection.content);
      } else if (fromSection.content !== toSection.content) {
        // Section modified
        const contentDiff = this.generateContentDiff(fromSection.content, toSection.content);
        changes.push({
          type: 'MODIFIED',
          section: toSection.title,
          content: contentDiff,
          lineNumber: this.findSectionLineNumber(toVersion.content, toSection.title)
        });
        sectionsModified++;
        
        const wordDiff = this.calculateWordDiff(fromSection.content, toSection.content);
        wordsAdded += wordDiff.added;
        wordsRemoved += wordDiff.removed;
      }
    }

    // Check for removed sections
    for (const [sectionId, fromSection] of fromSections) {
      if (!toSections.has(sectionId)) {
        changes.push({
          type: 'REMOVED',
          section: fromSection.title,
          content: fromSection.content,
          lineNumber: this.findSectionLineNumber(fromVersion.content, fromSection.title)
        });
        sectionsRemoved++;
        wordsRemoved += this.countWords(fromSection.content);
      }
    }

    const diff: DocumentDiff = {
      documentId: fromVersion.documentId,
      fromVersion: fromVersion.version,
      toVersion: toVersion.version,
      changes,
      summary: {
        sectionsAdded,
        sectionsModified,
        sectionsRemoved,
        wordsAdded,
        wordsRemoved
      }
    };

    logger.debug('Version diff generated', {
      documentId: fromVersion.documentId,
      changesCount: changes.length,
      summary: diff.summary
    });

    return diff;
  }

  /**
   * Generate diff between two sections
   */
  generateSectionDiff(
    oldSection: DocumentSection,
    newSection: DocumentSection
  ): SectionDiff {
    
    const operations: DiffOperation[] = [];

    // Check title changes
    if (oldSection.title !== newSection.title) {
      operations.push({
        type: 'MODIFIED',
        path: 'title',
        oldValue: oldSection.title,
        newValue: newSection.title
      });
    }

    // Check content changes
    if (oldSection.content !== newSection.content) {
      const contentOperations = this.generateContentOperations(
        oldSection.content,
        newSection.content
      );
      operations.push(...contentOperations);
    }

    // Check order changes
    if (oldSection.order !== newSection.order) {
      operations.push({
        type: 'MODIFIED',
        path: 'order',
        oldValue: oldSection.order,
        newValue: newSection.order
      });
    }

    // Check completion percentage changes
    if (oldSection.completionPercentage !== newSection.completionPercentage) {
      operations.push({
        type: 'MODIFIED',
        path: 'completionPercentage',
        oldValue: oldSection.completionPercentage,
        newValue: newSection.completionPercentage
      });
    }

    // Determine overall section change type
    let changeType: SectionDiff['type'] = 'UNCHANGED';
    if (operations.length > 0) {
      changeType = operations.some(op => op.path === 'content' && op.type === 'ADDED') ? 'ADDED' :
                   operations.some(op => op.path === 'content' && op.type === 'REMOVED') ? 'REMOVED' : 'MODIFIED';
    }

    return {
      sectionId: newSection.id,
      type: changeType,
      operations
    };
  }

  /**
   * Generate content diff as unified diff format
   */
  private generateContentDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    const diffLines: string[] = [];
    let oldIndex = 0;
    let newIndex = 0;

    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      const oldLine = oldLines[oldIndex] || '';
      const newLine = newLines[newIndex] || '';

      if (oldLine === newLine) {
        // Lines match
        diffLines.push(` ${oldLine}`);
        oldIndex++;
        newIndex++;
      } else {
        // Lines differ - simplified approach
        if (oldIndex < oldLines.length) {
          diffLines.push(`-${oldLine}`);
          oldIndex++;
        }
        if (newIndex < newLines.length) {
          diffLines.push(`+${newLine}`);
          newIndex++;
        }
      }
    }

    return diffLines.join('\n');
  }

  /**
   * Generate detailed content operations
   */
  private generateContentOperations(oldContent: string, newContent: string): DiffOperation[] {
    const operations: DiffOperation[] = [];
    
    if (oldContent && !newContent) {
      operations.push({
        type: 'REMOVED',
        path: 'content',
        oldValue: oldContent,
        newValue: '',
        lineNumber: 1
      });
    } else if (!oldContent && newContent) {
      operations.push({
        type: 'ADDED',
        path: 'content',
        oldValue: '',
        newValue: newContent,
        lineNumber: 1
      });
    } else if (oldContent !== newContent) {
      operations.push({
        type: 'MODIFIED',
        path: 'content',
        oldValue: oldContent,
        newValue: newContent,
        lineNumber: 1
      });
    }

    return operations;
  }

  /**
   * Calculate word count differences
   */
  private calculateWordDiff(oldContent: string, newContent: string): {
    added: number;
    removed: number;
  } {
    const oldWords = this.countWords(oldContent);
    const newWords = this.countWords(newContent);
    
    return {
      added: Math.max(0, newWords - oldWords),
      removed: Math.max(0, oldWords - newWords)
    };
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0)
      .length;
  }

  /**
   * Find line number of section in document content
   */
  private findSectionLineNumber(content: string, sectionTitle: string): number {
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(sectionTitle)) {
        return i + 1; // 1-based line numbers
      }
    }
    
    return 1; // Default to line 1 if not found
  }

  /**
   * Generate a summary of changes between versions
   */
  generateChangeSummary(diff: DocumentDiff): string {
    const { summary } = diff;
    const parts: string[] = [];

    if (summary.sectionsAdded > 0) {
      parts.push(`${summary.sectionsAdded} section${summary.sectionsAdded > 1 ? 's' : ''} added`);
    }

    if (summary.sectionsModified > 0) {
      parts.push(`${summary.sectionsModified} section${summary.sectionsModified > 1 ? 's' : ''} modified`);
    }

    if (summary.sectionsRemoved > 0) {
      parts.push(`${summary.sectionsRemoved} section${summary.sectionsRemoved > 1 ? 's' : ''} removed`);
    }

    const netWords = summary.wordsAdded - summary.wordsRemoved;
    if (netWords > 0) {
      parts.push(`${netWords} words added`);
    } else if (netWords < 0) {
      parts.push(`${Math.abs(netWords)} words removed`);
    }

    if (parts.length === 0) {
      return 'No changes detected';
    }

    return parts.join(', ');
  }

  /**
   * Check if two document versions are identical
   */
  areVersionsIdentical(version1: DocumentVersion, version2: DocumentVersion): boolean {
    // Quick checksum comparison
    if (version1.checksum && version2.checksum) {
      return version1.checksum === version2.checksum;
    }

    // Fallback to content comparison
    return version1.content === version2.content;
  }

  /**
   * Analyze diff complexity
   */
  analyzeDiffComplexity(diff: DocumentDiff): {
    complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    factors: string[];
  } {
    const factors: string[] = [];
    let score = 0;

    // Factor in the number of changes
    score += diff.changes.length * 2;
    if (diff.changes.length > 5) {
      factors.push('Many changes');
    }

    // Factor in section additions/removals (more complex than modifications)
    const structuralChanges = diff.summary.sectionsAdded + diff.summary.sectionsRemoved;
    score += structuralChanges * 3;
    if (structuralChanges > 0) {
      factors.push('Structural changes');
    }

    // Factor in word count changes
    const totalWordChanges = diff.summary.wordsAdded + diff.summary.wordsRemoved;
    score += Math.floor(totalWordChanges / 100);
    if (totalWordChanges > 500) {
      factors.push('Large content changes');
    }

    // Determine complexity level
    let complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    if (score <= 5) {
      complexity = 'LOW';
    } else if (score <= 15) {
      complexity = 'MEDIUM';
    } else {
      complexity = 'HIGH';
    }

    return {
      complexity,
      score,
      factors
    };
  }
}