import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

// Utils and config
import { getConfig } from './utils/config';
import { getRedisClient } from './utils/redis';
import { logger } from './utils/logger';

// Middleware
import { authenticateSocket } from './middleware/auth';
import { 
  createConnectionRateLimiter, 
  createSpamProtection, 
  createMessageRateLimiter,
  MessageRateLimiter
} from './middleware/rateLimit';

// Services
import { SessionRoomManager } from './services/sessionRooms';
import { BroadcastService } from './services/broadcast';

// Handlers
import { SessionHandler } from './handlers/session';
import { DocumentHandler } from './handlers/document';
import { AgentHandler } from './handlers/agent';

const config = getConfig();

export class RealtimeServer {
  private app: express.Application;
  private httpServer;
  private io: Server;
  private sessionRooms!: SessionRoomManager;
  private broadcastService!: BroadcastService;
  private messageRateLimiter: MessageRateLimiter;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.messageRateLimiter = new MessageRateLimiter();
    
    this.io = new Server(this.httpServer, {
      cors: {
        origin: this.getAllowedOrigins(),
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: config.SOCKET_IO_PING_TIMEOUT,
      pingInterval: config.SOCKET_IO_PING_INTERVAL,
      maxHttpBufferSize: 1e6, // 1MB
      allowEIO3: false,
      transports: ['websocket', 'polling']
    });

    this.setupExpress();
    this.setupSocketIO();
  }

  private getAllowedOrigins(): string[] {
    if (config.NODE_ENV === 'production') {
      return [
        'https://bmadkit.com',
        'https://www.bmadkit.com',
        'https://app.bmadkit.com'
      ];
    }
    
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
  }

