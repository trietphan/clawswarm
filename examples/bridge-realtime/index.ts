/**
 * Bridge Realtime Example — ClawSwarm
 *
 * Shows how to run a swarm with the Bridge server for real-time
 * monitoring via WebSocket. Dashboards, CLIs, or custom UIs can
 * connect to the bridge and receive live swarm events.
 *
 * Architecture:
 *   ClawSwarm ──events──▶ SwarmBridge ──WebSocket──▶ Clients
 *
 * Run:
 *   npx tsx examples/bridge-realtime/index.ts
 */

// Load API keys from environment — see .env.example at the repo root.
import 'dotenv/config';

import { ClawSwarm, Agent } from '@clawswarm/core';
import { SwarmBridge } from '@clawswarm/bridge';

async function main() {
  // ── 1. Create the swarm ──────────────────────────────────────────────────

  const swarm = new ClawSwarm({
    agents: [
      Agent.research({ model: 'claude-sonnet-4' }),
      Agent.code({ model: 'gpt-4o' }),
    ],
    chiefReview: {
      autoApproveThreshold: 7,
      humanReviewThreshold: 4,
    },
  });

  // ── 2. Create and start the Bridge server ────────────────────────────────
  //
  //    The bridge binds to a port and relays swarm events over WebSocket.
  //    Connect any WebSocket client to ws://localhost:<port> to receive
  //    real-time events as JSON messages.
  //
  //    Configuration options:
  //      port      — WebSocket server port (default: 8080)
  //      authToken — Optional bearer token for client authentication
  //      cors      — CORS origin whitelist for browser clients

  const bridge = new SwarmBridge({
    swarm,
    port: Number(process.env.BRIDGE_PORT) || 8080,
    // Optional: require clients to authenticate with a bearer token.
    // Clients send: { type: 'auth', token: '<token>' } as their first message.
    authToken: process.env.BRIDGE_AUTH_TOKEN || undefined,
  });

  // Start the bridge — it begins accepting WebSocket connections.
  await bridge.start();
  console.log(`\n🌉 Bridge listening on ws://localhost:${bridge.port}`);
  console.log('   Connect a WebSocket client to see real-time events.\n');

  // ── 3. Bridge lifecycle events ───────────────────────────────────────────
  //
  //    The bridge itself emits events you can use for logging or metrics.

  bridge.on('client:connected', (clientId) => {
    console.log(`  🔌 Client connected: ${clientId}`);
  });

  bridge.on('client:disconnected', (clientId) => {
    console.log(`  ❌ Client disconnected: ${clientId}`);
  });

  bridge.on('event:broadcast', (eventType, clientCount) => {
    console.log(`  📡 Broadcast "${eventType}" → ${clientCount} client(s)`);
  });

  // ── 4. Also log swarm events locally ─────────────────────────────────────

  swarm.on('goal:planning', (goal) => {
    console.log(`  📋 Planning: ${goal.title}`);
  });

  swarm.on('task:completed', (task) => {
    console.log(`  ✅ Completed: ${task.title}`);
  });

  swarm.on('goal:completed', (goal) => {
    console.log(`  🎉 Goal completed: ${goal.title}`);
  });

  // ── 5. Execute a sample goal ─────────────────────────────────────────────
  //
  //    While this goal runs, any connected WebSocket client will receive
  //    real-time events for every planning, assignment, execution, and
  //    review step.

  const goal = swarm.createGoal({
    title: 'Build a CLI tool that fetches weather data',
    description: `
      Create a simple Node.js CLI tool that:
      - Accepts a city name as argument
      - Fetches current weather from a public API
      - Displays temperature, humidity, and conditions
      - Includes error handling for invalid cities
      - Has a --json flag for machine-readable output
    `,
    tags: ['code', 'cli', 'api'],
  });

  console.log(`🚀 Executing: "${goal.title}"`);
  console.log('   Watch the bridge for real-time events...\n');

  const result = await swarm.execute(goal);

  // ── 6. Display results ───────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log('📦 Results');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Duration:     ${result.durationMs}ms`);
  console.log(`  Deliverables: ${result.deliverables.length}`);
  console.log(`  Total tokens: ${result.cost.totalTokens}`);

  for (const [i, d] of result.deliverables.entries()) {
    console.log(`\n  [${i + 1}] ${d.label} (${d.type})`);
    console.log(`      ${d.content.slice(0, 120).replace(/\n/g, ' ')}...`);
  }

  // ── 7. Graceful shutdown ─────────────────────────────────────────────────

  console.log('\n🛑 Shutting down bridge...');
  await bridge.stop();
  console.log('   Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
