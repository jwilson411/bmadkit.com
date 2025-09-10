import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  ImageRun,
  TableOfContents,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  SectionType,
  LevelFormat,
  convertInchesToTwip,
  UnderlineType,
  Media
} from 'docx';
import { ExportRequest, ExportOptions, DocumentContent, ExportResult } from './export-processor';

export interface WordGeneratorOptions extends ExportOptions {
  documentTitle?: string;
  documentSubject?: string;
  documentCreator?: string;
  documentDescription?: string;
  documentKeywords?: string[];
  useStyles?: boolean;
  includeHeaderFooter?: boolean;
  headerText?: string;
  footerText?: string;
  fontSize?: number;
  fontName?: string;
  lineSpacing?: number;
  paragraphSpacing?: number;
}

export interface WordStyleConfig {
  titleStyle: {
    size: number;
    bold: boolean;
    color: string;
    alignment: AlignmentType;
  };
  headingStyles: {
    h1: { size: number; bold: boolean; color: string };
    h2: { size: number; bold: boolean; color: string };
    h3: { size: number; bold: boolean; color: string };
    h4: { size: number; bold: boolean; color: string };
  };
  bodyStyle: {
    size: number;
    font: string;
    lineSpacing: number;
    spacing: { before: number; after: number };
  };
  tableStyle: {
    headerBackground: string;
    borderColor: string;
    borderSize: number;
  };
  branding?: {
    primaryColor: string;
    secondaryColor: string;
    logo?: Buffer;
  };
}

class WordGenerator extends EventEmitter {
  private readonly defaultStyles: WordStyleConfig = {
    titleStyle: {
      size: 32,
      bold: true,
      color: '2c3e50',
      alignment: AlignmentType.CENTER
    },
    headingStyles: {
      h1: { size: 24, bold: true, color: '2c3e50' },
      h2: { size: 20, bold: true, color: '34495e' },
      h3: { size: 16, bold: true, color: '34495e' },
      h4: { size: 14, bold: true, color: '7f8c8d' }
    },
    bodyStyle: {
      size: 11,
      font: 'Calibri',
      lineSpacing: 240, // 1.2x line spacing (240 = 1.2 * 200)
      spacing: { before: 120, after: 120 } // 6pt before/after
    },
    tableStyle: {
      headerBackground: 'E8F4FD',
      borderColor: '3498db',
      borderSize: 4
    }
  };

  constructor() {
    super();
  }

  async generateWordDocument(
    request: ExportRequest,
    content: DocumentContent,
    branding?: any
  ): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      // Generate style configuration
      const styleConfig = this.generateStyleConfig(branding);
      const options = request.options as WordGeneratorOptions;

      // Create document sections
      const sections = await this.createDocumentSections(content, options, styleConfig);

      // Create the Word document
      const doc = new Document({
        creator: options.documentCreator || 'BMAD Kit',
        title: options.documentTitle || content.title,
        description: options.documentDescription || content.metadata.description,
        subject: options.documentSubject || content.metadata.category,
        keywords: options.documentKeywords || content.metadata.tags,
        sections
      });

      // Generate the buffer
      const buffer = await Packer.toBuffer(doc);

      // Save to file
      const fileName = `${content.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.docx`;
      const filePath = path.join(process.env.EXPORT_STORAGE_PATH || './exports', fileName);
      
      await fs.writeFile(filePath, buffer);
      const stats = await fs.stat(filePath);

      // Calculate metadata
      const metadata = this.calculateWordMetadata(content, buffer);

      const result: ExportResult = {
        exportId: request.exportId,
        success: true,
        format: 'docx',
        filePath,
        fileUrl: `/api/exports/${request.exportId}/download`,
        fileName,
        fileSize: stats.size,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata
      };

      this.emit('wordDocumentGenerated', {
        exportId: request.exportId,
        userId: request.userId,
        fileName,
        fileSize: stats.size,
        processingTime: Date.now() - startTime,
        sections: content.sections.length
      });

