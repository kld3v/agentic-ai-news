import { logger } from './logger';
import { metrics } from './metrics';
import { tracing } from './tracing';
import { Request } from 'express';

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  method?: string;
  path?: string;
  query?: any;
  body?: any;
  headers?: any;
  ip?: string;
  userAgent?: string;
  timestamp?: string;
  environment?: string;
  version?: string;
  [key: string]: any;
}

export interface TrackedError {
  id: string;
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  context: ErrorContext;
  severity: 'low' | 'medium' | 'high' | 'critical';
  fingerprint: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  resolved: boolean;
}

export class ErrorTracker {
  private static instance: ErrorTracker;
  private errors: Map<string, TrackedError> = new Map();
  private errorHandlers: Map<string, (error: TrackedError) => void> = new Map();
  private alertThresholds = {
    critical: 1,
    high: 5,
    medium: 10,
    low: 50
  };

  private constructor() {
    this.setupGlobalErrorHandlers();
  }

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  private setupGlobalErrorHandlers() {
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception', error, { 
        type: 'uncaughtException',
        fatal: true 
      });
      this.trackError(error, { 
        type: 'uncaughtException',
        severity: 'critical' 
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled Rejection', reason, { 
        type: 'unhandledRejection',
        promise: promise.toString() 
      });
      this.trackError(reason instanceof Error ? reason : new Error(String(reason)), {
        type: 'unhandledRejection',
        severity: 'high'
      });
    });

    process.on('warning', (warning: Error) => {
      logger.warn('Process Warning', { 
        name: warning.name,
        message: warning.message,
        stack: warning.stack 
      });
    });
  }

  trackError(error: Error | any, context?: ErrorContext & { severity?: TrackedError['severity'] }): string {
    const errorObj = this.normalizeError(error);
    const fingerprint = this.generateFingerprint(errorObj, context);
    const severity = context?.severity || this.determineSeverity(errorObj);
    
    const existingError = this.errors.get(fingerprint);
    
    if (existingError) {
      existingError.occurrences++;
      existingError.lastSeen = new Date();
      existingError.context = { ...existingError.context, ...context };
      
      if (existingError.occurrences % 10 === 0) {
        this.handleRecurringError(existingError);
      }
    } else {
      const trackedError: TrackedError = {
        id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: errorObj.name,
        message: errorObj.message,
        stack: errorObj.stack,
        code: errorObj.code,
        context: context || {},
        severity,
        fingerprint,
        occurrences: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        resolved: false
      };
      
      this.errors.set(fingerprint, trackedError);
      this.handleNewError(trackedError);
    }

    metrics.httpRequestErrors.inc({
      method: context?.method || 'unknown',
      route: context?.path || 'unknown',
      error_type: errorObj.name
    });

    tracing.addEvent('error_tracked', {
      errorId: fingerprint,
      errorName: errorObj.name,
      severity
    });

    return fingerprint;
  }

  private normalizeError(error: any): { name: string; message: string; stack?: string; code?: string | number } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }
    
    return {
      name: 'UnknownError',
      message: String(error),
      stack: new Error().stack,
      code: undefined
    };
  }

  private generateFingerprint(error: { name: string; message: string }, context?: ErrorContext): string {
    const parts = [
      error.name,
      error.message.replace(/\d+/g, 'N'),
      context?.method,
      context?.path?.replace(/\d+/g, 'N')
    ].filter(Boolean);
    
    return Buffer.from(parts.join('|')).toString('base64');
  }

  private determineSeverity(error: { name: string; message: string; code?: string | number }): TrackedError['severity'] {
    if (error.name === 'TypeError' || error.name === 'ReferenceError') {
      return 'critical';
    }
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return 'high';
    }
    
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return 'low';
    }
    
    return 'medium';
  }

  private handleNewError(error: TrackedError) {
    logger.error(`New error tracked: ${error.name}`, undefined, {
      errorId: error.id,
      fingerprint: error.fingerprint,
      severity: error.severity,
      ...error.context
    });

    if (this.shouldAlert(error)) {
      this.sendAlert(error);
    }

    this.errorHandlers.forEach(handler => handler(error));
  }

  private handleRecurringError(error: TrackedError) {
    logger.warn(`Recurring error: ${error.name}`, {
      occurrences: error.occurrences,
      firstSeen: error.firstSeen,
      lastSeen: error.lastSeen
    });

    if (error.occurrences >= this.alertThresholds[error.severity] * 5) {
      this.escalateError(error);
    }
  }

  private shouldAlert(error: TrackedError): boolean {
    return error.severity === 'critical' || 
           (error.severity === 'high' && error.occurrences >= this.alertThresholds.high);
  }

  private sendAlert(error: TrackedError) {
    logger.error(`ALERT: ${error.severity.toUpperCase()} error detected`, undefined, {
      errorId: error.id,
      name: error.name,
      message: error.message,
      occurrences: error.occurrences,
      ...error.context
    });
  }

  private escalateError(error: TrackedError) {
    const newSeverity = this.getNextSeverityLevel(error.severity);
    error.severity = newSeverity;
    
    logger.error(`Error escalated to ${newSeverity}`, undefined, {
      errorId: error.id,
      occurrences: error.occurrences
    });
    
    this.sendAlert(error);
  }

  private getNextSeverityLevel(current: TrackedError['severity']): TrackedError['severity'] {
    const levels: TrackedError['severity'][] = ['low', 'medium', 'high', 'critical'];
    const currentIndex = levels.indexOf(current);
    return levels[Math.min(currentIndex + 1, levels.length - 1)];
  }

  registerErrorHandler(name: string, handler: (error: TrackedError) => void) {
    this.errorHandlers.set(name, handler);
  }

  getErrors(options?: { 
    severity?: TrackedError['severity']; 
    resolved?: boolean;
    limit?: number;
  }): TrackedError[] {
    let errors = Array.from(this.errors.values());
    
    if (options?.severity) {
      errors = errors.filter(e => e.severity === options.severity);
    }
    
    if (options?.resolved !== undefined) {
      errors = errors.filter(e => e.resolved === options.resolved);
    }
    
    errors.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
    
    if (options?.limit) {
      errors = errors.slice(0, options.limit);
    }
    
    return errors;
  }

  resolveError(fingerprint: string) {
    const error = this.errors.get(fingerprint);
    if (error) {
      error.resolved = true;
      logger.info('Error resolved', { 
        errorId: error.id,
        fingerprint 
      });
    }
  }

  clearResolvedErrors() {
    const resolved = Array.from(this.errors.entries())
      .filter(([_, error]) => error.resolved);
    
    resolved.forEach(([fingerprint]) => {
      this.errors.delete(fingerprint);
    });
    
    logger.info(`Cleared ${resolved.length} resolved errors`);
  }

  extractRequestContext(req: Request): ErrorContext {
    return {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        'accept': req.headers['accept']
      },
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
          req.connection.remoteAddress || 
          req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    };
  }

  getStatistics() {
    const errors = Array.from(this.errors.values());
    const bySeverity = errors.reduce((acc, err) => {
      acc[err.severity] = (acc[err.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalOccurrences = errors.reduce((sum, err) => sum + err.occurrences, 0);

    return {
      total: errors.length,
      resolved: errors.filter(e => e.resolved).length,
      unresolved: errors.filter(e => !e.resolved).length,
      bySeverity,
      totalOccurrences,
      mostFrequent: errors.sort((a, b) => b.occurrences - a.occurrences).slice(0, 5)
    };
  }
}

export const errorTracker = ErrorTracker.getInstance();