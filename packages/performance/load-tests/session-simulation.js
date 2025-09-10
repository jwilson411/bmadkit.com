const { EventEmitter } = require('events');
const WebSocket = require('ws');

/**
 * Artillery custom engine for realistic planning session simulation
 * Handles complex user workflows, WebSocket connections, and session state management
 */
class PlanningSessionSimulation extends EventEmitter {
  constructor(script, ee, helpers) {
    super();
    this.script = script;
    this.ee = ee;
    this.helpers = helpers;
    
    // Session state management
    this.activeSessions = new Map();
    this.sessionMetrics = {
      created: 0,
      completed: 0,
      failed: 0,
      avgDuration: 0,
      concurrentPeak: 0
    };
    
    // WebSocket connection pool
    this.wsConnections = new Map();
    this.wsMetrics = {
      connected: 0,
      disconnected: 0,
      messagesExchanged: 0,
      errors: 0
    };
    
    this.setupMetricReporting();
  }

  setupMetricReporting() {
    // Report custom metrics every 5 seconds
    setInterval(() => {
      this.ee.emit('customStat', 'sessions.active', this.activeSessions.size);
      this.ee.emit('customStat', 'sessions.created_total', this.sessionMetrics.created);
      this.ee.emit('customStat', 'sessions.completed_total', this.sessionMetrics.completed);
      this.ee.emit('customStat', 'sessions.failed_total', this.sessionMetrics.failed);
      this.ee.emit('customStat', 'websockets.active', this.wsConnections.size);
      this.ee.emit('customStat', 'websockets.messages_total', this.wsMetrics.messagesExchanged);
      
      // Track peak concurrent sessions
      if (this.activeSessions.size > this.sessionMetrics.concurrentPeak) {
        this.sessionMetrics.concurrentPeak = this.activeSessions.size;
        this.ee.emit('customStat', 'sessions.concurrent_peak', this.sessionMetrics.concurrentPeak);
      }
    }, 5000);
  }

