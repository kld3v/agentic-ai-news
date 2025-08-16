# 📡 Telemetry & Monitoring Guide

## 🎯 Where to Find Everything

### 1. **Real-time Web Dashboard**
```bash
# Start the server
npm run dev

# Open in browser
http://localhost:3000/monitor.html
```
This dashboard shows:
- Health status & uptime
- Live metrics (requests, errors, performance)
- Error tracking with severity levels
- Debug information
- Real-time logs simulation
- Test controls to trigger different scenarios

### 2. **HTTP Endpoints**

#### Health Check
```bash
curl http://localhost:3000/health
```
Returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "memory": { "rss": 89456640, "heapUsed": 45678901 },
  "cpu": { "user": 123456, "system": 78901 },
  "version": "1.0.0"
}
```

#### Prometheus Metrics
```bash
curl http://localhost:3000/metrics
```
Returns Prometheus-formatted metrics:
```
# HELP http_request_duration_seconds Duration of HTTP requests in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.001",method="GET",route="/",status_code="200"} 145
http_request_duration_seconds_sum{method="GET",route="/",status_code="200"} 12.456
http_requests_total{method="GET",route="/",status_code="200"} 1234
...
```

#### Error Statistics
```bash
curl http://localhost:3000/errors
```
Returns:
```json
{
  "total": 5,
  "resolved": 2,
  "unresolved": 3,
  "bySeverity": {
    "critical": 1,
    "high": 1,
    "medium": 2,
    "low": 1
  },
  "mostFrequent": [...]
}
```

#### Debug Information
```bash
curl http://localhost:3000/debug
```
Returns current debug sessions, breakpoints, and system metrics

### 3. **Log Files (Production)**

Logs are stored in `/home/kolya/Code/agentic-ai-news/logs/`:

```bash
# View today's combined logs
tail -f logs/$(date +%Y-%m-%d)-combined.log

# View error logs only
tail -f logs/$(date +%Y-%m-%d)-error.log

# View performance logs
tail -f logs/$(date +%Y-%m-%d)-performance.log

# Exception logs (crashes)
cat logs/exceptions.log

# Unhandled promise rejections
cat logs/rejections.log
```

### 4. **Development Console Logs**

In development mode, logs appear in the console with colors:
- 🟢 **Green**: Info messages
- 🟡 **Yellow**: Warnings
- 🔴 **Red**: Errors
- ⚪ **Gray**: Debug messages

Each log includes:
- Timestamp
- Log level
- Trace ID (for distributed tracing)
- Message
- Metadata (JSON)

### 5. **Database Query Logs**

Database operations are logged with:
- Query ID
- SQL statement
- Parameters
- Duration
- Row count
- Slow query warnings (>1000ms)

Example:
```
10:30:45.123 [DEBUG] [trace:abc123]: Database: insert | {"queryId":"query_1_1234567890","query":"INSERT INTO news_items...","duration":5,"rows":1}
```

### 6. **Testing the Telemetry**

#### Test Error Tracking
```bash
# Trigger a 500 error
curl -X POST http://localhost:3000/news \
  -H "Content-Type: application/json" \
  -d '{"summary":"x","link":"invalid-url"}'
```

#### Test Rate Limiting
```bash
# Send 101 requests quickly (limit is 100/minute)
for i in {1..101}; do curl http://localhost:3000/ & done
```

#### Test Slow Query Detection
```bash
# This will trigger a slow query warning in logs
curl http://localhost:3000/?sort=top
```

#### Test Security Middleware
```bash
# Try SQL injection (will be blocked)
curl "http://localhost:3000/?q='; DROP TABLE users;--"
```

#### Test Metrics Recording
```bash
# Create news item (increments news_items_total metric)
curl -X POST http://localhost:3000/news \
  -H "Content-Type: application/json" \
  -d '{"summary":"Test news","link":"https://example.com","author":"Test"}'

