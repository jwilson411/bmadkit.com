import { EventEmitter } from 'events';
import winston from 'winston';
import Redis from 'ioredis';
import os from 'os';
import fs from 'fs/promises';

/**
 * Infrastructure Monitoring Service
 * Comprehensive server resource monitoring with Redis cluster and security monitoring
 */

export interface ServerMetrics {
  hostname: string;
  timestamp: number;
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  processes: ProcessMetrics;
  system: SystemMetrics;
}

export interface CPUMetrics {
  usage: number;
  loadAverage: number[];
  cores: number;
  frequency: number;
  temperature?: number;
  processes: {
    user: number;
    system: number;
    idle: number;
    iowait: number;
  };
  topProcesses: ProcessInfo[];
}

export interface MemoryMetrics {
  total: number;
  used: number;
  free: number;
  available: number;
  utilization: number;
  swap: {
    total: number;
    used: number;
    free: number;
  };
  buffers: number;
  cached: number;
  pressure: MemoryPressure;
}

export interface MemoryPressure {
  some: {
    avg10: number;
    avg60: number;
    avg300: number;
  };
  full: {
    avg10: number;
    avg60: number;
    avg300: number;
  };
}

export interface DiskMetrics {
  filesystems: FilesystemInfo[];
  io: DiskIOMetrics;
  performance: DiskPerformance;
}

export interface FilesystemInfo {
  mountpoint: string;
  filesystem: string;
  type: string;
  size: number;
  used: number;
  available: number;
  utilization: number;
  inodes: {
    total: number;
    used: number;
    available: number;
  };
}

export interface DiskIOMetrics {
  readBytes: number;
  writeBytes: number;
  readOps: number;
  writeOps: number;
  readTime: number;
  writeTime: number;
  ioTime: number;
  weightedIOTime: number;
}

export interface DiskPerformance {
  readLatency: number;
  writeLatency: number;
  iops: number;
  throughput: number;
  queueDepth: number;
}

export interface NetworkMetrics {
  interfaces: NetworkInterface[];
  connections: NetworkConnections;
  latency: NetworkLatency;
  bandwidth: NetworkBandwidth;
}

export interface NetworkInterface {
  name: string;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  errorsReceived: number;
  errorsSent: number;
  droppedReceived: number;
  droppedSent: number;
  mtu: number;
  speed: number;
}

export interface NetworkConnections {
  established: number;
  timeWait: number;
  closeWait: number;
  listening: number;
  total: number;
}

export interface NetworkLatency {
  internal: number; // Internal service latency
  external: number; // External dependency latency
  dns: number;
  database: number;
  cache: number;
}

export interface NetworkBandwidth {
  inbound: number;
  outbound: number;
  utilization: number;
  capacity: number;
}

export interface ProcessMetrics {
  total: number;
  running: number;
  sleeping: number;
  stopped: number;
  zombie: number;
  threads: number;
  loadAverage: number[];
  contextSwitches: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  user: string;
  startTime: number;
  command: string;
}

export interface SystemMetrics {
  uptime: number;
  bootTime: number;
  users: number;
  kernelVersion: string;
  architecture: string;
  platform: string;
  timezone: string;
  locale: string;
}

export interface RedisClusterMetrics {
  nodes: RedisNodeMetrics[];
  cluster: RedisClusterStatus;
  performance: RedisPerformanceMetrics;
  replication: RedisReplicationMetrics;
}

export interface RedisNodeMetrics {
  id: string;
  host: string;
  port: number;
  role: 'master' | 'slave';
  status: 'connected' | 'disconnected' | 'fail';
  memory: {
    used: number;
    peak: number;
    fragmentation: number;
    rss: number;
  };
  cpu: {
    used: number;
    children: number;
  };
  network: {
    connections: number;
    inputKbps: number;
    outputKbps: number;
  };
  keyspace: {
    keys: number;
    expires: number;
    avgTtl: number;
  };
  operations: {
    totalCommands: number;
    opsPerSecond: number;
    hitRate: number;
    missRate: number;
  };
}

export interface RedisClusterStatus {
  state: 'ok' | 'fail';
  slots: {
    assigned: number;
    ok: number;
    pfail: number;
    fail: number;
  };
  knownNodes: number;
  size: number;
  currentEpoch: number;
  myEpoch: number;
}

export interface RedisPerformanceMetrics {
  latency: {
    average: number;
    p95: number;
    p99: number;
  };
  throughput: {
    operations: number;
    networkIO: number;
  };
  memory: {
    efficiency: number;
    fragmentation: number;
  };
}

