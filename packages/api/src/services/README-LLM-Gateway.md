# LLM Gateway System

## Overview

The LLM Gateway provides enterprise-grade access to multiple LLM providers (OpenAI and Anthropic) with automatic failover, cost monitoring, rate limiting, and comprehensive logging.

## Features

### 🔄 **Dual Provider Support**
- **OpenAI**: GPT-4, GPT-4 Turbo with full API compatibility
- **Anthropic**: Claude 3 (Opus, Sonnet, Haiku) with prompt translation
- **Automatic Failover**: Intelligent provider switching based on health metrics

### 🛡️ **Enterprise Reliability**
- **Circuit Breaker Pattern**: Prevents cascade failures
- **Exponential Backoff**: Smart retry logic with jitter
- **Health Monitoring**: Real-time provider health scoring
- **Rate Limiting**: Token bucket algorithm with per-provider limits

### 📊 **Monitoring & Observability**
- **Cost Tracking**: Real-time token usage and cost monitoring
- **Performance Metrics**: Latency, success rates, error analytics
- **Privacy-Compliant Logging**: PII masking and configurable retention
- **Structured Logging**: JSON format with correlation IDs

## Configuration

### Environment Variables

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_ORGANIZATION=org-your-org-id (optional)

# Anthropic Configuration
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key

# Gateway Configuration
PRIMARY_LLM_PROVIDER=openai # or anthropic
ENABLE_LLM_FAILOVER=true
ENABLE_LLM_CACHING=true
```

## API Usage

### Chat Completions

```bash
POST /api/v1/llm/chat/completions
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user", 
      "content": "Hello, how are you?"
    }
  ],
  "model": "gpt-4",
  "maxTokens": 150,
  "temperature": 0.7,
  "provider": "openai" // optional - auto-selected if not specified
}
```

### Health Check

```bash
GET /api/v1/llm/health
Authorization: Bearer your-jwt-token

# Response
{
  "success": true,
  "data": {
    "overall": "healthy",
    "providers": {
      "openai": {
        "status": "healthy",
        "latency": 245,
        "successRate": 0.98,
        "errorRate": 0.02
      },
      "anthropic": {
        "status": "healthy", 
        "latency": 312,
        "successRate": 0.97,
        "errorRate": 0.03
      }
    }
  }
}
```

### Metrics

```bash
GET /api/v1/llm/metrics?provider=openai&period=day
Authorization: Bearer your-jwt-token

# Response
{
  "success": true,
  "data": {
    "gateway": {
      "totalRequests": 1250,
      "successfulRequests": 1225,
      "failedRequests": 25,
      "averageLatency": 285,
      "totalCost": 12.45,
      "uptime": 86400
    },
    "performance": {
      "provider": "openai",
      "totalRequests": 800,
      "averageLatency": 245,
      "p95Latency": 450,
      "totalCost": 8.32,
      "topModels": [
        {
          "model": "gpt-4",
          "count": 600,
          "avgLatency": 250
        }
      ]
    }
  }
}
```

## Rate Limiting

The system implements multiple layers of rate limiting:

### Global Rate Limits
- **120 requests/minute** across all providers
- **200K tokens/minute** total

### Per-Provider Rate Limits
- **OpenAI**: 60 requests/minute, 100K tokens/minute
- **Anthropic**: 60 requests/minute, 100K tokens/minute

### Headers
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1641234567000
X-RateLimit-Provider: openai
```

## Error Handling

### Circuit Breaker States
- **CLOSED**: Normal operation
- **OPEN**: Provider temporarily disabled
- **HALF_OPEN**: Testing if provider has recovered

### Error Types
- `rate_limit_error`: Rate limit exceeded (retryable)
- `authentication_error`: Invalid API key (not retryable)
- `service_unavailable`: Provider down (retryable, triggers failover)
- `timeout_error`: Request timeout (retryable)
- `context_length_error`: Input too long (not retryable)

## Cost Monitoring

### Real-Time Cost Tracking
```javascript
{
  "cost": {
    "promptCost": 0.015,      // Cost for input tokens
    "completionCost": 0.045,  // Cost for output tokens
    "totalCost": 0.060,       // Total request cost
    "currency": "USD"
  }
}
```

