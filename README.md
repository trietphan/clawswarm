<div align="center">

# 🐾 ClawSwarm

### Your AI Department, Ready in Minutes

[![CI](https://github.com/trietphan/clawswarm/actions/workflows/ci.yml/badge.svg)](https://github.com/trietphan/clawswarm/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://makeapullrequest.com)

Deploy a team of AI agents that decompose goals into tasks,
assign work to specialists, review each other's output, and deliver results.

[Getting Started](docs/getting-started.md) · [Documentation](docs/concepts.md) · [Examples](examples/) · [Dashboard](https://swarmclaw.vercel.app)

</div>

---

## What is ClawSwarm?

ClawSwarm is an open-source multi-agent orchestration framework. Instead of one AI doing everything, you deploy a **team of specialist agents** that collaborate:

- 🔍 **ResearchClaw** — finds information, analyzes data, writes reports
- 🔧 **CodeClaw** — builds features, fixes bugs, writes tests
- ⚙️ **OpsClaw** — deploys, monitors, optimizes infrastructure
- 🧠 **Planner** — breaks goals into tasks, assigns to the right agent

### The Quality Gate

Every piece of work goes through a **3-tier chief review**:

| Score | Action |
|-------|--------|
| ≥ 8 | ✅ Auto-approved |
| 5-7 | 👀 Human review required |
| < 5 | ❌ Auto-rejected + rework |

No garbage output reaches production.

## Quick Start

```bash
npm install @clawswarm/core @clawswarm/bridge

# Initialize a new ClawSwarm project
npx clawswarm init

# Start the bridge
npx clawswarm start
```

```typescript
import { ClawSwarm, Agent, Goal } from '@clawswarm/core';

const swarm = new ClawSwarm({
  agents: [
    Agent.research({ model: 'claude-sonnet-4' }),
    Agent.code({ model: 'gpt-4o' }),
    Agent.ops({ model: 'gemini-pro' }),
  ],
  chiefReview: {
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
  },
});

const goal = await swarm.createGoal({
  title: 'Research and write a blog post about AI agents',
  description: 'Find latest trends, outline key points, write a draft',
});

// Planner automatically decomposes into tasks and assigns to agents
const result = await swarm.execute(goal);
console.log(result.deliverables);
```

## Architecture

```
Goal → Planner (decompose) → Tasks
                                  ↓
                    ┌─────────────┼─────────────┐
                    ↓             ↓             ↓
              ResearchClaw    CodeClaw      OpsClaw
                    ↓             ↓             ↓
              Chief Review  Chief Review  Chief Review
                    ↓             ↓             ↓
              ≥8 approve    5-7 review     <5 reject
                    ↓             ↓             ↓
                 Results     Human OK      Rework (max 3)
```

## Features

- 🎯 **Goal-Level Thinking** — describe what you want, agents figure out how
- 🤖 **Specialist Agents** — each agent has deep expertise in their domain
- 🛡️ **Quality Gate** — 3-tier review prevents bad output
- 🔄 **Auto-Rework** — failed tasks get automatically retried (max 3 cycles)
- 📊 **Cost Tracking** — per-agent, per-task token and cost monitoring
- 🔌 **Multi-Model** — use different LLM providers per agent
- 🌐 **Bridge Service** — WebSocket-based real-time communication
- 📦 **Extensible** — add custom agents, tools, and review criteria

## Dashboard (SaaS)

Want a visual dashboard with real-time monitoring, pixel art office, and analytics?

→ [swarmclaw.vercel.app](https://swarmclaw.vercel.app) (coming soon)

## Documentation Map

- [Getting Started](docs/getting-started.md)
- [Core Concepts](docs/concepts.md)
- [API Reference](docs/api-reference.md)
- [Monorepo Structure](docs/monorepo-structure.md)
- [Package Exports](docs/package-exports.md)
- [API Surface Outline](docs/api-surface-outline.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.
