# Getting Started with ClawSwarm

This guide gets you from zero to a running multi-agent swarm in under 10 minutes.

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+** or **pnpm 8+**
- At least one LLM API key (Anthropic, OpenAI, or Google AI)

---

## Installation

```bash
npm install clawswarm-ai
```

That's the only package you need for local usage. Dashboard integration and real-time bridge are included.

---

## Quick Start

The smallest possible ClawSwarm program:

```typescript
import { ClawSwarm, Agent } from 'clawswarm-ai';

const swarm = new ClawSwarm({
  agents: [
    Agent.research({ model: 'claude-sonnet-4-6' }),
  ],
  chiefReview: {
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
    maxReworkCycles: 3,
  },
});

const result = await swarm.execute({
  title: 'Summarize transformer architectures',
  description: 'Write a 3-paragraph summary of how transformer models work, suitable for a technical blog.',
});

console.log(result.deliverables[0]?.output);
```

Run it:

```bash
npx tsx index.ts
```

---

## Configuration

### Environment Variables

Create a `.env` file in your project root:

```env
# LLM providers — add only what you use
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=AIza...

# Dashboard integration (optional — see below)
CLAWSWARM_API_KEY=cs-...
CLAWSWARM_DASHBOARD_URL=https://clawswarm.app
```

Load it before running:

```bash
# With dotenv
node --env-file=.env index.js

# Or use tsx with dotenv
npx dotenv-cli -e .env npx tsx index.ts
```

### Choosing Models

You can mix models across agents — each agent calls its own provider:

```typescript
const swarm = new ClawSwarm({
  agents: [
    Agent.research({ model: 'claude-sonnet-4-6' }),   // Anthropic
    Agent.code({ model: 'gpt-4o' }),                  // OpenAI
    Agent.ops({ model: 'gemini-2.0-flash' }),          // Google
  ],
  chiefReview: {
    autoApproveThreshold: 8,   // ≥8 → auto-approved, no human needed
    humanReviewThreshold: 5,   // 5–7 → paused for human review
    maxReworkCycles: 3,        // <5 → sent back for rework, max 3 times
  },
});
```

You don't need all three agents — use only the specialists your workflow needs.

---

## Dashboard Integration

