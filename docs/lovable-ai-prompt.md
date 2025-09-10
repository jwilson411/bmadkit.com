# BMAD Web UI Platform - Planning Theater Experience

## High-Level Goal
Create an innovative AI-powered project planning platform that makes users feel like they're managing their own expert consulting team. Build the core "Planning Theater" experience featuring real-time document streaming, conversational AI interactions, and progressive disclosure monetization - transforming complex project planning into an engaging, valuable consultation experience.

## Project Context & Tech Stack
- **Platform Purpose**: AI-powered project planning SaaS that orchestrates BMAD methodology through intuitive web interface
- **Target Users**: Non-technical project leaders, startup founders, small team managers
- **Core Experience**: 45-minute planning sessions generating professional deliverables (PRD, Architecture, User Stories)
- **Tech Stack**: React 18+ with TypeScript, Tailwind CSS, Socket.IO for real-time updates
- **Monetization**: Progressive disclosure (free → email capture → premium subscription)
- **Key Paradigm**: "AI Team Management" - users direct expert consultants, not use software tools

## Visual Design System
- **Aesthetic**: Clean, professional, sophisticated - conveys expertise and trustworthiness
- **Color Palette**: 
  - Primary: #2563eb (blue for AI agents, actions)
  - Secondary: #7c3aed (purple for premium features)  
  - Accent: #06b6d4 (cyan for real-time updates)
  - Success: #10b981, Warning: #f59e0b, Error: #ef4444
- **Typography**: Inter font family, professional clarity with 4px spacing system
- **Layout**: 12-column responsive grid, mobile-first approach
- **Icons**: Heroicons v2 for consistency

## Detailed Step-by-Step Implementation

### Phase 1: Core Landing & Planning Interface
1. **Create Landing Page Component** (`components/LandingPage.tsx`):
   - Hero section with aspirational hook: "Start making your dreams a reality"
   - Immediate project input field with placeholder: "Describe your project idea..."
   - Value proposition messaging emphasizing "AI expert team"
   - Clean, conversion-optimized layout with minimal distractions

2. **Build Planning Session Interface** (`components/PlanningSession.tsx`):
   - Split-screen layout: left chat panel, right document preview
   - Responsive: collapses to tabbed single-column on mobile/tablet
   - Top bar with agent status indicator showing current expert (Analyst/PM/UX/Architect)
   - WebSocket integration placeholder for real-time updates

3. **Create Conversational Chat Interface** (`components/ChatInterface.tsx`):
   - Chat bubble design with clear agent/user differentiation
   - Agent persona indicators with expert titles and avatars
   - Input area with smart suggestions and context help
   - Loading states: "Your AI Project Manager is analyzing..." with subtle animations
   - Handle long response times gracefully with engaging wait messages

4. **Build Real-time Document Viewer** (`components/DocumentViewer.tsx`):
   - Tabbed navigation for multiple documents (Project Brief, PRD, Architecture, Stories)
   - Live content streaming simulation with fade-in animations
   - Skeleton loading states during AI generation
   - Highlight new content additions with subtle color transitions
   - Mobile: modal overlay with smooth transitions

### Phase 2: Progressive Disclosure & Monetization
5. **Create Conversion Flow Modals** (`components/ConversionModals/`):
   - Email capture modal: "Unlock full document preview" with clear value prop
   - Payment modal: Premium features showcase with benefit callouts
   - Non-blocking design - users can continue planning while considering upgrade
   - Trust indicators, social proof elements, mobile-optimized forms

6. **Build Agent Status Component** (`components/AgentStatus.tsx`):
   - Visual indicator showing current AI expert working
   - Smooth transitions between agent phases with celebratory animations
   - Status messages: contextual updates reinforcing team management metaphor
   - Progress visualization without traditional progress bars - focus on value delivered

### Phase 3: Session Management & User Features  
7. **Create Account Dashboard** (`components/Dashboard.tsx`):
   - Session history with thumbnail previews of generated documents
   - Quick resume functionality for incomplete sessions
   - Account settings, billing management integration
   - Project templates for returning users

