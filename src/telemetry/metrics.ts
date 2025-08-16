import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { logger } from './logger';

export class MetricsService {
  private static instance: MetricsService;
  
  public readonly httpRequestDuration: Histogram<string>;
  public readonly httpRequestTotal: Counter<string>;
  public readonly httpRequestErrors: Counter<string>;
  public readonly dbQueryDuration: Histogram<string>;
  public readonly dbConnectionPool: Gauge<string>;
  public readonly newsItemsTotal: Counter<string>;
  public readonly votesTotal: Counter<string>;
  public readonly activeUsers: Gauge<string>;
  public readonly memoryUsage: Gauge<string>;
  public readonly cpuUsage: Gauge<string>;
  public readonly responseSize: Summary<string>;
  public readonly cacheHits: Counter<string>;
  public readonly cacheMisses: Counter<string>;
  public readonly rateLimitHits: Counter<string>;
  public readonly externalApiCalls: Counter<string>;
  public readonly externalApiDuration: Histogram<string>;
  public readonly businessMetrics: {
    newsPosted: Counter<string>;
    votescast: Counter<string>;
    userEngagement: Histogram<string>;
  };

  private constructor() {
    collectDefaultMetrics({ register, prefix: 'agentic_ai_news_' });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    });

    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    });

    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type']
    });

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'table', 'database_type'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]
    });

    this.dbConnectionPool = new Gauge({
      name: 'db_connection_pool_size',
      help: 'Number of database connections in the pool',
      labelNames: ['state', 'database_type']
    });

    this.newsItemsTotal = new Counter({
      name: 'news_items_total',
      help: 'Total number of news items created',
      labelNames: ['source', 'author_type']
    });

    this.votesTotal = new Counter({
      name: 'votes_total',
      help: 'Total number of votes cast',
      labelNames: ['vote_type', 'vote_source']
    });

    this.activeUsers = new Gauge({
      name: 'active_users',
      help: 'Number of active users',
      labelNames: ['user_type']
    });

    this.memoryUsage = new Gauge({
      name: 'memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type']
    });

    this.cpuUsage = new Gauge({
      name: 'cpu_usage_percent',
      help: 'CPU usage percentage',
      labelNames: ['core']
    });

    this.responseSize = new Summary({
      name: 'http_response_size_bytes',
      help: 'Size of HTTP responses in bytes',
      labelNames: ['method', 'route'],
      percentiles: [0.5, 0.9, 0.95, 0.99]
    });

    this.cacheHits = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type']
    });

    this.cacheMisses = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type']
    });

    this.rateLimitHits = new Counter({
      name: 'rate_limit_hits_total',
      help: 'Total number of rate limit hits',
      labelNames: ['endpoint', 'ip_range']
    });

    this.externalApiCalls = new Counter({
      name: 'external_api_calls_total',
      help: 'Total number of external API calls',
      labelNames: ['api', 'endpoint', 'status']
    });

    this.externalApiDuration = new Histogram({
      name: 'external_api_duration_seconds',
      help: 'Duration of external API calls in seconds',
      labelNames: ['api', 'endpoint'],
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    });

    this.businessMetrics = {
      newsPosted: new Counter({
        name: 'business_news_posted_total',
        help: 'Total news items posted',
        labelNames: ['author_type', 'category']
      }),
      votescast: new Counter({
        name: 'business_votes_cast_total',
        help: 'Total votes cast',
        labelNames: ['vote_type', 'source_type']
      }),
      userEngagement: new Histogram({
        name: 'business_user_engagement_score',
        help: 'User engagement score',
        labelNames: ['user_type'],
        buckets: [0, 1, 5, 10, 25, 50, 100]
      })
    };

    this.startResourceMonitoring();
    
    logger.info('Metrics service initialized');
  }

  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  private startResourceMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.memoryUsage.set({ type: 'rss' }, memUsage.rss);
      this.memoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
      this.memoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
      this.memoryUsage.set({ type: 'external' }, memUsage.external);

      const cpuUsage = process.cpuUsage();
      const totalCpu = cpuUsage.user + cpuUsage.system;
      this.cpuUsage.set({ core: 'total' }, totalCpu / 1000000);
    }, 10000);
  }

  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    const labels = { method, route, status_code: statusCode.toString() };
    this.httpRequestDuration.observe(labels, duration / 1000);
    this.httpRequestTotal.inc(labels);
    
    if (statusCode >= 400) {
      this.httpRequestErrors.inc({
        method,
        route,
        error_type: statusCode >= 500 ? 'server_error' : 'client_error'
      });
    }
  }

  recordDbQuery(operation: string, table: string, duration: number, dbType: string = 'sqlite') {
    this.dbQueryDuration.observe(
      { operation, table, database_type: dbType },
      duration / 1000
    );
  }

  recordNewsItem(source: string, authorType: string) {
    this.newsItemsTotal.inc({ source, author_type: authorType });
    this.businessMetrics.newsPosted.inc({ 
      author_type: authorType, 
      category: 'ai-news' 
    });
  }

  recordVote(voteType: 'up' | 'down', voteSource: 'human' | 'machine') {
    this.votesTotal.inc({ vote_type: voteType, vote_source: voteSource });
    this.businessMetrics.votescast.inc({ 
      vote_type: voteType, 
      source_type: voteSource 
    });
  }

  recordUserEngagement(userType: string, score: number) {
    this.businessMetrics.userEngagement.observe({ user_type: userType }, score);
  }

  updateActiveUsers(count: number, userType: string = 'anonymous') {
    this.activeUsers.set({ user_type: userType }, count);
  }

  recordCacheOperation(hit: boolean, cacheType: string = 'default') {
    if (hit) {
      this.cacheHits.inc({ cache_type: cacheType });
    } else {
      this.cacheMisses.inc({ cache_type: cacheType });
    }
  }

  recordRateLimitHit(endpoint: string, ipRange: string = 'unknown') {
    this.rateLimitHits.inc({ endpoint, ip_range: ipRange });
  }

  recordExternalApiCall(api: string, endpoint: string, status: 'success' | 'failure', duration?: number) {
    this.externalApiCalls.inc({ api, endpoint, status });
    if (duration) {
      this.externalApiDuration.observe({ api, endpoint }, duration / 1000);
    }
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  reset() {
    register.clear();
  }
}

export const metrics = MetricsService.getInstance();