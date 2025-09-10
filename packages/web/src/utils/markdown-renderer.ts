import { marked, Renderer } from 'marked';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Custom renderer for enhanced markdown features
class BMADRenderer extends Renderer {
  heading(text: string, level: number): string {
    const anchor = text.toLowerCase().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
    const sizeClass = {
      1: 'text-3xl font-bold text-gray-900 mb-6 mt-8 pb-2 border-b border-gray-200',
      2: 'text-2xl font-semibold text-gray-900 mb-4 mt-6',
      3: 'text-xl font-medium text-gray-900 mb-3 mt-5',
      4: 'text-lg font-medium text-gray-800 mb-2 mt-4',
      5: 'text-base font-medium text-gray-800 mb-2 mt-3',
      6: 'text-sm font-medium text-gray-700 mb-2 mt-2'
    }[level] || 'text-base font-medium text-gray-800 mb-2';

    return `<h${level} id="${anchor}" class="${sizeClass} scroll-mt-4 group">
      <a href="#${anchor}" class="text-current hover:text-blue-600 transition-colors no-underline">
        ${text}
      </a>
      <span class="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400 text-sm font-normal">#</span>
    </h${level}>`;
  }

  paragraph(text: string): string {
    return `<p class="mb-4 text-gray-700 leading-relaxed">${text}</p>`;
  }

  list(body: string, ordered?: boolean): string {
    const tag = ordered ? 'ol' : 'ul';
    const className = ordered 
      ? 'list-decimal list-inside mb-4 space-y-1 text-gray-700 pl-4'
      : 'list-disc list-inside mb-4 space-y-1 text-gray-700 pl-4';
    
    return `<${tag} class="${className}">${body}</${tag}>`;
  }

  listitem(text: string): string {
    return `<li class="leading-relaxed">${text}</li>`;
  }

  blockquote(quote: string): string {
    return `<blockquote class="border-l-4 border-blue-200 pl-4 py-2 mb-4 bg-blue-50 text-gray-700 italic">
      ${quote}
    </blockquote>`;
  }

  table(header: string, body: string): string {
    return `<div class="overflow-x-auto mb-6">
      <table class="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg">
        <thead class="bg-gray-50">${header}</thead>
        <tbody class="bg-white divide-y divide-gray-200">${body}</tbody>
      </table>
    </div>`;
  }

  tablerow(content: string): string {
    return `<tr class="hover:bg-gray-50 transition-colors">${content}</tr>`;
  }

  tablecell(content: string, flags: { header?: boolean; align?: string }): string {
    const tag = flags.header ? 'th' : 'td';
    const alignment = flags.align ? `text-${flags.align}` : 'text-left';
    const className = flags.header 
      ? `px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${alignment}`
      : `px-6 py-4 text-sm text-gray-900 ${alignment}`;
    
    return `<${tag} class="${className}">${content}</${tag}>`;
  }

  code(code: string, language?: string): string {
    // This will be replaced by React component in the actual renderer
    return `<pre data-language="${language || 'text'}" class="code-block">${code}</pre>`;
  }

  codespan(code: string): string {
    return `<code class="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-sm font-mono">${code}</code>`;
  }

  strong(text: string): string {
    return `<strong class="font-semibold text-gray-900">${text}</strong>`;
  }

  em(text: string): string {
    return `<em class="italic text-gray-800">${text}</em>`;
  }