### Pricing (per 1K tokens, as of Sept 2024)
- **GPT-4**: $0.03 input, $0.06 output
- **GPT-4 Turbo**: $0.01 input, $0.03 output
- **Claude 3 Opus**: $0.015 input, $0.075 output
- **Claude 3 Sonnet**: $0.003 input, $0.015 output

## Logging & Privacy

### Privacy-Compliant Logging
- **PII Masking**: Emails, phones, addresses automatically masked
- **Content Truncation**: Long content truncated to prevent log bloat
- **Retention Policy**: Configurable log retention (default 30 days)

### Log Types
- **Request Logs**: Input parameters, estimated tokens
- **Response Logs**: Output content (masked), token usage, costs
- **Error Logs**: Error details, retry information

## Programmatic Usage

### Initialize Gateway
```typescript
import { createLLMGateway } from './services/llm-gateway';

const gateway = createLLMGateway({
  providers: {
    openai: {
      enabled: true,
      apiKey: process.env.OPENAI_API_KEY!
    },
    anthropic: {
      enabled: true,
      apiKey: process.env.ANTHROPIC_API_KEY!
    }
  },
  gateway: {
    primaryProvider: 'openai',
    enableFailover: true,
    enableCaching: true
  }
});

await gateway.initialize();
```

### Send Completion
```typescript
const messages = [
  { role: 'user', content: 'Hello!' }
];

const response = await gateway.complete(messages, {
  maxTokens: 150,
  temperature: 0.7
});

console.log(response.content);
console.log(`Cost: $${response.cost.totalCost}`);
```

## Monitoring & Alerts

### Health Monitoring
- **Automated Health Checks**: Every 30 seconds
- **Health Scoring**: Based on latency, error rate, consecutive failures
- **Auto-Recovery**: Automatic provider re-enablement when healthy

### Alert Thresholds
- **Error Rate**: >10% triggers degraded status
- **Latency**: >5 seconds triggers performance alerts
- **Cost**: >$100/hour triggers cost alerts

## Security

### Authentication
- **JWT Tokens**: Required for all endpoints
- **Role-Based Access**: Admin-only endpoints for sensitive operations

### API Key Management
- **Environment Variables**: Secure storage of provider API keys
- **Key Rotation**: Support for key rotation without downtime

## Development

### Testing Providers
```bash
POST /api/v1/llm/test
Authorization: Bearer admin-jwt-token

# Sends test message to verify provider connectivity
```

### Clear Cache
```bash
POST /api/v1/llm/cache/clear
Authorization: Bearer admin-jwt-token
```

### View Logs (Admin Only)
```bash
GET /api/v1/llm/logs?startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z
Authorization: Bearer admin-jwt-token
```

## Troubleshooting

### Common Issues

1. **Provider Not Responding**
   - Check API key validity
   - Verify network connectivity
   - Check rate limit status

2. **High Latency**
   - Review provider health metrics
   - Check network conditions
   - Consider provider switching

3. **Rate Limit Errors**
   - Reduce request frequency
   - Implement request queuing
   - Use multiple providers

### Debug Endpoints
- `GET /api/v1/llm/status`: Basic system status
- `GET /api/v1/llm/health`: Detailed provider health
- `GET /api/v1/llm/metrics`: Performance metrics

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Client    │───▶│   LLM Gateway    │───▶│   OpenAI API    │
└─────────────────┘    │                  │    └─────────────────┘
                       │  ┌─────────────┐ │    ┌─────────────────┐
                       │  │ Rate Limiter│ │───▶│ Anthropic API   │
                       │  └─────────────┘ │    └─────────────────┘
                       │  ┌─────────────┐ │
                       │  │Health Monitor│ │
                       │  └─────────────┘ │
                       │  ┌─────────────┐ │
                       │  │Circuit Breaker│ │
                       │  └─────────────┘ │
                       └──────────────────┘
```

This LLM Gateway provides production-ready infrastructure for reliable, cost-effective, and monitored access to multiple LLM providers with automatic failover capabilities.