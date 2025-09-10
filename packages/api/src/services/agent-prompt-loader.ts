import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import LRUCache from 'lru-cache';
import { 
  AgentPrompt, 
  AgentType, 
  AgentPromptSchema,
  VersionCompatibility,
  VersionCompatibilitySchema 
} from '../models/agent-prompt.ts';
import { logger } from '../utils/logger.ts';

export interface PromptLoadOptions {
  version?: string;
  useCache?: boolean;
  validateSchema?: boolean;
  fallbackToLatest?: boolean;
}

export interface PromptLoaderConfig {
  promptsDirectory: string;
  cacheSize: number;
  cacheTTL: number; // milliseconds
  enableHotReload: boolean;
  enableMetrics: boolean;
}

export interface PromptLoadMetrics {
  totalLoads: number;
  cacheHits: number;
  cacheMisses: number;
  loadErrors: number;
  averageLoadTime: number;
  lastLoadTime: Date;
}

export interface PromptFileInfo {
  agentType: AgentType;
  version: string;
  filename: string;
  filepath: string;
  lastModified: Date;
  size: number;
}

export class AgentPromptLoaderError extends Error {
  constructor(
    message: string,
    public code: string,
    public agentType?: AgentType,
    public version?: string
  ) {
    super(message);
    this.name = 'AgentPromptLoaderError';
  }
}

export class AgentPromptLoader {
  private cache: LRUCache<string, AgentPrompt>;
  private config: PromptLoaderConfig;
  private metrics: Map<AgentType, PromptLoadMetrics>;
  private fileWatchers: Map<string, any>;
  private compatibility: Map<AgentType, VersionCompatibility>;

