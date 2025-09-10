# Session State Management System

## Overview

The Session Management system provides comprehensive state management for 45-minute planning sessions with pause/resume capabilities, conversation history tracking, and agent state persistence.

## Features

### 🔄 **Session Lifecycle Management**
- **Create**: Initialize new planning sessions with unique identifiers
- **Pause/Resume**: Suspend and restore sessions from any point
- **Complete**: Finalize sessions with analytics generation
- **Delete**: Clean session data with proper resource cleanup

### 💾 **Dual Storage Strategy**
- **Redis Cache**: High-performance in-memory storage for active sessions
- **PostgreSQL Backup**: Persistent storage for reliability and recovery
- **Data Consistency**: Dual-write pattern with conflict resolution
- **Compression**: Automatic data compression for large conversations

### 🗣️ **Conversation Management**
- **Message Tracking**: Complete conversation history with metadata
- **Message Revisions**: User can edit responses with impact analysis
- **Token Optimization**: Automatic context window management within LLM limits
- **Conversation Analytics**: Usage patterns, response times, and metrics

### 🤖 **Agent State Tracking**
- **Workflow Progression**: Track current agent (Analyst → PM → UX Expert → Architect)
- **Agent Transitions**: Manage handoffs between agents with context preservation
- **Progress Monitoring**: Real-time progress percentage based on agent completion
- **State Persistence**: Maintain agent context across session interruptions

### ⏰ **Background Processing**
- **Session Cleanup**: Automated expiration and cleanup using Bull Queue
- **Health Monitoring**: Continuous system health checks and metrics
- **Resource Management**: Memory and storage leak prevention
- **Performance Optimization**: Cache maintenance and optimization

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Session Management                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐  │
│  │ Session Manager │    │Conversation Mgr │    │Token Limiter│  │
│  │                 │    │                 │    │             │  │
│  │ • Create        │    │ • Add Messages  │    │ • Context   │  │
│  │ • Pause/Resume  │◄──►│ • Revisions     │◄──►│   Optimization│  │
│  │ • State Track   │    │ • Analytics     │    │ • Token     │  │
│  │ • Cleanup       │    │ • Search        │    │   Limiting  │  │
│  └─────────────────┘    └─────────────────┘    └─────────────┘  │
│           │                       │                       │     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐  │
│  │  Session Cache  │    │Background Cleanup│    │Agent States │  │
│  │                 │    │                 │    │             │  │
│  │ • Redis Storage │    │ • Bull Queue    │    │ • Workflow  │  │
│  │ • Compression   │    │ • Scheduling    │    │ • Progress  │  │
│  │ • Locking       │    │ • Health Checks │    │ • Transitions│  │
│  │ • TTL Management│    │ • Metrics       │    │ • Context   │  │
│  └─────────────────┘    └─────────────────┘    └─────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# Session Configuration
SESSION_MAX_DURATION=2700000  # 45 minutes in milliseconds
SESSION_CLEANUP_GRACE_PERIOD=3600000  # 1 hour grace period
SESSION_AUTO_SAVE_INTERVAL=30000  # 30 seconds

# Token Management
MAX_CONTEXT_TOKENS=8000
MAX_MESSAGE_TOKENS=2000
SUMMARIZATION_THRESHOLD=6000
```

### Session Configuration Options

```typescript
interface SessionConfig {
  maxDuration: number;           // 45 minutes default
  maxMessages: number;           // 500 messages default
  maxTokensPerSession: number;   // 100k tokens default
  autoSaveInterval: number;      // 30 seconds
  cleanupGracePeriod: number;    // 24 hours
  contextWindowSize: number;     // 8000 tokens
  enableAutoSummarization: boolean;
  enableUserRevisions: boolean;
  enableAnalytics: boolean;
}
```

## API Usage

### Create Session

```bash
POST /api/v1/sessions
Content-Type: application/json
Authorization: Bearer your-jwt-token

{
  "projectInput": "Build a task management app for remote teams",
  "projectName": "TaskFlow Pro",
  "userId": "user-uuid-here",
  "metadata": {
    "source": "web_app",
    "priority": "high"
  }
}

# Response
{
  "success": true,
  "data": {
    "session": {
      "id": "session_1699123456789_abc123",
      "userId": "user-uuid-here",
      "projectInput": "Build a task management app...",
      "status": "ACTIVE",
      "currentAgent": "ANALYST",
      "progressPercentage": 0,
      "expiresAt": "2024-11-05T12:45:00.000Z",
      "createdAt": "2024-11-05T11:00:00.000Z"
    },
    "contextWindow": {
      "totalTokens": 25,
      "retainedMessages": 1,
      "optimizationApplied": false
    },
    "estimatedDuration": 2700000
  }
}
```

### Add Message

```bash
POST /api/v1/sessions/{sessionId}/messages
Content-Type: application/json

