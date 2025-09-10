/**
 * Test Environment Setup
 * Environment variables and configuration for edge case testing
 */

// Database configuration for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/bmad_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';

// Disable external services during testing
process.env.DISABLE_EXTERNAL_SERVICES = 'true';
process.env.MOCK_LLM_PROVIDERS = 'true';
process.env.MOCK_STRIPE_PROVIDER = 'true';
process.env.MOCK_EMAIL_PROVIDER = 'true';
process.env.MOCK_MONITORING_PROVIDER = 'true';

// Test-specific timeouts (shorter for faster tests)
process.env.LLM_TIMEOUT = '10000';
process.env.EXPORT_TIMEOUT = '30000';
process.env.SESSION_TIMEOUT = '300000';
process.env.DATABASE_QUERY_TIMEOUT = '5000';
process.env.REDIS_TIMEOUT = '2000';

// Circuit breaker configuration for testing
process.env.CIRCUIT_BREAKER_THRESHOLD = '3';
process.env.CIRCUIT_BREAKER_TIMEOUT = '10000';
process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = '30000';

// Rate limiting configuration for testing
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '100';
process.env.RATE_LIMIT_SKIP_FAILED = 'true';

// Memory limits for testing
process.env.MAX_MEMORY_USAGE = '2GB';
process.env.MAX_EXPORT_SIZE = '100MB';
process.env.MAX_SESSION_SIZE = '50MB';

// Logging configuration
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'warn';
process.env.LOG_FORMAT = 'json';
process.env.DISABLE_COLORS = 'true';

// Security settings for testing
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long';
process.env.COOKIE_SECRET = 'test-cookie-secret-for-testing';

// File upload limits
process.env.MAX_FILE_SIZE = '10MB';
process.env.ALLOWED_FILE_TYPES = 'pdf,docx,txt,md,json';

// Email settings (mocked)
process.env.SMTP_HOST = 'mock-smtp.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'test@bmad.test';
process.env.SMTP_PASS = 'test-password';

// Payment settings (mocked)
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_stripe_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_secret';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_publishable_key';

// Monitoring settings (mocked)
process.env.SENTRY_DSN = 'https://mock-sentry-dsn@sentry.io/test';
process.env.DATADOG_API_KEY = 'mock-datadog-api-key';
process.env.ANALYTICS_API_KEY = 'mock-analytics-api-key';

// LLM Provider settings (mocked)
process.env.OPENAI_API_KEY = 'sk-test-mock-openai-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-mock-anthropic-key';
process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

// CDN and static file settings
process.env.CDN_BASE_URL = 'https://mock-cdn.test';
process.env.STATIC_FILE_BASE = '/tmp/test-static';

// Session configuration
process.env.SESSION_COOKIE_NAME = 'bmad-test-session';
process.env.SESSION_COOKIE_MAX_AGE = '86400000'; // 24 hours
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.SESSION_COOKIE_HTTP_ONLY = 'true';

// CORS configuration for testing
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.CORS_CREDENTIALS = 'true';

// WebSocket configuration
process.env.WS_PATH = '/socket.io';
process.env.WS_TRANSPORT = 'websocket,polling';
process.env.WS_CORS_ORIGIN = 'http://localhost:3000';

// Cache configuration
process.env.CACHE_TTL = '300'; // 5 minutes
process.env.CACHE_MAX_SIZE = '100MB';
process.env.CACHE_COMPRESSION = 'true';

// Performance monitoring
process.env.ENABLE_PERFORMANCE_MONITORING = 'true';
process.env.PERFORMANCE_SAMPLE_RATE = '1.0';
process.env.SLOW_QUERY_THRESHOLD = '1000';

// Feature flags for testing
process.env.ENABLE_CHAOS_TESTING = 'true';
process.env.ENABLE_MEMORY_MONITORING = 'true';
process.env.ENABLE_NETWORK_SIMULATION = 'true';
process.env.ENABLE_FAILURE_INJECTION = 'true';

// Test data configuration
process.env.TEST_DATA_SIZE = 'large';
process.env.GENERATE_UNICODE_TEST_DATA = 'true';
process.env.GENERATE_LARGE_DOCUMENTS = 'true';
process.env.SIMULATE_EDGE_CASES = 'true';

// Cleanup configuration
process.env.AUTO_CLEANUP_TEST_DATA = 'true';
process.env.CLEANUP_TEMP_FILES = 'true';
process.env.CLEANUP_TEST_UPLOADS = 'true';

console.log('🔧 Test environment variables configured for edge case testing');
console.log(`📊 Database: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`);
console.log(`🔴 Redis: ${process.env.REDIS_URL?.replace(/\/\/.*@/, '//***@')}`);
console.log(`🧪 Node Environment: ${process.env.NODE_ENV}`);
console.log(`📝 Log Level: ${process.env.LOG_LEVEL}`);
console.log(`💾 Max Memory: ${process.env.MAX_MEMORY_USAGE}`);
console.log(`⏱️  LLM Timeout: ${process.env.LLM_TIMEOUT}ms`);
console.log(`🌪️  Chaos Testing: ${process.env.ENABLE_CHAOS_TESTING}`);