# Vote (increments votes_total metric)
curl -X POST http://localhost:3000/vote \
  -H "Content-Type: application/json" \
  -d '{"newsId":1,"voteType":"up","source":"human"}'
```

### 7. **Integration with External Tools**

#### Grafana Setup
1. Add Prometheus data source: `http://localhost:3000/metrics`
2. Import dashboard JSON from `/debug/grafana-dashboard.json`
3. View real-time metrics and alerts

#### Datadog/New Relic
Set environment variables:
```bash
OTLP_ENABLED=true
OTLP_ENDPOINT=https://your-apm-endpoint/v1/traces
```

#### ELK Stack (Elasticsearch, Logstash, Kibana)
Configure Logstash to read from:
```
/home/kolya/Code/agentic-ai-news/logs/*.log
```

### 8. **Performance Profiling**

#### Memory Profiling
```bash
# Dump heap snapshot
curl -X POST http://localhost:3000/debug/dump \
  -H "Content-Type: application/json" \
  -d '{"name":"heap","state":{"type":"memory"}}'

# View in /debug/dump_heap_*.json
```

#### CPU Profiling
The system automatically tracks CPU usage for requests >100ms

### 9. **Debugging Production Issues**

#### Create Debug Session
```javascript
// In your code
import { debugService } from './telemetry/debugger';

const session = debugService.createDebugSession('investigate-slow-load');
debugService.captureSnapshot(session.id, 'before-query', { user, params });
// ... code ...
debugService.captureSnapshot(session.id, 'after-query', { result });
```

#### Set Breakpoints
```javascript
debugService.setBreakpoint('src/database.ts', 234, 'newsItems.length > 100');
```

### 10. **Common Telemetry Patterns**

#### Track Custom Business Metrics
```javascript
metrics.businessMetrics.userEngagement.observe({ user_type: 'premium' }, score);
```

#### Add Trace Context
```javascript
tracing.setAttributes({
  'user.id': userId,
  'feature.flag': 'new_ui_enabled'
});
```

#### Security Audit
```javascript
logger.audit('data_export', {
  userId: req.user.id,
  resource: 'news_items',
  result: 'success',
  recordCount: 1000
});
```

## 🔥 Quick Commands

```bash
# Watch all logs in real-time
tail -f logs/*.log | grep -v DEBUG

# Count errors in last hour
grep ERROR logs/$(date +%Y-%m-%d)-combined.log | grep "$(date +%H)" | wc -l

# Find slow queries
grep "Slow query detected" logs/*.log

# Check memory usage
curl -s http://localhost:3000/health | jq '.memory'

# Export metrics for analysis
curl -s http://localhost:3000/metrics > metrics_$(date +%s).txt

# View error details
curl -s http://localhost:3000/errors | jq '.mostFrequent[0]'
```

## 🎮 Monitoring Best Practices

1. **Set up alerts** for:
   - Error rate > 1%
   - Response time > 1s
   - Memory usage > 80%
   - Unresolved critical errors

2. **Review daily**:
   - Error trends
   - Performance metrics
   - Slow queries
   - Security events

3. **Archive logs** weekly:
   ```bash
   tar -czf logs_week_$(date +%Y%W).tar.gz logs/*.log
   ```

4. **Dashboard bookmarks**:
   - http://localhost:3000/monitor.html - Main dashboard
   - http://localhost:3000/health - Quick health check
   - http://localhost:3000/metrics - Raw Prometheus metrics
   - http://localhost:3000/errors - Error summary

## 🚨 Troubleshooting

If telemetry isn't working:

1. Check logs directory exists:
   ```bash
   mkdir -p /home/kolya/Code/agentic-ai-news/logs
   ```

2. Verify environment:
   ```bash
   echo "LOG_LEVEL=debug" >> .env
   ```

3. Test endpoints:
   ```bash
   curl http://localhost:3000/health
   ```

4. Check TypeScript build:
   ```bash
   npm run build
   ```

The telemetry system is now your Swiss Army knife for debugging and monitoring! 🎯