  /**
   * Simulate a realistic planning session workflow
   */
  async simulatePlanningSession(context, events, done) {
    const startTime = Date.now();
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const userId = context.vars.userId || `user_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Track session start
      this.activeSessions.set(sessionId, {
        startTime,
        userId,
        phase: 'initialization',
        activities: []
      });
      this.sessionMetrics.created++;

      // Phase 1: Session Initialization
      await this.simulateSessionInitialization(context, sessionId, userId);
      
      // Phase 2: Planning Activities
      await this.simulatePlanningActivities(context, sessionId, userId);
      
      // Phase 3: Collaboration and Real-time Updates
      await this.simulateRealTimeCollaboration(context, sessionId, userId);
      
      // Phase 4: LLM Interactions
      await this.simulateLLMInteractions(context, sessionId, userId);
      
      // Phase 5: Export and Documentation
      await this.simulateExportOperations(context, sessionId, userId);
      
      // Phase 6: Session Cleanup
      await this.simulateSessionCleanup(context, sessionId, userId);
      
      // Mark session as completed
      const session = this.activeSessions.get(sessionId);
      session.phase = 'completed';
      session.duration = Date.now() - startTime;
      
      this.sessionMetrics.completed++;
      this.sessionMetrics.avgDuration = 
        (this.sessionMetrics.avgDuration * (this.sessionMetrics.completed - 1) + session.duration) / 
        this.sessionMetrics.completed;
      
      this.activeSessions.delete(sessionId);
      
      done();
    } catch (error) {
      this.sessionMetrics.failed++;
      this.activeSessions.delete(sessionId);
      
      this.ee.emit('error', error);
      done(error);
    }
  }

  async simulateSessionInitialization(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'initialization';
    
    // Simulate session creation API call
    const createSessionStart = Date.now();
    
    // Mock API call timing
    await this.simulateAPICall('POST', '/api/sessions', {
      sessionId,
      title: `Planning Session ${sessionId}`,
      type: this.getRandomSessionType(),
      methodology: this.getRandomMethodology(),
      userId
    });
    
    const createSessionTime = Date.now() - createSessionStart;
    this.ee.emit('customStat', 'api.session_creation_time', createSessionTime);
    
    session.activities.push({
      type: 'session_created',
      timestamp: Date.now(),
      duration: createSessionTime
    });
  }

  async simulatePlanningActivities(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'planning_activities';
    
    const activityTypes = [
      'stakeholder_identification',
      'requirement_gathering',
      'risk_assessment',
      'resource_planning',
      'timeline_definition'
    ];
    
    // Simulate multiple planning activities
    for (let i = 0; i < 3; i++) {
      const activityStart = Date.now();
      const activityType = activityTypes[Math.floor(Math.random() * activityTypes.length)];
      
      await this.simulateAPICall('POST', `/api/sessions/${sessionId}/activities`, {
        type: activityType,
        content: this.generatePlanningContent(activityType),
        userId
      });
      
      // Simulate thinking time between activities
      await this.sleep(1000 + Math.random() * 2000);
      
      const activityTime = Date.now() - activityStart;
      session.activities.push({
        type: activityType,
        timestamp: Date.now(),
        duration: activityTime
      });
    }
  }

  async simulateRealTimeCollaboration(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'real_time_collaboration';
    
    // Establish WebSocket connection
    const wsUrl = `ws://localhost:3000/api/sessions/${sessionId}/ws`;
    const ws = await this.establishWebSocketConnection(wsUrl, {
      Authorization: `Bearer ${context.vars.authToken}`,
      'User-Id': userId
    });
    
    if (ws) {
      this.wsConnections.set(sessionId, ws);
      this.wsMetrics.connected++;
      
      // Simulate real-time updates
      const updatePromises = [];
      for (let i = 0; i < 5; i++) {
        updatePromises.push(this.sendWebSocketUpdate(ws, sessionId, userId));
        await this.sleep(500 + Math.random() * 1000);
      }
      
      await Promise.all(updatePromises);
      
      // Close WebSocket connection
      ws.close();
      this.wsConnections.delete(sessionId);
      this.wsMetrics.disconnected++;
    }
  }

  async simulateLLMInteractions(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'llm_interactions';
    
    const queries = [
      "Analyze the key stakeholders for this project and their influence levels",
      "Identify potential risks in the current project timeline",
      "Suggest optimization strategies for resource allocation",
      "Provide recommendations for stakeholder communication plan"
    ];
    
    // Simulate concurrent LLM queries
    const llmPromises = queries.map(async (query, index) => {
      await this.sleep(index * 500); // Stagger requests
      
      const llmStart = Date.now();
      
      await this.simulateAPICall('POST', `/api/sessions/${sessionId}/llm-query`, {
        query,
        context: session.activities.map(a => a.type),
        userId
      });
      
      const llmTime = Date.now() - llmStart;
      this.ee.emit('customStat', 'api.llm_response_time', llmTime);
      
      return llmTime;
    });
    
    await Promise.all(llmPromises);
  }

  async simulateExportOperations(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'export_operations';
    
    const exportFormats = ['markdown', 'json', 'pdf'];
    const selectedFormat = exportFormats[Math.floor(Math.random() * exportFormats.length)];
    
    const exportStart = Date.now();
    
    await this.simulateAPICall('POST', '/api/export/single', {
      sessionId,
      format: selectedFormat,
      options: {
        includeMetadata: true,
        includeActivities: true
      },
      userId
    });
    
    const exportTime = Date.now() - exportStart;
    this.ee.emit('customStat', 'api.export_time', exportTime);
    
    session.activities.push({
      type: 'export_generated',
      timestamp: Date.now(),
      duration: exportTime,
      format: selectedFormat
    });
  }

  async simulateSessionCleanup(context, sessionId, userId) {
    const session = this.activeSessions.get(sessionId);
    session.phase = 'cleanup';
    
    // Simulate session finalization
    await this.simulateAPICall('PUT', `/api/sessions/${sessionId}/finalize`, {
      status: 'completed',
      summary: 'Load test session completed successfully',
      userId
    });
    
    // Random chance to delete session (10% of sessions)
    if (Math.random() < 0.1) {
      await this.simulateAPICall('DELETE', `/api/sessions/${sessionId}`, { userId });
    }
  }