{
  "sender": "USER",
  "content": "I want to focus on mobile-first design with offline capabilities",
  "metadata": {
    "inputMethod": "voice",
    "confidence": 0.95
  }
}

# Response
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_1699123456789_def456",
      "sessionId": "session_1699123456789_abc123",
      "sender": "USER",
      "content": "I want to focus on mobile-first...",
      "sequenceNumber": 1,
      "tokenCount": 18,
      "createdAt": "2024-11-05T11:05:00.000Z"
    },
    "tokenUsage": {
      "messageTokens": 18,
      "totalTokens": 43,
      "remainingTokens": 7957
    }
  }
}
```

### Pause Session

```bash
POST /api/v1/sessions/{sessionId}/pause

# Response
{
  "success": true,
  "data": {
    "session": {
      "id": "session_1699123456789_abc123",
      "status": "PAUSED",
      "pausedAt": "2024-11-05T11:15:00.000Z",
      "progressPercentage": 25
    }
  }
}
```

### Resume Session

```bash
POST /api/v1/sessions/{sessionId}/resume
Content-Type: application/json

{
  "resumePoint": "current",
  "validateIntegrity": true
}

# Response
{
  "success": true,
  "data": {
    "session": {
      "id": "session_1699123456789_abc123",
      "status": "ACTIVE",
      "pausedAt": null,
      "currentAgent": "ANALYST"
    },
    "messages": [...], // Last 10 messages
    "contextWindow": {
      "totalTokens": 1250,
      "retainedMessages": 15,
      "summary": "**Conversation Summary (20 messages)**..."
    },
    "resumePoint": "current"
  }
}
```

### Revise Message

```bash
PUT /api/v1/sessions/{sessionId}/messages/{messageId}
Content-Type: application/json

{
  "content": "I want to focus on mobile-first design with both offline capabilities and real-time collaboration",
  "reason": "Added collaboration requirement",
  "metadata": {
    "revisionType": "enhancement"
  }
}

# Response
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_1699123456789_def456",
      "content": "I want to focus on mobile-first...",
      "isRevised": true,
      "revisionNumber": 2,
      "tokenCount": 28
    },
    "revision": {
      "id": "rev_1699123456789_ghi789",
      "revisionNumber": 2,
      "revisionReason": "Added collaboration requirement",
      "reprocessingRequired": true
    },
    "impact": {
      "affectedMessages": ["msg_xyz", "msg_abc"],
      "reprocessingRequired": true,
      "estimatedTokenImpact": 450
    }
  }
}
```

## Token Management

### Context Optimization

The token limiter automatically optimizes conversation context:

1. **Under Token Limit**: All messages retained
2. **Approaching Limit**: Recent messages prioritized
3. **Over Limit**: Summarization triggered

```typescript
// Example context optimization
const contextWindow = {
  messages: [
    // Recent messages (always retained)
    { id: "msg_recent1", content: "...", tokenCount: 50 },
    { id: "msg_recent2", content: "...", tokenCount: 75 }
  ],
  totalTokens: 1250,
  summarizedTokens: 350,
  retainedMessages: 10,
  summary: "**Conversation Summary (25 messages)**\n\n**User Inputs:**\n• Build task management app for remote teams\n• Focus on mobile-first design...",
  optimizationApplied: true
}
```

### Summarization Strategies

- **Structured Summary**: Organized by user inputs and agent transitions
- **Priority Retention**: System messages and recent interactions preserved
- **Token Budget**: Configurable compression ratios
- **Content Preservation**: Key decisions and requirements highlighted

## Message Revisions

### Revision Tracking

```typescript
interface MessageRevision {
  revisionHistory: [
    {
      revisionNumber: 1,
      content: "Original message content",
      timestamp: "2024-11-05T11:05:00.000Z",
      reason: undefined
    },
    {
      revisionNumber: 2,
      content: "Revised message content",
      timestamp: "2024-11-05T11:25:00.000Z",
      reason: "Added collaboration requirement"
    }
  ]
}
```

### Impact Analysis

When messages are revised, the system analyzes:
- **Affected Messages**: Subsequent agent responses
- **Reprocessing Required**: Whether agent outputs need regeneration
- **Token Impact**: Estimated token usage for reprocessing
- **Agent Context**: Which agents need updated context

## Background Processing

### Session Cleanup Jobs

```typescript
// Cleanup job types
enum CleanupJobType {
  EXPIRED_SESSIONS = 'expired-sessions',      // Every 15 minutes
  INACTIVE_SESSIONS = 'inactive-sessions',    // Every 6 hours  
  CACHE_MAINTENANCE = 'cache-maintenance',    // Every hour
  HEALTH_CHECK = 'health-check'              // Every 5 minutes
}
```

### Cleanup Policies

- **Expired Sessions**: 1-hour grace period after expiration
- **Inactive Sessions**: 24-hour inactivity threshold
- **Cache Maintenance**: Memory optimization and key cleanup
- **Health Monitoring**: System status and alerting

## Analytics & Metrics

### Session Analytics

```bash
GET /api/v1/sessions/{sessionId}/analytics

