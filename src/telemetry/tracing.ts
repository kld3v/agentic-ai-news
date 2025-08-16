import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { trace, context, SpanStatusCode, SpanKind, Span } from '@opentelemetry/api';
import { logger } from './logger';

export class TracingService {
  private sdk: NodeSDK | null = null;
  private static instance: TracingService;

  private constructor() {}

  static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService();
    }
    return TracingService.instance;
  }

  initialize() {
    const serviceName = process.env.SERVICE_NAME || 'agentic-ai-news';
    const otlpEndpoint = process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
    const isDevelopment = process.env.NODE_ENV !== 'production';

    const traceExporter = process.env.OTLP_ENABLED === 'true' 
      ? new OTLPTraceExporter({ url: otlpEndpoint })
      : isDevelopment 
        ? new ConsoleSpanExporter()
        : undefined;

    this.sdk = new NodeSDK({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-dns': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-net': {
            enabled: false,
          }
        })
      ]
    });

    try {
      this.sdk.start();
      logger.info('OpenTelemetry tracing initialized', {
        serviceName,
        otlpEnabled: process.env.OTLP_ENABLED === 'true',
        endpoint: process.env.OTLP_ENABLED === 'true' ? otlpEndpoint : 'console'
      });
    } catch (error: any) {
      logger.error('Failed to initialize OpenTelemetry', error);
    }
  }

  shutdown(): Promise<void> {
    if (this.sdk) {
      return this.sdk.shutdown();
    }
    return Promise.resolve();
  }

  createSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: Record<string, any>;
  }): Span {
    const tracer = trace.getTracer('agentic-ai-news');
    return tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes
    });
  }

  async traceAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): Promise<T> {
    const span = this.createSpan(name, options);
    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(ctx, () => fn(span));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  traceSync<T>(
    name: string,
    fn: (span: Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): T {
    const span = this.createSpan(name, options);
    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = context.with(ctx, () => fn(span));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  addEvent(name: string, attributes?: Record<string, any>) {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  setAttributes(attributes: Record<string, any>) {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
}

export const tracing = TracingService.getInstance();