  private setupExpress(): void {
    // Express middleware
    this.app.use(cors({
      origin: this.getAllowedOrigins(),
      credentials: true
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Rate limiting for HTTP endpoints
    const httpRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
    });

    this.app.use('/api/realtime', httpRateLimit);

    this.setupHealthEndpoints();
    this.setupMonitoringEndpoints();
  }

  private setupHealthEndpoints(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'realtime-server',
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Ready check endpoint
    this.app.get('/ready', async (req, res) => {
      try {
        // Check Redis connectivity
        const redis = getRedisClient();
        await redis.ping();
        
        res.json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          checks: {
            redis: 'connected',
            socketio: 'running',
            rooms: this.sessionRooms?.getAllRooms().size || 0
          }
        });
      } catch (error) {
        logger.error('Readiness check failed', { error });
        res.status(503).json({
          status: 'not ready',
          timestamp: new Date().toISOString(),
          error: 'Service dependencies unavailable'
        });
      }
    });
  }

  private setupMonitoringEndpoints(): void {
    // Socket.IO metrics
    this.app.get('/api/realtime/metrics', (req, res) => {
      const rooms = this.sessionRooms?.getAllRooms();
      const roomStats = Array.from(rooms?.entries() || []).map(([sessionId, room]) => ({
        sessionId,
        participants: room.participants.size,
        status: room.metadata.status,
        lastActivity: room.lastActivity,
        createdAt: room.createdAt
      }));

      res.json({
        timestamp: new Date().toISOString(),
        connections: {
          total: this.io.engine.clientsCount,
          connected: this.io.sockets.sockets.size
        },
        rooms: {
          total: rooms?.size || 0,
          active: roomStats.filter(r => r.status === 'ACTIVE').length,
          paused: roomStats.filter(r => r.status === 'PAUSED').length,
          completed: roomStats.filter(r => r.status === 'COMPLETED').length
        },
        roomDetails: roomStats
      });
    });

    // Connection status for specific session
    this.app.get('/api/realtime/sessions/:sessionId/status', (req, res) => {
      const { sessionId } = req.params;
      const room = this.sessionRooms?.getSessionRoom(sessionId);
      
      if (!room) {
        return res.status(404).json({
          error: 'Session not found',
          sessionId,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        sessionId,
        participants: room.participants.size,
        status: room.metadata.status,
        currentAgent: room.metadata.currentAgent,
        lastActivity: room.lastActivity,
        createdAt: room.createdAt,
        timestamp: new Date().toISOString()
      });
    });

    // Force disconnect a session (admin endpoint)
    this.app.post('/api/realtime/sessions/:sessionId/disconnect', (req, res) => {
      const { sessionId } = req.params;
      const room = this.sessionRooms?.getSessionRoom(sessionId);
      
      if (!room) {
        return res.status(404).json({
          error: 'Session not found',
          sessionId,
          timestamp: new Date().toISOString()
        });
      }

      // Disconnect all participants
      room.participants.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
      });

      logger.info('Session force-disconnected', {
        sessionId,
        participantCount: room.participants.size
      });

      res.json({
        success: true,
        sessionId,
        disconnectedParticipants: room.participants.size,
        timestamp: new Date().toISOString()
      });
    });
  }

  private async setupSocketIO(): Promise<void> {
    try {
      // Setup Redis adapter for horizontal scaling
      const { getPubClient, getSubClient } = await import('./utils/redis');
      const pubClient = getPubClient();
      const subClient = getSubClient();
      
      await Promise.all([
        pubClient.connect(),
        subClient.connect()
      ]);

      this.io.adapter(createAdapter(pubClient, subClient));
      logger.info('Redis adapter configured for Socket.IO');

      // Initialize services
      this.sessionRooms = new SessionRoomManager(this.io);
      this.broadcastService = new BroadcastService(this.io);

      // Setup middleware
      this.setupMiddleware();
      
      // Setup event handlers
      this.setupEventHandlers();

      logger.info('Socket.IO server configured successfully');

    } catch (error) {
      logger.error('Failed to setup Socket.IO', { error });
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Connection-level middleware
    this.io.use(createSpamProtection());
    this.io.use(createConnectionRateLimiter({
      windowMs: 60000, // 1 minute
      maxConnections: config.RATE_LIMIT_CONNECTIONS_PER_IP
    }));
    this.io.use(authenticateSocket);

    // Message-level rate limiting
    this.io.use(createMessageRateLimiter({
      windowMs: 1000, // 1 second
      maxMessages: config.RATE_LIMIT_MESSAGES_PER_SECOND
    }));
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      const socketData = (socket as any).userData;
      
      logger.info('Client connected', {
        socketId: socket.id,
        userId: socketData?.userId,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      });

      // Initialize handlers
      const sessionHandler = new SessionHandler(this.sessionRooms, this.broadcastService);
      const documentHandler = new DocumentHandler(this.broadcastService);
      const agentHandler = new AgentHandler(this.broadcastService, this.sessionRooms);

      // Setup event handlers
      sessionHandler.setupHandlers(socket);
      documentHandler.setupHandlers(socket);
      agentHandler.setupHandlers(socket);

      // Handle connection events
      socket.on('disconnect', async (reason) => {
        logger.info('Client disconnected', {
          socketId: socket.id,
          userId: socketData?.userId,
          reason,
          duration: Date.now() - new Date(socketData?.connectedAt || 0).getTime()
        });

        // Cleanup session rooms
        await this.sessionRooms.disconnectSocket(socket);
      });

      socket.on('error', (error) => {
        logger.error('Socket error', {
          socketId: socket.id,
          userId: socketData?.userId,
          error
        });
      });

      // Broadcast connection status
      if (socketData?.sessionId) {
        this.broadcastService.broadcastConnectionStatus(socketData.sessionId, {
          status: 'CONNECTED',
          clientCount: this.sessionRooms.getRoomParticipantCount(socketData.sessionId),
          quality: 'GOOD'
        });
      }
    });

    // Handle server events
    this.io.on('connection_error', (error) => {
      logger.warn('Connection error', { error });
    });
  }

  async start(): Promise<void> {
    try {
      // Setup cleanup handlers
      this.setupGracefulShutdown();
      
      // Setup periodic cleanup
      this.setupPeriodicTasks();

      // Start HTTP server
      this.httpServer.listen(config.PORT, () => {
        logger.info('Realtime server started', {
          port: config.PORT,
          env: config.NODE_ENV,
          cors: this.getAllowedOrigins()
        });
      });

    } catch (error) {
      logger.error('Failed to start realtime server', { error });
      throw error;
    }
  }

  private setupPeriodicTasks(): void {
    // Cleanup inactive rooms every 30 minutes
    setInterval(() => {
      this.sessionRooms?.cleanupInactiveRooms();
    }, 30 * 60 * 1000);

    // Log connection metrics every 5 minutes
    setInterval(() => {
      const rooms = this.sessionRooms?.getAllRooms();
      logger.info('Connection metrics', {
        totalConnections: this.io.engine.clientsCount,
        activeRooms: rooms?.size || 0,
        totalParticipants: Array.from(rooms?.values() || [])
          .reduce((sum, room) => sum + room.participants.size, 0)
      });
    }, 5 * 60 * 1000);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);

      try {
        // Stop accepting new connections
        this.httpServer.close();

        // Disconnect all clients with notification
        this.io.disconnectSockets(true);

        // Cleanup services
        if (this.broadcastService) {
          await this.broadcastService.disconnect();
        }

        logger.info('Realtime server shutdown complete');
        process.exit(0);

      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  // Getter methods for testing
  get socketIO(): Server {
    return this.io;
  }

  get express(): express.Application {
    return this.app;
  }
}

// Start server if running directly
if (require.main === module) {
  const server = new RealtimeServer();
  server.start().catch((error) => {
    logger.error('Failed to start server', { error });
    process.exit(1);
  });
}

export default RealtimeServer;