  async establishWebSocketConnection(url, headers) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, [], { headers });
      const timeout = setTimeout(() => {
        ws.close();
        this.wsMetrics.errors++;
        resolve(null);
      }, 5000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve(ws);
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.wsMetrics.errors++;
        resolve(null);
      });
    });
  }

  async sendWebSocketUpdate(ws, sessionId, userId) {
    if (ws.readyState === WebSocket.OPEN) {
      const updateData = {
        sessionId,
        userId,
        type: 'planning_update',
        data: {
          content: this.generatePlanningContent('update'),
          timestamp: Date.now(),
          version: Math.floor(Math.random() * 100)
        }
      };
      
      ws.send(JSON.stringify(updateData));
      this.wsMetrics.messagesExchanged++;
    }
  }

  async simulateAPICall(method, endpoint, data) {
    // Simulate network latency and processing time
    const baseLatency = 50 + Math.random() * 100; // 50-150ms base latency
    const processingTime = method === 'GET' ? 10 + Math.random() * 40 : 50 + Math.random() * 200;
    
    await this.sleep(baseLatency + processingTime);
    
    // Simulate occasional API failures (2% failure rate)
    if (Math.random() < 0.02) {
      throw new Error(`API call failed: ${method} ${endpoint}`);
    }
  }

  getRandomSessionType() {
    const types = [
      'strategic_planning',
      'requirements_analysis',
      'risk_assessment',
      'stakeholder_mapping',
      'resource_planning'
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  getRandomMethodology() {
    const methodologies = ['agile', 'waterfall', 'lean', 'design_thinking'];
    return methodologies[Math.floor(Math.random() * methodologies.length)];
  }

  generatePlanningContent(contentType) {
    const contentTemplates = {
      stakeholder_identification: [
        'Primary stakeholder: Project Sponsor - High influence, High interest',
        'Secondary stakeholder: End Users - Medium influence, High interest',
        'Tertiary stakeholder: IT Department - Low influence, Medium interest'
      ],
      requirement_gathering: [
        'Functional requirement: System must support concurrent users',
        'Non-functional requirement: Response time under 3 seconds',
        'Business requirement: ROI improvement of 15% within 6 months'
      ],
      risk_assessment: [
        'Technical risk: Integration complexity with legacy systems',
        'Business risk: Market conditions affecting project timeline',
        'Resource risk: Key personnel availability during peak periods'
      ],
      update: [
        'Session progress update: Completed stakeholder analysis phase',
        'Collaborative input: New requirement identified by stakeholder',
        'Real-time change: Risk mitigation strategy updated'
      ]
    };
    
    const templates = contentTemplates[contentType] || contentTemplates.update;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  PlanningSessionSimulation
};

// Export functions for Artillery
module.exports.simulatePlanningSession = function(context, events, done) {
  const simulation = new PlanningSessionSimulation(null, events, null);
  simulation.simulatePlanningSession(context, events, done);
};

module.exports.simulateHighConcurrency = function(context, events, done) {
  // Simplified high-concurrency simulation
  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  Promise.resolve()
    .then(() => {
      events.emit('customStat', 'concurrent_user_simulation', 1);
      return new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
    })
    .then(() => done())
    .catch(error => done(error));
};

module.exports.simulateDatabaseStress = function(context, events, done) {
  // Database-intensive operations simulation
  const operations = [
    'session_query',
    'user_lookup',
    'activity_search',
    'export_history',
    'analytics_aggregation'
  ];
  
  Promise.all(operations.map(op => {
    const startTime = Date.now();
    return new Promise(resolve => {
      setTimeout(() => {
        const duration = Date.now() - startTime;
        events.emit('customStat', `db.${op}_time`, duration);
        resolve();
      }, 100 + Math.random() * 500);
    });
  }))
  .then(() => done())
  .catch(error => done(error));
};