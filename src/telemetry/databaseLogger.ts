import { logger } from './logger';
import { metrics } from './metrics';
import { tracing } from './tracing';
import { SpanKind } from '@opentelemetry/api';

export class DatabaseLogger {
  private static queryCounter = 0;

  static logQuery(
    operation: string,
    query: string,
    params?: any[],
    options?: {
      table?: string;
      dbType?: 'sqlite' | 'postgresql';
    }
  ): { queryId: string; startTime: number } {
    const queryId = `query_${++this.queryCounter}_${Date.now()}`;
    const startTime = Date.now();
    
    logger.database(operation, {
      queryId,
      query: this.sanitizeQuery(query),
      params: this.sanitizeParams(params),
      table: options?.table,
      dbType: options?.dbType || 'sqlite'
    });

    return { queryId, startTime };
  }

  static logQueryComplete(
    queryId: string,
    startTime: number,
    options?: {
      rows?: number;
      error?: any;
      table?: string;
      dbType?: 'sqlite' | 'postgresql';
    }
  ) {
    const duration = Date.now() - startTime;
    
    if (options?.error) {
      logger.database('Query failed', {
        queryId,
        duration,
        error: options.error,
        table: options.table
      });
      
      metrics.recordDbQuery('error', options.table || 'unknown', duration, options.dbType);
    } else {
      logger.database('Query completed', {
        queryId,
        duration,
        rows: options?.rows,
        table: options?.table
      });
      
      metrics.recordDbQuery('success', options?.table || 'unknown', duration, options?.dbType);
    }

    if (duration > 1000) {
      logger.warn('Slow query detected', {
        queryId,
        duration,
        threshold: 1000,
        table: options?.table
      });
    }
  }

  static async traceQuery<T>(
    operation: string,
    query: string,
    fn: () => Promise<T>,
    options?: {
      table?: string;
      dbType?: 'sqlite' | 'postgresql';
      params?: any[];
    }
  ): Promise<T> {
    return tracing.traceAsync(
      `db.${operation}`,
      async (span) => {
        span.setAttributes({
          'db.system': options?.dbType || 'sqlite',
          'db.operation': operation,
          'db.statement': this.sanitizeQuery(query),
          'db.table': options?.table
        });

        const { queryId, startTime } = this.logQuery(operation, query, options?.params, options);
        
        try {
          const result = await fn();
          
          const rows = Array.isArray(result) ? result.length : 
                       (result as any)?.rows?.length || 
                       (result as any)?.changes || 
                       1;
          
          this.logQueryComplete(queryId, startTime, {
            rows,
            table: options?.table,
            dbType: options?.dbType
          });
          
          span.setAttributes({
            'db.rows_affected': rows
          });
          
          return result;
        } catch (error) {
          this.logQueryComplete(queryId, startTime, {
            error,
            table: options?.table,
            dbType: options?.dbType
          });
          
          throw error;
        }
      },
      { kind: SpanKind.CLIENT }
    );
  }

  static traceTransaction<T>(
    name: string,
    fn: () => Promise<T>,
    options?: {
      dbType?: 'sqlite' | 'postgresql';
    }
  ): Promise<T> {
    return tracing.traceAsync(
      `db.transaction.${name}`,
      async (span) => {
        span.setAttributes({
          'db.system': options?.dbType || 'sqlite',
          'db.operation': 'transaction',
          'db.transaction.name': name
        });

        const startTime = Date.now();
        
        logger.database('Transaction started', {
          name,
          dbType: options?.dbType
        });
        
        try {
          const result = await fn();
          
          const duration = Date.now() - startTime;
          
          logger.database('Transaction completed', {
            name,
            duration,
            dbType: options?.dbType
          });
          
          span.setAttributes({
            'db.transaction.status': 'committed',
            'db.transaction.duration': duration
          });
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          
          logger.database('Transaction failed', {
            name,
            duration,
            error,
            dbType: options?.dbType
          });
          
          span.setAttributes({
            'db.transaction.status': 'rolled_back',
            'db.transaction.duration': duration
          });
          
          throw error;
        }
      },
      { kind: SpanKind.CLIENT }
    );
  }

  private static sanitizeQuery(query: string): string {
    return query
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);
  }

  private static sanitizeParams(params?: any[]): any[] | undefined {
    if (!params) return undefined;
    
    return params.map(param => {
      if (typeof param === 'string' && param.length > 100) {
        return param.substring(0, 100) + '...';
      }
      return param;
    });
  }

  static logConnectionPool(stats: {
    active: number;
    idle: number;
    total: number;
    dbType: 'sqlite' | 'postgresql';
  }) {
    logger.debug('Connection pool stats', stats);
    
    metrics.dbConnectionPool.set(
      { state: 'active', database_type: stats.dbType },
      stats.active
    );
    
    metrics.dbConnectionPool.set(
      { state: 'idle', database_type: stats.dbType },
      stats.idle
    );
    
    metrics.dbConnectionPool.set(
      { state: 'total', database_type: stats.dbType },
      stats.total
    );
  }

  static logMigration(name: string, status: 'started' | 'completed' | 'failed', error?: any) {
    const level = status === 'failed' ? 'error' : 'info';
    
    logger[level](`Migration ${status}: ${name}`, {
      migration: name,
      status,
      error
    });
    
    if (status === 'completed') {
      logger.audit('database_migration', {
        migration: name,
        result: 'success'
      });
    } else if (status === 'failed') {
      logger.audit('database_migration', {
        migration: name,
        result: 'failure',
        error
      });
    }
  }
}