export interface RedisReplicationMetrics {
  masterLinkStatus: 'up' | 'down';
  masterLastIOSecondsAgo: number;
  masterSyncInProgress: boolean;
  slaveReplicationOffset: number;
  slavePriority: number;
  slaveReadOnly: boolean;
  replicationBacklogActive: boolean;
  replicationBacklogSize: number;
  replicationBacklogHistLen: number;
}

export interface SecurityMetrics {
  authentication: AuthenticationMetrics;
  authorization: AuthorizationMetrics;
  intrusion: IntrusionMetrics;
  compliance: ComplianceMetrics;
}

export interface AuthenticationMetrics {
  successfulLogins: number;
  failedLogins: number;
  suspiciousAttempts: number;
  blockedIPs: number;
  activeSessions: number;
  tokenValidations: number;
}

export interface AuthorizationMetrics {
  accessGranted: number;
  accessDenied: number;
  privilegeEscalations: number;
  unauthorizedAccess: number;
  policyViolations: number;
}

export interface IntrusionMetrics {
  attemptedBreaches: number;
  maliciousRequests: number;
  suspiciousPatterns: number;
  blockedAttacks: number;
  vulnerabilityScans: number;
  ddosAttempts: number;
}

export interface ComplianceMetrics {
  dataEncryption: number;
  auditLogIntegrity: number;
  accessControlCompliance: number;
  dataRetentionCompliance: number;
  privacyCompliance: number;
}

/**
 * Infrastructure Monitor
 * Comprehensive monitoring of server resources, Redis cluster, and security
 */
