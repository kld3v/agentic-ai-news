import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { trace, context } from '@opentelemetry/api';

const { combine, timestamp, errors, json, printf, colorize, metadata } = winston.format;

interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
  [key: string]: any;
}

const developmentFormat = printf(({ level, message, timestamp, metadata, ...rest }) => {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();
  
  let log = `${timestamp} [${level}]`;
  
  if (spanContext) {
    log += ` [trace:${spanContext.traceId}]`;
  }
  
  log += `: ${message}`;
  
  if (metadata && Object.keys(metadata).length > 0) {
    log += ` | ${JSON.stringify(metadata)}`;
  }
  
  return log;
});

const productionFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  json()
);

const createRotateTransport = (level: string) => {
  return new DailyRotateFile({
    filename: path.join(process.cwd(), 'logs', `%DATE%-${level}.log`),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level,
    format: productionFormat
  });
};

class Logger {
  private logger: winston.Logger;
  private static instance: Logger;

  private constructor() {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: isDevelopment ? 
          combine(
            colorize({ all: true }),
            timestamp({ format: 'HH:mm:ss.SSS' }),
            errors({ stack: true }),
            metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
            developmentFormat
          ) : 
          productionFormat
      })
    ];

    if (!isDevelopment) {
      transports.push(
        createRotateTransport('error'),
        createRotateTransport('combined'),
        new DailyRotateFile({
          filename: path.join(process.cwd(), 'logs', '%DATE%-performance.log'),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '7d',
          level: 'info',
          format: productionFormat
        })
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
      format: combine(
        timestamp(),
        errors({ stack: true }),
        metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] })
      ),
      transports,
      exceptionHandlers: [
        new winston.transports.File({ 
          filename: path.join(process.cwd(), 'logs', 'exceptions.log'),
          format: productionFormat
        })
      ],
      rejectionHandlers: [
        new winston.transports.File({ 
          filename: path.join(process.cwd(), 'logs', 'rejections.log'),
          format: productionFormat
        })
      ]
    });
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private enrichWithContext(context?: LogContext): LogContext {
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    
    return {
      ...context,
      traceId: spanContext?.traceId || context?.traceId,
      spanId: spanContext?.spanId || context?.spanId,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      service: 'agentic-ai-news',
      version: process.env.APP_VERSION || '1.0.0'
    };
  }

  debug(message: string, context?: LogContext) {
    this.logger.debug(message, this.enrichWithContext(context));
  }

  info(message: string, context?: LogContext) {
    this.logger.info(message, this.enrichWithContext(context));
  }

  warn(message: string, context?: LogContext) {
    this.logger.warn(message, this.enrichWithContext(context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorDetails = error instanceof Error ? {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...context
    } : { error, ...context };
    
    this.logger.error(message, this.enrichWithContext(errorDetails));
  }

  performance(message: string, metrics: { duration?: number; memory?: any; cpu?: any; [key: string]: any }) {
    this.logger.info(message, this.enrichWithContext({ 
      performance: true, 
      metrics 
    }));
  }

  security(message: string, context?: LogContext & { threat?: string; action?: string }) {
    this.logger.warn(message, this.enrichWithContext({ 
      security: true, 
      ...context 
    }));
  }

  audit(action: string, details: { userId?: string; resource?: string; result?: string; [key: string]: any }) {
    this.logger.info(`Audit: ${action}`, this.enrichWithContext({ 
      audit: true, 
      action,
      ...details 
    }));
  }

  database(operation: string, details: { queryId?: string; query?: string; duration?: number; rows?: number; error?: any; table?: string; dbType?: string; params?: any[]; name?: string }) {
    const level = details.error ? 'error' : 'debug';
    this.logger.log(level, `Database: ${operation}`, this.enrichWithContext({ 
      database: true, 
      operation,
      ...details 
    }));
  }
}

export const logger = Logger.getInstance();
export type { LogContext };