  constructor(config: Partial<PromptLoaderConfig> = {}) {
    this.config = {
      promptsDirectory: config.promptsDirectory || path.join(__dirname, '../prompts'),
      cacheSize: config.cacheSize || 100,
      cacheTTL: config.cacheTTL || 1000 * 60 * 30, // 30 minutes
      enableHotReload: config.enableHotReload ?? process.env.NODE_ENV === 'development',
      enableMetrics: config.enableMetrics ?? true,
      ...config
    };

    this.cache = new LRUCache<string, AgentPrompt>({
      max: this.config.cacheSize,
      ttl: this.config.cacheTTL,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    this.metrics = new Map();
    this.fileWatchers = new Map();
    this.compatibility = new Map();

    this.initializeMetrics();
    
    if (this.config.enableHotReload) {
      this.setupHotReload();
    }
  }

  /**
   * Load agent prompt by type and optional version
   */
  async loadPrompt(agentType: AgentType, options: PromptLoadOptions = {}): Promise<AgentPrompt> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(agentType, options.version);

    try {
      // Try cache first if enabled
      if (options.useCache !== false) {
        const cached = this.cache.get(cacheKey);
        if (cached) {
          this.updateMetrics(agentType, startTime, true);
          return cached;
        }
      }

      // Load from file
      const prompt = await this.loadPromptFromFile(agentType, options);
      
      // Validate schema if requested
      if (options.validateSchema !== false) {
        this.validatePromptSchema(prompt);
      }

      // Cache the result
      this.cache.set(cacheKey, prompt);
      
      this.updateMetrics(agentType, startTime, false);
      
      logger.info('Agent prompt loaded successfully', {
        agentType,
        version: prompt.version,
        loadTime: Date.now() - startTime
      });

      return prompt;

    } catch (error) {
      this.updateErrorMetrics(agentType);
      logger.error('Failed to load agent prompt', {
        agentType,
        version: options.version,
        error: error instanceof Error ? error.message : String(error)
      });

      if (options.fallbackToLatest && options.version) {
        logger.warn('Falling back to latest version', { agentType, requestedVersion: options.version });
        return this.loadPrompt(agentType, { ...options, version: undefined });
      }

      throw error;
    }
  }

  /**
   * Load all available agent prompts
   */
  async loadAllPrompts(options: PromptLoadOptions = {}): Promise<Map<AgentType, AgentPrompt>> {
    const agents: AgentType[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    const prompts = new Map<AgentType, AgentPrompt>();

    const loadPromises = agents.map(async (agentType) => {
      try {
        const prompt = await this.loadPrompt(agentType, options);
        prompts.set(agentType, prompt);
      } catch (error) {
        logger.error(`Failed to load ${agentType} prompt`, { error });
        // Don't throw, just skip this agent
      }
    });

    await Promise.all(loadPromises);

    logger.info('Loaded agent prompts', {
      successful: prompts.size,
      total: agents.length,
      agents: Array.from(prompts.keys())
    });

    return prompts;
  }

  /**
   * Discover available prompt files
   */
  async discoverPromptFiles(): Promise<PromptFileInfo[]> {
    try {
      const files = await fs.readdir(this.config.promptsDirectory);
      const promptFiles: PromptFileInfo[] = [];

      for (const filename of files) {
        if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
          continue;
        }

        const filepath = path.join(this.config.promptsDirectory, filename);
        const stats = await fs.stat(filepath);

        // Parse agent type from filename
        const agentType = this.parseAgentTypeFromFilename(filename);
        if (!agentType) continue;

        try {
          // Load version from file content
          const content = await fs.readFile(filepath, 'utf8');
          const parsed = yaml.load(content) as any;
          
          promptFiles.push({
            agentType,
            version: parsed.version || '1.0.0',
            filename,
            filepath,
            lastModified: stats.mtime,
            size: stats.size,
          });
        } catch (error) {
          logger.warn('Failed to parse prompt file', { filename, error });
        }
      }

      return promptFiles.sort((a, b) => a.agentType.localeCompare(b.agentType));
    } catch (error) {
      logger.error('Failed to discover prompt files', { 
        directory: this.config.promptsDirectory, 
        error 
      });
      return [];
    }
  }

  /**
   * Check if prompt exists for agent type and version
   */
  async promptExists(agentType: AgentType, version?: string): Promise<boolean> {
    try {
      await this.loadPrompt(agentType, { version, useCache: false, validateSchema: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get prompt loading metrics
   */
  getMetrics(agentType?: AgentType): Map<AgentType, PromptLoadMetrics> | PromptLoadMetrics | undefined {
    if (agentType) {
      return this.metrics.get(agentType);
    }
    return this.metrics;
  }

  /**
   * Clear cache for specific agent or all
   */
  clearCache(agentType?: AgentType, version?: string): void {
    if (agentType) {
      const cacheKey = this.getCacheKey(agentType, version);
      if (version) {
        this.cache.delete(cacheKey);
      } else {
        // Clear all versions of this agent type
        for (const key of this.cache.keys()) {
          if (key.startsWith(`${agentType}:`)) {
            this.cache.delete(key);
          }
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Reload prompt from disk (bypass cache)
   */
  async reloadPrompt(agentType: AgentType, version?: string): Promise<AgentPrompt> {
    this.clearCache(agentType, version);
    return this.loadPrompt(agentType, { version, useCache: false });
  }

  /**
   * Get version compatibility information
   */
  async getVersionCompatibility(agentType: AgentType): Promise<VersionCompatibility | undefined> {
    return this.compatibility.get(agentType);
  }

  /**
   * Gracefully shutdown the loader
   */
  async shutdown(): Promise<void> {
    // Stop file watchers
    for (const [filepath, watcher] of this.fileWatchers) {
      try {
        watcher.close();
      } catch (error) {
        logger.warn('Error closing file watcher', { filepath, error });
      }
    }
    this.fileWatchers.clear();

    // Clear cache
    this.cache.clear();

    logger.info('Agent prompt loader shutdown complete');
  }

  // Private methods

  private async loadPromptFromFile(agentType: AgentType, options: PromptLoadOptions): Promise<AgentPrompt> {
    const filename = this.getPromptFilename(agentType, options.version);
    const filepath = path.join(this.config.promptsDirectory, filename);

    try {
      const content = await fs.readFile(filepath, 'utf8');
      const parsed = yaml.load(content);
      
      if (!parsed || typeof parsed !== 'object') {
        throw new AgentPromptLoaderError(
          'Invalid YAML content in prompt file',
          'INVALID_YAML',
          agentType,
          options.version
        );
      }

      return parsed as AgentPrompt;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new AgentPromptLoaderError(
          `Prompt file not found: ${filename}`,
          'PROMPT_NOT_FOUND',
          agentType,
          options.version
        );
      }

      if (error instanceof AgentPromptLoaderError) {
        throw error;
      }

      throw new AgentPromptLoaderError(
        `Failed to load prompt file: ${(error as Error).message}`,
        'LOAD_ERROR',
        agentType,
        options.version
      );
    }
  }

  private validatePromptSchema(prompt: any): void {
    try {
      AgentPromptSchema.parse(prompt);
    } catch (error) {
      throw new AgentPromptLoaderError(
        `Invalid prompt schema: ${(error as Error).message}`,
        'SCHEMA_VALIDATION_ERROR'
      );
    }
  }

  private getPromptFilename(agentType: AgentType, version?: string): string {
    const baseFilename = agentType.toLowerCase().replace('_', '-');
    
    if (version) {
      return `${baseFilename}-${version}.yaml`;
    }
    
    return `${baseFilename}.yaml`;
  }

  private parseAgentTypeFromFilename(filename: string): AgentType | null {
    const basename = path.basename(filename, path.extname(filename));
    const agentPart = basename.split('-')[0];

    const agentMap: Record<string, AgentType> = {
      'analyst': 'ANALYST',
      'pm': 'PM',
      'ux-expert': 'UX_EXPERT',
      'ux': 'UX_EXPERT',
      'architect': 'ARCHITECT'
    };

    return agentMap[agentPart] || null;
  }

  private getCacheKey(agentType: AgentType, version?: string): string {
    return `${agentType}:${version || 'latest'}`;
  }

  private initializeMetrics(): void {
    if (!this.config.enableMetrics) return;

    const agents: AgentType[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    
    for (const agentType of agents) {
      this.metrics.set(agentType, {
        totalLoads: 0,
        cacheHits: 0,
        cacheMisses: 0,
        loadErrors: 0,
        averageLoadTime: 0,
        lastLoadTime: new Date(0),
      });
    }
  }

  private updateMetrics(agentType: AgentType, startTime: number, cacheHit: boolean): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.metrics.get(agentType);
    if (!metrics) return;

    const loadTime = Date.now() - startTime;
    
    metrics.totalLoads++;
    if (cacheHit) {
      metrics.cacheHits++;
    } else {
      metrics.cacheMisses++;
    }
    
    // Update running average
    metrics.averageLoadTime = (metrics.averageLoadTime * (metrics.totalLoads - 1) + loadTime) / metrics.totalLoads;
    metrics.lastLoadTime = new Date();
    
    this.metrics.set(agentType, metrics);
  }

  private updateErrorMetrics(agentType: AgentType): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.metrics.get(agentType);
    if (metrics) {
      metrics.loadErrors++;
      this.metrics.set(agentType, metrics);
    }
  }

  private setupHotReload(): void {
    if (!this.config.enableHotReload) return;

    // Watch the prompts directory for changes
    import('chokidar').then(({ default: chokidar }) => {
      const watcher = chokidar.watch(
        path.join(this.config.promptsDirectory, '*.{yaml,yml}'),
        {
          persistent: true,
          ignoreInitial: true,
        }
      );

      watcher.on('change', (filepath) => {
        logger.info('Prompt file changed, clearing cache', { filepath });
        
        // Determine agent type from filename
        const filename = path.basename(filepath);
        const agentType = this.parseAgentTypeFromFilename(filename);
        
        if (agentType) {
          this.clearCache(agentType);
        }
      });

      watcher.on('error', (error) => {
        logger.error('File watcher error', { error });
      });

      this.fileWatchers.set('main', watcher);
    }).catch((error) => {
      logger.warn('Failed to setup hot reload (chokidar not available)', { error });
    });
  }
}

// Export singleton instance
export const promptLoader = new AgentPromptLoader();