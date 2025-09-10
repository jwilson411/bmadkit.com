const WebSocket = require('ws');
const { EventEmitter } = require('events');

/**
 * WebSocket Load Testing Module
 * Specialized testing for real-time collaboration features
 */
class WebSocketLoadTester extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConnections: options.maxConnections || 1000,
      messageRate: options.messageRate || 10, // messages per second per connection
      connectionRate: options.connectionRate || 50, // new connections per second
      testDuration: options.testDuration || 300000, // 5 minutes
      ...options
    };
    
    this.connections = new Map();
    this.metrics = {
      connected: 0,
      disconnected: 0,
      failed: 0,
      messagesExchanged: 0,
      averageLatency: 0,
      peakConnections: 0,
      errors: []
    };
    
    this.testActive = false;
    this.startTime = null;
  }

  /**
   * Start comprehensive WebSocket load test
   */
  async startLoadTest() {
    console.log(`Starting WebSocket load test with ${this.options.maxConnections} connections`);
    
    this.testActive = true;
    this.startTime = Date.now();
    
    // Start metric reporting
    this.startMetricReporting();
    
    // Phase 1: Gradual connection ramp-up
    await this.executeConnectionRampUp();
    
    // Phase 2: Sustained load with message exchange
    await this.executeSustainedLoad();
    
    // Phase 3: Connection stress test
    await this.executeConnectionStressTest();
    
    // Phase 4: Message burst testing
    await this.executeMessageBurstTest();
    
    // Phase 5: Graceful shutdown
    await this.executeGracefulShutdown();
    
    this.testActive = false;
    
    return this.generateTestReport();
  }

  async executeConnectionRampUp() {
    console.log('Phase 1: Connection Ramp-Up');
    
    const rampUpDuration = 60000; // 1 minute
    const targetConnections = Math.floor(this.options.maxConnections * 0.7);
    const connectionInterval = rampUpDuration / targetConnections;
    
    for (let i = 0; i < targetConnections && this.testActive; i++) {
      await this.createConnection(`rampup_${i}`);
      await this.sleep(connectionInterval);
      
      if (i % 50 === 0) {
        console.log(`Ramp-up progress: ${i}/${targetConnections} connections`);
      }
    }
    
    console.log(`Ramp-up complete: ${this.connections.size} connections established`);
  }

  async executeSustainedLoad() {
    console.log('Phase 2: Sustained Load Testing');
    
    const sustainedDuration = 120000; // 2 minutes
    const messageInterval = 1000 / this.options.messageRate;
    
    const messagePromises = [];
    const endTime = Date.now() + sustainedDuration;
    
    while (Date.now() < endTime && this.testActive) {
      // Select random connections for message exchange
      const connectionIds = Array.from(this.connections.keys());
      const selectedConnections = this.selectRandomConnections(connectionIds, 0.3);
      
      for (const connectionId of selectedConnections) {
        messagePromises.push(this.sendTestMessage(connectionId));
      }
      
      await this.sleep(messageInterval);
      
      // Periodically log progress
      if (messagePromises.length % 1000 === 0) {
        console.log(`Messages sent: ${this.metrics.messagesExchanged}`);
      }
    }
    
    await Promise.allSettled(messagePromises);
    console.log(`Sustained load complete: ${this.metrics.messagesExchanged} messages exchanged`);
  }

  async executeConnectionStressTest() {
    console.log('Phase 3: Connection Stress Test');
    
    const additionalConnections = this.options.maxConnections - this.connections.size;
    const connectionPromises = [];
    
    // Rapid connection creation
    for (let i = 0; i < additionalConnections; i++) {
      connectionPromises.push(this.createConnection(`stress_${i}`));
      
      if (i % 10 === 0) {
        await this.sleep(100); // Brief pause to avoid overwhelming the server
      }
    }
    
    const results = await Promise.allSettled(connectionPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Stress test complete: ${successful} successful, ${failed} failed connections`);
    
    // Update peak connections metric
    if (this.connections.size > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.connections.size;
    }
  }

  async executeMessageBurstTest() {
    console.log('Phase 4: Message Burst Test');
    
    const burstCount = 100;
    const burstInterval = 50; // 50ms between bursts
    
    for (let burst = 0; burst < 10 && this.testActive; burst++) {
      const connectionIds = Array.from(this.connections.keys());
      const burstPromises = [];
      
      // Send burst of messages
      for (let i = 0; i < burstCount; i++) {
        const connectionId = connectionIds[Math.floor(Math.random() * connectionIds.length)];
        burstPromises.push(this.sendBurstMessage(connectionId, burst, i));
      }
      
      await Promise.allSettled(burstPromises);
      await this.sleep(burstInterval);
      
      console.log(`Completed burst ${burst + 1}/10`);
    }
    
    console.log('Message burst test complete');
  }

  async executeGracefulShutdown() {
    console.log('Phase 5: Graceful Shutdown');
    
    const connectionIds = Array.from(this.connections.keys());
    const shutdownPromises = [];
    
    // Close connections in batches
    const batchSize = 50;
    for (let i = 0; i < connectionIds.length; i += batchSize) {
      const batch = connectionIds.slice(i, i + batchSize);
      
      for (const connectionId of batch) {
        shutdownPromises.push(this.closeConnection(connectionId));
      }
      
      await this.sleep(100); // Brief pause between batches
    }
    
    await Promise.allSettled(shutdownPromises);
    console.log(`Shutdown complete: ${this.metrics.disconnected} connections closed`);
  }

  async createConnection(connectionId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000/api/ws/load-test', [], {
        headers: {
          'X-Connection-Id': connectionId,
          'X-Load-Test': 'true'
        }
      });
      
      const timeout = setTimeout(() => {
        ws.close();
        this.metrics.failed++;
        reject(new Error(`Connection timeout: ${connectionId}`));
      }, 10000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        
        this.connections.set(connectionId, {
          socket: ws,
          connectedAt: Date.now(),
          messagesSent: 0,
          messagesReceived: 0,
          latencies: []
        });
        
        this.metrics.connected++;
        
        // Set up message handling
        ws.on('message', (data) => this.handleMessage(connectionId, data));
        ws.on('close', () => this.handleDisconnection(connectionId));
        ws.on('error', (error) => this.handleError(connectionId, error));
        
        resolve(connectionId);
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.metrics.failed++;
        this.metrics.errors.push({
          connectionId,
          error: error.message,
          timestamp: Date.now()
        });
        reject(error);
      });
    });
  }

  async sendTestMessage(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const message = {
      type: 'load_test_message',
      connectionId,
      timestamp: Date.now(),
      sequenceNumber: connection.messagesSent,
      data: {
        content: `Load test message from ${connectionId}`,
        payload: 'A'.repeat(100) // 100 byte payload
      }
    };
    
    try {
      connection.socket.send(JSON.stringify(message));
      connection.messagesSent++;
      this.metrics.messagesExchanged++;
    } catch (error) {
      this.handleError(connectionId, error);
    }
  }

  async sendBurstMessage(connectionId, burstId, messageId) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const message = {
      type: 'burst_test_message',
      connectionId,
      burstId,
      messageId,
      timestamp: Date.now(),
      data: {
        content: `Burst message ${burstId}-${messageId}`,
        payload: 'B'.repeat(200) // 200 byte payload for burst
      }
    };
    
    try {
      connection.socket.send(JSON.stringify(message));
      connection.messagesSent++;
      this.metrics.messagesExchanged++;
    } catch (error) {
      this.handleError(connectionId, error);
    }
  }

  handleMessage(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    try {
      const message = JSON.parse(data.toString());
      connection.messagesReceived++;
      
      // Calculate latency for echo messages
      if (message.type === 'echo' && message.originalTimestamp) {
        const latency = Date.now() - message.originalTimestamp;
        connection.latencies.push(latency);
        
        // Update average latency
        const totalLatency = connection.latencies.reduce((sum, lat) => sum + lat, 0);
        this.metrics.averageLatency = totalLatency / connection.latencies.length;
      }
      
    } catch (error) {
      this.handleError(connectionId, new Error('Invalid message format'));
    }
  }

  handleDisconnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connections.delete(connectionId);
      this.metrics.disconnected++;
    }
  }

  handleError(connectionId, error) {
    this.metrics.errors.push({
      connectionId,
      error: error.message,
      timestamp: Date.now()
    });
    
    // Close and remove problematic connections
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.socket.close();
      } catch (e) {
        // Ignore close errors
      }
      this.connections.delete(connectionId);
    }
  }

  async closeConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    return new Promise((resolve) => {
      connection.socket.close();
      
      // Force cleanup after timeout
      setTimeout(() => {
        this.connections.delete(connectionId);
        resolve();
      }, 1000);
    });
  }

  selectRandomConnections(connectionIds, percentage) {
    const count = Math.floor(connectionIds.length * percentage);
    const selected = [];
    
    for (let i = 0; i < count; i++) {
      const index = Math.floor(Math.random() * connectionIds.length);
      selected.push(connectionIds[index]);
    }
    
    return selected;
  }

  startMetricReporting() {
    const reportInterval = setInterval(() => {
      if (!this.testActive) {
        clearInterval(reportInterval);
        return;
      }
      
      const runtime = Date.now() - this.startTime;
      
      console.log(`\n=== WebSocket Load Test Metrics (${Math.floor(runtime / 1000)}s) ===`);
      console.log(`Active Connections: ${this.connections.size}`);
      console.log(`Total Connected: ${this.metrics.connected}`);
      console.log(`Total Disconnected: ${this.metrics.disconnected}`);
      console.log(`Connection Failures: ${this.metrics.failed}`);
      console.log(`Messages Exchanged: ${this.metrics.messagesExchanged}`);
      console.log(`Average Latency: ${this.metrics.averageLatency.toFixed(2)}ms`);
      console.log(`Peak Connections: ${this.metrics.peakConnections}`);
      console.log(`Recent Errors: ${this.metrics.errors.length}`);
      
      // Emit metrics for external monitoring
      this.emit('metrics', {
        activeConnections: this.connections.size,
        totalConnected: this.metrics.connected,
        totalDisconnected: this.metrics.disconnected,
        connectionFailures: this.metrics.failed,
        messagesExchanged: this.metrics.messagesExchanged,
        averageLatency: this.metrics.averageLatency,
        peakConnections: this.metrics.peakConnections,
        errorCount: this.metrics.errors.length,
        runtime
      });
      
    }, 10000); // Report every 10 seconds
  }

  generateTestReport() {
    const runtime = Date.now() - this.startTime;
    
    return {
      summary: {
        testDuration: runtime,
        targetConnections: this.options.maxConnections,
        peakConnections: this.metrics.peakConnections,
        totalMessagesExchanged: this.metrics.messagesExchanged,
        averageLatency: this.metrics.averageLatency,
        successRate: (this.metrics.connected / (this.metrics.connected + this.metrics.failed)) * 100
      },
      connectionMetrics: {
        connected: this.metrics.connected,
        disconnected: this.metrics.disconnected,
        failed: this.metrics.failed,
        activeAtEnd: this.connections.size
      },
      messageMetrics: {
        totalExchanged: this.metrics.messagesExchanged,
        averageRate: this.metrics.messagesExchanged / (runtime / 1000),
        averageLatency: this.metrics.averageLatency
      },
      errorMetrics: {
        totalErrors: this.metrics.errors.length,
        errorRate: (this.metrics.errors.length / this.metrics.messagesExchanged) * 100,
        recentErrors: this.metrics.errors.slice(-10)
      },
      performanceAssessment: {
        passedConnectionTarget: this.metrics.peakConnections >= this.options.maxConnections * 0.9,
        passedLatencyTarget: this.metrics.averageLatency < 100,
        passedSuccessRate: (this.metrics.connected / (this.metrics.connected + this.metrics.failed)) > 0.95,
        passedStabilityTest: this.metrics.errors.length < this.metrics.messagesExchanged * 0.01
      },
      recommendations: this.generateRecommendations()
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.metrics.averageLatency > 100) {
      recommendations.push('High average latency detected. Consider WebSocket connection pooling optimization.');
    }
    
    if (this.metrics.failed / (this.metrics.connected + this.metrics.failed) > 0.05) {
      recommendations.push('High connection failure rate. Review server connection limits and timeout settings.');
    }
    
    if (this.metrics.peakConnections < this.options.maxConnections * 0.9) {
      recommendations.push('Unable to reach target connection count. Investigate server capacity limits.');
    }
    
    if (this.metrics.errors.length > this.metrics.messagesExchanged * 0.01) {
      recommendations.push('High error rate detected. Review WebSocket message handling and error recovery.');
    }
    
    return recommendations;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { WebSocketLoadTester };

// Artillery integration functions
module.exports.wsLoadTest = function(context, events, done) {
  const tester = new WebSocketLoadTester({
    maxConnections: 100,
    messageRate: 5,
    testDuration: 30000 // 30 seconds for Artillery integration
  });
  
  tester.on('metrics', (metrics) => {
    Object.keys(metrics).forEach(key => {
      events.emit('customStat', `ws.${key}`, metrics[key]);
    });
  });
  
  tester.startLoadTest()
    .then(report => {
      console.log('WebSocket load test completed');
      done();
    })
    .catch(error => {
      console.error('WebSocket load test failed:', error);
      done(error);
    });
};

// Standalone execution for development testing
if (require.main === module) {
  const tester = new WebSocketLoadTester({
    maxConnections: 500,
    messageRate: 10,
    testDuration: 180000 // 3 minutes
  });
  
  tester.startLoadTest()
    .then(report => {
      console.log('\n=== Final WebSocket Load Test Report ===');
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(error => {
      console.error('Load test failed:', error);
      process.exit(1);
    });
}