8. **Build Export Center** (`components/ExportCenter.tsx`):
   - Multi-format download options (Markdown, PDF, Word)
   - Preview before download functionality
   - Batch export for all session documents
   - Premium feature gating with upgrade prompts

## Code Examples & Constraints

### Component Structure Example:
```tsx
interface PlanningSessionProps {
  sessionId: string;
  currentAgent: 'analyst' | 'pm' | 'ux' | 'architect';
  isRealTimeConnected: boolean;
}

const PlanningSession: React.FC<PlanningSessionProps> = ({ 
  sessionId, 
  currentAgent, 
  isRealTimeConnected 
}) => {
  // Split-screen layout with responsive collapse
  // Real-time document updates via WebSocket
  // Agent transition animations
};
```

### API Integration Pattern:
```typescript
// WebSocket connection for real-time updates
const socket = io('/planning-session');
socket.on('document-update', (data) => {
  // Stream document changes with smooth animations
});

// REST endpoints for session management
POST /api/sessions - Start new planning session
GET /api/sessions/{id} - Resume existing session
POST /api/sessions/{id}/messages - Send user response to AI agent
```

### Mobile-First Responsive Patterns:
```css
/* Mobile-first chat interface */
.planning-interface {
  @apply flex flex-col h-screen;
}

/* Tablet+ split screen */
@screen md {
  .planning-interface {
    @apply flex-row;
  }
  .chat-panel { @apply w-1/2; }
  .document-panel { @apply w-1/2; }
}
```

## Strict Scope & Constraints

### DO Create These Files:
- `/components/LandingPage.tsx` - Hero section and project input
- `/components/PlanningSession.tsx` - Core split-screen planning interface  
- `/components/ChatInterface.tsx` - Conversational AI interaction
- `/components/DocumentViewer.tsx` - Real-time document streaming
- `/components/AgentStatus.tsx` - AI expert status indicator
- `/components/ConversionModals/` directory - Email/payment modals
- `/types/session.ts` - TypeScript interfaces for session data
- `/hooks/useWebSocket.ts` - Real-time connection management
- `/styles/animations.css` - Micro-interactions for AI transitions

### DO NOT Modify:
- Any existing backend API endpoints
- Authentication system (create placeholder integration points only)
- Payment processing logic (create UI mockups with Stripe placeholder)
- Database schema or data models

### Critical UX Requirements:
1. **AI Team Metaphor**: Every interaction must reinforce the "managing expert consultants" experience
2. **Real-time Anticipation**: Transform waiting time into valuable anticipation through live document generation
3. **Progressive Value**: Each phase must demonstrate increasing value to drive natural conversion
4. **Mobile Optimization**: Touch-friendly controls, swipe gestures, bottom-sheet modals
5. **Accessibility**: WCAG AA compliance with semantic HTML, ARIA labels, keyboard navigation
6. **Performance**: Skeleton screens during loading, efficient DOM updates for real-time content

### Animation & Micro-interaction Specifications:
- Document streaming: 300ms fade-in with slide-up
- Agent transitions: 500ms with loading descriptions  
- Phase completions: 400ms celebratory pulse
- Modal presentations: 250ms with backdrop blur
- All animations maintain 60fps with hardware acceleration

## Expected Deliverables

The AI should generate a sophisticated, production-quality frontend that:
✅ Implements the "Planning Theater" experience with real-time document streaming simulation  
✅ Creates engaging conversational interface with AI agent personas
✅ Builds responsive split-screen layout collapsing appropriately on mobile
✅ Includes progressive disclosure monetization modals with conversion optimization
✅ Demonstrates professional visual design with the specified color system and typography
✅ Implements smooth micro-interactions and loading states for AI processing simulation
✅ Provides accessibility features and semantic HTML structure
✅ Creates TypeScript interfaces and hooks for WebSocket integration points

Remember: This prompt generates the foundation. You'll iterate to refine components, add advanced features, and integrate with the actual backend API. Focus on creating a compelling user experience that makes project planning feel like an exciting consultation with AI experts rather than using a software tool.