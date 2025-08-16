export { logger } from './logger';
export { tracing } from './tracing';
export { metrics } from './metrics';
export { errorTracker } from './errorTracking';
export * from './middleware';
export { DatabaseLogger } from './databaseLogger';

import { logger } from './logger';
import { tracing } from './tracing';
import { metrics } from './metrics';
import { errorTracker } from './errorTracking';

export class TelemetrySystem {
  private static initialized = false;

  static initialize() {
    // Import here to avoid circular dependency
    const { telemetryConfig } = require('./config');
    
    if (this.initialized) {
      console.warn('Telemetry system already initialized');
      return;
    }

    // Show configuration
    telemetryConfig.logConfiguration();

    // Exit early if telemetry is disabled
    if (!telemetryConfig.isEnabled()) {
      console.log('🚨 Telemetry system is DISABLED - skipping initialization');
      this.initialized = true;
      return;
    }

    try {
      // Only initialize tracing if enabled
      if (telemetryConfig.isTracingEnabled()) {
        tracing.initialize();
      }
      
      if (telemetryConfig.isLoggingEnabled()) {
        logger.info('Telemetry system initialized', {
          service: 'agentic-ai-news',
          environment: process.env.NODE_ENV || 'development',
          version: process.env.APP_VERSION || '1.0.0',
          features: {
            logging: telemetryConfig.isLoggingEnabled(),
            tracing: telemetryConfig.isTracingEnabled(),
            metrics: telemetryConfig.isMetricsEnabled(),
            errorTracking: telemetryConfig.isFeatureEnabled('errorTracking')
          }
        });
      }

      this.setupShutdownHandlers();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize telemetry system:', error);
      // Don't exit in production if telemetry fails
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      }
    }
  }

  private static setupShutdownHandlers() {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      try {
        await tracing.shutdown();
        
        const errorStats = errorTracker.getStatistics();
        logger.info('Error statistics at shutdown', errorStats);
        
        const metricsData = await metrics.getMetrics();
        logger.info('Final metrics exported', { 
          size: metricsData.length 
        });
        
        logger.info('Telemetry system shut down successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during telemetry shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }

  static getStatus() {
    return {
      initialized: this.initialized,
      errors: errorTracker.getStatistics(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
  }
}

export default TelemetrySystem;