{
  "success": true,
  "data": {
    "analytics": {
      "sessionId": "session_1699123456789_abc123",
      "totalMessages": 45,
      "messagesByAgent": {
        "USER": 15,
        "ANALYST": 10,
        "PM": 12,
        "UX_EXPERT": 8
      },
      "averageMessageLength": 125.6,
      "totalRevisions": 3,
      "conversationDuration": 2100000, // 35 minutes
      "responsePatterns": {
        "averageUserResponseTime": 45000,    // 45 seconds
        "averageAgentResponseTime": 8500     // 8.5 seconds
      }
    }
  }
}
```

### System Health

```bash
GET /api/v1/sessions/health (Admin only)

{
  "success": true,
  "data": {
    "sessions": {
      "activeSessions": 25,
      "cacheStats": {
        "connected": true,
        "memory": { "used": 52428800, "peak": 67108864 },
        "keyspace": { "sessions": 25, "messages": 150, "agentStates": 100 }
      }
    },
    "queue": {
      "waiting": 2,
      "active": 1,
      "completed": 145,
      "failed": 3
    },
    "cleanup": {
      "totalCleanups": 48,
      "totalSessionsProcessed": 250,
      "totalSessionsDeleted": 12,
      "averageCleanupDuration": 1250,
      "lastCleanupAt": "2024-11-05T10:30:00.000Z"
    }
  }
}
```

## Error Handling

### Common Error Scenarios

1. **Session Not Found**: 404 with SESSION_NOT_FOUND code
2. **Access Denied**: 403 when user doesn't own session
3. **Invalid State**: 400 when operation not allowed in current state
4. **Token Limit Exceeded**: 400 with MESSAGE_TOO_LONG code
5. **Revision Limit Exceeded**: 400 when max revisions reached
6. **Session Expired**: 400 when session past expiration

### Recovery Strategies

- **Cache Miss**: Fallback to database lookup
- **Lock Timeout**: Retry with exponential backoff
- **Memory Pressure**: Automatic cache eviction
- **Queue Overflow**: Priority-based processing

## Development

### Programmatic Usage

```typescript
import { sessionManager } from './services/session-manager';
import { conversationHistory } from './services/conversation-history';

// Create session
const result = await sessionManager.createSession({
  projectInput: "Build a task management app",
  userId: "user-123"
});

// Add message
const message = await conversationHistory.addMessage({
  sessionId: result.session.id,
  sender: 'USER',
  content: "Focus on mobile-first design"
});

// Pause and resume
await sessionManager.pauseSession(result.session.id);
const resumed = await sessionManager.resumeSession(result.session.id);
```

### Testing Integration

```typescript
// Test session lifecycle
const session = await createTestSession();
await addTestMessage(session.id, "Test input");
await pauseSession(session.id);
const resumedSession = await resumeSession(session.id);
expect(resumedSession.status).toBe('ACTIVE');
```

## Performance Considerations

### Optimization Features

- **LRU Caching**: Automatic eviction of least-used sessions
- **Data Compression**: gzip compression for large conversations
- **Distributed Locking**: Prevents concurrent access conflicts  
- **Token Optimization**: Smart context window management
- **Background Processing**: Non-blocking cleanup operations

### Monitoring

- **Memory Usage**: Redis memory consumption tracking
- **Response Times**: API endpoint performance metrics
- **Error Rates**: Success/failure ratios
- **Queue Health**: Background job processing status
- **Cache Hit Ratio**: Redis cache effectiveness

This Session Management system provides enterprise-grade state management for the BMAD planning sessions, enabling reliable 45-minute conversations with comprehensive pause/resume capabilities and intelligent conversation optimization.