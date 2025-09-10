# Epic 2: Agent Orchestration Engine

**Epic Goal:** Build the core BMAD agent workflow orchestration system that manages the intelligent conversation flow between analyst, PM, UX expert, and architect agents. This epic delivers the fundamental differentiating capability - seamless agent transitions that create comprehensive planning documents while maintaining natural conversation flow. Users will experience their first complete planning session from project input to basic document generation.

## Story 2.1: BMAD Agent Prompt Integration

As a system,  
I want to load and execute existing BMAD agent prompts programmatically,  
so that the platform can leverage proven methodology without rebuilding agent intelligence.

### Acceptance Criteria
1. BMAD agent prompts converted from markdown to structured JSON/YAML format
2. Agent prompt loader service that dynamically loads analyst, PM, UX expert, and architect prompts
3. Prompt template engine supporting variable substitution and context injection
4. Agent prompt validation ensuring all required fields and instructions are present
5. Version management for agent prompts with rollback capability
6. Agent prompt testing endpoints for validation and debugging
7. Error handling for malformed or missing agent prompts

## Story 2.2: LLM Integration with Dual Provider Support

As the orchestration system,  
I want reliable access to LLM capabilities with automatic failover,  
so that planning sessions never fail due to API provider issues.

### Acceptance Criteria
1. OpenAI API integration with GPT-4 model access and proper error handling
2. Anthropic Claude API integration as fallback provider
3. Automatic provider switching logic based on availability and response quality
4. Token usage tracking and cost monitoring across both providers
5. Request/response logging for debugging and quality assurance
6. Rate limiting and retry logic with exponential backoff
7. Provider health monitoring and status reporting

## Story 2.3: Session State Management

As a user,  
I want my planning session to remember our conversation and progress,  
so that I can pause, resume, and revise answers during the planning process.

### Acceptance Criteria
1. Session creation and management with unique session identifiers
2. Conversation history storage in Redis cache with PostgreSQL backup
3. Current agent state tracking (analyst, PM, UX expert, architect)
4. User response storage with ability to revise previous answers
5. Session expiration and cleanup policies
6. Session resumption from any point in the workflow
7. Conversation context management within LLM token limits

## Story 2.4: Agent Workflow Orchestration

As a user,  
I want to be guided through intelligent questions by different AI experts,  
so that I receive comprehensive planning without knowing the underlying methodology.

### Acceptance Criteria
1. Workflow engine implementing greenfield-fullstack.yaml sequence (analyst → PM → UX expert → architect)
2. Agent transition logic that passes context between specialized agents
3. Dynamic question generation based on user responses and current agent
4. Conversation flow management ensuring logical progression
5. Agent handoff prompts that maintain context and conversation quality
6. Workflow state persistence and recovery on system restart
7. Agent workflow testing and validation capabilities

## Story 2.5: Basic Document Generation

As a user,  
I want to see planning documents being created from our conversation,  
so that I understand the value being generated during the planning process.

### Acceptance Criteria
1. Document template engine using existing BMAD templates (project-brief, PRD, etc.)
2. Real-time document compilation from conversation history and agent outputs
3. Markdown document generation with proper formatting and structure
4. Document state management with version tracking
5. Basic document preview functionality accessible to user
6. Document content updating as conversation progresses
7. Error handling for document generation failures with user notification
