/**
 * `clawswarm status` — Show agent and task status via the bridge.
 *
 * Connects to a running bridge server and displays current agent status,
 * active goals, and task progress.
 *
 * @module @clawswarm/cli/commands/status
 */

import WebSocket from 'ws';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatusOptions {
  /** Bridge WebSocket URL */
  bridge?: string;
  /** Organization ID */
  org?: string;
  /** Auth token */
  token?: string;
  /** Watch mode — refresh continuously */
  watch?: boolean;
  /** Refresh interval in ms (watch mode only) */
  intervalMs?: number;
}

// ─── Status Command ───────────────────────────────────────────────────────────

/**
 * Connect to the bridge and display real-time status.
 */
export async function showStatus(options: StatusOptions = {}): Promise<void> {
  const bridgeUrl = options.bridge ?? process.env['CLAWSWARM_BRIDGE_URL'] ?? 'ws://localhost:8787';
  const orgId = options.org ?? process.env['CLAWSWARM_ORG_ID'] ?? 'default';
  const token = options.token ?? process.env['CLAWSWARM_BRIDGE_TOKEN'] ?? '';

  console.log(`\n🐾 ClawSwarm Status\n`);
  console.log(`  Bridge: ${bridgeUrl}`);
  console.log(`  Org:    ${orgId}\n`);

  const agents: Map<string, AgentStatus> = new Map();
  const tasks: Map<string, TaskSummary> = new Map();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(bridgeUrl);
    let authenticated = false;

    ws.on('open', () => {
      // Send auth
      ws.send(JSON.stringify({
        type: 'auth',
        ts: new Date().toISOString(),
        payload: { token, orgId, role: 'dashboard' },
      }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let msg: { type: string; payload: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === 'pong' && !authenticated) {
        authenticated = true;
        console.log(`  ✅ Connected to bridge\n`);
        printStatus(agents, tasks);

        if (!options.watch) {
          ws.close();
          resolve();
        }
        return;
      }

      if (msg.type === 'error') {
        const err = msg.payload as { code: string; message: string };
        console.error(`  ❌ ${err.code}: ${err.message}`);
        ws.close();
        reject(new Error(err.message));
        return;
      }

      // Update local state from events
      handleEvent(msg.type, msg.payload, agents, tasks);

      if (options.watch) {
        clearConsole();
        printStatus(agents, tasks);
      }
    });

    ws.on('error', (err) => {
      console.error(`  ❌ Cannot connect to bridge at ${bridgeUrl}`);
      console.error(`     ${err.message}`);
      console.error(`\n  Make sure the bridge is running: clawswarm start\n`);
      reject(err);
    });

    ws.on('close', () => {
      if (options.watch) {
        console.log('\nDisconnected from bridge.');
      }
      resolve();
    });

    // Ctrl+C handler
    if (options.watch) {
      process.on('SIGINT', () => {
        ws.close();
        console.log('\nExiting status monitor.');
        process.exit(0);
      });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AgentStatus {
  id: string;
  type: string;
  status: string;
  currentTaskId?: string;
  lastSeen: string;
}

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  goalId: string;
  updatedAt: string;
}

function handleEvent(
  type: string,
  payload: unknown,
  agents: Map<string, AgentStatus>,
  tasks: Map<string, TaskSummary>
): void {
  const p = payload as Record<string, unknown>;

  if (type === 'agent:status' && typeof p['agentId'] === 'string') {
    agents.set(p['agentId'], {
      id: p['agentId'],
      type: String(p['agentType'] ?? 'unknown'),
      status: String(p['status'] ?? 'unknown'),
      currentTaskId: p['currentTaskId'] as string | undefined,
      lastSeen: new Date().toISOString(),
    });
  }

  if (type.startsWith('task:') && typeof p['id'] === 'string') {
    tasks.set(p['id'], {
      id: p['id'],
      title: String(p['title'] ?? 'Untitled'),
      status: String(p['status'] ?? 'unknown'),
      goalId: String(p['goalId'] ?? ''),
      updatedAt: new Date().toISOString(),
    });
  }
}

function printStatus(agents: Map<string, AgentStatus>, tasks: Map<string, TaskSummary>): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`  Last updated: ${ts}\n`);

  // Agents
  console.log(`  ── Agents (${agents.size}) ──`);
  if (agents.size === 0) {
    console.log('  No agents connected\n');
  } else {
    for (const a of agents.values()) {
      const icon = a.status === 'idle' ? '🟢' : a.status === 'busy' ? '🟡' : '🔴';
      const task = a.currentTaskId ? ` → ${a.currentTaskId}` : '';
      console.log(`  ${icon} ${a.type.padEnd(10)} [${a.status}]${task}`);
    }
    console.log();
  }

  // Tasks
  const activeTasks = Array.from(tasks.values()).filter(
    t => t.status !== 'completed' && t.status !== 'failed'
  );
  console.log(`  ── Active Tasks (${activeTasks.length}) ──`);
  if (activeTasks.length === 0) {
    console.log('  No active tasks\n');
  } else {
    for (const t of activeTasks) {
      const icon = t.status === 'in_progress' ? '⚡' : t.status === 'review' ? '👀' : '⏳';
      console.log(`  ${icon} ${t.title.slice(0, 50).padEnd(50)} [${t.status}]`);
    }
    console.log();
  }
}

function clearConsole(): void {
  process.stdout.write('\x1Bc');
  console.log('\n🐾 ClawSwarm Status (watching)\n');
}