  link(href: string, title: string | null, text: string): string {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} class="text-blue-600 hover:text-blue-800 underline transition-colors">${text}</a>`;
  }

  image(href: string, title: string | null, text: string): string {
    const titleAttr = title ? ` title="${title}"` : '';
    const altAttr = text ? ` alt="${text}"` : '';
    return `<div class="mb-4">
      <img src="${href}"${titleAttr}${altAttr} class="max-w-full h-auto rounded-lg shadow-sm" loading="lazy" />
      ${text ? `<p class="text-sm text-gray-600 text-center mt-2 italic">${text}</p>` : ''}
    </div>`;
  }

  hr(): string {
    return `<hr class="my-8 border-gray-300" />`;
  }
}

// Configure marked with our custom renderer
const renderer = new BMADRenderer();

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
  pedantic: false,
  sanitize: false,
  smartLists: true,
  smartypants: true
});

// Markdown rendering utilities
export interface MarkdownRenderOptions {
  enableSyntaxHighlighting?: boolean;
  enableTableOfContents?: boolean;
  enableLineNumbers?: boolean;
  theme?: 'light' | 'dark';
  className?: string;
}

export interface MarkdownSection {
  id: string;
  title: string;
  level: number;
  anchor: string;
}

export interface MarkdownRenderResult {
  html: string;
  sections: MarkdownSection[];
  wordCount: number;
  readingTime: number; // in minutes
}

export class MarkdownRenderer {
  private static instance: MarkdownRenderer;
  
  static getInstance(): MarkdownRenderer {
    if (!MarkdownRenderer.instance) {
      MarkdownRenderer.instance = new MarkdownRenderer();
    }
    return MarkdownRenderer.instance;
  }

  /**
   * Render markdown to HTML with enhanced features
   */
  render(markdown: string, options: MarkdownRenderOptions = {}): MarkdownRenderResult {
    const {
      enableSyntaxHighlighting = true,
      enableTableOfContents = false,
      enableLineNumbers = false,
      theme = 'light',
      className = ''
    } = options;

    try {
      // Parse markdown to HTML
      let html = marked.parse(markdown) as string;

      // Extract sections for table of contents
      const sections = this.extractSections(markdown);

      // Post-process HTML for syntax highlighting
      if (enableSyntaxHighlighting) {
        html = this.applySyntaxHighlighting(html);
      }

      // Add table of contents if requested
      if (enableTableOfContents && sections.length > 0) {
        const toc = this.generateTableOfContents(sections);
        html = toc + html;
      }

      // Calculate reading metrics
      const wordCount = this.calculateWordCount(markdown);
      const readingTime = Math.ceil(wordCount / 200); // Average 200 words per minute

      // Wrap in container with theme classes
      const containerClasses = [
        'bmad-markdown',
        theme === 'dark' ? 'dark' : 'light',
        className
      ].filter(Boolean).join(' ');

      html = `<div class="${containerClasses}">${html}</div>`;

      return {
        html,
        sections,
        wordCount,
        readingTime
      };

    } catch (error) {
      console.error('Markdown rendering error:', error);
      return {
        html: `<div class="text-red-600 bg-red-50 p-4 rounded border border-red-200">
          <h4 class="font-semibold mb-2">Rendering Error</h4>
          <p>Failed to render markdown content: ${(error as Error).message}</p>
        </div>`,
        sections: [],
        wordCount: 0,
        readingTime: 0
      };
    }
  }

  /**
   * Extract sections from markdown for navigation
   */
  private extractSections(markdown: string): MarkdownSection[] {
    const sections: MarkdownSection[] = [];
    const lines = markdown.split('\n');

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        const anchor = title.toLowerCase().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
        
        sections.push({
          id: `section-${sections.length}`,
          title,
          level,
          anchor
        });
      }
    }

    return sections;
  }

  /**
   * Generate table of contents HTML
   */
  private generateTableOfContents(sections: MarkdownSection[]): string {
    if (sections.length === 0) return '';

    let toc = '<div class="table-of-contents mb-8 p-4 bg-gray-50 rounded-lg border border-gray-200">\n';
    toc += '<h4 class="text-lg font-semibold text-gray-900 mb-3">Table of Contents</h4>\n';
    toc += '<nav class="toc-nav">\n<ol class="space-y-1">\n';

    for (const section of sections) {
      const indent = Math.max(0, (section.level - 1) * 16);
      toc += `<li style="margin-left: ${indent}px;">
        <a href="#${section.anchor}" class="text-blue-600 hover:text-blue-800 text-sm transition-colors">
          ${section.title}
        </a>
      </li>\n`;
    }

    toc += '</ol>\n</nav>\n</div>\n';
    return toc;
  }

  /**
   * Apply syntax highlighting to code blocks
   */
  private applySyntaxHighlighting(html: string): string {
    // Replace code blocks with syntax-highlighted versions
    // Note: In a real React app, this would be handled by the React component
    return html.replace(
      /<pre data-language="([^"]*)" class="code-block">([^<]+)<\/pre>/g,
      (match, language, code) => {
        const lang = language || 'text';
        return `<div class="code-block-container mb-4">
          <div class="code-block-header bg-gray-800 text-gray-300 px-4 py-2 text-sm font-mono rounded-t-md">
            ${lang}
          </div>
          <pre class="code-block bg-gray-900 text-gray-100 p-4 rounded-b-md overflow-x-auto">
            <code class="language-${lang}">${code}</code>
          </pre>
        </div>`;
      }
    );
  }

  /**
   * Calculate word count from markdown
   */
  private calculateWordCount(markdown: string): number {
    // Remove markdown syntax and count words
    const plainText = markdown
      .replace(/[#*`_\[\]()]/g, '') // Remove markdown characters
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    if (!plainText) return 0;
    return plainText.split(' ').length;
  }

  /**
   * Render inline markdown (for smaller text snippets)
   */
  renderInline(markdown: string): string {
    try {
      return marked.parseInline(markdown) as string;
    } catch (error) {
      console.error('Inline markdown rendering error:', error);
      return markdown; // Fallback to original text
    }
  }

  /**
   * Sanitize markdown content for security
   */
  sanitize(markdown: string): string {
    // Remove potentially dangerous content
    return markdown
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+="/gi, '');
  }

  /**
   * Preview markdown (truncated version)
   */
  preview(markdown: string, maxWords: number = 50): string {
    const words = markdown.split(/\s+/);
    if (words.length <= maxWords) {
      return this.renderInline(markdown);
    }
    
    const truncated = words.slice(0, maxWords).join(' ') + '...';
    return this.renderInline(truncated);
  }
}

// Export default instance for easy use
export const markdownRenderer = MarkdownRenderer.getInstance();

// Utility functions for common use cases
export const renderMarkdown = (content: string, options?: MarkdownRenderOptions) => {
  return markdownRenderer.render(content, options);
};

export const renderInlineMarkdown = (content: string) => {
  return markdownRenderer.renderInline(content);
};

export const previewMarkdown = (content: string, maxWords?: number) => {
  return markdownRenderer.preview(content, maxWords);
};

export const extractSections = (content: string) => {
  const result = markdownRenderer.render(content, { enableTableOfContents: true });
  return result.sections;
};