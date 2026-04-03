# Custom Agents Example

Demonstrates how to create custom specialist agents with their own tools, system prompts, and execution logic — then plug them into a ClawSwarm alongside built-in agents.

## What You'll Learn

- Extending the `Agent` base class to create a custom specialist
- Configuring custom tools, system prompts, temperature, and token limits
- Overriding `canHandle()` to control which tasks the agent accepts
- Overriding `execute()` with custom business logic (data pipelines, content generation, etc.)
- Registering custom agents in a swarm via `agent.config`
- Mixing built-in agents (`Agent.research()`) with custom ones

## Custom Agents in This Example

- **DataAnalystClaw** — Analyzes datasets, runs Python scripts, generates chart data. Low temperature (0.2) for analytical precision.
- **WriterClaw** — Writes long-form content with research backing. Higher temperature (0.7) for creative output.

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
npx tsx examples/custom-agents/index.ts
```

## Expected Output

The swarm assigns analysis tasks to DataAnalystClaw and writing tasks to WriterClaw, producing deliverables from both custom agents.
