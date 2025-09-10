import { logger } from './logger';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: {
    timestamp: Date;
    checksum: string;
    version: string;
  };
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  path?: string;
  value?: any;
}

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
  suggestion?: string;
  path?: string;
}

export interface ValidationSchema {
  name: string;
  version: string;
  rules: ValidationRule[];
  required: string[];
  optional: string[];
}

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'email' | 'url';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: (value: any, data: any) => ValidationError | null;
}

class DataIntegrityValidator {
  private schemas: Map<string, ValidationSchema> = new Map();
  private checksumHistory: Map<string, string> = new Map();

  constructor() {
    this.initializeSchemas();
  }

  /**
   * Validate data against a schema
   */
  validateData(data: any, schemaName: string): ValidationResult {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      throw new Error(`Schema '${schemaName}' not found`);
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const checksum = this.calculateChecksum(data);
    const timestamp = new Date();

    try {
      // Validate structure
      const structureErrors = this.validateStructure(data, schema);
      errors.push(...structureErrors);

      // Validate individual fields
      const fieldErrors = this.validateFields(data, schema);
      errors.push(...fieldErrors);

      // Validate business rules
      const businessErrors = this.validateBusinessRules(data, schema);
      errors.push(...businessErrors);

      // Check for data corruption
      const corruptionErrors = this.checkDataCorruption(data, schemaName);
      errors.push(...corruptionErrors);

      // Generate warnings for optional improvements
      const dataWarnings = this.generateWarnings(data, schema);
      warnings.push(...dataWarnings);

      // Store checksum for future corruption detection
      this.checksumHistory.set(`${schemaName}_${Date.now()}`, checksum);

      const result: ValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        metadata: {
          timestamp,
          checksum,
          version: schema.version
        }
      };

      if (!result.isValid) {
        logger.warn(`Data validation failed for schema '${schemaName}':`, {
          errors: errors.length,
          warnings: warnings.length,
          checksum
        });
      }

      return result;
    } catch (error) {
      logger.error(`Data validation error for schema '${schemaName}':`, error);
      
      return {
        isValid: false,
        errors: [{
          field: 'validation',
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${(error as Error).message}`,
          severity: 'critical'
        }],
        warnings: [],
        metadata: {
          timestamp,
          checksum,
          version: schema.version
        }
      };
    }
  }

  /**
   * Validate session data integrity
   */
  validateSessionData(sessionData: any): ValidationResult {
    return this.validateData(sessionData, 'session');
  }

  /**
   * Validate business plan document integrity
   */
  validateBusinessPlan(planData: any): ValidationResult {
    return this.validateData(planData, 'business_plan');
  }

  /**
   * Validate user interaction data
   */
  validateUserInteraction(interactionData: any): ValidationResult {
    return this.validateData(interactionData, 'user_interaction');
  }

  /**
   * Validate conversation state
   */
  validateConversationState(conversationData: any): ValidationResult {
    return this.validateData(conversationData, 'conversation');
  }

  /**
   * Repair data corruption when possible
   */
  repairData(data: any, validationResult: ValidationResult): any {
    if (validationResult.isValid) return data;

    let repairedData = JSON.parse(JSON.stringify(data)); // Deep clone

    for (const error of validationResult.errors) {
      try {
        switch (error.code) {
          case 'MISSING_REQUIRED_FIELD':
            repairedData = this.repairMissingField(repairedData, error);
            break;
          case 'INVALID_TYPE':
            repairedData = this.repairInvalidType(repairedData, error);
            break;
          case 'INVALID_FORMAT':
            repairedData = this.repairInvalidFormat(repairedData, error);
            break;
          case 'DATA_CORRUPTION':
            repairedData = this.repairDataCorruption(repairedData, error);
            break;
        }
      } catch (repairError) {
        logger.warn(`Failed to repair error ${error.code}:`, repairError);
      }
    }

    logger.info('Data repair completed', {
      originalErrors: validationResult.errors.length,
      repairedData: !!repairedData
    });

    return repairedData;
  }

  private initializeSchemas() {
    // Session data schema
    this.schemas.set('session', {
      name: 'session',
      version: '1.0',
      required: ['sessionId', 'userId', 'timestamp'],
      optional: ['metadata'],
      rules: [
        { field: 'sessionId', type: 'string', required: true, minLength: 1 },
        { field: 'userId', type: 'string', required: true, minLength: 1 },
        { field: 'timestamp', type: 'date', required: true },
        { field: 'conversationState', type: 'object', required: true },
        { field: 'userInteractions', type: 'object', required: true },
        { field: 'systemState', type: 'object', required: false }
      ]
    });

    // Business plan schema
    this.schemas.set('business_plan', {
      name: 'business_plan',
      version: '1.0',
      required: ['title', 'executiveSummary', 'businessDescription'],
      optional: ['financialProjections', 'marketAnalysis'],
      rules: [
        { field: 'title', type: 'string', required: true, minLength: 5, maxLength: 200 },
        { field: 'executiveSummary', type: 'string', required: true, minLength: 50 },
        { field: 'businessDescription', type: 'string', required: true, minLength: 100 },
        { field: 'marketAnalysis', type: 'object', required: false },
        { field: 'financialProjections', type: 'object', required: false },
        { 
          field: 'industry',
          type: 'string',
          required: true,
          enum: ['technology', 'retail', 'healthcare', 'finance', 'education', 'manufacturing', 'other']
        }
      ]
    });

    // Conversation schema
    this.schemas.set('conversation', {
      name: 'conversation',
      version: '1.0',
      required: ['messages'],
      optional: ['metadata'],
      rules: [
        { field: 'messages', type: 'array', required: true },
        { 
          field: 'messages',
          type: 'array',
          custom: (messages, data) => {
            if (!Array.isArray(messages)) return null;
            
            for (let i = 0; i < messages.length; i++) {
              const message = messages[i];
              if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
                return {
                  field: `messages[${i}].role`,
                  code: 'INVALID_MESSAGE_ROLE',
                  message: 'Message role must be user, assistant, or system',
                  severity: 'high' as const
                };
              }
              if (!message.content || typeof message.content !== 'string') {
                return {
                  field: `messages[${i}].content`,
                  code: 'INVALID_MESSAGE_CONTENT',
                  message: 'Message content must be a non-empty string',
                  severity: 'high' as const
                };
              }
            }
            return null;
          }
        }
      ]
    });

    // User interaction schema
    this.schemas.set('user_interaction', {
      name: 'user_interaction',
      version: '1.0',
      required: ['timestamp', 'type'],
      optional: ['data', 'metadata'],
      rules: [
        { field: 'timestamp', type: 'date', required: true },
        { field: 'type', type: 'string', required: true, enum: ['click', 'input', 'navigation', 'form_submit'] },
        { field: 'data', type: 'object', required: false }
      ]
    });
  }

  private validateStructure(data: any, schema: ValidationSchema): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if data is an object
    if (typeof data !== 'object' || data === null) {
      errors.push({
        field: 'root',
        code: 'INVALID_DATA_TYPE',
        message: 'Data must be an object',
        severity: 'critical'
      });
      return errors;
    }

    // Check required fields
    for (const requiredField of schema.required) {
      if (!(requiredField in data) || data[requiredField] === undefined || data[requiredField] === null) {
        errors.push({
          field: requiredField,
          code: 'MISSING_REQUIRED_FIELD',
          message: `Required field '${requiredField}' is missing`,
          severity: 'high',
          path: requiredField
        });
      }
    }

    return errors;
  }

  private validateFields(data: any, schema: ValidationSchema): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of schema.rules) {
      const value = data[rule.field];

      // Skip validation if field is missing and not required
      if (value === undefined || value === null) {
        if (rule.required) {
          errors.push({
            field: rule.field,
            code: 'MISSING_REQUIRED_FIELD',
            message: `Required field '${rule.field}' is missing`,
            severity: 'high',
            path: rule.field
          });
        }
        continue;
      }

      // Type validation
      const typeError = this.validateFieldType(rule.field, value, rule.type);
      if (typeError) errors.push(typeError);

      // Length validation for strings
      if (rule.type === 'string' && typeof value === 'string') {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push({
            field: rule.field,
            code: 'MIN_LENGTH_VIOLATION',
            message: `Field '${rule.field}' must be at least ${rule.minLength} characters long`,
            severity: 'medium',
            value: value.length
          });
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({
            field: rule.field,
            code: 'MAX_LENGTH_VIOLATION',
            message: `Field '${rule.field}' must not exceed ${rule.maxLength} characters`,
            severity: 'medium',
            value: value.length
          });
        }
      }

      // Numeric range validation
      if (rule.type === 'number' && typeof value === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({
            field: rule.field,
            code: 'MIN_VALUE_VIOLATION',
            message: `Field '${rule.field}' must be at least ${rule.min}`,
            severity: 'medium',
            value
          });
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            field: rule.field,
            code: 'MAX_VALUE_VIOLATION',
            message: `Field '${rule.field}' must not exceed ${rule.max}`,
            severity: 'medium',
            value
          });
        }
      }

      // Pattern validation
      if (rule.pattern && typeof value === 'string') {
        if (!rule.pattern.test(value)) {
          errors.push({
            field: rule.field,
            code: 'PATTERN_MISMATCH',
            message: `Field '${rule.field}' does not match required pattern`,
            severity: 'medium',
            value
          });
        }
      }

      // Enum validation
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push({
          field: rule.field,
          code: 'INVALID_ENUM_VALUE',
          message: `Field '${rule.field}' must be one of: ${rule.enum.join(', ')}`,
          severity: 'medium',
          value
        });
      }

      // Custom validation
      if (rule.custom) {
        const customError = rule.custom(value, data);
        if (customError) errors.push(customError);
      }
    }

    return errors;
  }

  private validateFieldType(field: string, value: any, expectedType: string): ValidationError | null {
    let isValid = false;

    switch (expectedType) {
      case 'string':
        isValid = typeof value === 'string';
        break;
      case 'number':
        isValid = typeof value === 'number' && !isNaN(value);
        break;
      case 'boolean':
        isValid = typeof value === 'boolean';
        break;
      case 'object':
        isValid = typeof value === 'object' && value !== null && !Array.isArray(value);
        break;
      case 'array':
        isValid = Array.isArray(value);
        break;
      case 'date':
        isValid = value instanceof Date || !isNaN(Date.parse(value));
        break;
      case 'email':
        isValid = typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        break;
      case 'url':
        isValid = typeof value === 'string' && /^https?:\/\/.+/.test(value);
        break;
      default:
        return null;
    }

    if (!isValid) {
      return {
        field,
        code: 'INVALID_TYPE',
        message: `Field '${field}' must be of type '${expectedType}'`,
        severity: 'medium',
        value
      };
    }

    return null;
  }

  private validateBusinessRules(data: any, schema: ValidationSchema): ValidationError[] {
    const errors: ValidationError[] = [];

    // Business-specific validation rules
    if (schema.name === 'business_plan') {
      // Ensure executive summary and business description don't overlap too much
      if (data.executiveSummary && data.businessDescription) {
        const similarity = this.calculateTextSimilarity(data.executiveSummary, data.businessDescription);
        if (similarity > 0.8) {
          errors.push({
            field: 'executiveSummary',
            code: 'CONTENT_DUPLICATION',
            message: 'Executive summary and business description are too similar',
            severity: 'low'
          });
        }
      }
    }

    if (schema.name === 'conversation') {
      // Validate conversation flow
      if (data.messages && Array.isArray(data.messages)) {
        let consecutiveSystemMessages = 0;
        for (const message of data.messages) {
          if (message.role === 'system') {
            consecutiveSystemMessages++;
            if (consecutiveSystemMessages > 3) {
              errors.push({
                field: 'messages',
                code: 'EXCESSIVE_SYSTEM_MESSAGES',
                message: 'Too many consecutive system messages detected',
                severity: 'low'
              });
              break;
            }
          } else {
            consecutiveSystemMessages = 0;
          }
        }
      }
    }

    return errors;
  }

  private checkDataCorruption(data: any, schemaName: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const currentChecksum = this.calculateChecksum(data);

    // Check for obvious corruption signs
    const serialized = JSON.stringify(data);
    
    // Check for truncated data
    if (serialized.length < 50 && Object.keys(data).length > 0) {
      errors.push({
        field: 'data',
        code: 'POSSIBLE_DATA_TRUNCATION',
        message: 'Data appears to be truncated or corrupted',
        severity: 'high'
      });
    }

    // Check for invalid characters or encoding issues
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(serialized)) {
      errors.push({
        field: 'data',
        code: 'INVALID_CHARACTERS',
        message: 'Data contains invalid control characters',
        severity: 'medium'
      });
    }

    return errors;
  }

  private generateWarnings(data: any, schema: ValidationSchema): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Check for missing optional but recommended fields
    for (const optionalField of schema.optional) {
      if (!(optionalField in data) || data[optionalField] === undefined) {
        warnings.push({
          field: optionalField,
          code: 'MISSING_OPTIONAL_FIELD',
          message: `Optional field '${optionalField}' is missing`,
          suggestion: `Consider adding '${optionalField}' for better data completeness`
        });
      }
    }

    return warnings;
  }

  private calculateChecksum(data: any): string {
    // Simple checksum calculation (use crypto.createHash in production)
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    let hash = 0;
    for (let i = 0; i < serialized.length; i++) {
      const char = serialized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple Jaccard similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private repairMissingField(data: any, error: ValidationError): any {
    const field = error.field;
    
    // Provide default values for common missing fields
    const defaults: Record<string, any> = {
      'timestamp': new Date().toISOString(),
      'id': `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      'version': '1.0',
      'status': 'active',
      'messages': [],
      'metadata': {}
    };

    if (field in defaults) {
      data[field] = defaults[field];
      logger.info(`Repaired missing field '${field}' with default value`);
    }

    return data;
  }

  private repairInvalidType(data: any, error: ValidationError): any {
    const field = error.field;
    const value = error.value;

    try {
      // Attempt type coercion
      if (field === 'timestamp' && typeof value === 'string') {
        data[field] = new Date(value).toISOString();
      } else if (typeof value === 'string' && value.match(/^\d+$/)) {
        data[field] = parseInt(value, 10);
      }
    } catch (repairError) {
      logger.warn(`Failed to repair invalid type for field '${field}':`, repairError);
    }

    return data;
  }

  private repairInvalidFormat(data: any, error: ValidationError): any {
    // Attempt to fix common format issues
    const field = error.field;
    const value = error.value;

    if (typeof value === 'string') {
      // Clean up whitespace
      data[field] = value.trim();
      
      // Fix email formats
      if (field.includes('email') && !value.includes('@')) {
        // Can't automatically fix, but log the attempt
        logger.warn(`Cannot automatically repair email format for field '${field}'`);
      }
    }

    return data;
  }

  private repairDataCorruption(data: any, error: ValidationError): any {
    logger.warn(`Attempting to repair data corruption: ${error.code}`);
    
    // For corruption, we might need to restore from backup or use default values
    // This is a placeholder for more sophisticated corruption repair
    
    return data;
  }
}

export const dataIntegrityValidator = new DataIntegrityValidator();