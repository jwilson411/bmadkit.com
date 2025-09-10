import { z } from 'zod';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import {
  Document,
  DocumentSection,
  DocumentVersion,
  DocumentStatus,
  DocumentDiff,
  DocumentSchema,
  DocumentVersionSchema,
  generateDocumentId,
  generateVersionId,
  calculateDocumentProgress
} from '../models/document';
import { DocumentDiffGenerator } from '../utils/document-diff';

export interface DocumentStateManagerConfig {
  enableVersioning: boolean;
  maxVersionsPerDocument: number;
  enableAutosave: boolean;
  autosaveIntervalMs: number;
  enableIntegrityChecks: boolean;
}

export interface DocumentStateQuery {
  workflowExecutionId?: string;
  status?: DocumentStatus;
  type?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'type';
  sortOrder?: 'asc' | 'desc';
}

export interface DocumentStateUpdate {
  status?: DocumentStatus;
  sections?: DocumentSection[];
  metadata?: Record<string, any>;
  generationProgress?: number;
}

export class DocumentStateManager extends EventEmitter {
  private config: DocumentStateManagerConfig;
  private documents: Map<string, Document> = new Map();
  private versions: Map<string, DocumentVersion[]> = new Map();
  private diffGenerator: DocumentDiffGenerator;
  private autosaveTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<DocumentStateManagerConfig> = {}) {
    super();
    
    this.config = {
      enableVersioning: true,
      maxVersionsPerDocument: 10,
      enableAutosave: false,
      autosaveIntervalMs: 30000, // 30 seconds
      enableIntegrityChecks: true,
      ...config
    };

    this.diffGenerator = new DocumentDiffGenerator();
    
    logger.info('Document state manager initialized', {
      config: this.config
    });
  }

  /**
   * Create a new document
   */
  async createDocument(
    workflowExecutionId: string,
    type: string,
    title: string,
    templateId?: string
  ): Promise<Document> {
    
    const documentId = generateDocumentId();
    const now = new Date();

    const document: Document = {
      id: documentId,
      workflowExecutionId,
      type: type as any,
      title,
      status: 'DRAFT',
      currentVersion: 1,
      sections: [],
      templateId: templateId || `${type.toLowerCase()}-template`,
      generationProgress: 0,
      metadata: {
        projectName: title,
        lastAgentPhase: undefined,
        wordCount: 0,
        readingTime: 0
      },
      createdAt: now,
      updatedAt: now
    };

    // Validate document
    const validatedDocument = DocumentSchema.parse(document);
    
    // Store document
    this.documents.set(documentId, validatedDocument);

    // Create initial version if versioning is enabled
    if (this.config.enableVersioning) {
      await this.createVersion(validatedDocument);
    }

    // Setup autosave if enabled
    if (this.config.enableAutosave) {
      this.setupAutosave(documentId);
    }

    logger.info('Document created', {
      documentId,
      type,
      workflowExecutionId,
      versioning: this.config.enableVersioning
    });

    this.emit('document-created', {
      documentId,
      document: validatedDocument
    });

    return validatedDocument;
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<Document | null> {
    const document = this.documents.get(documentId);
    
    if (!document) {
      logger.debug('Document not found', { documentId });
      return null;
    }

    // Integrity check if enabled
    if (this.config.enableIntegrityChecks) {
      await this.verifyDocumentIntegrity(document);
    }

    return document;
  }

  /**
   * Update document
   */
  async updateDocument(
    documentId: string,
    updates: DocumentStateUpdate
  ): Promise<Document> {
    
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    logger.debug('Updating document', {
      documentId,
      updates: Object.keys(updates)
    });

    const previousVersion = { ...document };
    const now = new Date();

    // Apply updates
    const updatedDocument: Document = {
      ...document,
      ...updates,
      updatedAt: now
    };

    // Recalculate progress if sections were updated
    if (updates.sections) {
      updatedDocument.generationProgress = calculateDocumentProgress(updates.sections);
      updatedDocument.sections = updates.sections;
    }

    // Update word count if sections changed
    if (updates.sections) {
      const wordCount = this.calculateTotalWordCount(updates.sections);
      updatedDocument.metadata = {
        ...updatedDocument.metadata,
        wordCount,
        readingTime: Math.ceil(wordCount / 200)
      };
    }

    // Validate updated document
    const validatedDocument = DocumentSchema.parse(updatedDocument);

    // Store updated document
    this.documents.set(documentId, validatedDocument);

    // Create new version if significant changes and versioning enabled
    if (this.config.enableVersioning && this.hasSignificantChanges(previousVersion, validatedDocument)) {
      await this.createVersion(validatedDocument);
    }

    logger.info('Document updated', {
      documentId,
      status: validatedDocument.status,
      progress: validatedDocument.generationProgress,
      sections: validatedDocument.sections.length
    });

    this.emit('document-updated', {
      documentId,
      previousVersion,
      currentVersion: validatedDocument,
      changes: updates
    });

    return validatedDocument;
  }

  /**
   * Update document section
   */
  async updateDocumentSection(
    documentId: string,
    sectionId: string,
    updates: Partial<DocumentSection>
  ): Promise<DocumentSection> {
    
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    const sectionIndex = document.sections.findIndex(s => s.id === sectionId);
    if (sectionIndex === -1) {
      throw new Error(`Section ${sectionId} not found in document ${documentId}`);
    }

    logger.debug('Updating document section', {
      documentId,
      sectionId,
      updates: Object.keys(updates)
    });

    const previousSection = { ...document.sections[sectionIndex] };
    const updatedSection: DocumentSection = {
      ...document.sections[sectionIndex],
      ...updates,
      lastUpdated: new Date()
    };

    // Update section in document
    const updatedSections = [...document.sections];
    updatedSections[sectionIndex] = updatedSection;

    // Update the entire document
    await this.updateDocument(documentId, {
      sections: updatedSections
    });

    this.emit('section-updated', {
      documentId,
      sectionId,
      previousSection,
      currentSection: updatedSection
    });

    return updatedSection;
  }

  /**
   * Add section to document
   */
  async addDocumentSection(
    documentId: string,
    section: Omit<DocumentSection, 'id' | 'lastUpdated'>
  ): Promise<DocumentSection> {
    
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    const newSection: DocumentSection = {
      ...section,
      id: `section_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      lastUpdated: new Date()
    };

    logger.debug('Adding section to document', {
      documentId,
      sectionId: newSection.id,
      title: newSection.title
    });

    const updatedSections = [...document.sections, newSection];
    await this.updateDocument(documentId, {
      sections: updatedSections
    });

    this.emit('section-added', {
      documentId,
      section: newSection
    });

    return newSection;
  }

  /**
   * Remove section from document
   */
  async removeDocumentSection(documentId: string, sectionId: string): Promise<void> {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    const sectionIndex = document.sections.findIndex(s => s.id === sectionId);
    if (sectionIndex === -1) {
      throw new Error(`Section ${sectionId} not found in document ${documentId}`);
    }

    logger.debug('Removing section from document', {
      documentId,
      sectionId
    });

    const removedSection = document.sections[sectionIndex];
    const updatedSections = document.sections.filter(s => s.id !== sectionId);

    await this.updateDocument(documentId, {
      sections: updatedSections
    });

    this.emit('section-removed', {
      documentId,
      sectionId,
      removedSection
    });
  }

  /**
   * Query documents
   */
  async queryDocuments(query: DocumentStateQuery = {}): Promise<Document[]> {
    let results = Array.from(this.documents.values());

    // Apply filters
    if (query.workflowExecutionId) {
      results = results.filter(doc => doc.workflowExecutionId === query.workflowExecutionId);
    }

    if (query.status) {
      results = results.filter(doc => doc.status === query.status);
    }

    if (query.type) {
      results = results.filter(doc => doc.type === query.type);
    }

    // Apply sorting
    if (query.sortBy) {
      results.sort((a, b) => {
        const aValue = a[query.sortBy!];
        const bValue = b[query.sortBy!];
        const order = query.sortOrder === 'desc' ? -1 : 1;

        if (aValue instanceof Date && bValue instanceof Date) {
          return (aValue.getTime() - bValue.getTime()) * order;
        }

        return (String(aValue).localeCompare(String(bValue))) * order;
      });
    }

    // Apply pagination
    if (query.offset) {
      results = results.slice(query.offset);
    }

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Create document version
   */
  private async createVersion(document: Document): Promise<DocumentVersion> {
    const versionId = generateVersionId();
    const now = new Date();

    // Calculate content for version
    const content = this.generateDocumentContent(document);

    const version: DocumentVersion = {
      id: versionId,
      documentId: document.id,
      version: document.currentVersion,
      content,
      sections: [...document.sections],
      createdAt: now,
      size: content.length,
      checksum: this.generateChecksum(content)
    };

    // Validate version
    const validatedVersion = DocumentVersionSchema.parse(version);

    // Store version
    if (!this.versions.has(document.id)) {
      this.versions.set(document.id, []);
    }

    const documentVersions = this.versions.get(document.id)!;
    documentVersions.push(validatedVersion);

    // Cleanup old versions if needed
    if (documentVersions.length > this.config.maxVersionsPerDocument) {
      const versionsToRemove = documentVersions.length - this.config.maxVersionsPerDocument;
      documentVersions.splice(0, versionsToRemove);
    }

    // Update document version number
    document.currentVersion++;

    logger.debug('Document version created', {
      documentId: document.id,
      versionId,
      version: validatedVersion.version,
      totalVersions: documentVersions.length
    });

    this.emit('version-created', {
      documentId: document.id,
      version: validatedVersion
    });

    return validatedVersion;
  }

  /**
   * Get document versions
   */
  async getDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    const versions = this.versions.get(documentId) || [];
    return [...versions].sort((a, b) => b.version - a.version);
  }

  /**
   * Get specific document version
   */
  async getDocumentVersion(documentId: string, version: number): Promise<DocumentVersion | null> {
    const versions = this.versions.get(documentId) || [];
    return versions.find(v => v.version === version) || null;
  }

  /**
   * Generate diff between versions
   */
  async generateVersionDiff(
    documentId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<DocumentDiff> {
    
    const versions = this.versions.get(documentId) || [];
    const fromVersionObj = versions.find(v => v.version === fromVersion);
    const toVersionObj = versions.find(v => v.version === toVersion);

    if (!fromVersionObj || !toVersionObj) {
      throw new Error(`Version not found for document ${documentId}`);
    }

    return this.diffGenerator.generateVersionDiff(fromVersionObj, toVersionObj);
  }

  /**
   * Rollback document to specific version
   */
  async rollbackToVersion(documentId: string, targetVersion: number): Promise<Document> {
    const versionObj = await this.getDocumentVersion(documentId, targetVersion);
    if (!versionObj) {
      throw new Error(`Version ${targetVersion} not found for document ${documentId}`);
    }

    logger.info('Rolling back document to version', {
      documentId,
      targetVersion,
      currentVersion: this.documents.get(documentId)?.currentVersion
    });

    // Restore document state from version
    const updates: DocumentStateUpdate = {
      sections: versionObj.sections,
      status: 'DRAFT' // Reset to draft after rollback
    };

    const document = await this.updateDocument(documentId, updates);

    this.emit('document-rollback', {
      documentId,
      targetVersion,
      document
    });

    return document;
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string): Promise<void> {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    logger.info('Deleting document', { documentId });

    // Clear autosave timer
    const timer = this.autosaveTimers.get(documentId);
    if (timer) {
      clearInterval(timer);
      this.autosaveTimers.delete(documentId);
    }

    // Remove document and versions
    this.documents.delete(documentId);
    this.versions.delete(documentId);

    this.emit('document-deleted', { documentId });
  }

  /**
   * Setup autosave for document
   */
  private setupAutosave(documentId: string): void {
    const timer = setInterval(async () => {
      const document = this.documents.get(documentId);
      if (document && document.status === 'GENERATING') {
        try {
          if (this.config.enableVersioning) {
            await this.createVersion(document);
          }
          logger.debug('Document autosaved', { documentId });
        } catch (error) {
          logger.error('Autosave failed', {
            documentId,
            error: (error as Error).message
          });
        }
      }
    }, this.config.autosaveIntervalMs);

    this.autosaveTimers.set(documentId, timer);
  }

  /**
   * Check if document has significant changes
   */
  private hasSignificantChanges(previous: Document, current: Document): boolean {
    // Status changes are always significant
    if (previous.status !== current.status) {
      return true;
    }

    // Progress changes > 10% are significant
    if (Math.abs(previous.generationProgress - current.generationProgress) >= 10) {
      return true;
    }

    // Section count changes are significant
    if (previous.sections.length !== current.sections.length) {
      return true;
    }

    // Content changes in sections
    for (let i = 0; i < previous.sections.length; i++) {
      const prevSection = previous.sections[i];
      const currSection = current.sections[i];
      
      if (prevSection.content !== currSection.content) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate total word count across all sections
   */
  private calculateTotalWordCount(sections: DocumentSection[]): number {
    return sections.reduce((total, section) => {
      const words = section.content
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 0);
      return total + words.length;
    }, 0);
  }

  /**
   * Generate document content string
   */
  private generateDocumentContent(document: Document): string {
    return document.sections
      .sort((a, b) => a.order - b.order)
      .map(section => `# ${section.title}\n\n${section.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Generate content checksum
   */
  private generateChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Verify document integrity
   */
  private async verifyDocumentIntegrity(document: Document): Promise<void> {
    // Check for required fields
    if (!document.id || !document.workflowExecutionId || !document.type) {
      throw new Error(`Document ${document.id} has missing required fields`);
    }

    // Check section consistency
    for (const section of document.sections) {
      if (!section.id || !section.title) {
        throw new Error(`Document ${document.id} has invalid section: ${section.id}`);
      }
    }

    // Check version consistency
    if (this.config.enableVersioning) {
      const versions = this.versions.get(document.id) || [];
      if (versions.length > 0) {
        const latestVersion = Math.max(...versions.map(v => v.version));
        if (document.currentVersion <= latestVersion) {
          logger.warn('Document version inconsistency detected', {
            documentId: document.id,
            currentVersion: document.currentVersion,
            latestStoredVersion: latestVersion
          });
        }
      }
    }
  }

  /**
   * Get state manager statistics
   */
  getStatistics(): {
    totalDocuments: number;
    documentsByStatus: Record<string, number>;
    documentsByType: Record<string, number>;
    totalVersions: number;
    averageVersionsPerDocument: number;
  } {
    const documents = Array.from(this.documents.values());
    
    const documentsByStatus = documents.reduce((acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const documentsByType = documents.reduce((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const allVersions = Array.from(this.versions.values()).flat();
    const averageVersionsPerDocument = documents.length > 0 ? allVersions.length / documents.length : 0;

    return {
      totalDocuments: documents.length,
      documentsByStatus,
      documentsByType,
      totalVersions: allVersions.length,
      averageVersionsPerDocument: Math.round(averageVersionsPerDocument * 100) / 100
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear all autosave timers
    for (const timer of this.autosaveTimers.values()) {
      clearInterval(timer);
    }
    this.autosaveTimers.clear();

    logger.info('Document state manager cleanup completed');
  }
}