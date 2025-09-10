-- Performance Optimization Database Indexes
-- Optimized for high-concurrency workloads supporting 1,000+ concurrent planning sessions

-- User and Authentication Indexes
-- Critical for session authentication and user lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active 
ON users(email) WHERE active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_subscription_tier 
ON users(subscription_tier, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_token_active 
ON user_sessions(session_token) WHERE expires_at > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_id_active 
ON user_sessions(user_id, created_at DESC) WHERE expires_at > NOW();

-- Planning Sessions Indexes
-- Core indexes for session management and retrieval
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_id_status_created 
ON planning_sessions(user_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_status_updated 
ON planning_sessions(status, updated_at DESC) WHERE status IN ('active', 'in_progress');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_methodology_created 
ON planning_sessions(methodology, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_collaborative 
ON planning_sessions(is_collaborative, participant_count DESC) WHERE is_collaborative = true;

-- Session Activities Indexes
-- Optimized for real-time collaboration and activity tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_activities_session_id_timestamp 
ON session_activities(session_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_activities_user_id_session_timestamp 
ON session_activities(user_id, session_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_activities_type_session 
ON session_activities(activity_type, session_id, created_at DESC);

-- Composite index for activity queries with filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_activities_composite 
ON session_activities(session_id, activity_type, user_id, created_at DESC);

-- LLM Interactions Indexes
-- Critical for LLM request processing and caching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_session_id_timestamp 
ON llm_requests(session_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_user_id_status 
ON llm_requests(user_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_cache_key 
ON llm_requests(cache_key) WHERE cache_key IS NOT NULL;

-- Hash index for exact cache key lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_cache_key_hash 
ON llm_requests USING HASH(cache_key) WHERE cache_key IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_provider_model 
ON llm_requests(provider, model, status, created_at DESC);

-- Export Operations Indexes
-- Optimized for export history and batch processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exports_user_id_status_created 
ON exports(user_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exports_session_id_format 
ON exports(session_id, format, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exports_batch_id 
ON exports(batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exports_status_processing 
ON exports(status, created_at) WHERE status IN ('processing', 'queued');

-- Batch Export Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_batch_exports_user_id_status 
ON batch_exports(user_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_batch_exports_status_priority 
ON batch_exports(status, priority DESC, created_at) WHERE status IN ('queued', 'processing');

-- Feature Flags and Subscriptions Indexes
-- Critical for access control and feature gating
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_features_user_id_feature 
ON user_features(user_id, feature_flag);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_id_active 
ON subscriptions(user_id, status, expires_at DESC) WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_usage_user_period 
ON subscription_usage(user_id, period_start DESC, period_end DESC);

-- Real-time Collaboration Indexes
-- WebSocket connections and live session participants
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_participants_session_id_active 
ON session_participants(session_id, joined_at DESC) WHERE left_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_participants_user_session 
ON session_participants(user_id, session_id, joined_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_websocket_connections_session_user 
ON websocket_connections(session_id, user_id, connected_at DESC) WHERE disconnected_at IS NULL;

-- Analytics and Reporting Indexes
-- Performance monitoring and usage analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_metrics_timestamp_metric 
ON performance_metrics(recorded_at DESC, metric_name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_metrics_session_id 
ON performance_metrics(session_id, recorded_at DESC) WHERE session_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_analytics_user_date 
ON usage_analytics(user_id, date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_analytics_date_activity 
ON usage_analytics(date DESC, activity_type);

-- Error Logging and Monitoring Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_timestamp_level 
ON error_logs(created_at DESC, error_level);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_session_user 
ON error_logs(session_id, user_id, created_at DESC) WHERE session_id IS NOT NULL;

-- Cache Management Indexes
-- Redis cache keys and expiration management
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_entries_key_hash 
ON cache_entries USING HASH(cache_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_entries_expires_at 
ON cache_entries(expires_at) WHERE expires_at IS NOT NULL;

-- Session State Indexes
-- Critical for session persistence and recovery
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_state_session_id_version 
ON session_state(session_id, version DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_state_updated_at 
ON session_state(updated_at DESC) WHERE expires_at > NOW();

-- Notification and Communication Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id_status 
ON notifications(user_id, read_status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_type_created 
ON notifications(notification_type, created_at DESC) WHERE read_status = false;

-- Database Maintenance Indexes
-- Support for cleanup and archival operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_table_record_timestamp 
ON audit_logs(table_name, record_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id_timestamp 
ON audit_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- Partial indexes for common WHERE clause conditions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active_users 
ON planning_sessions(user_id, updated_at DESC) 
WHERE status IN ('active', 'in_progress') AND deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exports_pending_processing 
ON exports(created_at, priority DESC) 
WHERE status IN ('queued', 'processing') AND deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_requests_recent_active 
ON llm_requests(session_id, created_at DESC) 
WHERE status IN ('processing', 'queued') AND created_at > NOW() - INTERVAL '1 hour';

-- Full-text search indexes
-- For content search and analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_title_description_fts 
ON planning_sessions USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_content_fts 
ON session_activities USING gin(to_tsvector('english', COALESCE(content, '')));

-- Statistics and cardinality optimization
-- Update table statistics for query planner optimization
ANALYZE users;
ANALYZE planning_sessions;
ANALYZE session_activities;
ANALYZE llm_requests;
ANALYZE exports;
ANALYZE batch_exports;
ANALYZE session_participants;
ANALYZE performance_metrics;

-- View creation for commonly queried data
CREATE OR REPLACE VIEW active_sessions_with_participants AS
SELECT 
    s.id,
    s.user_id,
    s.title,
    s.status,
    s.methodology,
    s.created_at,
    s.updated_at,
    COUNT(p.user_id) as participant_count,
    MAX(p.joined_at) as last_participant_joined
FROM planning_sessions s
LEFT JOIN session_participants p ON s.id = p.session_id AND p.left_at IS NULL
WHERE s.status IN ('active', 'in_progress') AND s.deleted_at IS NULL
GROUP BY s.id, s.user_id, s.title, s.status, s.methodology, s.created_at, s.updated_at;

-- Index on the materialized view if it becomes a materialized view later
-- CREATE INDEX idx_active_sessions_view_user_updated ON active_sessions_with_participants(user_id, updated_at DESC);

-- Performance monitoring queries optimization
CREATE OR REPLACE VIEW session_performance_summary AS
SELECT 
    DATE_TRUNC('hour', s.created_at) as hour,
    COUNT(*) as sessions_created,
    COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as sessions_completed,
    AVG(EXTRACT(EPOCH FROM (s.updated_at - s.created_at))) as avg_session_duration,
    COUNT(DISTINCT s.user_id) as unique_users
FROM planning_sessions s
WHERE s.created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', s.created_at)
ORDER BY hour DESC;

-- Concurrency optimization settings
-- These should be run with appropriate privileges and monitoring

-- Increase statistics target for better query planning
ALTER TABLE planning_sessions ALTER COLUMN user_id SET STATISTICS 1000;
ALTER TABLE planning_sessions ALTER COLUMN status SET STATISTICS 1000;
ALTER TABLE session_activities ALTER COLUMN session_id SET STATISTICS 1000;
ALTER TABLE llm_requests ALTER COLUMN session_id SET STATISTICS 1000;

-- Enable auto-vacuum tuning for high-traffic tables
ALTER TABLE planning_sessions SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_cost_delay = 10
);

ALTER TABLE session_activities SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_cost_delay = 10
);

ALTER TABLE llm_requests SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 10
);

-- Connection pooling and performance optimization settings
-- Note: These are PostgreSQL configuration settings that should be applied to postgresql.conf

/*
Recommended postgresql.conf settings for 1,000+ concurrent sessions:

# Connection Settings
max_connections = 1000
shared_buffers = 4GB
effective_cache_size = 12GB
maintenance_work_mem = 1GB
checkpoint_completion_target = 0.9
wal_buffers = 64MB
default_statistics_target = 1000

# Connection Pooling (via pgbouncer)
# pool_mode = session
# default_pool_size = 100
# max_client_conn = 1000
# max_db_connections = 200

# Logging for Performance Analysis
log_min_duration_statement = 1000
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_statement = 'ddl'
log_line_prefix = '%t [%p]: user=%u,db=%d,app=%a,client=%h '

# Memory Settings
work_mem = 32MB
hash_mem_multiplier = 2.0
random_page_cost = 1.1  # For SSD storage

# Parallel Processing
max_parallel_workers_per_gather = 4
max_parallel_workers = 16
max_worker_processes = 16

# Autovacuum Settings
autovacuum = on
autovacuum_max_workers = 6
autovacuum_naptime = 15s
autovacuum_vacuum_cost_delay = 10ms
autovacuum_vacuum_cost_limit = 1000
*/