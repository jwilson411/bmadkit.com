import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { Server } from 'socket.io';
import { createServer } from 'http';
import Client from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { RealtimeServer } from '../../src/server';

describe('Realtime Server Integration Tests', () => {
  let server: RealtimeServer;
  let clientSocket: any;
  let serverPort: number;
  let testToken: string;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.PORT = '0'; // Let system assign port
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.REDIS_URL = 'redis://localhost:6379';

    // Create test JWT token
    testToken = jwt.sign(
      {
        userId: 'test-user-123',
        email: 'test@example.com',
        subscriptionTier: 'premium',
        sessionId: 'test-session-123'
      },
      process.env.JWT_SECRET,
      {
        issuer: 'bmad-api',
        audience: 'bmad-client',
        expiresIn: '1h'
      }
    );

    // Start server
    server = new RealtimeServer();
    await server.start();
    
    // Get assigned port
    serverPort = (server as any).httpServer.address()?.port || 3002;
  });

  afterAll(async () => {
    if (server) {
      (server as any).httpServer.close();
    }
  });

  beforeEach((done) => {
    // Create client connection
    clientSocket = Client(`http://localhost:${serverPort}`, {
      auth: { token: testToken },
      transports: ['websocket']
    });

    clientSocket.on('connect', done);
  });

  afterEach(() => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should authenticate valid connections', (done) => {
      expect(clientSocket.connected).toBe(true);
      done();
    });

    it('should reject connections without valid token', (done) => {
      const unauthorizedClient = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket']
      });

      unauthorizedClient.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        unauthorizedClient.disconnect();
        done();
      });
    });
  });

  describe('Session Management', () => {
    it('should allow joining a session', (done) => {
      clientSocket.emit('join_session', 
        { sessionId: 'test-session-123' },
        (ack: any) => {
          expect(ack.success).toBe(true);
          expect(ack.timestamp).toBeDefined();
          done();
        }
      );
    });

    it('should receive session_joined event after joining', (done) => {
      clientSocket.on('session_joined', (data: any) => {
        expect(data.sessionId).toBe('test-session-123');
        expect(data.data.participantCount).toBe(1);
        expect(data.data.status).toBe('ACTIVE');
        done();
      });

      clientSocket.emit('join_session', { sessionId: 'test-session-123' });
    });

    it('should handle session status requests', (done) => {
      clientSocket.emit('join_session', { sessionId: 'test-session-123' }, () => {
        clientSocket.emit('get_session_status', 
          { sessionId: 'test-session-123' },
          (response: any) => {
            expect(response.success).toBe(true);
            expect(response.data.sessionId).toBe('test-session-123');
            expect(response.data.participantCount).toBeGreaterThanOrEqual(1);
            done();
          }
        );
      });
    });

    it('should handle leaving sessions', (done) => {
      clientSocket.emit('join_session', { sessionId: 'test-session-123' }, () => {
        clientSocket.emit('leave_session', (ack: any) => {
          expect(ack.success).toBe(true);
          done();
        });
      });
    });
  });

  describe('Real-time Events', () => {
    beforeEach((done) => {
      clientSocket.emit('join_session', { sessionId: 'test-session-123' }, done);
    });

    it('should handle progress updates', (done) => {
      const progressData = {
        percentage: 50,
        currentPhase: 'Analysis',
        completedTasks: 5,
        totalTasks: 10
      };

      clientSocket.emit('progress_updated', progressData, (ack: any) => {
        expect(ack.success).toBe(true);
        done();
      });
    });

    it('should handle agent status changes', (done) => {
      const agentData = {
        currentAgent: 'ANALYST' as const,
        status: 'WORKING' as const,
        task: 'Analyzing requirements'
      };

      clientSocket.emit('agent_status_changed', agentData, (ack: any) => {
        expect(ack.success).toBe(true);
        done();
      });
    });

    it('should handle document updates', (done) => {
      const documentData = {
        documentId: 'doc-123',
        documentType: 'PROJECT_BRIEF' as const,
        title: 'Test Project Brief',
        status: 'DRAFT' as const,
        version: 1,
        changes: {
          type: 'created' as const,
          summary: 'Initial creation'
        }
      };

      clientSocket.emit('document_updated', documentData, (ack: any) => {
        expect(ack.success).toBe(true);
        done();
      });
    });

    it('should handle typing indicators', (done) => {
      clientSocket.emit('user_typing', {
        sessionId: 'test-session-123',
        typing: true
      });

      // Should not throw error and complete
      setTimeout(done, 100);
    });

    it('should handle ping/pong', (done) => {
      clientSocket.emit('ping', (response: any) => {
        expect(response.pong).toBe('pong');
        expect(response.serverTime).toBeDefined();
        done();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session IDs', (done) => {
      clientSocket.emit('join_session', 
        { sessionId: '' },
        (ack: any) => {
          expect(ack.success).toBe(false);
          expect(ack.error.code).toBe('INVALID_DATA');
          done();
        }
      );
    });

    it('should handle missing session data', (done) => {
      clientSocket.emit('get_session_status', 
        { sessionId: 'non-existent-session' },
        (response: any) => {
          expect(response.success).toBe(false);
          expect(response.error.code).toBe('SESSION_NOT_FOUND');
          done();
        }
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should handle message rate limiting', (done) => {
      let warningReceived = false;
      
      clientSocket.on('rate_limit_warning', (data: any) => {
        expect(data.message).toContain('too quickly');
        warningReceived = true;
      });

      // Send many messages quickly to trigger rate limit
      for (let i = 0; i < 20; i++) {
        clientSocket.emit('ping');
      }

      setTimeout(() => {
        expect(warningReceived).toBe(true);
        done();
      }, 1000);
    });
  });

  describe('Multi-client Communication', () => {
    let secondClient: any;

    beforeEach((done) => {
      const secondToken = jwt.sign(
        {
          userId: 'test-user-456',
          email: 'test2@example.com',
          subscriptionTier: 'premium',
          sessionId: 'test-session-123'
        },
        process.env.JWT_SECRET!,
        {
          issuer: 'bmad-api',
          audience: 'bmad-client',
          expiresIn: '1h'
        }
      );

      secondClient = Client(`http://localhost:${serverPort}`, {
        auth: { token: secondToken },
        transports: ['websocket']
      });

      secondClient.on('connect', () => {
        secondClient.emit('join_session', { sessionId: 'test-session-123' }, done);
      });
    });

    afterEach(() => {
      if (secondClient) {
        secondClient.disconnect();
      }
    });

    it('should broadcast events to all session participants', (done) => {
      secondClient.on('progress_updated', (data: any) => {
        expect(data.data.percentage).toBe(75);
        expect(data.data.currentPhase).toBe('Implementation');
        done();
      });

      clientSocket.emit('progress_updated', {
        percentage: 75,
        currentPhase: 'Implementation',
        completedTasks: 7,
        totalTasks: 10
      });
    });

    it('should handle participant join/leave notifications', (done) => {
      clientSocket.on('participant_joined', (data: any) => {
        expect(data.data.joinedUserId).toBe('test-user-456');
        done();
      });
    });
  });
});

describe('HTTP Endpoints', () => {
  let server: RealtimeServer;
  let serverPort: number;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '0';
    
    server = new RealtimeServer();
    await server.start();
    serverPort = (server as any).httpServer.address()?.port || 3002;
  });

  afterAll(async () => {
    if (server) {
      (server as any).httpServer.close();
    }
  });

  it('should respond to health check', async () => {
    const response = await fetch(`http://localhost:${serverPort}/health`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('realtime-server');
  });

  it('should respond to readiness check', async () => {
    const response = await fetch(`http://localhost:${serverPort}/ready`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('ready');
    expect(data.checks).toBeDefined();
  });

  it('should provide metrics endpoint', async () => {
    const response = await fetch(`http://localhost:${serverPort}/api/realtime/metrics`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.connections).toBeDefined();
    expect(data.rooms).toBeDefined();
    expect(typeof data.connections.total).toBe('number');
  });
});