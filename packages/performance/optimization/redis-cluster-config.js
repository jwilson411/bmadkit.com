const Redis = require('ioredis');
const { EventEmitter } = require('events');

/**
 * Redis Cluster Configuration for High-Concurrency Session State Management
 * Optimized for 1,000+ concurrent planning sessions with horizontal scaling
 */
class RedisClusterManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // Cluster Configuration
      nodes: options.nodes || [
        { host: 'redis-node-1.bmad.internal', port: 6379 },
        { host: 'redis-node-2.bmad.internal', port: 6379 },
        { host: 'redis-node-3.bmad.internal', port: 6379 },
        { host: 'redis-node-4.bmad.internal', port: 6379 },
        { host: 'redis-node-5.bmad.internal', port: 6379 },
        { host: 'redis-node-6.bmad.internal', port: 6379 }
      ],
      
      // Redis Cluster Options
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 10000,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        maxLoadingTimeout: 30000,
        ...options.redisOptions
      },
      
      // Cluster-specific options
      enableOfflineQueue: false,
      redisOptions: {
        ...this.redisOptions,
        keepAlive: 30000,
        family: 4
      },
      
      // Scaling and Performance Options
      scaleReads: 'slave',
      maxRedirections: 16,
      retryDelayOnMoved: 0,
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 10000,
      slotsRefreshInterval: 5000,
      
      // Session Management Configuration
      sessionPartitions: options.sessionPartitions || 16,
      sessionTTL: options.sessionTTL || 3600, // 1 hour default
      cacheWarmupEnabled: options.cacheWarmupEnabled !== false,
      
      ...options
    };
    
    this.cluster = null;
    this.healthCheckInterval = null;
    this.metricsInterval = null;
    this.partitionStrategy = new SessionPartitionStrategy(this.options.sessionPartitions);
    
    // Performance metrics
    this.metrics = {
      connections: { active: 0, failed: 0, total: 0 },
      operations: { gets: 0, sets: 0, deletes: 0, errors: 0 },
      latency: { min: Infinity, max: 0, avg: 0, samples: [] },
      memory: { used: 0, peak: 0, fragmentation: 0 },
      partitions: new Map()
    };
  }

  /**
   * Initialize Redis cluster with high-availability configuration
   */
  async initialize() {
    try {
      console.log('Initializing Redis cluster for high-concurrency session management...');
      
      this.cluster = new Redis.Cluster(this.options.nodes, {
        ...this.options,
        clusterRetryDelayOnMoved: 0,
        clusterRetryDelayOnFailover: 100,
        enableReadyCheck: true,
        lazyConnect: true,
        slotsRefreshTimeout: 10000,
        slotsRefreshInterval: 5000
      });
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Connect to cluster
      await this.cluster.connect();
      
      // Configure cluster for session management
      await this.configureSessionManagement();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      // Perform cache warming if enabled
      if (this.options.cacheWarmupEnabled) {
        await this.performCacheWarmup();
      }
      
      console.log('Redis cluster initialized successfully');
      this.emit('ready');
      
      return true;
    } catch (error) {
      console.error('Failed to initialize Redis cluster:', error);
      this.emit('error', error);
      throw error;
    }
  }

  setupEventHandlers() {
    this.cluster.on('connect', () => {
      console.log('Connected to Redis cluster');
      this.metrics.connections.active++;
      this.metrics.connections.total++;
    });
    
    this.cluster.on('error', (error) => {
      console.error('Redis cluster error:', error);
      this.metrics.connections.failed++;
      this.emit('error', error);
    });
    
    this.cluster.on('close', () => {
      console.log('Redis cluster connection closed');
      this.metrics.connections.active = Math.max(0, this.metrics.connections.active - 1);
    });
    
    this.cluster.on('reconnecting', () => {
      console.log('Reconnecting to Redis cluster...');
    });
    
    this.cluster.on('ready', () => {
      console.log('Redis cluster is ready');
    });
    
    this.cluster.on('node error', (error, node) => {
      console.error(`Redis node error on ${node.options.host}:${node.options.port}:`, error);
    });
  }

  /**
   * Configure Redis cluster for optimized session state management
   */
  async configureSessionManagement() {
    // Configure memory policies for session data
    await this.executeOnAllNodes('CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru');
    await this.executeOnAllNodes('CONFIG', 'SET', 'timeout', '300');
    await this.executeOnAllNodes('CONFIG', 'SET', 'tcp-keepalive', '60');
    
    // Optimize for high-concurrency operations
    await this.executeOnAllNodes('CONFIG', 'SET', 'hz', '100');
    await this.executeOnAllNodes('CONFIG', 'SET', 'dynamic-hz', 'yes');
    
    // Configure persistence for session durability
    await this.executeOnAllNodes('CONFIG', 'SET', 'save', '900 1 300 10 60 10000');
    await this.executeOnAllNodes('CONFIG', 'SET', 'rdbcompression', 'yes');
    
    // Optimize for network performance
    await this.executeOnAllNodes('CONFIG', 'SET', 'tcp-backlog', '2048');
    
    console.log('Redis cluster configured for session management');
  }

  /**
   * Execute command on all cluster nodes
   */
  async executeOnAllNodes(command, ...args) {
    const nodes = this.cluster.nodes('master');
    const promises = nodes.map(node => node[command.toLowerCase()](...args));
    return Promise.allSettled(promises);
  }

  /**
   * Store session state with partitioning and high availability
   */
  async setSessionState(sessionId, state, options = {}) {
    const startTime = Date.now();
    
    try {
      const partition = this.partitionStrategy.getPartition(sessionId);
      const key = this.generateSessionKey(sessionId, partition);
      const ttl = options.ttl || this.options.sessionTTL;
      
      // Serialize state with compression for large sessions
      const serializedState = await this.serializeState(state);
      
      // Store with TTL and partition information
      const pipeline = this.cluster.pipeline();
      pipeline.setex(key, ttl, serializedState);
      pipeline.sadd(`partition:${partition}:sessions`, sessionId);
      pipeline.expire(`partition:${partition}:sessions`, ttl + 300); // Extra buffer
      
      // Add session metadata
      const metadataKey = `${key}:meta`;
      pipeline.hset(metadataKey, {
        created: Date.now(),
        partition,
        size: serializedState.length,
        version: state.version || 1,
        userId: state.userId
      });
      pipeline.expire(metadataKey, ttl);
      
      await pipeline.exec();
      
      // Update metrics
      this.updateLatencyMetrics(Date.now() - startTime);
      this.metrics.operations.sets++;
      this.updatePartitionMetrics(partition, 'set');
      
      this.emit('sessionStored', { sessionId, partition, size: serializedState.length });
      
      return true;
    } catch (error) {
      this.metrics.operations.errors++;
      console.error(`Failed to set session state for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve session state with failover support
   */
  async getSessionState(sessionId, options = {}) {
    const startTime = Date.now();
    
    try {
      const partition = this.partitionStrategy.getPartition(sessionId);
      const key = this.generateSessionKey(sessionId, partition);
      
      // Get state and metadata in parallel
      const pipeline = this.cluster.pipeline();
      pipeline.get(key);
      pipeline.hgetall(`${key}:meta`);
      
      const results = await pipeline.exec();
      const [stateResult, metadataResult] = results;
      
      if (stateResult[1] === null) {
        return null; // Session not found
      }
      
      // Deserialize state
      const state = await this.deserializeState(stateResult[1]);
      const metadata = metadataResult[1] || {};
      
      // Update metrics
      this.updateLatencyMetrics(Date.now() - startTime);
      this.metrics.operations.gets++;
      this.updatePartitionMetrics(partition, 'get');
      
      this.emit('sessionRetrieved', { sessionId, partition, size: stateResult[1].length });
      
      return {
        ...state,
        _metadata: metadata
      };
    } catch (error) {
      this.metrics.operations.errors++;
      console.error(`Failed to get session state for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Delete session state with cleanup
   */
  async deleteSessionState(sessionId, options = {}) {
    const startTime = Date.now();
    
    try {
      const partition = this.partitionStrategy.getPartition(sessionId);
      const key = this.generateSessionKey(sessionId, partition);
      
      // Delete state and metadata
      const pipeline = this.cluster.pipeline();
      pipeline.del(key);
      pipeline.del(`${key}:meta`);
      pipeline.srem(`partition:${partition}:sessions`, sessionId);
      
      const results = await pipeline.exec();
      const deletedCount = results[0][1] + results[1][1];
      
      // Update metrics
      this.updateLatencyMetrics(Date.now() - startTime);
      this.metrics.operations.deletes++;
      this.updatePartitionMetrics(partition, 'delete');
      
      this.emit('sessionDeleted', { sessionId, partition, deletedCount });
      
      return deletedCount > 0;
    } catch (error) {
      this.metrics.operations.errors++;
      console.error(`Failed to delete session state for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get all sessions in a partition for batch operations
   */
  async getPartitionSessions(partition) {
    try {
      const sessions = await this.cluster.smembers(`partition:${partition}:sessions`);
      return sessions;
    } catch (error) {
      console.error(`Failed to get partition ${partition} sessions:`, error);
      return [];
    }
  }

  /**
   * Perform cache warming for frequently accessed sessions
   */
  async performCacheWarmup() {
    console.log('Performing Redis cache warmup...');
    
    try {
      // Pre-load session templates and common data
      const templates = await this.loadSessionTemplates();
      const commonData = await this.loadCommonSessionData();
      
      const pipeline = this.cluster.pipeline();
      
      // Cache session templates
      templates.forEach((template, index) => {
        const key = `template:${template.id}`;
        pipeline.setex(key, 3600, JSON.stringify(template));
      });
      
      // Cache common session data
      commonData.forEach((data, key) => {
        pipeline.setex(`common:${key}`, 1800, JSON.stringify(data));
      });
      
      await pipeline.exec();
      
      console.log(`Cache warmup completed: ${templates.length} templates, ${commonData.size} common data items`);
    } catch (error) {
      console.error('Cache warmup failed:', error);
    }
  }

  async loadSessionTemplates() {
    // Mock implementation - in real app, load from database
    return [
      { id: 'agile-template', type: 'agile', structure: {} },
      { id: 'waterfall-template', type: 'waterfall', structure: {} },
      { id: 'lean-template', type: 'lean', structure: {} }
    ];
  }

  async loadCommonSessionData() {
    // Mock implementation - in real app, load frequently accessed data
    return new Map([
      ['methodologies', ['agile', 'waterfall', 'lean', 'design_thinking']],
      ['activity_types', ['planning', 'analysis', 'review', 'documentation']],
      ['stakeholder_roles', ['sponsor', 'user', 'analyst', 'developer']]
    ]);
  }

  /**
   * Start health monitoring for cluster nodes
   */
  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check failed:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  async performHealthCheck() {
    const nodes = this.cluster.nodes();
    const healthPromises = nodes.map(async (node) => {
      try {
        const start = Date.now();
        await node.ping();
        const latency = Date.now() - start;
        
        return {
          host: node.options.host,
          port: node.options.port,
          status: 'healthy',
          latency
        };
      } catch (error) {
        return {
          host: node.options.host,
          port: node.options.port,
          status: 'unhealthy',
          error: error.message
        };
      }
    });
    
    const healthResults = await Promise.all(healthPromises);
    const unhealthyNodes = healthResults.filter(r => r.status === 'unhealthy');
    
    if (unhealthyNodes.length > 0) {
      console.warn(`Unhealthy Redis nodes detected:`, unhealthyNodes);
      this.emit('unhealthyNodes', unhealthyNodes);
    }
    
    this.emit('healthCheck', healthResults);
  }

  /**
   * Start metrics collection and reporting
   */
  startMetricsCollection() {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectClusterMetrics();
        this.emit('metricsCollected', this.metrics);
      } catch (error) {
        console.error('Metrics collection failed:', error);
      }
    }, 60000); // Collect every minute
  }

  async collectClusterMetrics() {
    const nodes = this.cluster.nodes('master');
    
    for (const node of nodes) {
      try {
        const info = await node.memory('usage');
        const stats = await node.info('memory');
        
        // Parse memory info
        const memoryInfo = this.parseRedisInfo(stats);
        
        // Update cluster-wide metrics
        this.metrics.memory.used += parseInt(memoryInfo.used_memory || 0);
        this.metrics.memory.peak = Math.max(this.metrics.memory.peak, 
          parseInt(memoryInfo.used_memory_peak || 0));
        
        if (memoryInfo.mem_fragmentation_ratio) {
          this.metrics.memory.fragmentation = 
            Math.max(this.metrics.memory.fragmentation, 
              parseFloat(memoryInfo.mem_fragmentation_ratio));
        }
      } catch (error) {
        console.error(`Failed to collect metrics from node ${node.options.host}:`, error);
      }
    }
  }

  parseRedisInfo(infoString) {
    const info = {};
    infoString.split('\r\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value !== undefined) {
          info[key] = value;
        }
      }
    });
    return info;
  }

  generateSessionKey(sessionId, partition) {
    return `session:${partition}:${sessionId}`;
  }

  async serializeState(state) {
    // Use compression for large session states
    const json = JSON.stringify(state);
    if (json.length > 1024) {
      const zlib = require('zlib');
      return zlib.gzipSync(Buffer.from(json)).toString('base64');
    }
    return json;
  }

  async deserializeState(serializedState) {
    try {
      return JSON.parse(serializedState);
    } catch {
      // Try decompression
      const zlib = require('zlib');
      const compressed = Buffer.from(serializedState, 'base64');
      const decompressed = zlib.gunzipSync(compressed);
      return JSON.parse(decompressed.toString());
    }
  }

  updateLatencyMetrics(latency) {
    this.metrics.latency.min = Math.min(this.metrics.latency.min, latency);
    this.metrics.latency.max = Math.max(this.metrics.latency.max, latency);
    
    this.metrics.latency.samples.push(latency);
    if (this.metrics.latency.samples.length > 1000) {
      this.metrics.latency.samples = this.metrics.latency.samples.slice(-100);
    }
    
    this.metrics.latency.avg = this.metrics.latency.samples.reduce((a, b) => a + b, 0) / 
      this.metrics.latency.samples.length;
  }

  updatePartitionMetrics(partition, operation) {
    if (!this.metrics.partitions.has(partition)) {
      this.metrics.partitions.set(partition, { gets: 0, sets: 0, deletes: 0 });
    }
    this.metrics.partitions.get(partition)[operation + 's']++;
  }

  /**
   * Graceful shutdown with connection cleanup
   */
  async shutdown() {
    console.log('Shutting down Redis cluster manager...');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    if (this.cluster) {
      await this.cluster.disconnect();
    }
    
    console.log('Redis cluster manager shutdown complete');
  }

  /**
   * Get current cluster status and metrics
   */
  getStatus() {
    return {
      connected: this.cluster && this.cluster.status === 'ready',
      nodes: this.cluster ? this.cluster.nodes().length : 0,
      metrics: this.metrics,
      partitionStrategy: this.partitionStrategy.getStatus()
    };
  }
}

/**
 * Session Partition Strategy for distributing sessions across cluster nodes
 */
class SessionPartitionStrategy {
  constructor(partitionCount = 16) {
    this.partitionCount = partitionCount;
    this.partitionMap = new Map();
  }

  getPartition(sessionId) {
    if (this.partitionMap.has(sessionId)) {
      return this.partitionMap.get(sessionId);
    }
    
    // Use consistent hashing for session distribution
    const hash = this.hash(sessionId);
    const partition = hash % this.partitionCount;
    
    this.partitionMap.set(sessionId, partition);
    return partition;
  }

  hash(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash);
  }

  getStatus() {
    return {
      partitionCount: this.partitionCount,
      mappedSessions: this.partitionMap.size,
      partitionDistribution: this.getPartitionDistribution()
    };
  }

  getPartitionDistribution() {
    const distribution = new Array(this.partitionCount).fill(0);
    
    for (const partition of this.partitionMap.values()) {
      distribution[partition]++;
    }
    
    return distribution;
  }
}

module.exports = {
  RedisClusterManager,
  SessionPartitionStrategy
};