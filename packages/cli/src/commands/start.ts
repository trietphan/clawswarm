/**
 * `clawswarm start` — Start the ClawSwarm bridge server.
 *
 * @module @clawswarm/cli/commands/start
 */

import { BridgeServer } from '@clawswarm/bridge';

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
}

// ─── Start Command ────────────────────────────────────────────────────────────

/**
 * Start the ClawSwarm bridge server.
 *
 * @param options - Start options
 */
export async function startBridge(options: StartOptions = {}): Promise<void> {
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
