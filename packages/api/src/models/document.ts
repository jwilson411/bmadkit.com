import { z } from 'zod';

export const DocumentTypeEnum = z.enum([
  'PROJECT_BRIEF',
  'PRD',
  'TECHNICAL_ARCHITECTURE', 
  'USER_STORIES',
  'EXECUTIVE_SUMMARY',
  'IMPLEMENTATION_PLAN'
]);

export const DocumentStatusEnum = z.enum([
  'DRAFT',
  'GENERATING',
  'COMPLETED',
  'ERROR',
  'ARCHIVED'
]);

export const DocumentSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  order: z.number(),
  sourceAgentPhase: z.string().optional(),
  lastUpdated: z.date(),
  completionPercentage: z.number().min(0).max(100),
  metadata: z.record(z.any()).optional()
});

export const DocumentVersionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  version: z.number(),
  content: z.string(),
  sections: z.array(DocumentSectionSchema),
  createdAt: z.date(),
  createdBy: z.string().optional(),
  changeLog: z.string().optional(),
  size: z.number(), // Content size in bytes
  checksum: z.string() // Content hash for integrity
});

export const DocumentSchema = z.object({
  id: z.string(),
  workflowExecutionId: z.string(),
  type: DocumentTypeEnum,
  title: z.string(),
  status: DocumentStatusEnum,
  currentVersion: z.number(),
  sections: z.array(DocumentSectionSchema),
  templateId: z.string(),
  generationProgress: z.number().min(0).max(100),
  metadata: z.object({
    projectName: z.string().optional(),
    stakeholders: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lastAgentPhase: z.string().optional(),
    estimatedCompletionTime: z.date().optional(),
    wordCount: z.number().optional(),
    readingTime: z.number().optional() // in minutes
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    timestamp: z.date(),
    section: z.string().optional(),
    recoverable: z.boolean()
  })).optional()
});

export const DocumentTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: DocumentTypeEnum,
  description: z.string(),
  template: z.string(), // Handlebars template content
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    required: z.boolean(),
    order: z.number(),
    dependsOnAgentPhase: z.array(z.string()).optional(),
    template: z.string() // Section-specific template
  })),
  variables: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    description: z.string(),
    defaultValue: z.any().optional()
  })),
  version: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const DocumentGenerationRequestSchema = z.object({
  workflowExecutionId: z.string(),
  documentType: DocumentTypeEnum,
  templateId: z.string().optional(),
  title: z.string().optional(),
  sections: z.array(z.string()).optional(), // Specific sections to generate
  realTimeUpdates: z.boolean().default(true),
  preview: z.boolean().default(false)
});

export const DocumentUpdateEventSchema = z.object({
  documentId: z.string(),
  type: z.enum(['SECTION_UPDATED', 'STATUS_CHANGED', 'ERROR_OCCURRED', 'GENERATION_COMPLETE']),
  sectionId: z.string().optional(),
  content: z.string().optional(),
  progress: z.number().optional(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional(),
  timestamp: z.date()
});

export const DocumentPreviewSchema = z.object({
  documentId: z.string(),
  content: z.string(), // Rendered markdown
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    anchor: z.string() // For navigation
  })),
  metadata: z.object({
    wordCount: z.number(),
    readingTime: z.number(),
    lastUpdated: z.date(),
    completionPercentage: z.number()
  })
});

export const DocumentDiffSchema = z.object({
  documentId: z.string(),
  fromVersion: z.number(),
  toVersion: z.number(),
  changes: z.array(z.object({
    type: z.enum(['ADDED', 'REMOVED', 'MODIFIED']),
    section: z.string(),
    content: z.string(),
    lineNumber: z.number().optional()
  })),
  summary: z.object({
    sectionsAdded: z.number(),
    sectionsModified: z.number(),
    sectionsRemoved: z.number(),
    wordsAdded: z.number(),
    wordsRemoved: z.number()
  })
});

// Type exports
export type DocumentType = z.infer<typeof DocumentTypeEnum>;
export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;
export type DocumentGenerationRequest = z.infer<typeof DocumentGenerationRequestSchema>;
export type DocumentUpdateEvent = z.infer<typeof DocumentUpdateEventSchema>;
export type DocumentPreview = z.infer<typeof DocumentPreviewSchema>;
export type DocumentDiff = z.infer<typeof DocumentDiffSchema>;

// Utility functions
export function generateDocumentId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function generateVersionId(): string {
  return `ver_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function calculateReadingTime(wordCount: number): number {
  // Average reading speed: 200 words per minute
  return Math.ceil(wordCount / 200);
}

export function calculateDocumentProgress(sections: DocumentSection[]): number {
  if (sections.length === 0) return 0;
  
  const totalProgress = sections.reduce((sum, section) => sum + section.completionPercentage, 0);
  return Math.round(totalProgress / sections.length);
}

export function createDocumentSection(
  title: string,
  content: string = '',
  order: number,
  sourceAgentPhase?: string
): DocumentSection {
  return {
    id: `section_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    title,
    content,
    order,
    sourceAgentPhase,
    lastUpdated: new Date(),
    completionPercentage: content ? 100 : 0,
    metadata: {}
  };
}

// Document template mapping for BMAD workflow
export const BMAD_DOCUMENT_TEMPLATES = {
  PROJECT_BRIEF: 'project-brief',
  PRD: 'prd', 
  TECHNICAL_ARCHITECTURE: 'architecture',
  USER_STORIES: 'user-stories'
} as const;

// Agent phase to document section mapping
export const AGENT_PHASE_DOCUMENT_MAPPING = {
  ANALYST: ['business-overview', 'market-analysis', 'stakeholder-analysis', 'success-metrics'],
  PM: ['project-scope', 'feature-prioritization', 'user-stories', 'acceptance-criteria'],
  UX_EXPERT: ['user-experience', 'user-journeys', 'design-requirements', 'usability-guidelines'],
  ARCHITECT: ['technical-architecture', 'technology-stack', 'system-design', 'implementation-plan']
} as const;