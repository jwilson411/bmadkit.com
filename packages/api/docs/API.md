# BMAD API Documentation

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

### Response Format

All API responses follow this structure:

```typescript
interface ApiResponse {
  success: boolean;
  data?: any;           // Present on successful requests
  error?: {            // Present on failed requests
    message: string;
    code: string;
    correlationId: string;
    timestamp: string;
    details?: any;
  };
}
```

## Endpoints

### Health & Status

#### GET /health

Basic health check endpoint.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "uptime": 3600,
    "version": "1.0.0",
    "environment": "development"
  }
}
```

#### GET /api/v1/status

API status and version information.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "BMAD API is running",
    "version": "1.0.0",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

### Authentication (Coming Soon)

#### POST /api/v1/auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "subscriptionTier": "FREE"
    },
    "token": "jwt-token"
  }
}
```

#### POST /api/v1/auth/login

Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com", 
  "password": "SecurePassword123!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "subscriptionTier": "PREMIUM"
    },
    "token": "jwt-token"
  }
}
```

### Planning Sessions (Coming Soon)

#### POST /api/v1/sessions

Create a new planning session.

**Authentication Required:** Yes

**Request Body:**
```json
{
  "projectInput": "I want to build a mobile app for task management with AI features..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-uuid",
    "status": "ACTIVE",
    "currentAgent": "ANALYST",
    "projectInput": "I want to build a mobile app...",
    "progressPercentage": 0,
    "startedAt": "2024-01-01T12:00:00.000Z",
    "expiresAt": "2024-01-03T12:00:00.000Z"
  }
}
```

#### GET /api/v1/sessions/:id

Get planning session details.

**Authentication Required:** Yes

**Parameters:**
- `id` (UUID) - Session ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-uuid",
    "status": "ACTIVE",
    "currentAgent": "PM",
    "projectInput": "I want to build a mobile app...",
    "progressPercentage": 25,
    "sessionData": {
      "analysisComplete": true,
      "requirementsGathered": true
    },
    "startedAt": "2024-01-01T12:00:00.000Z",
    "expiresAt": "2024-01-03T12:00:00.000Z",
    "documents": [
      {
        "id": "doc-uuid",
        "type": "PROJECT_BRIEF",
        "title": "Mobile Task Management App",
        "status": "COMPLETED"
      }
    ]
  }
}
```

#### PUT /api/v1/sessions/:id

Update planning session.

**Authentication Required:** Yes

**Parameters:**
- `id` (UUID) - Session ID

**Request Body:**
```json
{
  "status": "PAUSED",
  "sessionData": {
    "userFeedback": "Please focus more on the AI features"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-uuid",
    "status": "PAUSED",
    "updatedAt": "2024-01-01T13:00:00.000Z"
  }
}
```

### Documents (Coming Soon)

#### GET /api/v1/sessions/:sessionId/documents

List all documents for a planning session.

**Authentication Required:** Yes

**Parameters:**
- `sessionId` (UUID) - Planning session ID

**Query Parameters:**
- `type` (optional) - Filter by document type
- `status` (optional) - Filter by document status
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "doc-uuid",
        "type": "PROJECT_BRIEF",
        "title": "Mobile Task Management App",
        "status": "COMPLETED",
        "version": 1,
        "createdAt": "2024-01-01T12:00:00.000Z",
        "updatedAt": "2024-01-01T12:30:00.000Z"
      },
      {
        "id": "doc-uuid-2",
        "type": "PRD", 
        "title": "Product Requirements Document",
        "status": "GENERATING",
        "version": 1,
        "createdAt": "2024-01-01T12:30:00.000Z",
        "updatedAt": "2024-01-01T12:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "totalPages": 1
    }
  }
}
```

#### GET /api/v1/documents/:id

Get document by ID with full content.

**Authentication Required:** Yes

**Parameters:**
- `id` (UUID) - Document ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "doc-uuid",
    "type": "PROJECT_BRIEF",
    "title": "Mobile Task Management App",
    "content": "## Project Overview\n\nThis project aims to...",
    "status": "COMPLETED",
    "version": 1,
    "exportFormats": ["pdf", "docx", "markdown"],
    "createdAt": "2024-01-01T12:00:00.000Z",
    "updatedAt": "2024-01-01T12:30:00.000Z",
    "session": {
      "id": "session-uuid",
      "projectInput": "I want to build a mobile app..."
    }
  }
}
```

#### POST /api/v1/documents/:id/export

Export document in specified format.

**Authentication Required:** Yes

**Parameters:**
- `id` (UUID) - Document ID

**Request Body:**
```json
{
  "format": "pdf",
  "options": {
    "includeMetadata": true,
    "template": "professional"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://api.bmad.com/downloads/doc-uuid.pdf",
    "expiresAt": "2024-01-01T18:00:00.000Z",
    "format": "pdf",
    "fileSize": 245760
  }
}
```

## Error Codes

| Code | Description | Status Code |
|------|-------------|-------------|
| `VALIDATION_ERROR` | Request validation failed | 400 |
| `UNAUTHORIZED` | Authentication required | 401 |
| `FORBIDDEN` | Access denied | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 |
| `SUBSCRIPTION_REQUIRED` | Upgrade subscription needed | 403 |
| `INTERNAL_SERVER_ERROR` | Server error | 500 |

## Rate Limiting

The API implements rate limiting to ensure fair usage:

- **Default**: 100 requests per 15-minute window per IP
- **Authenticated**: Higher limits based on subscription tier
- **Premium users**: 1000 requests per 15-minute window

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Request limit
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset time

## Webhooks (Coming Soon)

The API will support webhooks for real-time notifications:

### Session Events
- `session.created` - New planning session created
- `session.updated` - Session status changed
- `session.completed` - Session finished
- `session.failed` - Session encountered error

### Document Events
- `document.created` - New document generated
- `document.updated` - Document content updated
- `document.completed` - Document generation finished

### Agent Events
- `agent.started` - Agent execution began
- `agent.completed` - Agent finished task
- `agent.failed` - Agent encountered error

## SDKs and Libraries

Official SDKs will be available for:
- JavaScript/TypeScript (Node.js and Browser)
- Python
- Go
- PHP

Community SDKs:
- Ruby
- Java
- C#