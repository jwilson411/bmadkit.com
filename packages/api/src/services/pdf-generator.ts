import { EventEmitter } from 'events';
import puppeteer, { Browser, Page, PDFOptions } from 'puppeteer';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { ExportRequest, ExportOptions, DocumentContent, ExportResult } from './export-processor';
import { customBrandingManager } from './custom-branding-manager';

export interface PDFGeneratorOptions extends ExportOptions {
  headerTemplate?: string;
  footerTemplate?: string;
  displayHeaderFooter?: boolean;
  printBackground?: boolean;
  landscape?: boolean;
  format?: 'A3' | 'A4' | 'A5' | 'Legal' | 'Letter' | 'Tabloid';
  width?: string;
  height?: string;
  preferCSSPageSize?: boolean;
  omitBackground?: boolean;
  timeout?: number;
}

export interface PDFStyleConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  fontSize: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    body: string;
    small: string;
  };
  spacing: {
    sectionMargin: string;
    paragraphMargin: string;
    listMargin: string;
  };
  branding?: {
    logo?: string;
    companyName?: string;
    colors?: any;
  };
}

class PDFGenerator extends EventEmitter {
  private browser: Browser | null = null;
  private isInitialized: boolean = false;
  private readonly templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();
  private readonly defaultStyles: PDFStyleConfig = {
    primaryColor: '#2c3e50',
    secondaryColor: '#34495e',
    accentColor: '#3498db',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    fontSize: {
      h1: '2.5rem',
      h2: '2rem',
      h3: '1.5rem',
      h4: '1.25rem',
      body: '1rem',
      small: '0.875rem'
    },
    spacing: {
      sectionMargin: '2rem 0',
      paragraphMargin: '1rem 0',
      listMargin: '0.5rem 0'
    }
  };

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });

      this.isInitialized = true;
      this.emit('initialized');

    } catch (error) {
      this.emit('initializationError', error);
      throw new Error(`Failed to initialize PDF generator: ${error.message}`);
    }
  }

  async generatePDF(
    request: ExportRequest,
    content: DocumentContent,
    branding?: any
  ): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      await this.initialize();

      if (!this.browser) {
        throw new Error('PDF generator not initialized');
      }

      // Create a new page
      const page = await this.browser.newPage();
      
      try {
        // Generate HTML content for PDF
        const htmlContent = await this.generateHTMLForPDF(content, request.options, branding);

        // Set viewport for consistent rendering
        await page.setViewport({
          width: 1200,
          height: 1600,
          deviceScaleFactor: 1
        });

        // Set content
        await page.setContent(htmlContent, {
          waitUntil: ['networkidle0', 'load'],
          timeout: 30000
        });

        // Wait for any dynamic content to load
        await page.waitForTimeout(1000);

        // Generate PDF options
        const pdfOptions = this.generatePDFOptions(request.options as PDFGeneratorOptions);

        // Generate the PDF
        const pdfBuffer = await page.pdf(pdfOptions);

        // Save PDF to file
        const fileName = `${content.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.pdf`;
        const filePath = path.join(process.env.EXPORT_STORAGE_PATH || './exports', fileName);
        
        await fs.writeFile(filePath, pdfBuffer);
        const stats = await fs.stat(filePath);

        // Calculate metadata
        const metadata = await this.calculatePDFMetadata(htmlContent, pdfBuffer);

        const result: ExportResult = {
          exportId: request.exportId,
          success: true,
          format: 'pdf',
          filePath,
          fileUrl: `/api/exports/${request.exportId}/download`,
          fileName,
          fileSize: stats.size,
          generatedAt: new Date(),
          processingTime: Date.now() - startTime,
          metadata
        };

        this.emit('pdfGenerated', {
          exportId: request.exportId,
          userId: request.userId,
          fileName,
          fileSize: stats.size,
          processingTime: Date.now() - startTime,
          pages: metadata.pages
        });

        return result;

      } finally {
        await page.close();
      }

    } catch (error) {
      this.emit('pdfGenerationError', {
        exportId: request.exportId,
        userId: request.userId,
        error: error.message,
        processingTime: Date.now() - startTime
      });

      return {
        exportId: request.exportId,
        success: false,
        format: 'pdf',
        fileName: '',
        fileSize: 0,
        generatedAt: new Date(),
        processingTime: Date.now() - startTime,
        metadata: {},
        error: {
          code: 'PDF_GENERATION_ERROR',
          message: error.message
        }
      };
    }
  }

  private async generateHTMLForPDF(
    content: DocumentContent,
    options: ExportOptions,
    branding?: any
  ): Promise<string> {
    const styleConfig = this.generateStyleConfig(branding);
    const css = this.generatePDFCSS(styleConfig, options);

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${content.title}</title>
    <style>${css}</style>
</head>
<body>
    <div class="document-container">
`;

    // Add cover page if enabled
    if (options.quality === 'high') {
      html += await this.generateCoverPage(content, styleConfig, branding);
    }

    // Add document header
    if (branding?.logo?.primary || branding?.companyInfo?.name) {
      html += '<div class="document-header">';
      if (branding.logo?.primary) {
        html += `<img src="${branding.logo.primary}" alt="Logo" class="header-logo">`;
      }
      if (branding.companyInfo?.name) {
        html += `<h1 class="company-name">${branding.companyInfo.name}</h1>`;
      }
      html += '</div>';
    }

    // Add document title
    html += `<h1 class="document-title">${content.title}</h1>`;

    // Add metadata if requested
    if (options.includeMetadata) {
      html += '<div class="document-metadata">';
      html += `<div class="metadata-item"><strong>Created:</strong> ${content.metadata.createdAt.toLocaleDateString()}</div>`;
      html += `<div class="metadata-item"><strong>Updated:</strong> ${content.metadata.updatedAt.toLocaleDateString()}</div>`;
      if (content.metadata.author) {
        html += `<div class="metadata-item"><strong>Author:</strong> ${content.metadata.author}</div>`;
      }
      if (content.metadata.tags && content.metadata.tags.length > 0) {
        html += `<div class="metadata-item"><strong>Tags:</strong> ${content.metadata.tags.join(', ')}</div>`;
      }
      html += '</div>';
    }

    // Add table of contents if requested
    if (options.includeTOC && content.sections.length > 1) {
      html += '<div class="table-of-contents page-break-before">';
      html += '<h2 class="toc-title">Table of Contents</h2>';
      html += '<div class="toc-entries">';
      
      for (const section of content.sections.sort((a, b) => a.order - b.order)) {
        const anchor = this.createAnchor(section.title);
        html += `<div class="toc-entry">
          <a href="#${anchor}" class="toc-link">
            <span class="toc-text">${section.title}</span>
            <span class="toc-dots"></span>
            <span class="toc-page">{{pageNumber}}</span>
          </a>
        </div>`;
      }
      html += '</div></div>';
    }

    // Add main content sections
    html += '<div class="document-content">';
    for (const section of content.sections.sort((a, b) => a.order - b.order)) {
      html += await this.generateSectionHTML(section, styleConfig, options);
    }
    html += '</div>';

    // Add document footer
    if (branding?.companyInfo?.name || options.includeTimestamp) {
      html += '<div class="document-footer">';
      if (branding?.companyInfo?.name) {
        html += `<div class="footer-company">${branding.companyInfo.name}</div>`;
      }
      if (options.includeTimestamp) {
        html += `<div class="footer-timestamp">Generated on ${new Date().toLocaleDateString()}</div>`;
      }
      html += '</div>';
    }

    html += `
    </div>
</body>
</html>`;

    return html;
  }

  private generatePDFCSS(styleConfig: PDFStyleConfig, options: ExportOptions): string {
    const margins = options.margins || {
      top: '1in',
      right: '1in',
      bottom: '1in',
      left: '1in'
    };

    return `
/* Reset and base styles */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html, body {
    font-family: ${styleConfig.fontFamily};
    font-size: ${styleConfig.fontSize.body};
    line-height: 1.6;
    color: ${styleConfig.primaryColor};
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

/* Page layout */
@page {
    size: ${options.pageSize || 'A4'} ${options.orientation || 'portrait'};
    margin: ${margins.top} ${margins.right} ${margins.bottom} ${margins.left};
    
    ${options.includePageNumbers ? `
    @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 10pt;
        color: #666;
    }
    ` : ''}
}

/* Document structure */
.document-container {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
}

.document-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid ${styleConfig.accentColor};
}

.header-logo {
    max-height: 60px;
    width: auto;
}

.company-name {
    font-size: 1.5rem;
    font-weight: 600;
    color: ${styleConfig.primaryColor};
    margin: 0;
}

.document-title {
    font-size: ${styleConfig.fontSize.h1};
    font-weight: 700;
    color: ${styleConfig.primaryColor};
    margin: ${styleConfig.spacing.sectionMargin};
    text-align: center;
    page-break-after: avoid;
}

/* Metadata section */
.document-metadata {
    background-color: #f8f9fa;
    padding: 1.5rem;
    border-radius: 8px;
    border-left: 4px solid ${styleConfig.accentColor};
    margin: ${styleConfig.spacing.sectionMargin};
    page-break-inside: avoid;
}

.metadata-item {
    margin: 0.5rem 0;
    font-size: 0.9rem;
}

/* Table of Contents */
.table-of-contents {
    margin: ${styleConfig.spacing.sectionMargin};
    page-break-inside: avoid;
}

.toc-title {
    font-size: ${styleConfig.fontSize.h2};
    color: ${styleConfig.primaryColor};
    margin-bottom: 1.5rem;
    border-bottom: 2px solid ${styleConfig.accentColor};
    padding-bottom: 0.5rem;
}

.toc-entries {
    margin-left: 1rem;
}

.toc-entry {
    margin: 0.5rem 0;
    page-break-inside: avoid;
}

.toc-link {
    display: flex;
    align-items: baseline;
    text-decoration: none;
    color: ${styleConfig.primaryColor};
    font-size: 0.95rem;
}

.toc-link:hover {
    color: ${styleConfig.accentColor};
}

.toc-text {
    flex-shrink: 0;
}

.toc-dots {
    flex-grow: 1;
    height: 1px;
    background: repeating-linear-gradient(
        to right,
        transparent,
        transparent 2px,
        ${styleConfig.secondaryColor} 2px,
        ${styleConfig.secondaryColor} 4px
    );
    margin: 0 0.5rem;
    opacity: 0.5;
}

.toc-page {
    flex-shrink: 0;
    font-weight: 600;
}

/* Content sections */
.document-content {
    margin: ${styleConfig.spacing.sectionMargin};
}

.content-section {
    margin: ${styleConfig.spacing.sectionMargin};
    page-break-inside: avoid;
}

.section-title {
    font-size: ${styleConfig.fontSize.h2};
    font-weight: 600;
    color: ${styleConfig.primaryColor};
    margin: 2rem 0 1rem 0;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid ${styleConfig.accentColor};
    page-break-after: avoid;
}

.section-content {
    margin: ${styleConfig.spacing.paragraphMargin};
    line-height: 1.7;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
    font-weight: 600;
    color: ${styleConfig.primaryColor};
    page-break-after: avoid;
}

h1 { font-size: ${styleConfig.fontSize.h1}; margin: 2rem 0 1.5rem 0; }
h2 { font-size: ${styleConfig.fontSize.h2}; margin: 1.8rem 0 1rem 0; }
h3 { font-size: ${styleConfig.fontSize.h3}; margin: 1.5rem 0 0.8rem 0; }
h4 { font-size: ${styleConfig.fontSize.h4}; margin: 1.2rem 0 0.6rem 0; }

p {
    margin: ${styleConfig.spacing.paragraphMargin};
    line-height: 1.7;
    text-align: justify;
    hyphens: auto;
}

/* Lists */
ul, ol {
    margin: ${styleConfig.spacing.listMargin};
    padding-left: 1.5rem;
}

li {
    margin: 0.3rem 0;
    line-height: 1.6;
}

/* Code blocks */
code {
    font-family: 'Monaco', 'Consolas', 'Liberation Mono', monospace;
    font-size: 0.85em;
    background-color: #f8f9fa;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    border: 1px solid #e9ecef;
}

pre {
    background-color: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 1rem;
    overflow-x: auto;
    margin: 1rem 0;
    page-break-inside: avoid;
}

pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.9em;
    line-height: 1.4;
}

