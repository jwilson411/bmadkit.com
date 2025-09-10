/**
 * Jest Configuration for Edge Case Testing
 * Enhanced configuration for running advanced edge case tests
 * with specialized timeouts, memory monitoring, and chaos testing support
 */

const baseConfig = require('../../../jest.config.js');

module.exports = {
  ...baseConfig,
  
  // Edge case tests may take longer
  testTimeout: 120000, // 2 minutes per test
  
  // Run edge case tests in sequence to avoid resource conflicts
  maxWorkers: 1,
  
  // Only run edge case tests
  testMatch: [
    '**/tests/edge-cases/**/*.test.ts',
    '**/tests/integration/cross-story-integration.test.ts'
  ],
  
  // Setup for edge case testing
  setupFilesAfterEnv: [
    '<rootDir>/../../src/tests/config/edge-case-setup.ts'
  ],
  
  // Memory management for large tests
  workerIdleMemoryLimit: '2GB',
  
  // Environment variables for edge case testing
  setupFiles: [
    '<rootDir>/../../src/tests/config/test-env-setup.js'
  ],
  
  // Global test configuration
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
      isolatedModules: true
    },
    // Enable garbage collection for memory tests
    '__GC_ENABLED__': true
  },
  
  // Coverage settings optimized for edge cases
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/tests/**',
    '!src/**/*.test.{ts,tsx}',
    // Focus on edge case handling code
    'src/services/error-handler.ts',
    'src/services/circuit-breaker.ts',
    'src/middleware/error-handler.ts',
    'src/utils/retry-logic.ts'
  ],
  
  // Reporters for detailed edge case test results
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './test-results/edge-cases',
        filename: 'edge-case-test-report.html',
        expand: true,
        hideIcon: false,
        pageTitle: 'BMAD Edge Case Test Report'
      }
    ],
    [
      'jest-junit',
      {
        outputDirectory: './test-results/edge-cases',
        outputName: 'edge-case-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true
      }
    ]
  ],
  
  // Module name mapping for test utilities
  moduleNameMapper: {
    '^@/tests/(.*)$': '<rootDir>/../../src/tests/$1',
    '^@/fixtures/(.*)$': '<rootDir>/../../src/tests/fixtures/$1',
    '^@/edge-cases/(.*)$': '<rootDir>/../../src/tests/edge-cases/$1'
  },
  
  // Verbose output for edge case debugging
  verbose: true,
  
  // Custom test environment for resource monitoring
  testEnvironment: 'node',
  testEnvironmentOptions: {
    resourceMonitoring: true,
    memoryLeakDetection: true,
    networkSimulation: true
  }
};