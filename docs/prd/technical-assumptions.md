# Technical Assumptions

## Repository Structure: Monorepo
**Rationale:** Monorepo structure supports shared types and utilities between frontend and backend while maintaining clear separation. Aligns with modern development practices for full-stack applications and simplifies deployment coordination for real-time features requiring frontend/backend synchronization.

## Service Architecture
**CRITICAL DECISION - Orchestrator API with Real-time Services:** Hybrid architecture consisting of:
- RESTful API endpoints for session management and document CRUD operations
- WebSocket services for real-time document streaming and progress updates  
- Orchestration service managing BMAD agent workflow execution
- Session state management via Redis cache with PostgreSQL persistence
- Microservices pattern for agent execution to enable independent scaling and LLM provider failover

## Testing Requirements
**CRITICAL DECISION - Unit + Integration Testing:** Comprehensive testing strategy including:
- Unit tests for individual agent orchestration logic and document generation
- Integration tests for LLM API interactions and workflow sequencing
- End-to-end testing for complete planning session flows
- Load testing for concurrent session handling and real-time streaming performance
- Manual testing convenience methods for agent prompt validation and document quality assurance

## Additional Technical Assumptions and Requests

**Frontend Technology Stack:**
- **Primary Framework:** React with TypeScript for type safety and component reusability
- **Real-time Communication:** Socket.IO client for WebSocket connections and fallback support
- **State Management:** Redux Toolkit for session state and document management
- **Styling:** Tailwind CSS for rapid responsive design implementation
- **Build/Deploy:** Vite for fast development and CDN-optimized production builds

**Backend Technology Stack:**
- **Runtime:** Node.js with Express framework for familiar JavaScript development
- **LLM Integration:** OpenAI SDK (primary) with Anthropic SDK (fallback) and automatic switching logic
- **Database:** PostgreSQL for persistent data with Prisma ORM for type-safe database operations
- **Caching:** Redis for session state and conversation history with configurable TTL
- **Authentication:** JWT-based authentication with optional social login (Google, GitHub)

**Infrastructure and Deployment:**
- **Hosting:** Vercel for frontend CDN deployment, Railway/Render for backend API hosting
- **Environment Management:** Separate staging and production environments with feature flag support
- **Monitoring:** Application performance monitoring with error tracking and LLM usage analytics
- **Security:** HTTPS enforcement, API rate limiting, input sanitization, and secure session management

**BMAD Integration Specifics:**
- **Agent Prompt Loading:** Dynamic loading of existing BMAD agent prompts from structured JSON/YAML format
- **Template Processing:** Conversion of existing BMAD templates to programmatic document generation
- **Workflow Engine:** State machine implementation for managing agent transitions and conversation flow
- **Document Generation:** Real-time markdown compilation with live preview and export capabilities