      return result;

    } catch (error) {
      this.emit('wordGenerationError', {
        exportId: request.exportId,
        userId: request.userId,
        error: error.message,
        processingTime: Date.now() - startTime
      });

      return {
        exportId: request.exportId,
        success: false,
        format: 'docx',
        fileName: '',
        fileSize: 0,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata: {},
        error: {
          code: 'WORD_GENERATION_ERROR',
          message: error.message
        }
      };
    }
  }

  private async createDocumentSections(
    content: DocumentContent,
    options: WordGeneratorOptions,
    styleConfig: WordStyleConfig
  ): Promise<any[]> {
    const elements: any[] = [];

    // Create header and footer if requested
    const headers = options.includeHeaderFooter ? this.createHeaders(options, styleConfig) : undefined;
    const footers = options.includeHeaderFooter ? this.createFooters(options, styleConfig) : undefined;

    // Main document section
    const mainSection: any = {
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1)
          }
        }
      },
      headers,
      footers,
      children: []
    };

    // Add document title
    mainSection.children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: content.title,
            size: styleConfig.titleStyle.size,
            bold: styleConfig.titleStyle.bold,
            color: styleConfig.titleStyle.color
          })
        ],
        alignment: styleConfig.titleStyle.alignment,
        spacing: { after: 400 } // 20pt after
      })
    );

    // Add metadata if requested
    if (options.includeMetadata) {
      mainSection.children.push(...this.createMetadataSection(content, styleConfig));
    }

    // Add timestamp if requested
    if (options.includeTimestamp) {
      mainSection.children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated on ${new Date().toLocaleString()}`,
              italics: true,
              size: styleConfig.bodyStyle.size - 2,
              color: '7f8c8d'
            })
          ],
          spacing: { after: 200 }
        })
      );
    }

    // Add table of contents if requested
    if (options.includeTOC && content.sections.length > 1) {
      mainSection.children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Table of Contents',
              size: styleConfig.headingStyles.h2.size,
              bold: styleConfig.headingStyles.h2.bold,
              color: styleConfig.headingStyles.h2.color
            })
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        })
      );

      // Add TOC entries
      for (let i = 0; i < content.sections.length; i++) {
        const section = content.sections[i];
        mainSection.children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${i + 1}. ${section.title}`,
                size: styleConfig.bodyStyle.size,
                color: '34495e'
              })
            ],
            spacing: { after: 100 }
          })
        );
      }

      // Page break after TOC
      mainSection.children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Add content sections
    for (const section of content.sections.sort((a, b) => a.order - b.order)) {
      mainSection.children.push(...await this.createSection(section, styleConfig, options));
    }

    // Add branding footer if available
    if (styleConfig.branding && options.includeMetadata) {
      mainSection.children.push(...this.createBrandingFooter(styleConfig));
    }

    return [mainSection];
  }

  private createMetadataSection(content: DocumentContent, styleConfig: WordStyleConfig): any[] {
    const elements: any[] = [];

    // Create metadata table
    const metadataRows: TableRow[] = [];

    // Add metadata rows
    const metadata = [
      { label: 'Created', value: content.metadata.createdAt.toLocaleDateString() },
      { label: 'Updated', value: content.metadata.updatedAt.toLocaleDateString() },
      ...(content.metadata.author ? [{ label: 'Author', value: content.metadata.author }] : []),
      ...(content.metadata.category ? [{ label: 'Category', value: content.metadata.category }] : []),
      ...(content.metadata.tags?.length ? [{ label: 'Tags', value: content.metadata.tags.join(', ') }] : [])
    ];

    for (const item of metadata) {
      metadataRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item.label,
                      bold: true,
                      size: styleConfig.bodyStyle.size
                    })
                  ]
                })
              ],
              width: { size: 2000, type: WidthType.DXA },
              shading: {
                type: ShadingType.SOLID,
                color: 'F8F9FA'
              }
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item.value,
                      size: styleConfig.bodyStyle.size
                    })
                  ]
                })
              ],
              width: { size: 6000, type: WidthType.DXA }
            })
          ]
        })
      );
    }

    const metadataTable = new Table({
      rows: metadataRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: styleConfig.tableStyle.borderColor },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: styleConfig.tableStyle.borderColor },
        left: { style: BorderStyle.SINGLE, size: 1, color: styleConfig.tableStyle.borderColor },
        right: { style: BorderStyle.SINGLE, size: 1, color: styleConfig.tableStyle.borderColor },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E9ECEF' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E9ECEF' }
      }
    });

    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Document Information',
            size: styleConfig.headingStyles.h3.size,
            bold: styleConfig.headingStyles.h3.bold,
            color: styleConfig.headingStyles.h3.color
          })
        ],
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 300, after: 200 }
      }),
      metadataTable,
      new Paragraph({ children: [], spacing: { after: 400 } })
    );

    return elements;
  }

  private async createSection(
    section: any,
    styleConfig: WordStyleConfig,
    options: WordGeneratorOptions
  ): Promise<any[]> {
    const elements: any[] = [];

    // Section heading
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: section.title,
            size: styleConfig.headingStyles.h2.size,
            bold: styleConfig.headingStyles.h2.bold,
            color: styleConfig.headingStyles.h2.color
          })
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      })
    );

    // Section content based on type
    switch (section.type) {
      case 'text':
        elements.push(...this.createTextContent(section.content, styleConfig));
        break;
      case 'code':
        elements.push(...this.createCodeContent(section.content, styleConfig));
        break;
      case 'table':
        elements.push(...await this.createTableContent(section.content, styleConfig));
        break;
      case 'image':
        elements.push(...await this.createImageContent(section.content, section.title, styleConfig));
        break;
      default:
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.content || 'Content not available',
                size: styleConfig.bodyStyle.size
              })
            ],
            spacing: styleConfig.bodyStyle.spacing
          })
        );
    }

    return elements;
  }

  private createTextContent(content: string, styleConfig: WordStyleConfig): any[] {
    const elements: any[] = [];
    
    // Split content into paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);

    for (const paragraph of paragraphs) {
      // Handle different text formatting
      const runs = this.parseTextRuns(paragraph, styleConfig);
      
      elements.push(
        new Paragraph({
          children: runs,
          spacing: styleConfig.bodyStyle.spacing
        })
      );
    }

    return elements;
  }

  private parseTextRuns(text: string, styleConfig: WordStyleConfig): TextRun[] {
    // Simple text parsing - in production, would handle markdown-like formatting
    const runs: TextRun[] = [];
    
    // For now, create a single text run
    runs.push(
      new TextRun({
        text: text,
        size: styleConfig.bodyStyle.size,
        font: styleConfig.bodyStyle.font
      })
    );

    // TODO: Parse bold, italic, links, etc.
    // Example: **bold**, *italic*, [links](url)

    return runs;
  }

  private createCodeContent(content: string, styleConfig: WordStyleConfig): any[] {
    const elements: any[] = [];

    // Create code block with monospace font and background
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: content,
            size: styleConfig.bodyStyle.size - 2,
            font: 'Consolas' // Monospace font
          })
        ],
        border: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'E9ECEF' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E9ECEF' },
          left: { style: BorderStyle.SINGLE, size: 4, color: '3498db' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'E9ECEF' }
        },
        shading: {
          type: ShadingType.SOLID,
          color: 'F8F9FA'
        },
        spacing: { before: 200, after: 200 },
        indent: { left: 200, right: 200 }
      })
    );

    return elements;
  }

  private async createTableContent(tableData: any, styleConfig: WordStyleConfig): Promise<any[]> {
    const elements: any[] = [];

    try {
      // Mock table creation - would parse actual table data
      const headers = ['Column 1', 'Column 2', 'Column 3'];
      const rows = [
        ['Data 1', 'Data 2', 'Data 3'],
        ['Data 4', 'Data 5', 'Data 6']
      ];

      const tableRows: TableRow[] = [];

      // Create header row
      const headerCells = headers.map(header => 
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: header,
                  bold: true,
                  size: styleConfig.bodyStyle.size,
                  color: '2c3e50'
                })
              ],
              alignment: AlignmentType.CENTER
            })
          ],
          shading: {
            type: ShadingType.SOLID,
            color: styleConfig.tableStyle.headerBackground
          }
        })
      );

      tableRows.push(new TableRow({ children: headerCells }));

      // Create data rows
      for (const row of rows) {
        const dataCells = row.map(cell =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cell,
                    size: styleConfig.bodyStyle.size
                  })
                ]
              })
            ]
          })
        );
        tableRows.push(new TableRow({ children: dataCells }));
      }

      const table = new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: styleConfig.tableStyle.borderSize, color: styleConfig.tableStyle.borderColor },
          bottom: { style: BorderStyle.SINGLE, size: styleConfig.tableStyle.borderSize, color: styleConfig.tableStyle.borderColor },
          left: { style: BorderStyle.SINGLE, size: styleConfig.tableStyle.borderSize, color: styleConfig.tableStyle.borderColor },
          right: { style: BorderStyle.SINGLE, size: styleConfig.tableStyle.borderSize, color: styleConfig.tableStyle.borderColor },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'BDC3C7' },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'BDC3C7' }
        }
      });

      elements.push(table);
      elements.push(new Paragraph({ children: [], spacing: { after: 200 } }));

    } catch (error) {
      console.warn('Error creating table content:', error);
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '[Table content could not be rendered]',
              italics: true,
              size: styleConfig.bodyStyle.size,
              color: '7f8c8d'
            })
          ]
        })
      );
    }

    return elements;
  }

  private async createImageContent(imageUrl: string, title: string, styleConfig: WordStyleConfig): Promise<any[]> {
    const elements: any[] = [];

    try {
      // In production, would fetch and embed actual images
      // For now, create a placeholder
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[Image: ${title}]`,
              italics: true,
              size: styleConfig.bodyStyle.size,
              color: '7f8c8d'
            })
          ],
          alignment: AlignmentType.CENTER,
          border: {
            top: { style: BorderStyle.DASHED, size: 1, color: 'BDC3C7' },
            bottom: { style: BorderStyle.DASHED, size: 1, color: 'BDC3C7' },
            left: { style: BorderStyle.DASHED, size: 1, color: 'BDC3C7' },
            right: { style: BorderStyle.DASHED, size: 1, color: 'BDC3C7' }
          },
          spacing: { before: 200, after: 200 }
        })
      );

      // Add caption
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: title,
              size: styleConfig.bodyStyle.size - 2,
              italics: true,
              color: '7f8c8d'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        })
      );

    } catch (error) {
      console.warn('Error creating image content:', error);
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[Image could not be loaded: ${title}]`,
              italics: true,
              size: styleConfig.bodyStyle.size,
              color: '7f8c8d'
            })
          ]
        })
      );
    }

    return elements;
  }

  private createBrandingFooter(styleConfig: WordStyleConfig): any[] {
    const elements: any[] = [];

    if (styleConfig.branding) {
      elements.push(
        new Paragraph({
          children: [new PageBreak()]
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '— End of Document —',
              italics: true,
              size: styleConfig.bodyStyle.size,
              color: '7f8c8d'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 }
        })
      );
    }

    return elements;
  }

  private createHeaders(options: WordGeneratorOptions, styleConfig: WordStyleConfig): any {
    if (!options.headerText && !styleConfig.branding) return undefined;

    return {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: options.headerText || '',
                size: styleConfig.bodyStyle.size - 2,
                color: '7f8c8d'
              })
            ],
            alignment: AlignmentType.RIGHT
          })
        ]
      })
    };
  }

  private createFooters(options: WordGeneratorOptions, styleConfig: WordStyleConfig): any {
    const footerChildren = [];

    // Add custom footer text if provided
    if (options.footerText) {
      footerChildren.push(
        new TextRun({
          text: options.footerText,
          size: styleConfig.bodyStyle.size - 2,
          color: '7f8c8d'
        })
      );
    }

    // Add page numbers if requested
    if (options.includePageNumbers) {
      if (footerChildren.length > 0) {
        footerChildren.push(new TextRun({ text: ' | ' }));
      }
      footerChildren.push(
        new TextRun({
          text: 'Page ',
          size: styleConfig.bodyStyle.size - 2,
          color: '7f8c8d'
        }),
        new TextRun({
          children: [PageNumber.CURRENT],
          size: styleConfig.bodyStyle.size - 2,
          color: '7f8c8d'
        }),
        new TextRun({
          text: ' of ',
          size: styleConfig.bodyStyle.size - 2,
          color: '7f8c8d'
        }),
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          size: styleConfig.bodyStyle.size - 2,
          color: '7f8c8d'
        })
      );
    }

    return {
      default: new Footer({
        children: [
          new Paragraph({
            children: footerChildren,
            alignment: AlignmentType.CENTER
          })
        ]
      })
    };
  }

  private generateStyleConfig(branding?: any): WordStyleConfig {
    const config = { ...this.defaultStyles };

    if (branding?.colorScheme) {
      config.titleStyle.color = branding.colorScheme.primary?.replace('#', '') || config.titleStyle.color;
      config.headingStyles.h1.color = branding.colorScheme.primary?.replace('#', '') || config.headingStyles.h1.color;
      config.headingStyles.h2.color = branding.colorScheme.secondary?.replace('#', '') || config.headingStyles.h2.color;
      config.tableStyle.borderColor = branding.colorScheme.accent?.replace('#', '') || config.tableStyle.borderColor;
    }

    if (branding?.typography?.fontFamily?.primary) {
      config.bodyStyle.font = branding.typography.fontFamily.primary;
    }

    if (branding) {
      config.branding = {
        primaryColor: branding.colorScheme?.primary || '2c3e50',
        secondaryColor: branding.colorScheme?.secondary || '34495e',
        logo: branding.logo?.primary ? Buffer.from('') : undefined // Would load actual logo
      };
    }

    return config;
  }

  private calculateWordMetadata(content: DocumentContent, buffer: Buffer): any {
    // Calculate document metadata
    const totalText = content.sections.reduce((acc, section) => acc + (section.content || ''), '');
    const wordCount = totalText.split(/\s+/).filter(word => word.length > 0).length;
    const characterCount = totalText.length;

    // Estimate pages based on word count (roughly 250 words per page)
    const estimatedPages = Math.max(1, Math.ceil(wordCount / 250));

    return {
      pages: estimatedPages,
      wordCount,
      characterCount,
      sections: content.sections.length
    };
  }
}

export const wordGenerator = new WordGenerator();