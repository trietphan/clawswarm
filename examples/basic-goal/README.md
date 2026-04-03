# Basic Goal Example

Demonstrates the simplest way to use ClawSwarm: define a goal, let the swarm decompose it into tasks, and collect the deliverables.

## What You'll Learn

- Creating a `ClawSwarm` instance with built-in specialist agents
- Defining a goal with `createGoal()`
- Listening to swarm lifecycle events (`goal:planning`, `task:assigned`, `task:completed`, etc.)
- Executing a goal and inspecting the results (deliverables, cost, duration)

## Prerequisites

- Node.js 18+
- At least one LLM API key

## Setup

```bash
# From the repo root
cp .env.example .env
# Fill in your API keys in .env
```

## Run

```bash
npx tsx examples/basic-goal/index.ts
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Goal** | A high-level objective the swarm decomposes into tasks |
| **Agent** | A specialist (research, code, ops) that handles specific task types |
| **Chief Review** | Quality gate that scores every task output 0-10 |
| **Deliverable** | A concrete output artifact produced by a task |

## Expected Output

You'll see the swarm plan the goal, assign tasks to agents, execute them, review the outputs, and produce deliverables — all from a single `swarm.execute()` call.