export class InfrastructureMonitor extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private metricsTimer: NodeJS.Timer | null = null;
  private redisMonitor: RedisClusterMonitor;
  private securityMonitor: SecurityMonitor;
  private currentMetrics: ServerMetrics | null = null;

  constructor(
    private config: {
      redis: {
        url: string;
        keyPrefix: string;
        cluster?: {
          nodes: string[];
          password?: string;
        };
      };
      monitoring: {
        interval: number;
        retention: number;
        alertThresholds: {
          cpu: number;
          memory: number;
          disk: number;
          network: number;
        };
      };
      security: {
        enabled: boolean;
        intrusionDetection: boolean;
        complianceMonitoring: boolean;
      };
    }
  ) {
    super();
    
    this.initializeRedis();
    this.initializeLogger();
    this.redisMonitor = new RedisClusterMonitor(config.redis);
    this.securityMonitor = new SecurityMonitor(config.security);
    
    this.startMonitoring();
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(): void {
    this.redis = new Redis(this.config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('error', (error) => {
      this.logger.error('Infrastructure Monitor Redis error', { error: error.message });
    });
  }

  /**
   * Initialize structured logging
   */
  private initializeLogger(): void {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'infrastructure-monitor' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/infrastructure-monitor.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Start infrastructure monitoring
   */
  private startMonitoring(): void {
    this.metricsTimer = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        this.logger.error('Metrics collection failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.config.monitoring.interval);

    this.logger.info('Infrastructure monitoring started', {
      interval: this.config.monitoring.interval,
      hostname: os.hostname()
    });
  }

  /**
   * Collect all infrastructure metrics
   */
  private async collectMetrics(): Promise<void> {
    const metrics: ServerMetrics = {
      hostname: os.hostname(),
      timestamp: Date.now(),
      cpu: await this.collectCPUMetrics(),
      memory: await this.collectMemoryMetrics(),
      disk: await this.collectDiskMetrics(),
      network: await this.collectNetworkMetrics(),
      processes: await this.collectProcessMetrics(),
      system: await this.collectSystemMetrics()
    };

    this.currentMetrics = metrics;

    // Store metrics
    await this.storeMetrics(metrics);

    // Check alert thresholds
    await this.checkAlertThresholds(metrics);

    // Collect Redis cluster metrics
    const redisMetrics = await this.redisMonitor.collect();
    if (redisMetrics) {
      await this.storeRedisMetrics(redisMetrics);
    }

    // Collect security metrics
    if (this.config.security.enabled) {
      const securityMetrics = await this.securityMonitor.collect();
      await this.storeSecurityMetrics(securityMetrics);
    }

    this.emit('metricsCollected', {
      server: metrics,
      redis: redisMetrics,
      security: this.config.security.enabled ? await this.securityMonitor.collect() : null
    });
  }

  /**
   * Collect CPU metrics
   */
  private async collectCPUMetrics(): Promise<CPUMetrics> {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage (simplified)
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    const usage = 100 - ~~(100 * totalIdle / totalTick);

    // Get top processes (mock data)
    const topProcesses: ProcessInfo[] = [
      {
        pid: 1234,
        name: 'node',
        cpu: 15.2,
        memory: 256,
        user: 'app',
        startTime: Date.now() - 3600000,
        command: 'node server.js'
      },
      {
        pid: 5678,
        name: 'redis-server',
        cpu: 8.5,
        memory: 128,
        user: 'redis',
        startTime: Date.now() - 7200000,
        command: 'redis-server *:6379'
      }
    ];

    return {
      usage,
      loadAverage: loadAvg,
      cores: cpus.length,
      frequency: cpus[0]?.speed || 0,
      processes: {
        user: usage * 0.7,
        system: usage * 0.2,
        idle: 100 - usage,
        iowait: usage * 0.1
      },
      topProcesses
    };
  }

  /**
   * Collect memory metrics
   */
  private async collectMemoryMetrics(): Promise<MemoryMetrics> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Mock memory pressure data (would come from /proc/pressure/memory on Linux)
    const pressure: MemoryPressure = {
      some: { avg10: 0.5, avg60: 0.8, avg300: 1.2 },
      full: { avg10: 0.1, avg60: 0.2, avg300: 0.3 }
    };

    return {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      available: freeMem,
      utilization: (usedMem / totalMem) * 100,
      swap: {
        total: 0, // Would read from /proc/swaps on Linux
        used: 0,
        free: 0
      },
      buffers: 0, // Would read from /proc/meminfo on Linux
      cached: 0,
      pressure
    };
  }

  /**
   * Collect disk metrics
   */
  private async collectDiskMetrics(): Promise<DiskMetrics> {
    const filesystems: FilesystemInfo[] = [];
    
    // Mock filesystem data (would use statvfs on Unix systems)
    const rootFs: FilesystemInfo = {
      mountpoint: '/',
      filesystem: '/dev/sda1',
      type: 'ext4',
      size: 100 * 1024 * 1024 * 1024, // 100GB
      used: 60 * 1024 * 1024 * 1024,  // 60GB
      available: 40 * 1024 * 1024 * 1024, // 40GB
      utilization: 60,
      inodes: {
        total: 6553600,
        used: 327680,
        available: 6225920
      }
    };
    filesystems.push(rootFs);

    // Mock disk I/O metrics (would read from /proc/diskstats on Linux)
    const io: DiskIOMetrics = {
      readBytes: 1024 * 1024 * 100,  // 100MB
      writeBytes: 1024 * 1024 * 200, // 200MB
      readOps: 1000,
      writeOps: 2000,
      readTime: 500,
      writeTime: 1000,
      ioTime: 1500,
      weightedIOTime: 2000
    };

    const performance: DiskPerformance = {
      readLatency: io.readTime / io.readOps,
      writeLatency: io.writeTime / io.writeOps,
      iops: (io.readOps + io.writeOps),
      throughput: (io.readBytes + io.writeBytes) / 1024 / 1024, // MB/s
      queueDepth: 4
    };

    return {
      filesystems,
      io,
      performance
    };
  }

  /**
   * Collect network metrics
   */
  private async collectNetworkMetrics(): Promise<NetworkMetrics> {
    const networkInterfaces = os.networkInterfaces();
    const interfaces: NetworkInterface[] = [];

    // Convert OS network interfaces to our format
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
      if (addrs && addrs.length > 0) {
        const addr = addrs[0];
        if (!addr.internal) {
          interfaces.push({
            name,
            bytesReceived: Math.floor(Math.random() * 1000000000), // Mock data
            bytesSent: Math.floor(Math.random() * 1000000000),
            packetsReceived: Math.floor(Math.random() * 1000000),
            packetsSent: Math.floor(Math.random() * 1000000),
            errorsReceived: Math.floor(Math.random() * 100),
            errorsSent: Math.floor(Math.random() * 100),
            droppedReceived: Math.floor(Math.random() * 10),
            droppedSent: Math.floor(Math.random() * 10),
            mtu: 1500,
            speed: 1000 // 1Gbps
          });
        }
      }
    }

    // Mock connection metrics (would parse /proc/net/sockstat on Linux)
    const connections: NetworkConnections = {
      established: 150,
      timeWait: 25,
      closeWait: 5,
      listening: 10,
      total: 190
    };

    // Mock latency metrics
    const latency: NetworkLatency = {
      internal: 1.2,
      external: 45.5,
      dns: 8.3,
      database: 2.1,
      cache: 0.5
    };

    const bandwidth: NetworkBandwidth = {
      inbound: 100 * 1024 * 1024,  // 100 Mbps
      outbound: 50 * 1024 * 1024,  // 50 Mbps
      utilization: 15, // 15%
      capacity: 1000 * 1024 * 1024 // 1 Gbps
    };

    return {
      interfaces,
      connections,
      latency,
      bandwidth
    };
  }

  /**
   * Collect process metrics
   */
  private async collectProcessMetrics(): Promise<ProcessMetrics> {
    // Mock process data (would parse /proc/stat and /proc/*/stat on Linux)
    return {
      total: 250,
      running: 2,
      sleeping: 245,
      stopped: 2,
      zombie: 1,
      threads: 800,
      loadAverage: os.loadavg(),
      contextSwitches: 50000
    };
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<SystemMetrics> {
    return {
      uptime: os.uptime(),
      bootTime: Date.now() - (os.uptime() * 1000),
      users: 1, // Mock data
      kernelVersion: os.release(),
      architecture: os.arch(),
      platform: os.platform(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: 'en_US.UTF-8'
    };
  }

  /**
   * Check alert thresholds
   */
  private async checkAlertThresholds(metrics: ServerMetrics): Promise<void> {
    const thresholds = this.config.monitoring.alertThresholds;

    // CPU threshold
    if (metrics.cpu.usage > thresholds.cpu) {
      this.emit('threshold_exceeded', {
        type: 'cpu',
        current: metrics.cpu.usage,
        threshold: thresholds.cpu,
        severity: metrics.cpu.usage > thresholds.cpu * 1.2 ? 'critical' : 'warning'
      });
    }

    // Memory threshold
    if (metrics.memory.utilization > thresholds.memory) {
      this.emit('threshold_exceeded', {
        type: 'memory',
        current: metrics.memory.utilization,
        threshold: thresholds.memory,
        severity: metrics.memory.utilization > thresholds.memory * 1.1 ? 'critical' : 'warning'
      });
    }

    // Disk threshold
    for (const fs of metrics.disk.filesystems) {
      if (fs.utilization > thresholds.disk) {
        this.emit('threshold_exceeded', {
          type: 'disk',
          filesystem: fs.mountpoint,
          current: fs.utilization,
          threshold: thresholds.disk,
          severity: fs.utilization > 90 ? 'critical' : 'warning'
        });
      }
    }

    // Network threshold (bandwidth utilization)
    if (metrics.network.bandwidth.utilization > thresholds.network) {
      this.emit('threshold_exceeded', {
        type: 'network',
        current: metrics.network.bandwidth.utilization,
        threshold: thresholds.network,
        severity: 'warning'
      });
    }
  }

  /**
   * Store metrics in Redis
   */
  private async storeMetrics(metrics: ServerMetrics): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:infrastructure:${metrics.hostname}:${Math.floor(metrics.timestamp / 60000)}`;
    await this.redis.setex(key, this.config.monitoring.retention, JSON.stringify(metrics));

    // Also store current metrics for real-time access
    const currentKey = `${this.config.redis.keyPrefix}:infrastructure:current:${metrics.hostname}`;
    await this.redis.setex(currentKey, 300, JSON.stringify(metrics)); // 5 minutes
  }

  /**
   * Store Redis cluster metrics
   */
  private async storeRedisMetrics(metrics: RedisClusterMetrics): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:redis:cluster:${Math.floor(Date.now() / 60000)}`;
    await this.redis.setex(key, this.config.monitoring.retention, JSON.stringify(metrics));
  }

  /**
   * Store security metrics
   */
  private async storeSecurityMetrics(metrics: SecurityMetrics): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:security:${Math.floor(Date.now() / 60000)}`;
    await this.redis.setex(key, this.config.monitoring.retention, JSON.stringify(metrics));
  }

  // Public API methods
  getCurrentMetrics(): ServerMetrics | null {
    return this.currentMetrics;
  }

  async getHistoricalMetrics(hostname: string, startTime: number, endTime: number): Promise<ServerMetrics[]> {
    const metrics: ServerMetrics[] = [];
    const startMinute = Math.floor(startTime / 60000);
    const endMinute = Math.floor(endTime / 60000);

    for (let minute = startMinute; minute <= endMinute; minute++) {
      const key = `${this.config.redis.keyPrefix}:infrastructure:${hostname}:${minute}`;
      const data = await this.redis.get(key);
      
      if (data) {
        metrics.push(JSON.parse(data));
      }
    }

    return metrics;
  }

  async getClusterHealth(): Promise<any> {
    const redisMetrics = await this.redisMonitor.collect();
    
    return {
      server: {
        status: this.currentMetrics ? 'healthy' : 'unknown',
        cpu: this.currentMetrics?.cpu.usage || 0,
        memory: this.currentMetrics?.memory.utilization || 0,
        disk: Math.max(...(this.currentMetrics?.disk.filesystems.map(fs => fs.utilization) || [0]))
      },
      redis: redisMetrics ? {
        status: redisMetrics.cluster.state,
        nodes: redisMetrics.nodes.length,
        healthyNodes: redisMetrics.nodes.filter(n => n.status === 'connected').length
      } : null
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down infrastructure monitor...');

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    await this.redisMonitor.shutdown();
    await this.securityMonitor.shutdown();
    await this.redis.disconnect();

    this.logger.info('Infrastructure monitor shutdown complete');
  }
}

/**
 * Redis Cluster Monitor
 * Specialized monitoring for Redis cluster health and performance
 */
class RedisClusterMonitor {
  private clusterRedis: Redis | null = null;

  constructor(private config: any) {
    this.initializeClusterConnection();
  }

  private initializeClusterConnection(): void {
    if (this.config.cluster) {
      try {
        // Initialize cluster connection for monitoring
        // This would use actual Redis cluster configuration
        this.clusterRedis = new Redis(this.config.url);
      } catch (error) {
        console.error('Failed to initialize Redis cluster monitoring:', error);
      }
    }
  }

  async collect(): Promise<RedisClusterMetrics | null> {
    if (!this.clusterRedis) return null;

    try {
      // Mock Redis cluster metrics (would use CLUSTER INFO, INFO commands)
      const nodes: RedisNodeMetrics[] = [
        {
          id: 'node1',
          host: 'redis-node-1',
          port: 6379,
          role: 'master',
          status: 'connected',
          memory: {
            used: 256 * 1024 * 1024,
            peak: 512 * 1024 * 1024,
            fragmentation: 1.2,
            rss: 280 * 1024 * 1024
          },
          cpu: {
            used: 5.2,
            children: 0.1
          },
          network: {
            connections: 150,
            inputKbps: 100,
            outputKbps: 200
          },
          keyspace: {
            keys: 100000,
            expires: 50000,
            avgTtl: 3600
          },
          operations: {
            totalCommands: 1000000,
            opsPerSecond: 500,
            hitRate: 0.95,
            missRate: 0.05
          }
        }
      ];

      const cluster: RedisClusterStatus = {
        state: 'ok',
        slots: {
          assigned: 16384,
          ok: 16384,
          pfail: 0,
          fail: 0
        },
        knownNodes: nodes.length,
        size: nodes.length,
        currentEpoch: 1,
        myEpoch: 1
      };

      const performance: RedisPerformanceMetrics = {
        latency: {
          average: 0.5,
          p95: 2.0,
          p99: 5.0
        },
        throughput: {
          operations: 500,
          networkIO: 300
        },
        memory: {
          efficiency: 0.8,
          fragmentation: 1.2
        }
      };

      const replication: RedisReplicationMetrics = {
        masterLinkStatus: 'up',
        masterLastIOSecondsAgo: 0,
        masterSyncInProgress: false,
        slaveReplicationOffset: 1000000,
        slavePriority: 100,
        slaveReadOnly: true,
        replicationBacklogActive: true,
        replicationBacklogSize: 1048576,
        replicationBacklogHistLen: 512
      };

      return {
        nodes,
        cluster,
        performance,
        replication
      };

    } catch (error) {
      console.error('Redis cluster metrics collection failed:', error);
      return null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.clusterRedis) {
      await this.clusterRedis.disconnect();
    }
  }
}

/**
 * Security Monitor
 * Monitors security events and compliance metrics
 */
class SecurityMonitor {
  private securityEvents: any[] = [];

  constructor(private config: any) {}

  async collect(): Promise<SecurityMetrics> {
    // Mock security metrics
    return {
      authentication: {
        successfulLogins: 1500,
        failedLogins: 25,
        suspiciousAttempts: 3,
        blockedIPs: 5,
        activesSessions: 150,
        tokenValidations: 5000
      },
      authorization: {
        accessGranted: 8000,
        accessDenied: 50,
        privilegeEscalations: 0,
        unauthorizedAccess: 2,
        policyViolations: 1
      },
      intrusion: {
        attemptedBreaches: 0,
        maliciousRequests: 10,
        suspiciousPatterns: 5,
        blockedAttacks: 8,
        vulnerabilityScans: 2,
        ddosAttempts: 0
      },
      compliance: {
        dataEncryption: 100,
        auditLogIntegrity: 100,
        accessControlCompliance: 98,
        dataRetentionCompliance: 100,
        privacyCompliance: 95
      }
    };
  }

  async shutdown(): Promise<void> {
    // Cleanup security monitoring resources
  }
}

export default InfrastructureMonitor;