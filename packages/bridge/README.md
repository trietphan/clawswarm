# @clawswarm/bridge

WebSocket bridge server for ClawSwarm — enables real-time communication between agents, UI clients, and external services.

## Features

- 🔌 **WebSocket server** — persistent connections for agents and dashboard clients
- 🏢 **Org-scoped routing** — tasks and events are isolated per organization
- 📡 **Real-time events** — task updates, agent status, and goal progress streamed live
- 🔐 **Token-based auth** — per-connection authentication via Bearer tokens
- 🔁 **Reconnect handling** — automatic ping/pong and stale connection cleanup

## Installation

```bash
npm install @clawswarm/bridge
```

## Usage

### Standalone Server

```typescript
import { BridgeServer } from '@clawswarm/bridge';

const bridge = new BridgeServer({ port: 8787, host: '0.0.0.0' });
await bridge.start();

bridge.on('client:connected', (client) => {
  console.log('New client:', client.id, 'org:', client.orgId);
});
```

### With ClawSwarm Core

```typescript
import { ClawSwarm, Agent } from '@clawswarm/core';
import { BridgeServer, TaskRouter } from '@clawswarm/bridge';

const bridge = new BridgeServer({ port: 8787 });
await bridge.start();

const router = new TaskRouter(bridge);

const swarm = new ClawSwarm({
  agents: [Agent.research({ model: 'claude-sonnet-4' })],
  bridgeUrl: 'ws://localhost:8787',
});

// Forward swarm events to bridge clients
swarm.on('task:completed', (task) => {
  router.broadcast(task.goalId, { type: 'task:completed', payload: task });
});
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `8787` | Port to listen on |
| `host` | `string` | `'0.0.0.0'` | Host to bind to |
| `maxConnections` | `number` | `1000` | Max concurrent WebSocket connections |
| `pingIntervalMs` | `number` | `30000` | Ping interval for keep-alive |
| `authTokens` | `string[]` | `[]` | Allowed auth tokens (empty = no auth) |

## License

MIT
