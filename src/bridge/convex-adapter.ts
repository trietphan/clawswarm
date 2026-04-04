/**
 * Convex Bridge Adapter for ClawSwarm.
 *
 * Connects clawswarm-ai to a moonclawswarm (clawswarm.app) Convex backend
 * using HTTP polling instead of WebSockets. This allows agent runners to
 * work with a managed cloud backend without requiring a public WebSocket
 * server.
 *
 * Flow:
 *  1. `start()` begins polling `GET /api/bridge/pending`
 *  2. For each returned step, `POST /api/bridge/claim` is called to lock it
 *  3. The `step:claimed` event fires — callers execute the step
 *  4. Callers call `reportResult()` to POST `/api/bridge/report`
 *
 * @example
 * ```typescript
 * const adapter = new ConvexBridgeAdapter({
 *   convexUrl: 'https://xxx.convex.cloud',
 *   bridgeToken: process.env.BRIDGE_SECRET,
 *   pollIntervalMs: 5000,
 * });
 *
 * adapter.on('step:claimed', async (step) => {
 *   const output = await runAgent(step);
 *   await adapter.reportResult({
 *     stepId: step.stepId,
 *     status: 'success',
 *     output,
 *   });
 * });
 *
 * await adapter.start();
 * ```
 *
 * @module @clawswarm/bridge/convex-adapter
 */

import { EventEmitter } from 'eventemitter3';
import {
  ConvexAdapterConfig,
  ConvexAdapterEvents,
  ConvexPendingStep,
  ConvexStepResult,
} from './types.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_INSTANCE_ID = 'clawswarm-adapter';

// ─── ConvexBridgeAdapter ──────────────────────────────────────────────────────

/**
 * HTTP-polling bridge adapter that connects clawswarm-ai to a Convex-backed
 * moonclawswarm deployment.
 *
 * Implements EventEmitter with {@link ConvexAdapterEvents} so it can be
 * used as a drop-in complement to (or replacement for) the WebSocket-based
 * {@link BridgeServer} in environments where pull-based execution is preferred.
 */
export class ConvexBridgeAdapter extends EventEmitter<ConvexAdapterEvents> {
  private readonly config: Required<ConvexAdapterConfig>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  /** Step IDs currently being processed (prevents duplicate claims) */
  private _inFlight: Set<string> = new Set();

  constructor(config: ConvexAdapterConfig) {
    super();

    if (!config.convexUrl) {
      throw new Error('ConvexBridgeAdapter: convexUrl is required');
    }

    this.config = {
      convexUrl: config.convexUrl.replace(/\/+$/, ''), // strip trailing slash
      bridgeToken: config.bridgeToken ?? '',
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      orgId: config.orgId ?? '',
      instanceId: config.instanceId ?? DEFAULT_INSTANCE_ID,
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Whether the adapter is currently polling.
   */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Start polling for pending steps.
   * Resolves once the adapter is active (first poll is scheduled).
   * Throws if already running.
   */
  async start(): Promise<void> {
    if (this._running) {
      throw new Error('ConvexBridgeAdapter is already running');
    }

    this._running = true;
    this._inFlight.clear();

    // Run the first poll immediately so callers don't wait a full interval
    await this._poll().catch((err) => this._emitError(err));

    this.pollTimer = setInterval(async () => {
      if (!this._running) return;
      await this._poll().catch((err) => this._emitError(err));
    }, this.config.pollIntervalMs);

    this.emit('started');
  }

  /**
   * Stop polling and clean up.
   */
  stop(): void {
    if (!this._running) return;

    this._running = false;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Report a step result back to the Convex backend.
   *
   * Call this after processing a `step:claimed` event to mark the step as
   * done (or failed) in moonclawswarm.
   *
   * @param result - The step result to report
   * @throws If the HTTP request fails or returns a non-OK status
   */
  async reportResult(result: ConvexStepResult): Promise<void> {
    await this._post('/api/bridge/report', result);
    // Remove from in-flight tracking on successful report
    this._inFlight.delete(result.stepId);
    this.emit('step:reported', result.stepId, result.status);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Execute a single poll cycle: fetch pending steps and claim each one.
   * @internal
   */
  private async _poll(): Promise<void> {
    const steps = await this._fetchPending();
    this.emit('poll', steps);

    // Process steps sequentially to avoid overwhelming the backend
    for (const step of steps) {
      // Skip steps already being processed
      if (this._inFlight.has(step.stepId)) continue;

      const claimed = await this._claimStep(step.stepId);
      if (!claimed) continue;

      this._inFlight.add(step.stepId);
      // Emit asynchronously — caller processes, then calls reportResult()
      this.emit('step:claimed', step);
    }
  }

  /**
   * Fetch pending steps from the Convex backend.
   * @internal
   */
  private async _fetchPending(): Promise<ConvexPendingStep[]> {
    const response = await this._fetch('/api/bridge/pending', { method: 'GET' });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `GET /api/bridge/pending failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`
      );
    }

    const data = await response.json() as unknown;
    if (!Array.isArray(data)) {
      throw new Error('GET /api/bridge/pending: expected array response');
    }

    return data as ConvexPendingStep[];
  }

  /**
   * Claim a step to prevent other runners from picking it up.
   * Returns true if the claim succeeded.
   * @internal
   */
  private async _claimStep(stepId: string): Promise<boolean> {
    try {
      const response = await this._post('/api/bridge/claim', {
        stepId,
        claimedBy: this.config.instanceId,
      });

      // The mutation returns { success: boolean } or similar
      const body = await response.json() as Record<string, unknown>;
      // If the server returns { success: false } or { ok: false }, treat as not claimed
      if (body && (body['success'] === false || body['ok'] === false)) {
        return false;
      }
      return response.ok;
    } catch (err) {
      this._emitError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Make an authenticated GET/DELETE fetch to the Convex backend.
   * @internal
   */
  private _fetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.config.convexUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.bridgeToken) {
      headers['X-Bridge-Token'] = this.config.bridgeToken;
    }

    return fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> ?? {}),
      },
    });
  }

  /**
   * POST JSON to the Convex backend and return the raw Response.
   * Throws on network errors; non-2xx responses are returned for callers to handle.
   * @internal
   */
  private async _post(path: string, body: unknown): Promise<Response> {
    const response = await this._fetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `POST ${path} failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`
      );
    }

    return response;
  }

  /**
   * Emit an error event without throwing.
   * @internal
   */
  private _emitError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.emit('error', error);
  }
}
