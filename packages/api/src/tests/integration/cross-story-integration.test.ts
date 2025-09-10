/**
 * Cross-Story Integration Tests - Phase 1 Critical Production Gaps
 * Test ID: CROSS-001 to CROSS-005
 * Priority: P0 - Production Blocking
 * 
 * Tests the critical user workflows that span multiple stories:
 * - Payment → Premium Features → Export workflow
 * - Agent Workflow → Document Streaming → Export pipeline  
 * - Session State → Error Recovery → Premium Features
 * - Authentication → Payment → Monitoring correlation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { app } from '../../app';
import { createMockSession, createMockUser, createMockPayment } from '../fixtures/test-data';

describe('Cross-Story Integration Tests - Critical Production Workflows', () => {
  let prisma: PrismaClient;
  let server: any;
  let io: Server;
  let authToken: string;
  let userId: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    server = createServer(app);
    io = new Server(server);
    
    // Create test user and auth token
    const user = await createMockUser(prisma);
    userId = user.id;
    authToken = generateTestJWT(user.id);
  });

  afterEach(async () => {
    await prisma.planningSession.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    server.close();
  });

  describe('CROSS-001: Payment → Premium → Export Workflow', () => {
    it('should handle complete upgrade and export workflow without data loss', async () => {
      // Step 1: Create free planning session
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Test project for premium upgrade flow' })
        .expect(201);

      const sessionId = sessionResponse.body.data.id;

      // Step 2: Generate content that would exceed free limits
      await request(app)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Generate comprehensive business plan', agentType: 'ANALYST' })
        .expect(201);

      // Step 3: Attempt export - should hit free limit
      const freeExportResponse = await request(app)
        .post(`/api/sessions/${sessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' })
        .expect(403);

      expect(freeExportResponse.body.error.code).toBe('PREMIUM_REQUIRED');

      // Step 4: Initiate payment flow
      const paymentResponse = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          planType: 'PREMIUM_MONTHLY',
          sessionId,
          returnUrl: 'https://bmad.com/success'
        })
        .expect(201);

      const paymentIntentId = paymentResponse.body.data.paymentIntentId;

      // Step 5: Simulate successful payment webhook
      await request(app)
        .post('/api/payments/webhook')
        .send({
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: paymentIntentId,
              metadata: { userId, planType: 'PREMIUM_MONTHLY' }
            }
          }
        })
        .expect(200);

      // Step 6: Verify premium features activated immediately
      const userStatusResponse = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(userStatusResponse.body.data.subscription.status).toBe('ACTIVE');
      expect(userStatusResponse.body.data.subscription.planType).toBe('PREMIUM_MONTHLY');

      // Step 7: Export should now succeed with all formats
      const exportFormats = ['PDF', 'DOCX', 'MARKDOWN', 'JSON'];
      
      for (const format of exportFormats) {
        const exportResponse = await request(app)
          .post(`/api/sessions/${sessionId}/export`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ format })
          .expect(200);

        expect(exportResponse.body.data.downloadUrl).toBeDefined();
        expect(exportResponse.body.data.format).toBe(format);
      }

      // Step 8: Verify export history tracking
      const historyResponse = await request(app)
        .get(`/api/sessions/${sessionId}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(historyResponse.body.data.exports).toHaveLength(4);
    });

    it('should handle payment success with feature activation failure gracefully', async () => {
      // Edge case: Payment succeeds but feature activation fails
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Test payment success edge case' });

      const sessionId = sessionResponse.body.data.id;

      // Mock feature activation service failure
      jest.spyOn(require('../../services/premium-features'), 'activatePremiumFeatures')
        .mockRejectedValueOnce(new Error('Feature activation service unavailable'));

      const paymentResponse = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planType: 'PREMIUM_MONTHLY', sessionId });

      // Webhook should still succeed but queue retry
      await request(app)
        .post('/api/payments/webhook')
        .send({
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: paymentResponse.body.data.paymentIntentId,
              metadata: { userId, planType: 'PREMIUM_MONTHLY' }
            }
          }
        })
        .expect(200);

      // User should get notification about delayed activation
      const notificationsResponse = await request(app)
        .get('/api/users/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(notificationsResponse.body.data.notifications.some(
        (n: any) => n.type === 'PAYMENT_SUCCESS_ACTIVATION_PENDING'
      )).toBe(true);
    });

    it('should handle concurrent session during upgrade without data corruption', async () => {
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Concurrent upgrade test' });

      const sessionId = sessionResponse.body.data.id;

      // Simulate concurrent operations: payment processing and session updates
      const paymentPromise = request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planType: 'PREMIUM_MONTHLY', sessionId });

      const sessionUpdatePromise = request(app)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Continue working during payment', agentType: 'PM' });

      const [paymentResult, sessionResult] = await Promise.all([
        paymentPromise,
        sessionUpdatePromise
      ]);

      expect(paymentResult.status).toBe(201);
      expect(sessionResult.status).toBe(201);

      // Verify session data integrity
      const sessionCheck = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(sessionCheck.body.data.messages).toBeDefined();
      expect(sessionCheck.body.data.status).toBe('ACTIVE');
    });
  });

  describe('CROSS-002: Agent Workflow → Document Streaming → Export Pipeline', () => {
    it('should maintain document consistency during real-time updates and export', async () => {
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Real-time document streaming test' });

      const sessionId = sessionResponse.body.data.id;

      // Enable premium for export capability
      await activatePremiumForUser(userId);

      // Step 1: Start agent workflow with document generation
      const analystResponse = await request(app)
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'ANALYST', prompt: 'Analyze comprehensive market research' })
        .expect(200);

      // Step 2: Initiate export during agent processing
      const exportPromise = request(app)
        .post(`/api/sessions/${sessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' });

      // Step 3: Trigger agent transition during export
      const pmTransitionPromise = request(app)
        .post(`/api/sessions/${sessionId}/agents/transition`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ fromAgent: 'ANALYST', toAgent: 'PM' });

      const [exportResult, transitionResult] = await Promise.all([
        exportPromise,
        pmTransitionPromise
      ]);

      expect(exportResult.status).toBe(200);
      expect(transitionResult.status).toBe(200);

      // Step 4: Verify document version consistency
      const documentVersion = exportResult.body.data.documentVersion;
      const currentDocument = await request(app)
        .get(`/api/sessions/${sessionId}/document`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Export should contain stable version, not partial updates
      expect(documentVersion).toBeDefined();
      expect(exportResult.body.data.content).not.toContain('undefined');
      expect(exportResult.body.data.content).not.toContain('null');

      // Step 5: Continue with UX expert and verify streaming
      await request(app)
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'UX_EXPERT', prompt: 'Design user experience' });

      // Step 6: Export updated version
      const updatedExport = await request(app)
        .post(`/api/sessions/${sessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' })
        .expect(200);

      // Verify version progression
      expect(updatedExport.body.data.documentVersion).not.toBe(documentVersion);
      expect(updatedExport.body.data.content.length).toBeGreaterThan(0);
    });

    it('should handle agent failure during export without corruption', async () => {
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Agent failure during export test' });

      const sessionId = sessionResponse.body.data.id;
      await activatePremiumForUser(userId);

      // Start agent execution
      await request(app)
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'ANALYST' });

      // Mock agent failure
      jest.spyOn(require('../../services/llm-gateway'), 'executeAgent')
        .mockRejectedValueOnce(new Error('LLM provider timeout'));

      // Export during failed agent execution
      const exportResponse = await request(app)
        .post(`/api/sessions/${sessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' })
        .expect(200); // Should still succeed with available content

      expect(exportResponse.body.data.content).toBeDefined();
      expect(exportResponse.body.data.warningMessage).toContain('partial content');

      // Verify session remains recoverable
      const sessionStatus = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(sessionStatus.body.data.status).toBe('ACTIVE');
      expect(sessionStatus.body.data.lastError).toBeDefined();
    });
  });

  describe('CROSS-003: Session State → Error Recovery → Premium Features', () => {
    it('should recover premium user session with feature access validation', async () => {
      // Create premium user session
      await activatePremiumForUser(userId);
      
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Premium session recovery test' });

      const sessionId = sessionResponse.body.data.id;

      // Generate substantial content
      await request(app)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Complex business analysis', agentType: 'ANALYST' });

      // Simulate session interruption
      await request(app)
        .post(`/api/sessions/${sessionId}/interrupt`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'CONNECTION_LOST' })
        .expect(200);

      // Attempt session recovery
      const recoveryResponse = await request(app)
        .post(`/api/sessions/${sessionId}/recover`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify premium features still accessible
      expect(recoveryResponse.body.data.features.premiumTemplates).toBe(true);
      expect(recoveryResponse.body.data.features.unlimitedExports).toBe(true);
      expect(recoveryResponse.body.data.features.customBranding).toBe(true);

      // Test premium feature functionality
      const exportResponse = await request(app)
        .post(`/api/sessions/${sessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF', customBranding: true })
        .expect(200);

      expect(exportResponse.body.data.brandingApplied).toBe(true);
    });
  });

  describe('CROSS-004: Authentication → Payment → Monitoring Integration', () => {
    it('should correlate user authentication through payment flow with monitoring', async () => {
      // Mock monitoring service
      const monitoringEvents: any[] = [];
      jest.spyOn(require('../../services/monitoring'), 'track')
        .mockImplementation((event, data) => {
          monitoringEvents.push({ event, data, timestamp: new Date() });
        });

      // Step 1: User authentication
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@bmad.com', password: 'testpassword123' })
        .expect(200);

      const newAuthToken = loginResponse.body.data.token;

      // Step 2: Session creation
      await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${newAuthToken}`)
        .send({ projectInput: 'Monitoring correlation test' });

      // Step 3: Payment flow
      await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${newAuthToken}`)
        .send({ planType: 'PREMIUM_MONTHLY' });

      // Verify monitoring correlation
      const authEvents = monitoringEvents.filter(e => e.event === 'USER_AUTHENTICATED');
      const sessionEvents = monitoringEvents.filter(e => e.event === 'SESSION_CREATED');
      const paymentEvents = monitoringEvents.filter(e => e.event === 'PAYMENT_INITIATED');

      expect(authEvents).toHaveLength(1);
      expect(sessionEvents).toHaveLength(1);
      expect(paymentEvents).toHaveLength(1);

      // Verify correlation IDs match
      const correlationId = authEvents[0].data.correlationId;
      expect(sessionEvents[0].data.correlationId).toBe(correlationId);
      expect(paymentEvents[0].data.correlationId).toBe(correlationId);
    });
  });

  describe('CROSS-005: LLM Integration → Error Handling → Monitoring', () => {
    it('should handle LLM provider failures with error recovery and alert correlation', async () => {
      const monitoringAlerts: any[] = [];
      jest.spyOn(require('../../services/monitoring'), 'alert')
        .mockImplementation((alert) => {
          monitoringAlerts.push(alert);
        });

      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'LLM failure recovery test' });

      const sessionId = sessionResponse.body.data.id;

      // Mock primary LLM provider failure
      jest.spyOn(require('../../services/llm-gateway'), 'executeWithProvider')
        .mockRejectedValueOnce(new Error('OpenAI API timeout'))
        .mockResolvedValueOnce({ content: 'Fallback response from Anthropic' });

      // Execute agent with LLM failure
      const agentResponse = await request(app)
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'ANALYST' })
        .expect(200);

      // Verify fallback worked
      expect(agentResponse.body.data.response.content).toContain('Fallback response');
      expect(agentResponse.body.data.provider).toBe('ANTHROPIC');

      // Verify monitoring alerts
      const llmFailureAlerts = monitoringAlerts.filter(a => a.type === 'LLM_PROVIDER_FAILURE');
      const recoveryAlerts = monitoringAlerts.filter(a => a.type === 'LLM_FALLBACK_SUCCESS');

      expect(llmFailureAlerts).toHaveLength(1);
      expect(recoveryAlerts).toHaveLength(1);

      // Verify alert correlation
      expect(llmFailureAlerts[0].correlationId).toBe(recoveryAlerts[0].correlationId);
    });
  });
});

// Helper functions
function generateTestJWT(userId: string): string {
  // Mock JWT generation - in real implementation, use actual JWT service
  return `mock-jwt-token-${userId}`;
}

async function activatePremiumForUser(userId: string): Promise<void> {
  // Mock premium activation - in real implementation, call subscription service
  const mockSubscription = {
    status: 'ACTIVE',
    planType: 'PREMIUM_MONTHLY',
    features: {
      premiumTemplates: true,
      unlimitedExports: true,
      customBranding: true
    }
  };
  
  // This would typically update the user's subscription in the database
  console.log(`Activated premium for user ${userId}:`, mockSubscription);
}