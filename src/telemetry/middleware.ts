import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { metrics } from './metrics';
import { tracing } from './tracing';
import { errorTracker } from './errorTracking';
import { SpanKind } from '@opentelemetry/api';
import crypto from 'crypto';

interface RequestWithTelemetry extends Request {
  requestId?: string;
  startTime?: number;
  span?: any;
}

export function requestIdMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  req.requestId = req.headers['x-request-id'] as string || 
                  `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function loggingMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  req.startTime = Date.now();
  
  const logContext = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  logger.info('Request received', logContext);

  const originalSend = res.send;
  res.send = function(data: any) {
    res.send = originalSend;
    const responseTime = Date.now() - (req.startTime || Date.now());
    
    logger.info('Request completed', {
      ...logContext,
      statusCode: res.statusCode,
      duration: responseTime,
      contentLength: res.get('content-length')
    });

    if (responseTime > 1000) {
      logger.warn('Slow request detected', {
        ...logContext,
        duration: responseTime,
        threshold: 1000
      });
    }

    return res.send(data);
  };

  next();
}

export function tracingMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const spanName = `${req.method} ${req.route?.path || req.path}`;
  
  req.span = tracing.createSpan(spanName, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.path,
      'http.host': req.hostname,
      'http.scheme': req.protocol,
      'http.user_agent': req.headers['user-agent'],
      'http.request_id': req.requestId,
      'net.peer.ip': req.ip
    }
  });

  const originalEnd = res.end;
  res.end = function(...args: any[]) {
    if (req.span) {
      req.span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_content_length': res.get('content-length')
      });
      req.span.end();
    }
    return originalEnd.apply(res, args as any);
  };

  next();
}

export function metricsMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const route = req.route?.path || req.path;
    
    metrics.recordHttpRequest(req.method, route, res.statusCode, duration);
    
    const contentLength = res.get('content-length');
    if (contentLength) {
      metrics.responseSize.observe(
        { method: req.method, route },
        parseInt(contentLength)
      );
    }
  });

  next();
}

export function errorHandlingMiddleware(err: Error, req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const context = errorTracker.extractRequestContext(req);
  context.requestId = req.requestId;
  
  const errorId = errorTracker.trackError(err, context);
  
  logger.error('Request error', err, {
    ...context,
    errorId
  });

  if (req.span) {
    req.span.recordException(err);
    req.span.setStatus({ code: 2, message: err.message });
  }

  const statusCode = (err as any).statusCode || (err as any).status || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal Server Error'
    : err.message;

  res.status(statusCode).json({
    error: {
      message,
      errorId,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
}

export function performanceMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const startCpuUsage = process.cpuUsage();
  const startMemory = process.memoryUsage();
  
  res.on('finish', () => {
    const endCpuUsage = process.cpuUsage(startCpuUsage);
    const endMemory = process.memoryUsage();
    
    const cpuTime = (endCpuUsage.user + endCpuUsage.system) / 1000;
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    if (cpuTime > 100 || memoryDelta > 10 * 1024 * 1024) {
      logger.performance('High resource usage detected', {
        duration: Date.now() - (req.startTime || Date.now()),
        cpu: {
          user: endCpuUsage.user / 1000,
          system: endCpuUsage.system / 1000,
          total: cpuTime
        },
        memory: {
          delta: memoryDelta,
          heapUsed: endMemory.heapUsed,
          heapTotal: endMemory.heapTotal,
          rss: endMemory.rss
        },
        request: {
          method: req.method,
          path: req.path,
          requestId: req.requestId
        }
      });
    }
  });
  
  next();
}

export function securityMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const suspiciousPatterns = [
    /\.\.\//g,
    /<script/gi,
    /javascript:/gi,
    /on\w+=/gi,
    /union.*select/gi,
    /drop.*table/gi
  ];
  
  const checkForThreats = (value: string): boolean => {
    return suspiciousPatterns.some(pattern => pattern.test(value));
  };
  
  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });
  
  if (checkForThreats(requestData)) {
    logger.security('Potential security threat detected', {
      requestId: req.requestId,
      threat: 'suspicious_pattern',
      action: 'blocked',
      method: req.method,
      path: req.path,
      ip: req.ip
    });
    
    metrics.httpRequestErrors.inc({
      method: req.method,
      route: req.path,
      error_type: 'security_threat'
    });
    
    return res.status(400).json({
      error: 'Invalid request'
    });
  }
  
  next();
}

export function auditMiddleware(req: RequestWithTelemetry, res: Response, next: NextFunction) {
  const auditableActions = ['POST', 'PUT', 'PATCH', 'DELETE'];
  
  if (auditableActions.includes(req.method)) {
    res.on('finish', () => {
      logger.audit(`${req.method} ${req.path}`, {
        requestId: req.requestId,
        resource: req.path,
        method: req.method,
        statusCode: res.statusCode,
        result: res.statusCode < 400 ? 'success' : 'failure',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
    });
  }
  
  next();
}

export function rateLimitMiddleware(windowMs: number = 60000, max: number = 100) {
  const requests = new Map<string, { count: number; resetTime: number }>();
  
  return (req: RequestWithTelemetry, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    
    const record = requests.get(ip);
    
    if (!record || now > record.resetTime) {
      requests.set(ip, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }
    
    record.count++;
    
    if (record.count > max) {
      metrics.recordRateLimitHit(req.path, ip.substring(0, ip.lastIndexOf('.')));
      
      logger.warn('Rate limit exceeded', {
        ip,
        count: record.count,
        limit: max,
        path: req.path
      });
      
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }
    
    next();
  };
}

export function healthCheckMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health') {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      version: process.env.APP_VERSION || '1.0.0'
    };
    
    return res.json(health);
  }
  
  if (req.path === '/metrics') {
    metrics.getMetrics().then(metricsData => {
      res.set('Content-Type', metrics.getContentType());
      res.send(metricsData);
    });
    return;
  }
  
  if (req.path === '/errors') {
    const errors = errorTracker.getStatistics();
    return res.json(errors);
  }
  
  next();
}