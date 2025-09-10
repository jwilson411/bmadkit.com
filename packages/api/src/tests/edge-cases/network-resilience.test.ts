/**
 * Network Resilience & Resource Exhaustion Tests
 * Test IDs: EGE-NETWORK-001, EGE-NETWORK-002, EGE-RESOURCE-001, EGE-RESOURCE-002
 * Priority: P0 - Critical Network & Resource Edge Cases
 * 
 * Tests for:
 * - Ultra-low bandwidth performance
 * - Network partition recovery
 * - Memory leak detection
 * - Database connection pool exhaustion
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { app } from '../../app';
import { createMockUser, simulateNetworkConditions, monitorMemoryUsage } from '../fixtures/test-data';

describe('Network Resilience & Resource Exhaustion Tests', () => {
  let prisma: PrismaClient;
  let server: any;
  let io: Server;
  let authToken: string;
  let userId: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    server = createServer(app);
    io = new Server(server);
    
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

  describe('EGE-NETWORK-001: Ultra-Low Bandwidth Simulation', () => {
    it('should maintain functionality over 56K dialup speeds with high latency', async () => {
      // Simulate extreme network conditions
      const networkSimulator = simulateNetworkConditions({
        bandwidth: '56Kbps',
        latency: 2000, // 2 second latency
        packetLoss: 0.05, // 5% packet loss
        jitter: 500 // ±500ms variation
      });

      // Apply network simulation to requests
      const slowRequest = networkSimulator.wrapRequest(request(app));

      // Test session creation under slow conditions
      const sessionStart = Date.now();
      const sessionResponse = await slowRequest
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Ultra-slow network test' })
        .timeout(30000) // 30 second timeout
        .expect(201);

      const sessionDuration = Date.now() - sessionStart;
      console.log(`Session created in ${sessionDuration}ms under slow network`);

      const sessionId = sessionResponse.body.data.id;

      // Test real-time document streaming performance
      const streamStart = Date.now();
      const agentResponse = await slowRequest
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          agentType: 'ANALYST',
          prompt: 'Quick analysis for slow network test',
          optimizeForBandwidth: true
        })
        .timeout(45000)
        .expect(200);

      const streamDuration = Date.now() - streamStart;

      // Verify graceful degradation
      expect(agentResponse.body.data.optimizationApplied).toBe(true);
      expect(agentResponse.body.data.contentPrioritization).toBe('TEXT_FIRST');
      expect(agentResponse.body.data.compressionLevel).toBe('HIGH');

      // Test WebSocket fallback behavior
      const fallbackResponse = await slowRequest
        .get(`/api/sessions/${sessionId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ connectionMode: 'POLLING' })
        .expect(200);

      expect(fallbackResponse.body.data.connectionType).toBe('HTTP_POLLING');
      expect(fallbackResponse.body.data.pollInterval).toBeGreaterThanOrEqual(5000); // Min 5s for slow connections

      // Verify offline mode activation thresholds
      networkSimulator.simulateDisconnection(35000); // 35 second outage

      const offlineModeResponse = await slowRequest
        .get(`/api/sessions/${sessionId}/offline-status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(offlineModeResponse.body.data.offlineModeActive).toBe(true);
      expect(offlineModeResponse.body.data.cachedDataAvailable).toBe(true);
    });

    it('should prioritize critical content loading (text before images)', async () => {
      const networkSimulator = simulateNetworkConditions({
        bandwidth: '56Kbps',
        latency: 2000
      });

      const slowRequest = networkSimulator.wrapRequest(request(app));

      const sessionResponse = await slowRequest
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Content prioritization test' });

      const sessionId = sessionResponse.body.data.id;

      // Add session with mixed content types
      await slowRequest
        .post(`/api/sessions/${sessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Analysis with charts and diagrams',
          agentType: 'ANALYST',
          includeVisualizations: true,
          includeLargeDatasets: true
        });

      // Request content with bandwidth optimization
      const contentResponse = await slowRequest
        .get(`/api/sessions/${sessionId}/content`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ 
          optimizeForBandwidth: true,
          priorityOrder: 'TEXT_FIRST'
        })
        .expect(200);

      // Verify content prioritization
      expect(contentResponse.body.data.loadSequence).toEqual([
        'TEXT_CONTENT',
        'ESSENTIAL_METADATA',
        'COMPRESSED_IMAGES',
        'FULL_VISUALIZATIONS'
      ]);

      expect(contentResponse.body.data.textContent).toBeDefined();
      expect(contentResponse.body.data.deferredContent).toBeDefined();
      expect(contentResponse.body.data.deferredContent.images).toHaveLength(0); // Images deferred
    });

    it('should provide appropriate connectivity warnings and guidance', async () => {
      const networkSimulator = simulateNetworkConditions({
        bandwidth: '56Kbps',
        latency: 3000,
        unstable: true
      });

      const slowRequest = networkSimulator.wrapRequest(request(app));

      const sessionResponse = await slowRequest
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Connectivity warnings test' });

      // Check for connectivity warnings
      const warningsResponse = await slowRequest
        .get('/api/system/connectivity-check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(warningsResponse.body.data.connectionQuality).toBe('POOR');
      expect(warningsResponse.body.data.warnings).toContain('SLOW_CONNECTION_DETECTED');
      expect(warningsResponse.body.data.recommendations).toEqual(
        expect.arrayContaining([
          'ENABLE_OFFLINE_MODE',
          'REDUCE_REAL_TIME_FEATURES',
          'ENABLE_COMPRESSION'
        ])
      );

      expect(warningsResponse.body.data.estimatedFeaturePerformance).toBeDefined();
      expect(warningsResponse.body.data.estimatedFeaturePerformance.documentStreaming).toBe('DEGRADED');
      expect(warningsResponse.body.data.estimatedFeaturePerformance.exportGeneration).toBe('SLOW');
    });
  });

  describe('EGE-NETWORK-002: Network Partition Recovery', () => {
    it('should handle database accessible but LLM providers unreachable', async () => {
      // Mock LLM provider failure
      jest.spyOn(require('../../services/llm-gateway'), 'executeWithProvider')
        .mockRejectedValue(new Error('ENOTFOUND api.openai.com'));

      jest.spyOn(require('../../services/llm-gateway'), 'getProviderStatus')
        .mockResolvedValue({
          openai: { status: 'UNREACHABLE', lastCheck: new Date() },
          anthropic: { status: 'UNREACHABLE', lastCheck: new Date() }
        });

      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'LLM partition test' })
        .expect(201);

      const sessionId = sessionResponse.body.data.id;

      // Attempt agent execution with LLM unavailable
      const agentResponse = await request(app)
        .post(`/api/sessions/${sessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'ANALYST' })
        .expect(503); // Service Unavailable

      expect(agentResponse.body.error.code).toBe('LLM_PROVIDERS_UNAVAILABLE');
      expect(agentResponse.body.data.fallbackOptions).toBeDefined();
      expect(agentResponse.body.data.estimatedRecoveryTime).toBeDefined();

      // Verify database operations still work
      const sessionCheck = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(sessionCheck.body.data.id).toBe(sessionId);
      expect(sessionCheck.body.data.status).toBe('LLM_UNAVAILABLE');

      // Test recovery when LLM comes back online
      jest.spyOn(require('../../services/llm-gateway'), 'executeWithProvider')
        .mockResolvedValue({ content: 'Recovery successful', provider: 'OPENAI' });

      jest.spyOn(require('../../services/llm-gateway'), 'getProviderStatus')
        .mockResolvedValue({
          openai: { status: 'HEALTHY', lastCheck: new Date() },
          anthropic: { status: 'HEALTHY', lastCheck: new Date() }
        });

      // Retry agent execution
      const recoveryResponse = await request(app)
        .post(`/api/sessions/${sessionId}/agents/retry`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ agentType: 'ANALYST' })
        .expect(200);

      expect(recoveryResponse.body.data.response.content).toBe('Recovery successful');
      expect(recoveryResponse.body.data.recoverySuccessful).toBe(true);
    });

    it('should handle Redis cache isolated but database connected', async () => {
      // Mock Redis connection failure
      jest.spyOn(require('../../services/cache'), 'get')
        .mockRejectedValue(new Error('ECONNREFUSED Redis connection'));

      jest.spyOn(require('../../services/cache'), 'set')
        .mockRejectedValue(new Error('ECONNREFUSED Redis connection'));

      // Session operations should continue without cache
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Redis isolation test' })
        .expect(201);

      const sessionId = sessionResponse.body.data.id;

      // Verify session works without caching
      const sessionCheck = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(sessionCheck.body.data.id).toBe(sessionId);
      expect(sessionCheck.body.data.cacheMiss).toBe(true);
      expect(sessionCheck.body.data.performanceWarning).toContain('CACHE_UNAVAILABLE');

      // Test recovery when Redis comes back
      jest.spyOn(require('../../services/cache'), 'get').mockRestore();
      jest.spyOn(require('../../services/cache'), 'set').mockRestore();

      // Should automatically resume caching
      const cachedResponse = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cachedResponse.body.data.cacheHit).toBe(false); // First miss, then cached
    });

    it('should synchronize data accurately after network partition recovery', async () => {
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Partition recovery sync test' });

      const sessionId = sessionResponse.body.data.id;

      // Add initial content
      await request(app)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Before partition', agentType: 'ANALYST' });

      // Simulate network partition by mocking external service failures
      jest.spyOn(require('../../services/monitoring'), 'track')
        .mockRejectedValue(new Error('Monitoring service unreachable'));

      // Continue operations during partition (should queue)
      const partitionOperations = [];
      for (let i = 0; i < 5; i++) {
        partitionOperations.push(
          request(app)
            .post(`/api/sessions/${sessionId}/messages`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({ content: `During partition ${i}`, agentType: 'PM' })
        );
      }

      const partitionResults = await Promise.allSettled(partitionOperations);
      
      // Operations should succeed but be queued for sync
      partitionResults.forEach((result, index) => {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect((result as any).value.status).toBe(201);
          expect((result as any).value.body.data.syncStatus).toBe('QUEUED');
        }
      });

      // Restore monitoring service
      jest.spyOn(require('../../services/monitoring'), 'track').mockRestore();

      // Trigger sync recovery
      const syncResponse = await request(app)
        .post('/api/system/sync-recovery')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(syncResponse.body.data.queuedOperations).toBe(5);
      expect(syncResponse.body.data.syncStatus).toBe('IN_PROGRESS');

      // Wait for sync completion
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify all data synchronized correctly
      const finalSessionCheck = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(finalSessionCheck.body.data.messages).toHaveLength(6); // 1 before + 5 during partition
      expect(finalSessionCheck.body.data.syncStatus).toBe('COMPLETE');
      expect(finalSessionCheck.body.data.dataIntegrityCheck).toBe('PASSED');
    });
  });

  describe('EGE-RESOURCE-001: Gradual Memory Leak Detection', () => {
    it('should detect memory leaks over extended operation', async () => {
      const memoryMonitor = monitorMemoryUsage();
      const testDuration = 60000; // 1 minute test (scaled down from 48 hours)
      const startTime = Date.now();

      // Simulate 1000+ concurrent sessions (scaled down)
      const concurrentSessions = 50; // Scaled down for test
      const sessions = [];

      // Create multiple sessions
      for (let i = 0; i < concurrentSessions; i++) {
        const sessionResponse = await request(app)
          .post('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ projectInput: `Memory leak test session ${i}` });
        
        sessions.push(sessionResponse.body.data.id);
      }

      // Continuously add content to sessions
      const leakTestInterval = setInterval(async () => {
        if (Date.now() - startTime > testDuration) {
          clearInterval(leakTestInterval);
          return;
        }

        // Add content to random sessions
        const randomSession = sessions[Math.floor(Math.random() * sessions.length)];
        await request(app)
          .post(`/api/sessions/${randomSession}/messages`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ 
            content: `Memory test message at ${Date.now()}`,
            agentType: 'ANALYST'
          });
      }, 1000); // Every second

      // Monitor memory growth
      await new Promise(resolve => {
        setTimeout(() => {
          clearInterval(leakTestInterval);
          resolve(void 0);
        }, testDuration);
      });

      const memoryReport = memoryMonitor.getReport();
      
      // Check for memory leak indicators
      const memoryGrowthRate = memoryReport.growthRatePerHour; // MB/hour
      expect(memoryGrowthRate).toBeLessThan(10); // Less than 10MB/hour growth
      
      expect(memoryReport.leakIndicators).toBeDefined();
      expect(memoryReport.leakIndicators.webSocketConnections).toBeLessThan(concurrentSessions * 2);
      expect(memoryReport.leakIndicators.eventListeners).toBeLessThan(1000);
      expect(memoryReport.leakIndicators.domReferences).toBe(0); // Backend test

      // Test garbage collection efficiency
      global.gc && global.gc(); // Force garbage collection if available
      const postGCMemory = process.memoryUsage();
      
      expect(postGCMemory.heapUsed).toBeLessThan(memoryReport.peakMemory * 0.8);
    });

    it('should handle memory pressure scenarios gracefully', async () => {
      // Simulate memory pressure by creating large objects
      const largeObjects = [];
      
      try {
        // Create memory pressure
        while (process.memoryUsage().heapUsed < 1024 * 1024 * 1024) { // 1GB
          largeObjects.push(new Array(1024 * 1024).fill('memory-pressure-test'));
        }
      } catch (error) {
        // Expected to hit memory limits
      }

      // Test system behavior under memory pressure
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Memory pressure test' });

      if (sessionResponse.status === 503) {
        // System correctly detected memory pressure
        expect(sessionResponse.body.error.code).toBe('MEMORY_PRESSURE_DETECTED');
        expect(sessionResponse.body.data.retryAfter).toBeDefined();
      } else {
        // System handled pressure gracefully
        expect(sessionResponse.status).toBe(201);
        expect(sessionResponse.body.data.memoryOptimizationApplied).toBe(true);
      }

      // Clean up
      largeObjects.length = 0;
    });
  });

  describe('EGE-RESOURCE-002: Database Connection Pool Exhaustion', () => {
    it('should handle connection pool exhaustion gracefully', async () => {
      // Mock connection pool with limited size
      const mockPool = {
        totalCount: 20,
        idleCount: 0,
        waitingCount: 0
      };

      jest.spyOn(require('../../services/database'), 'getPoolStatus')
        .mockResolvedValue(mockPool);

      // Create many concurrent requests to exhaust pool
      const concurrentRequests = Array.from({ length: 25 }, (_, i) =>
        request(app)
          .post('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ projectInput: `Pool exhaustion test ${i}` })
      );

      const results = await Promise.allSettled(concurrentRequests);
      
      // Some requests should succeed, others should be queued or rejected gracefully
      const successful = results.filter(r => r.status === 'fulfilled' && (r as any).value.status === 201);
      const queued = results.filter(r => r.status === 'fulfilled' && (r as any).value.status === 202);
      const failed = results.filter(r => r.status === 'fulfilled' && (r as any).value.status === 503);

      expect(successful.length).toBeGreaterThan(0);
      expect(successful.length + queued.length + failed.length).toBe(25);

      // Check queued requests receive proper response
      const queuedResponses = results
        .filter(r => r.status === 'fulfilled' && (r as any).value.status === 202)
        .map(r => (r as any).value.body);

      queuedResponses.forEach(response => {
        expect(response.data.queuePosition).toBeDefined();
        expect(response.data.estimatedWaitTime).toBeDefined();
        expect(response.message).toContain('queued');
      });

      // Verify no application crashes
      const healthResponse = await request(app)
        .get('/api/health')
        .expect(200);

      expect(healthResponse.body.data.status).toBe('OPERATIONAL');
      expect(healthResponse.body.data.connectionPool.status).toBe('DEGRADED');
    });

    it('should recover automatically when connections become available', async () => {
      // Start with exhausted pool
      jest.spyOn(require('../../services/database'), 'getPoolStatus')
        .mockResolvedValueOnce({ totalCount: 20, idleCount: 0, waitingCount: 15 });

      const exhaustedResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Pool recovery test' })
        .expect(503);

      expect(exhaustedResponse.body.error.code).toBe('CONNECTION_POOL_EXHAUSTED');

      // Simulate connections becoming available
      jest.spyOn(require('../../services/database'), 'getPoolStatus')
        .mockResolvedValue({ totalCount: 20, idleCount: 5, waitingCount: 0 });

      // Request should now succeed
      const recoveryResponse = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectInput: 'Pool recovery test - retry' })
        .expect(201);

      expect(recoveryResponse.body.data.id).toBeDefined();
    });

    it('should provide connection health monitoring accuracy', async () => {
      const healthResponse = await request(app)
        .get('/api/health/database')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(healthResponse.body.data.connectionPool).toBeDefined();
      expect(healthResponse.body.data.connectionPool.totalConnections).toBeGreaterThan(0);
      expect(healthResponse.body.data.connectionPool.activeConnections).toBeGreaterThanOrEqual(0);
      expect(healthResponse.body.data.connectionPool.idleConnections).toBeGreaterThanOrEqual(0);
      expect(healthResponse.body.data.connectionPool.waitingRequests).toBeGreaterThanOrEqual(0);

      expect(healthResponse.body.data.queryPerformance).toBeDefined();
      expect(healthResponse.body.data.queryPerformance.averageResponseTime).toBeGreaterThan(0);
      expect(healthResponse.body.data.queryPerformance.slowQueries).toBeGreaterThanOrEqual(0);

      expect(healthResponse.body.data.connectionHealth).toBeDefined();
      expect(['HEALTHY', 'DEGRADED', 'CRITICAL']).toContain(healthResponse.body.data.connectionHealth);
    });
  });
});

// Helper functions
function generateTestJWT(userId: string): string {
  return `mock-jwt-token-${userId}`;
}