Connect your local swarm to the [ClawSwarm cloud dashboard](https://clawswarm.app) for real-time visibility into runs, tasks, and agent outputs.

### 1. Get your API key

Sign in at [clawswarm.app](https://clawswarm.app) → Settings → API Keys → Create key.

### 2. Add to your environment

```env
CLAWSWARM_API_KEY=cs-your-key-here
CLAWSWARM_DASHBOARD_URL=https://clawswarm.app   # optional, this is the default
```

### 3. Wire up DashboardReporter

```typescript
import { ClawSwarm, Agent } from 'clawswarm-ai';
import { DashboardReporter } from 'clawswarm-ai';

// Reads CLAWSWARM_API_KEY and CLAWSWARM_DASHBOARD_URL from env
const reporter = DashboardReporter.fromEnv();

const swarm = new ClawSwarm({
  agents: [Agent.research({ model: 'claude-sonnet-4-6' })],
  reporter, // attach it here
});

const result = await swarm.execute({
  title: 'Research AI agent frameworks',
  description: 'Compare LangGraph, CrewAI, and ClawSwarm across: setup complexity, multi-agent support, tool integration, cost.',
});
```

If `CLAWSWARM_API_KEY` is not set, `DashboardReporter.fromEnv()` returns a no-op reporter — your swarm runs normally, just without cloud reporting. No need to conditionally wire it.

### Manual reporter events (advanced)

If you're building your own orchestration, you can emit events directly:

```typescript
const reporter = new DashboardReporter({
  apiKey: 'cs-your-key',
  dashboardUrl: 'https://clawswarm.app', // or your self-hosted URL
});

reporter.runStarted({ runId: 'run-1', goal: 'Build landing page copy' });
reporter.taskCreated({ runId: 'run-1', taskId: 'task-1', title: 'Research competitors' });
reporter.stepStarted({ runId: 'run-1', stepId: 'step-1', agentRole: 'researcher', taskId: 'task-1' });
reporter.stepCompleted({ runId: 'run-1', stepId: 'step-1', taskId: 'task-1', output: '...', durationMs: 3200 });
reporter.taskCompleted({ runId: 'run-1', taskId: 'task-1' });
reporter.runCompleted({ runId: 'run-1', summary: 'All tasks complete', durationMs: 12000 });
```

All calls are fire-and-forget — dashboard failures never block your swarm.

---

## Running Your First Swarm

Here's a full working example you can copy-paste:

```typescript
// swarm.ts
import 'dotenv/config';
import { ClawSwarm, Agent } from 'clawswarm-ai';
import { DashboardReporter } from 'clawswarm-ai';

async function main() {
  const reporter = DashboardReporter.fromEnv();

  const swarm = new ClawSwarm({
    agents: [
      Agent.research({ model: 'claude-sonnet-4-6' }),
      Agent.code({ model: 'gpt-4o' }),
    ],
    chiefReview: {
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
      maxReworkCycles: 3,
    },
    reporter,
  });

  // Optional: stream progress to stdout
  swarm.on('task:completed', (task) => {
    console.log(`✅ ${task.title} [score: ${task.chiefScore ?? '?'}]`);
  });

  swarm.on('task:rework', (task) => {
    console.log(`🔄 ${task.title} sent back for rework`);
  });

  const result = await swarm.execute({
    title: 'Add input validation to a user registration form',
    description: `
      Given a basic HTML form with name, email, and password fields:
      1. Write a TypeScript validation function with zod
      2. Add helpful error messages
      3. Write unit tests for edge cases (empty fields, invalid email, weak password)
    `,
  });

  console.log('\n=== Deliverables ===');
  for (const d of result.deliverables) {
    console.log(`\n[${d.task}]`);
    console.log(d.output);
  }
}

main().catch(console.error);
```

```bash
npx tsx swarm.ts
```

---

## CLI Usage

ClawSwarm also ships a CLI for running goals from the terminal:

```bash
# Run a goal inline
npx clawswarm run --goal "Write a regex to validate US phone numbers" --model claude-sonnet-4-6

# With dashboard reporting
CLAWSWARM_API_KEY=cs-... npx clawswarm run --goal "..." --model gpt-4o

# Or pass the dashboard URL explicitly
npx clawswarm run --goal "..." --model gpt-4o --dashboard-url https://clawswarm.app
```

---

## What Happens Under the Hood

When you call `swarm.execute(goal)`:

```
Goal → Planner → Tasks
                    ↓
           ┌────────┼────────┐
           ↓        ↓        ↓
      ResearchClaw CodeClaw OpsClaw
           ↓        ↓        ↓
       Chief Review (score 0–10)
           ↓        ↓        ↓
        ≥8 ✅    5–7 👀   <5 🔄 (max 3 cycles)
```

1. **Planning** — The Planner decomposes your goal into tasks and assigns each to a specialist
2. **Execution** — Tasks run with dependency ordering; specialists execute in parallel where possible
3. **Review** — Every output is scored by the Chief Reviewer
4. **Delivery** — Approved deliverables are returned; borderline ones pause for human review

---

## Troubleshooting

### `Error: No API key for provider 'anthropic'`

You're using `Agent.research({ model: 'claude-...' })` but `ANTHROPIC_API_KEY` is not set.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or add it to .env and load with dotenv
```

### `Error: Cannot find module 'clawswarm-ai'`

```bash
npm install clawswarm-ai
```

If you're using an older package name (`@clawswarm/core`), upgrade:

```bash
npm uninstall @clawswarm/core && npm install clawswarm-ai
```

### Dashboard events not appearing

1. Check `CLAWSWARM_API_KEY` is set and starts with `cs-`
2. Verify the key is active at [clawswarm.app](https://clawswarm.app) → Settings → API Keys
3. Check your network — the reporter POSTs to `https://clawswarm.app/api/bridge/events`
4. Events are fire-and-forget; set `DEBUG=clawswarm:reporter` for verbose logs

### Chief review looping / never approving

Lower your `autoApproveThreshold` or increase the quality of your goal description:

```typescript
chiefReview: {
  autoApproveThreshold: 6, // less strict
  maxReworkCycles: 2,      // cap retries
}
```

### TypeScript `Cannot find name 'fetch'`

Add `"lib": ["ES2015", "DOM"]` to your `tsconfig.json`. The `DashboardReporter` uses the global `fetch` API, available in Node 18+.

---

## Next Steps

- [Core Concepts](concepts.md) — agents, goals, tasks, and chief review in depth
- [Agent Guide](agents.md) — configure and extend built-in agents, or build custom ones
- [Goals & Tasks](goals-and-tasks.md) — goal decomposition and dependency ordering
- [Chief Review](chief-review.md) — the quality gate scoring system
- [API Reference](api-reference.md) — full TypeScript API docs
- [ClawSwarm Cloud](https://clawswarm.app) — real-time dashboard, run history, team sharing