/* Tables */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    page-break-inside: avoid;
    font-size: 0.9rem;
}

th, td {
    border: 1px solid #ddd;
    padding: 0.75rem;
    text-align: left;
    vertical-align: top;
}

th {
    background-color: ${styleConfig.accentColor}20;
    font-weight: 600;
    color: ${styleConfig.primaryColor};
    page-break-after: avoid;
}

tr:nth-child(even) {
    background-color: #f8f9fa;
}

/* Images */
img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 1rem auto;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Blockquotes */
blockquote {
    border-left: 4px solid ${styleConfig.accentColor};
    padding-left: 1.5rem;
    margin: 1.5rem 0;
    font-style: italic;
    color: ${styleConfig.secondaryColor};
    background-color: #f8f9fa;
    padding: 1rem 1.5rem;
    border-radius: 0 4px 4px 0;
}

/* Document footer */
.document-footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
    font-size: ${styleConfig.fontSize.small};
    color: ${styleConfig.secondaryColor};
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Page breaks */
.page-break-before {
    page-break-before: always;
}

.page-break-after {
    page-break-after: always;
}

.page-break-avoid {
    page-break-inside: avoid;
}

/* Cover page styles */
.cover-page {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    page-break-after: always;
    background: linear-gradient(135deg, ${styleConfig.accentColor}10 0%, ${styleConfig.primaryColor}10 100%);
}

