# Getting Started with ClawSwarm

This guide walks you through installing ClawSwarm, configuring your first swarm, and running your first goal.

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+** or **pnpm 8+**
- At least one LLM API key (Anthropic, OpenAI, or Google AI)

## Installation

### Option 1: Add to an existing project

```bash
npm install @clawswarm/core
# Optional: real-time bridge for dashboard
npm install @clawswarm/bridge
```

### Option 2: New project with CLI

```bash
# Install the CLI globally
npm install -g @clawswarm/cli

# Create a new project
mkdir my-swarm && cd my-swarm
clawswarm init
```

This creates:

```
my-swarm/
├── clawswarm.config.ts    # Swarm configuration
├── .env.example           # API key template
└── goals/
    └── example.ts         # Your first goal
```

## Configuration

### 1. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=...
```

### 2. Configure your agents

Edit `clawswarm.config.ts`:

```typescript
import { SwarmConfig, Agent } from '@clawswarm/core';

const config: SwarmConfig = {
  agents: [
    Agent.research({ model: 'claude-sonnet-4' }),
    Agent.code({ model: 'gpt-4o' }),
    Agent.ops({ model: 'gemini-pro' }),
  ],
  chiefReview: {
    autoApproveThreshold: 8,   // ≥8 → auto-approved
    humanReviewThreshold: 5,   // 5-7 → human review
  },
};

export default config;
```

You don't need all three agents — use only what your workflow needs.

## Your First Goal

```typescript
import { ClawSwarm } from '@clawswarm/core';
import config from './clawswarm.config.js';

const swarm = new ClawSwarm(config);

// Listen for events
swarm.on('task:completed', (task) => {
  console.log('✅', task.title);
});

// Define the goal
const goal = swarm.createGoal({
  title: 'Write a blog post about AI agents',
  description: `
    Research the latest trends in AI agent frameworks (2025-2026),
    then write a 1000-word blog post covering:
    - What AI agents are
    - Top frameworks and their trade-offs
    - When to use multi-agent vs single-agent approaches
    - Practical getting-started advice
  `,
});

// Execute — the planner decomposes into tasks automatically
const result = await swarm.execute(goal);

console.log('\nDeliverables:');
for (const d of result.deliverables) {
  console.log(`  ${d.label}: ${d.content.slice(0, 100)}...`);
}
```

Run it:

```bash
npx tsx goals/example.ts
```

## What Happens Under the Hood

When you call `swarm.execute(goal)`:

1. **Planning** — The Planner agent decomposes your goal into tasks and assigns each to a specialist agent
2. **Execution** — Tasks run concurrently where dependencies allow; each specialist agent executes its task
3. **Review** — Every task's output goes through the Chief Reviewer (3-tier scoring)
4. **Delivery** — Approved deliverables are collected and returned

```
Goal → Planner → Tasks
                    ↓
           ┌────────┼────────┐
           ↓        ↓        ↓
      ResearchClaw CodeClaw OpsClaw
           ↓        ↓        ↓
       Chief Review (score 0-10)
           ↓        ↓        ↓
        ≥8 OK    5-7 👀   <5 rework
```

## Next Steps

- [Core Concepts](concepts.md) — understand agents, goals, tasks, and chief review
- [Agent Guide](agents.md) — configure and customize agents
- [Goals & Tasks](goals-and-tasks.md) — goal decomposition in depth
- [Chief Review](chief-review.md) — the quality gate system
- [API Reference](api-reference.md) — full API docs
