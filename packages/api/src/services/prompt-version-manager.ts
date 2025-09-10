import fs from 'fs/promises';
import path from 'path';
import semver from 'semver';
import { 
  AgentPrompt, 
  AgentType, 
  VersionCompatibility,
  VersionCompatibilitySchema 
} from '../models/agent-prompt.ts';
import { promptLoader } from './agent-prompt-loader.ts';
import { promptValidator } from './prompt-validator.ts';
import { logger } from '../utils/logger.ts';

export interface VersionInfo {
  version: string;
  agentType: AgentType;
  createdAt: Date;
  author: string;
  changeDescription: string;
  breaking: boolean;
  deprecated: boolean;
}

export interface VersionMigration {
  fromVersion: string;
  toVersion: string;
  agentType: AgentType;
  migrationSteps: Array<{
    description: string;
    automated: boolean;
    script?: string;
  }>;
  breakingChanges: string[];
  rollbackPossible: boolean;
}

export interface RollbackPlan {
  fromVersion: string;
  toVersion: string;
  agentType: AgentType;
  steps: Array<{
    description: string;
    command: string;
    reversible: boolean;
  }>;
  dataBackupRequired: boolean;
  estimatedDowntime: number;
}

export class PromptVersionManagerError extends Error {
  constructor(
    message: string,
    public code: string,
    public agentType?: AgentType,
    public version?: string
  ) {
    super(message);
    this.name = 'PromptVersionManagerError';
  }
}

export class PromptVersionManager {
  private versionsDirectory: string;
  private compatibilityCache: Map<AgentType, VersionCompatibility>;
  private versionHistory: Map<AgentType, VersionInfo[]>;

  constructor(versionsDirectory?: string) {
    this.versionsDirectory = versionsDirectory || path.join(__dirname, '../prompts/versions');
    this.compatibilityCache = new Map();
    this.versionHistory = new Map();
    
    this.initializeVersionTracking();
  }

