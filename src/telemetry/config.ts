import { logger } from './logger';

export interface TelemetryConfig {
  enabled: boolean;
  logging: {
    enabled: boolean;
    level: 'error' | 'warn' | 'info' | 'debug';
    console: boolean;
    files: boolean;
    sensitiveDataRedaction: boolean;
  };
  metrics: {
    enabled: boolean;
    endpoint: boolean;
    businessMetrics: boolean;
  };
  tracing: {
    enabled: boolean;
    otlpEnabled: boolean;
  };
  errorTracking: {
    enabled: boolean;
    alerting: boolean;
  };
  security: {
    middleware: boolean;
    rateLimiting: boolean;
    auditLogging: boolean;
  };
  endpoints: {
    health: boolean;
    metrics: boolean;
    errors: boolean;
    debug: boolean;
  };
  performance: {
    monitoring: boolean;
    slowQueryThreshold: number;
    memoryThreshold: number;
  };
}

const defaultDevelopmentConfig: TelemetryConfig = {
  enabled: true,
  logging: {
    enabled: true,
    level: 'debug',
    console: true,
    files: false,
    sensitiveDataRedaction: true
  },
  metrics: {
    enabled: true,
    endpoint: true,
    businessMetrics: true
  },
  tracing: {
    enabled: true,
    otlpEnabled: false
  },
  errorTracking: {
    enabled: true,
    alerting: false
  },
  security: {
    middleware: true,
    rateLimiting: true,
    auditLogging: true
  },
  endpoints: {
    health: true,
    metrics: true,
    errors: true,
    debug: true
  },
  performance: {
    monitoring: true,
    slowQueryThreshold: 1000,
    memoryThreshold: 100 * 1024 * 1024 // 100MB
  }
};

const defaultProductionConfig: TelemetryConfig = {
  enabled: false, // 🚨 DISABLED BY DEFAULT FOR SAFETY
  logging: {
    enabled: false,
    level: 'error',
    console: false,
    files: false,
    sensitiveDataRedaction: true
  },
  metrics: {
    enabled: false,
    endpoint: false,
    businessMetrics: false
  },
  tracing: {
    enabled: false,
    otlpEnabled: false
  },
  errorTracking: {
    enabled: false,
    alerting: false
  },
  security: {
    middleware: true, // Keep security enabled
    rateLimiting: true, // Keep rate limiting
    auditLogging: false
  },
  endpoints: {
    health: true, // Keep health check
    metrics: false,
    errors: false,
    debug: false
  },
  performance: {
    monitoring: false,
    slowQueryThreshold: 5000,
    memoryThreshold: 500 * 1024 * 1024 // 500MB
  }
};

const minimalSafeConfig: TelemetryConfig = {
  enabled: true,
  logging: {
    enabled: true,
    level: 'error', // Only log errors
    console: false,
    files: false,
    sensitiveDataRedaction: true
  },
  metrics: {
    enabled: false,
    endpoint: false,
    businessMetrics: false
  },
  tracing: {
    enabled: false,
    otlpEnabled: false
  },
  errorTracking: {
    enabled: true, // Track errors but don't alert
    alerting: false
  },
  security: {
    middleware: true,
    rateLimiting: true,
    auditLogging: false
  },
  endpoints: {
    health: true,
    metrics: false,
    errors: false,
    debug: false
  },
  performance: {
    monitoring: false,
    slowQueryThreshold: 10000,
    memoryThreshold: 1024 * 1024 * 1024 // 1GB
  }
};

class TelemetryConfiguration {
  private static instance: TelemetryConfiguration;
  private config: TelemetryConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  static getInstance(): TelemetryConfiguration {
    if (!TelemetryConfiguration.instance) {
      TelemetryConfiguration.instance = new TelemetryConfiguration();
    }
    return TelemetryConfiguration.instance;
  }

  private loadConfig(): TelemetryConfig {
    const env = process.env.NODE_ENV || 'development';
    const telemetryMode = process.env.TELEMETRY_MODE;
    
    // Check for explicit disable
    if (process.env.DISABLE_TELEMETRY === 'true') {
      console.log('🚨 TELEMETRY DISABLED by DISABLE_TELEMETRY=true');
      return { ...defaultProductionConfig, enabled: false };
    }

    switch (telemetryMode) {
      case 'off':
        console.log('🚨 TELEMETRY OFF by TELEMETRY_MODE=off');
        return { ...defaultProductionConfig, enabled: false };
      
      case 'minimal':
        console.log('⚠️ TELEMETRY MINIMAL mode');
        return minimalSafeConfig;
      
      case 'full':
        console.log('📊 TELEMETRY FULL mode');
        return env === 'production' ? defaultProductionConfig : defaultDevelopmentConfig;
      
      case 'development':
        console.log('🧪 TELEMETRY DEVELOPMENT mode');
        return defaultDevelopmentConfig;
      
      default:
        if (env === 'production') {
          console.log('🔒 PRODUCTION detected - telemetry DISABLED by default');
          console.log('🔧 Set TELEMETRY_MODE=minimal|full to enable');
          return { ...defaultProductionConfig, enabled: false };
        } else {
          console.log('🧪 DEVELOPMENT detected - telemetry enabled');
          return defaultDevelopmentConfig;
        }
    }
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isFeatureEnabled(feature: keyof TelemetryConfig): boolean {
    if (!this.config.enabled) return false;
    return this.config[feature] as boolean;
  }

  isLoggingEnabled(): boolean {
    return this.config.enabled && this.config.logging.enabled;
  }

  isMetricsEnabled(): boolean {
    return this.config.enabled && this.config.metrics.enabled;
  }

  isTracingEnabled(): boolean {
    return this.config.enabled && this.config.tracing.enabled;
  }

  isEndpointEnabled(endpoint: keyof TelemetryConfig['endpoints']): boolean {
    return this.config.enabled && this.config.endpoints[endpoint];
  }

  getLogLevel(): string {
    return this.config.logging.level;
  }

  getSlowQueryThreshold(): number {
    return this.config.performance.slowQueryThreshold;
  }

  logConfiguration() {
    if (this.config.enabled) {
      console.log('📊 Telemetry Configuration:', {
        environment: process.env.NODE_ENV,
        mode: process.env.TELEMETRY_MODE || 'auto',
        logging: this.config.logging.enabled,
        metrics: this.config.metrics.enabled,
        tracing: this.config.tracing.enabled,
        endpoints: Object.entries(this.config.endpoints)
          .filter(([_, enabled]) => enabled)
          .map(([name, _]) => name)
      });
    } else {
      console.log('🚨 Telemetry is DISABLED');
    }
  }
}

export const telemetryConfig = TelemetryConfiguration.getInstance();
export { defaultDevelopmentConfig, defaultProductionConfig, minimalSafeConfig };