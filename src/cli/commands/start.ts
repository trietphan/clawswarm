/**
 * `clawswarm start` — Start the ClawSwarm bridge server or Convex adapter.
 *
 * Pass `--convex-url` to use the HTTP-polling ConvexBridgeAdapter instead
 * of the WebSocket BridgeServer.
 *
 * @module @clawswarm/cli/commands/start
 */

import { BridgeServer } from '../../bridge/bridge.js';
import { ConvexBridgeAdapter } from '../../bridge/convex-adapter.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StartOptions {
  /** Port to listen on (default: 8787) */
  port?: number;
  /** Host to bind to (default: 0.0.0.0) */
  host?: string;
  /** Path to config file */
  config?: string;
  /** Auth tokens (comma-separated) */
  tokens?: string;
  /**
   * Convex deployment URL (e.g. `https://xxx.convex.cloud`).
   * When provided, the Convex HTTP-polling adapter is used instead of
   * the WebSocket bridge server.
   */
  convexUrl?: string;
  /**
   * Poll interval in ms when using the Convex adapter (default: 5000).
   */
  pollIntervalMs?: number;
  /**
   * Org ID to scope events when using the Convex adapter.
   */
  orgId?: string;
}

// ─── Start Command ────────────────────────────────────────────────────────────

/**
 * Start the ClawSwarm bridge.
 *
 * When `options.convexUrl` (or `CLAWSWARM_CONVEX_URL` env var) is set, the
 * HTTP-polling ConvexBridgeAdapter is used.  Otherwise the WebSocket
 * BridgeServer is started as usual.
 *
 * @param options - Start options
 */
export async function startBridge(options: StartOptions = {}): Promise<void> {
  // ── Convex adapter mode ──────────────────────────────────────────────────
  const convexUrl = options.convexUrl ?? process.env['CLAWSWARM_CONVEX_URL'];
  if (convexUrl) {
    return _startConvexAdapter(options, convexUrl);
  }

  // ── WebSocket bridge server (default) ────────────────────────────────────
  const port = options.port ?? parseInt(process.env['CLAWSWARM_PORT'] ?? '8787', 10);
  const host = options.host ?? process.env['CLAWSWARM_HOST'] ?? '0.0.0.0';
  const authTokens = options.tokens
    ? options.tokens.split(',').map(t => t.trim())
    : process.env['CLAWSWARM_BRIDGE_TOKEN']
    ? [process.env['CLAWSWARM_BRIDGE_TOKEN']]
    : [];

  console.log('\n🐾 ClawSwarm Bridge Server\n');

  const bridge = new BridgeServer({ port, host, authTokens });

  // Log events
  bridge.on('listening', (p, h) => {
    console.log(`  ✅ Bridge listening on ws://${h}:${p}`);
    if (authTokens.length > 0) {
      console.log(`  🔐 Auth required (${authTokens.length} token(s) configured)`);
    } else {
      console.log(`  ⚠  No auth configured — open to all connections`);
    }
    console.log('\nPress Ctrl+C to stop.\n');
  });

  bridge.on('client:connected', (client) => {
    console.log(`  → Client connected: ${client.id} (${client.role})`);
  });

  bridge.on('client:disconnected', (clientId, reason) => {
    console.log(`  ← Client disconnected: ${clientId} (${reason})`);
  });

  bridge.on('client:authenticated', (client) => {
    console.log(`  🔓 Authenticated: ${client.id} org=${client.orgId} role=${client.role}`);
  });

  bridge.on('error', (err) => {
    console.error(`  ❌ Bridge error:`, err.message);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down bridge...');
    await bridge.stop();
    console.log('Bridge stopped. Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await bridge.stop();
    process.exit(0);
  });

  await bridge.start();

  // Print periodic stats every 60s
  setInterval(() => {
    const s = bridge.stats();
    if (s.connections > 0) {
      console.log(`  📊 Stats: ${s.connections} connections, ${s.orgs} orgs`);
    }
  }, 60_000);
}

// ─── Convex Adapter Startup ───────────────────────────────────────────────────

/**
 * Start the ConvexBridgeAdapter and wire up console logging.
 * @internal
 */
async function _startConvexAdapter(
  options: StartOptions,
  convexUrl: string
): Promise<void> {
  const bridgeToken =
    options.tokens ??
    process.env['CLAWSWARM_BRIDGE_TOKEN'] ??
    process.env['BRIDGE_SECRET'] ??
    '';

  const pollIntervalMs =
    options.pollIntervalMs ??
    (process.env['CLAWSWARM_POLL_INTERVAL_MS']
      ? parseInt(process.env['CLAWSWARM_POLL_INTERVAL_MS'], 10)
      : 5_000);

  const orgId = options.orgId ?? process.env['CLAWSWARM_ORG_ID'];

  console.log('\n🐾 ClawSwarm Convex Bridge Adapter\n');
  console.log(`  🔗 Convex URL:    ${convexUrl}`);
  console.log(`  ⏱  Poll interval: ${pollIntervalMs}ms`);
  if (bridgeToken) {
    console.log(`  🔐 Auth:          X-Bridge-Token configured`);
  } else {
    console.log(`  ⚠  No bridge token — requests are unauthenticated`);
  }
  console.log('\nPress Ctrl+C to stop.\n');

  const adapter = new ConvexBridgeAdapter({
    convexUrl,
    bridgeToken: bridgeToken || undefined,
    pollIntervalMs,
    orgId,
  });

  adapter.on('started', () => {
    console.log('  ✅ Adapter started — polling for steps');
  });

  adapter.on('stopped', () => {
    console.log('  ⏹  Adapter stopped');
  });

  adapter.on('poll', (steps) => {
    if (steps.length > 0) {
      console.log(`  📥 Poll: ${steps.length} pending step(s)`);
    }
  });

  adapter.on('step:claimed', (step) => {
    console.log(
      `  🎯 Claimed step: ${step.stepId} (${step.agentRole}) — "${step.stepName}"`
    );
  });

  adapter.on('step:reported', (stepId, status) => {
    const icon = status === 'success' ? '✅' : '❌';
    console.log(`  ${icon} Reported step: ${stepId} → ${status}`);
  });

  adapter.on('error', (err) => {
    console.error(`  ❌ Adapter error: ${err.message}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down adapter...');
    adapter.stop();
    console.log('Adapter stopped. Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    adapter.stop();
    process.exit(0);
  });

  await adapter.start();

  // Keep the process alive — the poll timer drives execution
  await new Promise<void>(() => { /* intentionally never resolves */ });
}