.cover-title {
    font-size: 3rem;
    font-weight: 700;
    color: ${styleConfig.primaryColor};
    margin: 2rem 0;
    line-height: 1.2;
}

.cover-subtitle {
    font-size: 1.25rem;
    color: ${styleConfig.secondaryColor};
    margin: 1rem 0 3rem 0;
}

.cover-logo {
    max-width: 300px;
    max-height: 150px;
    margin-bottom: 2rem;
}

.cover-metadata {
    margin-top: 3rem;
    font-size: 1rem;
    color: ${styleConfig.secondaryColor};
}

.cover-date {
    margin-top: 1rem;
    font-size: 0.9rem;
    color: ${styleConfig.secondaryColor};
}

/* Watermark */
${options.includeWatermark ? `
.document-container::before {
    content: "${styleConfig.branding?.companyName || 'CONFIDENTIAL'}";
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-45deg);
    font-size: 4rem;
    font-weight: 100;
    color: rgba(0, 0, 0, 0.05);
    z-index: -1;
    pointer-events: none;
}
` : ''}

/* Print optimizations */
@media print {
    body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .document-container {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    
    a {
        color: inherit !important;
        text-decoration: none !important;
    }
}

/* Custom CSS from user */
${options.customCSS || ''}
`;
  }

  private generateStyleConfig(branding?: any): PDFStyleConfig {
    const config = { ...this.defaultStyles };

    if (branding?.colorScheme) {
      config.primaryColor = branding.colorScheme.primary || config.primaryColor;
      config.secondaryColor = branding.colorScheme.secondary || config.secondaryColor;
      config.accentColor = branding.colorScheme.accent || config.accentColor;
    }

    if (branding?.typography?.fontFamily?.primary) {
      config.fontFamily = branding.typography.fontFamily.primary;
    }

    if (branding) {
      config.branding = {
        logo: branding.logo?.primary,
        companyName: branding.companyInfo?.name,
        colors: branding.colorScheme
      };
    }

    return config;
  }

  private async generateCoverPage(
    content: DocumentContent,
    styleConfig: PDFStyleConfig,
    branding?: any
  ): Promise<string> {
    let coverPage = '<div class="cover-page">';

    // Add logo if available
    if (branding?.logo?.primary) {
      coverPage += `<img src="${branding.logo.primary}" alt="Logo" class="cover-logo">`;
    }

    // Add title
    coverPage += `<h1 class="cover-title">${content.title}</h1>`;

    // Add description if available
    if (content.metadata.description || branding?.companyInfo?.tagline) {
      const subtitle = content.metadata.description || branding.companyInfo.tagline;
      coverPage += `<p class="cover-subtitle">${subtitle}</p>`;
    }

    // Add metadata
    coverPage += '<div class="cover-metadata">';
    if (content.metadata.author) {
      coverPage += `<div><strong>Author:</strong> ${content.metadata.author}</div>`;
    }
    if (branding?.companyInfo?.name) {
      coverPage += `<div><strong>Organization:</strong> ${branding.companyInfo.name}</div>`;
    }
    coverPage += '</div>';

    // Add generation date
    coverPage += `<div class="cover-date">Generated on ${new Date().toLocaleDateString()}</div>`;

    coverPage += '</div>';
    return coverPage;
  }

  private async generateSectionHTML(
    section: any,
    styleConfig: PDFStyleConfig,
    options: ExportOptions
  ): Promise<string> {
    const anchor = this.createAnchor(section.title);
    let html = `<div class="content-section" id="${anchor}">`;
    html += `<h2 class="section-title">${section.title}</h2>`;
    html += '<div class="section-content">';

    switch (section.type) {
      case 'text':
        html += `<div class="text-content">${this.formatTextContent(section.content)}</div>`;
        break;
      case 'code':
        html += `<pre><code>${this.escapeHtml(section.content)}</code></pre>`;
        break;
      case 'table':
        html += this.generateTableHTML(section.content);
        break;
      case 'image':
        html += `<figure>
          <img src="${section.content}" alt="${section.title}" />
          <figcaption>${section.title}</figcaption>
        </figure>`;
        break;
      case 'chart':
        // For charts, we might need to convert to image or embed SVG
        html += `<div class="chart-container">${section.content}</div>`;
        break;
      default:
        html += `<div class="generic-content">${section.content}</div>`;
    }

    html += '</div></div>';
    return html;
  }

  private formatTextContent(content: string): string {
    // Convert line breaks to paragraphs
    return content
      .split('\n\n')
      .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  private generateTableHTML(tableData: any): string {
    // Mock table generation - would parse actual table data
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Column 1</th>
            <th>Column 2</th>
            <th>Column 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Data 1</td>
            <td>Data 2</td>
            <td>Data 3</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  private generatePDFOptions(options: PDFGeneratorOptions): PDFOptions {
    const margins = options.margins || {
      top: '1in',
      right: '1in',
      bottom: '1in',
      left: '1in'
    };

    return {
      format: options.format || 'A4',
      landscape: options.landscape || false,
      printBackground: options.printBackground !== false,
      displayHeaderFooter: options.displayHeaderFooter || false,
      headerTemplate: options.headerTemplate || '',
      footerTemplate: options.footerTemplate || '',
      margin: {
        top: margins.top,
        right: margins.right,
        bottom: margins.bottom,
        left: margins.left
      },
      preferCSSPageSize: options.preferCSSPageSize || true,
      omitBackground: options.omitBackground || false,
      timeout: options.timeout || 30000
    };
  }

  private async calculatePDFMetadata(htmlContent: string, pdfBuffer: Buffer): Promise<any> {
    // Calculate document metadata
    const wordCount = this.countWords(htmlContent);
    const characterCount = htmlContent.length;
    
    // Estimate page count based on content length and format
    // This is a rough estimation - actual page count would need PDF parsing
    const estimatedPages = Math.max(1, Math.ceil(wordCount / 500));

    return {
      pages: estimatedPages,
      wordCount,
      characterCount,
      sections: (htmlContent.match(/<h2 class="section-title">/g) || []).length
    };
  }

  private createAnchor(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  private countWords(text: string): number {
    // Remove HTML tags for word counting
    const plainText = text.replace(/<[^>]*>/g, ' ');
    return plainText.split(/\s+/).filter(word => word.length > 0).length;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isInitialized = false;
    }
  }
}

export const pdfGenerator = new PDFGenerator();