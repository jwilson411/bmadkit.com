/**
 * Enhanced Test Data Fixtures & Utilities
 * Supporting advanced edge case testing scenarios
 * 
 * Includes:
 * - Large content generation
 * - Unicode test data
 * - Network simulation
 * - Chaos engineering utilities
 * - Memory monitoring
 */

import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

// Mock User Factory
export async function createMockUser(prisma: PrismaClient, overrides?: any) {
  const user = await prisma.user.create({
    data: {
      email: faker.internet.email(),
      name: faker.person.fullName(),
      subscription: {
        status: 'FREE',
        planType: 'FREE',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      ...overrides
    }
  });
  return user;
}

// Mock Session Factory
export function createMockSession(overrides?: any) {
  return {
    id: faker.string.uuid(),
    projectInput: faker.lorem.paragraphs(3),
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Mock Payment Factory
export function createMockPayment(overrides?: any) {
  return {
    id: faker.string.uuid(),
    amount: 2900, // $29.00
    currency: 'usd',
    status: 'succeeded',
    paymentIntentId: `pi_${faker.string.alphanumeric(24)}`,
    ...overrides
  };
}

// Large Content Generator
export function generateLargeContent(options: {
  messageCount: number;
  averageMessageLength?: number;
  includeCodeBlocks?: boolean;
  includeTables?: boolean;
  includeImages?: boolean;
}) {
  const {
    messageCount,
    averageMessageLength = 1000,
    includeCodeBlocks = false,
    includeTables = false,
    includeImages = false
  } = options;

  const messages = [];
  const agentTypes = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];

  for (let i = 0; i < messageCount; i++) {
    let content = faker.lorem.paragraphs(
      Math.floor(averageMessageLength / 100),
      '\n\n'
    );

    // Add code blocks occasionally
    if (includeCodeBlocks && i % 10 === 0) {
      content += '\n\n```typescript\n';
      content += generateCodeBlock();
      content += '\n```\n';
    }

    // Add tables occasionally
    if (includeTables && i % 15 === 0) {
      content += '\n\n' + generateMarkdownTable();
    }

    // Add image references occasionally
    if (includeImages && i % 20 === 0) {
      content += `\n\n![Chart ${i}](https://example.com/charts/chart-${i}.png)\n`;
    }

    messages.push({
      id: faker.string.uuid(),
      content,
      agentType: agentTypes[i % agentTypes.length],
      sequenceNumber: i,
      createdAt: new Date(Date.now() + i * 1000), // Spread over time
      metadata: {
        wordCount: content.split(' ').length,
        characterCount: content.length,
        containsCode: includeCodeBlocks && i % 10 === 0,
        containsTable: includeTables && i % 15 === 0,
        containsImage: includeImages && i % 20 === 0
      }
    });
  }

  const totalSize = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  
  return {
    messages,
    totalMessages: messageCount,
    totalSizeBytes: totalSize,
    estimatedSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    averageMessageSize: Math.round(totalSize / messageCount)
  };
}

function generateCodeBlock(): string {
  const codeTemplates = [
    `interface SessionData {
  id: string;
  userId: string;
  projectInput: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionService {
  async createSession(data: CreateSessionData): Promise<Session> {
    return this.prisma.session.create({
      data: {
        ...data,
        status: 'ACTIVE'
      }
    });
  }
}`,
    `const processLargeDataset = async (data: any[]): Promise<ProcessedData[]> => {
  const results = [];
  
  for (const item of data) {
    try {
      const processed = await processItem(item);
      results.push(processed);
    } catch (error) {
      logger.error('Processing failed', { error, item });
    }
  }
  
  return results;
};`,
    `export const validateInput = z.object({
  projectInput: z.string().min(10).max(5000),
  userPreferences: z.object({
    industry: z.string().optional(),
    complexity: z.enum(['simple', 'medium', 'complex'])
  }).optional()
});`
  ];

  return codeTemplates[Math.floor(Math.random() * codeTemplates.length)];
}

function generateMarkdownTable(): string {
  const headers = ['Feature', 'Free Plan', 'Premium Plan', 'Enterprise Plan'];
  const features = [
    'Sessions per month',
    'Export formats',
    'Document templates',
    'Real-time collaboration',
    'Priority support'
  ];

  const values = [
    ['5', '50', 'Unlimited'],
    ['PDF only', 'PDF, DOCX, MD', 'All formats'],
    ['3 basic', '15 professional', '50+ custom'],
    ['❌', '✅', '✅'],
    ['❌', '✅', '✅ + Dedicated']
  ];

  let table = `| ${headers.join(' | ')} |\n`;
  table += `| ${headers.map(() => '---').join(' | ')} |\n`;
  
  features.forEach((feature, index) => {
    table += `| ${feature} | ${values[index].join(' | ')} |\n`;
  });

  return table;
}

// Unicode Test Content Generator
export function generateUnicodeTestContent() {
  return {
    // Mixed directional text (English + Arabic + Hebrew)
    mixedDirectionalText: `
      Business analysis in English العمل التجاري (Arabic business) and עסקים (Hebrew business).
      Project timeline: البداية في يناير (January start) התחלה בינואר (Hebrew January start).
      Budget considerations: التكلفة الإجمالية (total cost) עלות כוללת (Hebrew total cost).
      Team structure: فريق العمل (work team) צוות עבודה (Hebrew work team).
    `,

    // Emoji combinations with modifiers
    emojiCombinations: `
      Team members: 👨🏻‍💻 👩🏽‍💼 👨🏾‍🎨 👩🏿‍🔬
      Project status: ✅ Completed ⚠️ In Progress ❌ Blocked 🔄 Review
      Mood indicators: 😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛
      Complex emoji: 👨‍👩‍👧‍👦 👩‍❤️‍👨 💑💏👪
      Flags: 🇺🇸🇬🇧🇫🇷🇩🇪🇯🇵🇨🇳🇮🇳🇧🇷
    `,

    // Mathematical symbols and technical notation
    mathematicalSymbols: `
      Revenue calculations: ∑(revenue) = ∫₀^∞ f(x)dx ≈ $1,234,567
      Statistical measures: μ = 42.7, σ = 3.14, ρ = 0.87
      Set theory: A ∪ B ∩ C ⊆ D, |S| = ∞
      Greek letters: α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω
      Mathematical operators: ± × ÷ ≠ ≤ ≥ ≈ ∝ ∞ ∂ ∇ ∆ ∏ ∑
      Special symbols: ℝ ℕ ℚ ℤ ℂ ℍ ℙ ⊕ ⊗ ⊘ ⟨x⟩ [x] {x}
    `,

    // Ancient scripts and rare Unicode blocks
    ancientScripts: `
      Ancient Greek: ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ αβγδεζηθικλμνξοπρστυφχψω
      Coptic: ⲀⲂⲄⲆⲈⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰ
      Hieroglyphs: 𓀀𓀁𓀂𓀃𓀄𓀅𓀆𓀇𓀈𓀉𓀊𓀋𓀌𓀍𓀎𓀏
      Runic: ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛟᛞ
      Cherokee: ᎠᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏ
    `,

    // Zero-width and combining characters
    specialCharacters: `
      Zero width space: A\u200BB\u200BC\u200BD
      Zero width non-joiner: \u200Ctest\u200C
      Zero width joiner: \u200Dtest\u200D
      Combining diacritical marks: e\u0301 o\u0308 u\u0300 a\u0302 i\u0303
      Directional marks: \u200ELeft-to-right\u200E \u200FRight-to-left\u200F
      Bidi overrides: \u202AForce LTR\u202C \u202BForce RTL\u202C
    `,

    // Mixed languages for search testing
    multiLanguageContent: {
      english: 'Business analysis and project planning methodology',
      spanish: 'Análisis empresarial y metodología de planificación de proyectos',
      french: 'Analyse d\'entreprise et méthodologie de planification de projet',
      german: 'Unternehmensanalyse und Projektplanungsmethodik',
      italian: 'Analisi aziendale e metodologia di pianificazione del progetto',
      portuguese: 'Análise de negócios e metodologia de planejamento de projetos',
      russian: 'Бизнес-анализ и методология планирования проектов',
      chinese: '商业分析和项目规划方法论',
      japanese: 'ビジネス分析とプロジェクト計画の方法論',
      korean: '비즈니스 분석 및 프로젝트 계획 방법론',
      arabic: 'تحليل الأعمال ومنهجية تخطيط المشاريع',
      hebrew: 'ניתוח עסקי ומתודולוגיית תכנון פרויקטים',
      hindi: 'व्यापार विश्लेषण और परियोजना योजना पद्धति',
      thai: 'การวิเคราะห์ธุรกิจและวิธีการวางแผนโครงการ'
    }
  };
}

// Network Conditions Simulator
export function simulateNetworkConditions(options: {
  bandwidth?: string;
  latency?: number;
  packetLoss?: number;
  jitter?: number;
  unstable?: boolean;
}) {
  const {
    bandwidth = '100Mbps',
    latency = 50,
    packetLoss = 0,
    jitter = 0,
    unstable = false
  } = options;

  return {
    wrapRequest: (requestAgent: any) => {
      return {
        ...requestAgent,
        timeout: (ms: number) => {
          // Simulate network delays
          const delay = latency + (jitter * Math.random());
          return requestAgent.timeout(ms + delay);
        }
      };
    },

    simulateDisconnection: (duration: number) => {
      console.log(`Simulating network disconnection for ${duration}ms`);
      // In real implementation, this would temporarily block network calls
      return new Promise(resolve => setTimeout(resolve, duration));
    },

    getNetworkStats: () => ({
      bandwidth,
      latency,
      packetLoss,
      jitter,
      unstable,
      quality: packetLoss > 0.1 ? 'POOR' : latency > 1000 ? 'SLOW' : 'GOOD'
    })
  };
}

// Memory Usage Monitor
export function monitorMemoryUsage() {
  const startMemory = process.memoryUsage();
  const measurements: Array<{ time: number; memory: NodeJS.MemoryUsage }> = [];
  
  const interval = setInterval(() => {
    measurements.push({
      time: Date.now(),
      memory: process.memoryUsage()
    });
  }, 5000); // Every 5 seconds

  return {
    getReport: () => {
      clearInterval(interval);
      
      if (measurements.length === 0) {
        return { error: 'No measurements taken' };
      }

      const latest = measurements[measurements.length - 1];
      const growthRate = measurements.length > 1 ? 
        (latest.memory.heapUsed - measurements[0].memory.heapUsed) / measurements.length * 720 : 0; // Per hour

      return {
        startMemory: startMemory.heapUsed,
        currentMemory: latest.memory.heapUsed,
        peakMemory: Math.max(...measurements.map(m => m.memory.heapUsed)),
        growthRatePerHour: Math.round(growthRate / 1024 / 1024 * 100) / 100, // MB/hour
        measurements: measurements.length,
        leakIndicators: {
          webSocketConnections: 0, // Would be populated in real implementation
          eventListeners: 0,
          domReferences: 0,
          cacheEntries: 0
        }
      };
    },

    cleanup: () => {
      clearInterval(interval);
    }
  };
}

// Chaos Simulator
export class ChaosSimulator {
  private enabled = false;
  private failures: Map<string, any> = new Map();

  enable() {
    this.enabled = true;
    console.log('Chaos engineering enabled');
  }

  disable() {
    this.enabled = false;
    console.log('Chaos engineering disabled');
  }

  async cleanup() {
    this.disable();
    this.failures.clear();
  }

  injectRandomFailures(services: string[], failureRate: number = 0.1) {
    if (!this.enabled) return;

    services.forEach(service => {
      if (Math.random() < failureRate) {
        const failureTypes = ['TIMEOUT', 'CONNECTION_ERROR', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'];
        const failureType = failureTypes[Math.floor(Math.random() * failureTypes.length)];
        
        this.failures.set(service, {
          type: failureType,
          injectedAt: Date.now(),
          duration: Math.random() * 30000 + 5000 // 5-35 seconds
        });

        console.log(`Injected ${failureType} failure into ${service}`);
      }
    });
  }

  isFailureActive(service: string): boolean {
    if (!this.enabled) return false;
    
    const failure = this.failures.get(service);
    if (!failure) return false;

    const elapsed = Date.now() - failure.injectedAt;
    if (elapsed > failure.duration) {
      this.failures.delete(service);
      return false;
    }

    return true;
  }

  getFailureType(service: string): string | null {
    const failure = this.failures.get(service);
    return failure ? failure.type : null;
  }
}

// Failure Injector
export class FailureInjector {
  private injectedFailures: Map<string, any> = new Map();
  private originalMethods: Map<string, any> = new Map();

  injectFailure(service: string, config: {
    type: string;
    duration: number;
    failureRate?: number;
    errorMessage?: string;
  }) {
    console.log(`Injecting failure into ${service}:`, config);
    
    this.injectedFailures.set(service, {
      ...config,
      injectedAt: Date.now()
    });

    // In a real implementation, this would mock the actual service methods
    // For now, we'll just store the configuration for tests to check
  }

  restoreService(service: string) {
    console.log(`Restoring service: ${service}`);
    this.injectedFailures.delete(service);
    
    // Restore original methods if they were mocked
    const originalMethod = this.originalMethods.get(service);
    if (originalMethod) {
      // Restore logic would go here
      this.originalMethods.delete(service);
    }
  }

  async restore() {
    // Restore all services
    for (const service of this.injectedFailures.keys()) {
      this.restoreService(service);
    }
    this.injectedFailures.clear();
  }

  isFailureActive(service: string): boolean {
    const failure = this.injectedFailures.get(service);
    if (!failure) return false;

    const elapsed = Date.now() - failure.injectedAt;
    return elapsed < failure.duration;
  }
}

// Test Environment Setup
export function setupEnhancedTestEnvironment() {
  // Configure test database
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/bmad_test';
  
  // Configure test Redis
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
  
  // Disable external services for testing
  process.env.DISABLE_EXTERNAL_SERVICES = 'true';
  process.env.MOCK_LLM_PROVIDERS = 'true';
  process.env.MOCK_PAYMENT_PROVIDER = 'true';
  
  // Set test-appropriate timeouts
  process.env.LLM_TIMEOUT = '10000';
  process.env.EXPORT_TIMEOUT = '30000';
  process.env.SESSION_TIMEOUT = '300000';
  
  // Enable detailed logging for tests
  process.env.LOG_LEVEL = 'debug';
  process.env.TEST_MODE = 'true';
  
  console.log('Enhanced test environment configured');
}