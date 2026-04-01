# Bridge Realtime Example

Demonstrates how to run a ClawSwarm with the Bridge server for real-time monitoring via WebSocket. The Bridge provides a live event stream that dashboards, CLIs, or custom UIs can consume.

## What You'll Learn

- Setting up the `SwarmBridge` alongside a `ClawSwarm` instance
- Configuring the bridge port and authentication
- Subscribing to real-time swarm events over WebSocket
- Programmatically connecting a WebSocket client to the bridge

## Architecture

```
ClawSwarm ──events──▶ SwarmBridge ──WebSocket──▶ Dashboard / CLI / Custom UI
                         :8080
```

The bridge acts as an event relay — it receives typed events from the swarm and broadcasts them to all connected WebSocket clients in real time.

## Prerequisites

- Node.js 18+
- At least one LLM API key
- `@clawswarm/bridge` package installed

## Setup

```bash
# From the repo root
npm install @clawswarm/core @clawswarm/bridge
cp .env.example .env
# Fill in your API keys in .env
```

## Run

```bash
npx tsx examples/bridge-realtime/index.ts
```

Then open a WebSocket client (or the ClawSwarm dashboard) at `ws://localhost:8080` to see live events.

## Expected Output

The server starts, a sample goal executes, and you see bridge lifecycle events logged in the terminal. Any connected WebSocket client receives the full event stream in real time.
