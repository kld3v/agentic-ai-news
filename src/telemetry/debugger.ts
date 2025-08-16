import { logger } from './logger';
import { metrics } from './metrics';
import { errorTracker } from './errorTracking';
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import util from 'util';

export class DebuggerService {
  private static instance: DebuggerService;
  private debugSessions: Map<string, DebugSession> = new Map();
  private breakpoints: Map<string, Breakpoint[]> = new Map();
  private watchedVariables: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): DebuggerService {
    if (!DebuggerService.instance) {
      DebuggerService.instance = new DebuggerService();
    }
    return DebuggerService.instance;
  }

  createDebugSession(name: string): DebugSession {
    const session: DebugSession = {
      id: `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      startTime: Date.now(),
      logs: [],
      snapshots: [],
      active: true
    };

    this.debugSessions.set(session.id, session);
    logger.debug('Debug session created', { sessionId: session.id, name });
    
    return session;
  }

  log(sessionId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
    const session = this.debugSessions.get(sessionId);
    if (!session || !session.active) return;

    const logEntry: DebugLog = {
      timestamp: Date.now(),
      level,
      message,
      data: data ? this.serializeData(data) : undefined
    };

    session.logs.push(logEntry);
    
    if (session.logs.length > 1000) {
      session.logs.shift();
    }
  }

  captureSnapshot(sessionId: string, name: string, context: any) {
    const session = this.debugSessions.get(sessionId);
    if (!session || !session.active) return;

    const snapshot: Snapshot = {
      id: `snap_${Date.now()}`,
      name,
      timestamp: Date.now(),
      context: this.serializeData(context),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };

    session.snapshots.push(snapshot);
    logger.debug('Snapshot captured', { sessionId, snapshotId: snapshot.id, name });
  }

  setBreakpoint(file: string, line: number, condition?: string): string {
    const breakpointId = `bp_${Date.now()}`;
    const breakpoint: Breakpoint = {
      id: breakpointId,
      file,
      line,
      condition,
      enabled: true,
      hitCount: 0
    };

    const fileBreakpoints = this.breakpoints.get(file) || [];
    fileBreakpoints.push(breakpoint);
    this.breakpoints.set(file, fileBreakpoints);

    logger.debug('Breakpoint set', { breakpointId, file, line, condition });
    return breakpointId;
  }

  checkBreakpoint(file: string, line: number, context?: any): boolean {
    const fileBreakpoints = this.breakpoints.get(file);
    if (!fileBreakpoints) return false;

    const breakpoint = fileBreakpoints.find(bp => bp.line === line && bp.enabled);
    if (!breakpoint) return false;

    if (breakpoint.condition) {
      try {
        const conditionMet = eval(breakpoint.condition);
        if (!conditionMet) return false;
      } catch (error) {
        logger.error('Error evaluating breakpoint condition', error, { 
          breakpointId: breakpoint.id,
          condition: breakpoint.condition 
        });
        return false;
      }
    }

    breakpoint.hitCount++;
    logger.debug('Breakpoint hit', {
      breakpointId: breakpoint.id,
      file,
      line,
      hitCount: breakpoint.hitCount,
      context: this.serializeData(context)
    });

    return true;
  }

  watch(name: string, value: any) {
    const previousValue = this.watchedVariables.get(name);
    this.watchedVariables.set(name, this.serializeData(value));

    if (previousValue !== undefined && previousValue !== value) {
      logger.debug('Watched variable changed', {
        name,
        previousValue: this.serializeData(previousValue),
        newValue: this.serializeData(value)
      });
    }
  }

  getWatchedVariables(): Map<string, any> {
    return new Map(this.watchedVariables);
  }

  profile<T>(name: string, fn: () => T): T {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();

    try {
      const result = fn();
      
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      const profile = {
        name,
        duration: endTime - startTime,
        memory: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        },
        cpu: {
          user: endCpu.user / 1000,
          system: endCpu.system / 1000
        }
      };

      logger.performance(`Profile: ${name}`, profile);
      
      return result;
    } catch (error) {
      logger.error(`Profile error: ${name}`, error);
      throw error;
    }
  }

  async profileAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();

    try {
      const result = await fn();
      
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      const profile = {
        name,
        duration: endTime - startTime,
        memory: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        },
        cpu: {
          user: endCpu.user / 1000,
          system: endCpu.system / 1000
        }
      };

      logger.performance(`Profile: ${name}`, profile);
      
      return result;
    } catch (error) {
      logger.error(`Profile error: ${name}`, error);
      throw error;
    }
  }

  trace(name: string, ...args: any[]) {
    const stack = new Error().stack;
    logger.debug(`Trace: ${name}`, {
      args: args.map(arg => this.serializeData(arg)),
      stack
    });
  }

  assert(condition: boolean, message: string, data?: any) {
    if (!condition) {
      const error = new Error(`Assertion failed: ${message}`);
      logger.error('Assertion failed', error, {
        message,
        data: this.serializeData(data),
        stack: error.stack
      });
      
      if (process.env.NODE_ENV === 'development') {
        throw error;
      }
    }
  }

  dumpState(name: string, state: any) {
    const timestamp = new Date().toISOString();
    const filename = `dump_${name}_${timestamp.replace(/[:.]/g, '-')}.json`;
    const filepath = path.join(process.cwd(), 'debug', filename);

    try {
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, JSON.stringify({
        name,
        timestamp,
        state: this.serializeData(state),
        process: {
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          uptime: process.uptime()
        }
      }, null, 2));

      logger.info('State dumped to file', { name, filepath });
    } catch (error) {
      logger.error('Failed to dump state', error, { name });
    }
  }

  getDebugInfo(): DebugInfo {
    return {
      sessions: Array.from(this.debugSessions.values()).map(s => ({
        ...s,
        logs: s.logs.slice(-10),
        snapshots: s.snapshots.slice(-5)
      })),
      breakpoints: Array.from(this.breakpoints.entries()).map(([file, bps]) => ({
        file,
        breakpoints: bps
      })),
      watchedVariables: Object.fromEntries(this.watchedVariables),
      errors: errorTracker.getErrors({ limit: 10 }),
      metrics: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      }
    };
  }

  endDebugSession(sessionId: string) {
    const session = this.debugSessions.get(sessionId);
    if (session) {
      session.active = false;
      session.endTime = Date.now();
      logger.debug('Debug session ended', {
        sessionId,
        duration: session.endTime - session.startTime
      });
    }
  }

  private serializeData(data: any, depth: number = 0, maxDepth: number = 5): any {
    if (depth > maxDepth) return '[Max depth reached]';
    
    if (data === null || data === undefined) return data;
    
    if (typeof data === 'function') {
      return `[Function: ${data.name || 'anonymous'}]`;
    }
    
    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack
      };
    }
    
    if (data instanceof Date) {
      return data.toISOString();
    }
    
    if (data instanceof RegExp) {
      return data.toString();
    }
    
    if (Buffer.isBuffer(data)) {
      return `[Buffer: ${data.length} bytes]`;
    }
    
    if (Array.isArray(data)) {
      return data.slice(0, 100).map(item => this.serializeData(item, depth + 1, maxDepth));
    }
    
    if (typeof data === 'object') {
      const result: any = {};
      const keys = Object.keys(data).slice(0, 100);
      for (const key of keys) {
        try {
          result[key] = this.serializeData(data[key], depth + 1, maxDepth);
        } catch {
          result[key] = '[Unserializable]';
        }
      }
      return result;
    }
    
    return data;
  }
}

interface DebugSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  logs: DebugLog[];
  snapshots: Snapshot[];
  active: boolean;
}

interface DebugLog {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

interface Snapshot {
  id: string;
  name: string;
  timestamp: number;
  context: any;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
}

interface Breakpoint {
  id: string;
  file: string;
  line: number;
  condition?: string;
  enabled: boolean;
  hitCount: number;
}

interface DebugInfo {
  sessions: any[];
  breakpoints: any[];
  watchedVariables: any;
  errors: any[];
  metrics: any;
}

export const debugService = DebuggerService.getInstance();

export function debugMiddleware(req: Request, res: Response, next: Function) {
  if (req.path === '/debug') {
    const debugInfo = debugService.getDebugInfo();
    return res.json(debugInfo);
  }
  
  if (req.path === '/debug/dump' && req.method === 'POST') {
    const { name, state } = req.body;
    debugService.dumpState(name || 'manual', state || { request: req.url });
    return res.json({ success: true });
  }
  
  next();
}