  /**
   * Get all available versions for an agent type
   */
  async getVersions(agentType: AgentType): Promise<string[]> {
    try {
      const agentVersionDir = path.join(this.versionsDirectory, agentType.toLowerCase());
      
      try {
        const files = await fs.readdir(agentVersionDir);
        const versions = files
          .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
          .map(file => path.basename(file, path.extname(file)))
          .map(filename => {
            // Extract version from filename like "analyst-1.2.0.yaml" or "1.2.0.yaml"
            const parts = filename.split('-');
            return parts.length > 1 ? parts[parts.length - 1] : parts[0];
          })
          .filter(version => semver.valid(version))
          .sort(semver.rcompare); // Sort in descending order (newest first)

        return versions;
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          // Directory doesn't exist, return current version from main prompt
          const currentPrompt = await promptLoader.loadPrompt(agentType, { useCache: false });
          return [currentPrompt.version];
        }
        throw error;
      }
    } catch (error) {
      logger.error('Failed to get versions', { agentType, error });
      throw new PromptVersionManagerError(
        `Failed to get versions for ${agentType}: ${error instanceof Error ? error.message : String(error)}`,
        'VERSION_LOOKUP_ERROR',
        agentType
      );
    }
  }

  /**
   * Get the latest version for an agent type
   */
  async getLatestVersion(agentType: AgentType): Promise<string> {
    const versions = await this.getVersions(agentType);
    if (versions.length === 0) {
      throw new PromptVersionManagerError(
        `No versions found for agent type ${agentType}`,
        'NO_VERSIONS_FOUND',
        agentType
      );
    }
    return versions[0]; // Already sorted in descending order
  }

  /**
   * Check if a version exists for an agent type
   */
  async versionExists(agentType: AgentType, version: string): Promise<boolean> {
    if (!semver.valid(version)) {
      return false;
    }

    const versions = await this.getVersions(agentType);
    return versions.includes(version);
  }

  /**
   * Create a new version of an agent prompt
   */
  async createVersion(
    agentType: AgentType,
    newVersion: string,
    prompt: AgentPrompt,
    changeDescription: string,
    options: {
      breaking?: boolean;
      deprecatePrevious?: boolean;
      author?: string;
    } = {}
  ): Promise<void> {
    try {
      // Validate version format
      if (!semver.valid(newVersion)) {
        throw new PromptVersionManagerError(
          `Invalid version format: ${newVersion}`,
          'INVALID_VERSION_FORMAT',
          agentType,
          newVersion
        );
      }

      // Check if version already exists
      if (await this.versionExists(agentType, newVersion)) {
        throw new PromptVersionManagerError(
          `Version ${newVersion} already exists for ${agentType}`,
          'VERSION_ALREADY_EXISTS',
          agentType,
          newVersion
        );
      }

      // Validate the prompt
      const validationResult = await promptValidator.validatePrompt(prompt);
      if (!validationResult.valid) {
        throw new PromptVersionManagerError(
          `Prompt validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`,
          'PROMPT_VALIDATION_FAILED',
          agentType,
          newVersion
        );
      }

      // Ensure prompt has correct version
      prompt.version = newVersion;
      prompt.updated_at = new Date().toISOString();
      if (options.author) {
        prompt.author = options.author;
      }

      // Create versions directory if it doesn't exist
      const agentVersionDir = path.join(this.versionsDirectory, agentType.toLowerCase());
      await fs.mkdir(agentVersionDir, { recursive: true });

      // Save the versioned prompt
      const versionFile = path.join(agentVersionDir, `${newVersion}.yaml`);
      const yaml = await import('js-yaml');
      await fs.writeFile(versionFile, yaml.dump(prompt, { lineWidth: 120 }), 'utf8');

      // Update version history
      const versionInfo: VersionInfo = {
        version: newVersion,
        agentType,
        createdAt: new Date(),
        author: options.author || 'system',
        changeDescription,
        breaking: options.breaking || false,
        deprecated: false,
      };

      await this.updateVersionHistory(agentType, versionInfo);

      // Update compatibility information
      await this.updateCompatibility(agentType, newVersion, options.breaking || false);

      // Handle deprecation of previous version
      if (options.deprecatePrevious) {
        const versions = await this.getVersions(agentType);
        if (versions.length > 1) {
          const previousVersion = versions[1]; // Second newest
          await this.deprecateVersion(agentType, previousVersion);
        }
      }

      logger.info('Version created successfully', {
        agentType,
        version: newVersion,
        breaking: options.breaking,
        deprecatePrevious: options.deprecatePrevious,
        changeDescription
      });

    } catch (error) {
      logger.error('Failed to create version', {
        agentType,
        version: newVersion,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof PromptVersionManagerError) {
        throw error;
      }

      throw new PromptVersionManagerError(
        `Failed to create version: ${error instanceof Error ? error.message : String(error)}`,
        'VERSION_CREATION_ERROR',
        agentType,
        newVersion
      );
    }
  }

  /**
   * Rollback to a previous version
   */
  async rollback(
    agentType: AgentType,
    targetVersion: string,
    options: {
      createBackup?: boolean;
      force?: boolean;
    } = {}
  ): Promise<RollbackPlan> {
    try {
      const currentVersion = await this.getLatestVersion(agentType);
      
      // Validate target version exists
      if (!(await this.versionExists(agentType, targetVersion))) {
        throw new PromptVersionManagerError(
          `Target version ${targetVersion} does not exist for ${agentType}`,
          'VERSION_NOT_FOUND',
          agentType,
          targetVersion
        );
      }

      // Check if rollback is needed
      if (semver.eq(currentVersion, targetVersion)) {
        throw new PromptVersionManagerError(
          `Already at target version ${targetVersion}`,
          'ALREADY_AT_VERSION',
          agentType,
          targetVersion
        );
      }

      // Check rollback compatibility
      const compatibility = await this.getCompatibility(agentType);
      const canRollback = this.canRollbackTo(currentVersion, targetVersion, compatibility);
      
      if (!canRollback && !options.force) {
        throw new PromptVersionManagerError(
          `Cannot rollback from ${currentVersion} to ${targetVersion} due to breaking changes`,
          'ROLLBACK_NOT_ALLOWED',
          agentType,
          targetVersion
        );
      }

      // Create rollback plan
      const rollbackPlan: RollbackPlan = {
        fromVersion: currentVersion,
        toVersion: targetVersion,
        agentType,
        steps: [],
        dataBackupRequired: options.createBackup || false,
        estimatedDowntime: this.estimateRollbackDowntime(currentVersion, targetVersion),
      };

      // Add backup step if requested
      if (options.createBackup) {
        rollbackPlan.steps.push({
          description: `Backup current version ${currentVersion}`,
          command: `cp current-prompt.yaml backup-${currentVersion}-${Date.now()}.yaml`,
          reversible: true,
        });
      }

      // Add rollback step
      rollbackPlan.steps.push({
        description: `Rollback to version ${targetVersion}`,
        command: `cp versions/${agentType.toLowerCase()}/${targetVersion}.yaml current-prompt.yaml`,
        reversible: true,
      });

      // Execute rollback if not in dry-run mode
      if (!options.force) {
        await this.executeRollback(rollbackPlan);
      }

      logger.info('Rollback completed', {
        agentType,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        stepsExecuted: rollbackPlan.steps.length
      });

      return rollbackPlan;

    } catch (error) {
      logger.error('Rollback failed', {
        agentType,
        targetVersion,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof PromptVersionManagerError) {
        throw error;
      }

      throw new PromptVersionManagerError(
        `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        'ROLLBACK_ERROR',
        agentType,
        targetVersion
      );
    }
  }

  /**
   * Get version compatibility information
   */
  async getCompatibility(agentType: AgentType): Promise<VersionCompatibility> {
    // Check cache first
    const cached = this.compatibilityCache.get(agentType);
    if (cached) {
      return cached;
    }

    try {
      // Try to load from file
      const compatibilityFile = path.join(this.versionsDirectory, agentType.toLowerCase(), 'compatibility.json');
      const content = await fs.readFile(compatibilityFile, 'utf8');
      const compatibility = VersionCompatibilitySchema.parse(JSON.parse(content));
      
      this.compatibilityCache.set(agentType, compatibility);
      return compatibility;

    } catch (error) {
      // Create default compatibility if file doesn't exist
      const versions = await this.getVersions(agentType);
      const latest = versions[0] || '1.0.0';
      
      const defaultCompatibility: VersionCompatibility = {
        current_version: latest,
        compatible_versions: versions,
        breaking_changes: [],
        deprecated_features: [],
      };

      this.compatibilityCache.set(agentType, defaultCompatibility);
      return defaultCompatibility;
    }
  }

  /**
   * Deprecate a version
   */
  async deprecateVersion(
    agentType: AgentType,
    version: string,
    removalVersion?: string,
    replacement?: string
  ): Promise<void> {
    const compatibility = await this.getCompatibility(agentType);
    
    const deprecation = {
      feature: `Version ${version}`,
      deprecated_in: compatibility.current_version,
      removal_in: removalVersion || semver.inc(compatibility.current_version, 'major') || '2.0.0',
      replacement,
    };

    compatibility.deprecated_features.push(deprecation);
    
    await this.saveCompatibility(agentType, compatibility);
    
    logger.info('Version deprecated', {
      agentType,
      version,
      removalVersion: deprecation.removal_in,
      replacement
    });
  }

  /**
   * Get version migration plan
   */
  async getMigrationPlan(
    agentType: AgentType,
    fromVersion: string,
    toVersion: string
  ): Promise<VersionMigration> {
    const compatibility = await this.getCompatibility(agentType);
    
    const breakingChanges = compatibility.breaking_changes
      .filter(bc => semver.gt(bc.version, fromVersion) && semver.lte(bc.version, toVersion))
      .flatMap(bc => bc.changes);

    const migration: VersionMigration = {
      fromVersion,
      toVersion,
      agentType,
      migrationSteps: [
        {
          description: `Update prompt from ${fromVersion} to ${toVersion}`,
          automated: true,
          script: `copy-version-${toVersion}.sh`,
        }
      ],
      breakingChanges,
      rollbackPossible: breakingChanges.length === 0,
    };

    // Add specific migration steps for breaking changes
    if (breakingChanges.length > 0) {
      migration.migrationSteps.unshift({
        description: 'Review breaking changes and update integrations',
        automated: false,
      });
    }

    return migration;
  }

  /**
   * Clear compatibility cache
   */
  clearCompatibilityCache(agentType?: AgentType): void {
    if (agentType) {
      this.compatibilityCache.delete(agentType);
    } else {
      this.compatibilityCache.clear();
    }
  }

  // Private helper methods

  private async initializeVersionTracking(): Promise<void> {
    try {
      await fs.mkdir(this.versionsDirectory, { recursive: true });
      
      const agentTypes: AgentType[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
      
      for (const agentType of agentTypes) {
        const agentDir = path.join(this.versionsDirectory, agentType.toLowerCase());
        await fs.mkdir(agentDir, { recursive: true });
        
        // Initialize version history
        await this.loadVersionHistory(agentType);
      }
      
    } catch (error) {
      logger.warn('Failed to initialize version tracking', { error });
    }
  }

  private async loadVersionHistory(agentType: AgentType): Promise<void> {
    try {
      const historyFile = path.join(this.versionsDirectory, agentType.toLowerCase(), 'history.json');
      const content = await fs.readFile(historyFile, 'utf8');
      const history = JSON.parse(content) as VersionInfo[];
      
      // Convert date strings back to Date objects
      const processedHistory = history.map(info => ({
        ...info,
        createdAt: new Date(info.createdAt)
      }));
      
      this.versionHistory.set(agentType, processedHistory);
    } catch (error) {
      // Initialize empty history if file doesn't exist
      this.versionHistory.set(agentType, []);
    }
  }

  private async updateVersionHistory(agentType: AgentType, versionInfo: VersionInfo): Promise<void> {
    const history = this.versionHistory.get(agentType) || [];
    history.push(versionInfo);
    this.versionHistory.set(agentType, history);
    
    // Save to file
    const historyFile = path.join(this.versionsDirectory, agentType.toLowerCase(), 'history.json');
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2), 'utf8');
  }

  private async updateCompatibility(agentType: AgentType, newVersion: string, breaking: boolean): Promise<void> {
    const compatibility = await this.getCompatibility(agentType);
    
    compatibility.current_version = newVersion;
    compatibility.compatible_versions = compatibility.compatible_versions.filter(v => semver.valid(v));
    compatibility.compatible_versions.unshift(newVersion);
    
    if (breaking) {
      compatibility.breaking_changes.push({
        version: newVersion,
        changes: [`Breaking changes introduced in version ${newVersion}`],
        migration_guide: `Please review migration guide for version ${newVersion}`,
      });
    }
    
    await this.saveCompatibility(agentType, compatibility);
  }

  private async saveCompatibility(agentType: AgentType, compatibility: VersionCompatibility): Promise<void> {
    const compatibilityFile = path.join(this.versionsDirectory, agentType.toLowerCase(), 'compatibility.json');
    await fs.writeFile(compatibilityFile, JSON.stringify(compatibility, null, 2), 'utf8');
    
    // Update cache
    this.compatibilityCache.set(agentType, compatibility);
  }

  private canRollbackTo(fromVersion: string, toVersion: string, compatibility: VersionCompatibility): boolean {
    // Check if there are breaking changes between the versions
    const breakingVersions = compatibility.breaking_changes
      .map(bc => bc.version)
      .filter(v => semver.gt(v, toVersion) && semver.lte(v, fromVersion));
    
    return breakingVersions.length === 0;
  }

  private estimateRollbackDowntime(fromVersion: string, toVersion: string): number {
    // Simple estimation based on version difference
    const versionDiff = semver.diff(fromVersion, toVersion);
    
    switch (versionDiff) {
      case 'patch':
        return 30; // 30 seconds
      case 'minor':
        return 120; // 2 minutes
      case 'major':
        return 300; // 5 minutes
      default:
        return 60; // 1 minute
    }
  }

  private async executeRollback(plan: RollbackPlan): Promise<void> {
    for (const step of plan.steps) {
      try {
        // This would execute the actual rollback command
        // For now, we'll just log the steps
        logger.info('Executing rollback step', {
          description: step.description,
          command: step.command,
          reversible: step.reversible
        });
        
        // In a real implementation, you would execute the command here
        // await execCommand(step.command);
        
      } catch (error) {
        logger.error('Rollback step failed', {
          step: step.description,
          error: error instanceof Error ? error.message : String(error)
        });
        
        if (step.reversible) {
          logger.info('Step is reversible, attempting to continue...');
        } else {
          throw new PromptVersionManagerError(
            `Critical rollback step failed: ${step.description}`,
            'ROLLBACK_STEP_FAILED'
          );
        }
      }
    }
  }
}

// Export singleton instance
export const promptVersionManager = new PromptVersionManager();