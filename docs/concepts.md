# Core Concepts

ClawSwarm is built on four foundational concepts: **Agents**, **Goals**, **Tasks**, and **Chief Review**. Understanding these will help you design effective multi-agent workflows.

---

## Agents

An **Agent** is an AI worker specialized for a particular domain. Each agent has:

- A **type** (research, code, ops, custom)
- A **model** (the LLM it uses)
- A **system prompt** (its instructions and persona)
- A set of **tools** it can use

```typescript
Agent.research({ model: 'claude-sonnet-4' })
// Creates a ResearchClaw agent with web search + summarization tools

Agent.code({ model: 'gpt-4o' })
// Creates a CodeClaw agent with file read/write + test runner tools

Agent.ops({ model: 'gemini-pro' })
// Creates an OpsClaw agent with shell + docker + kubernetes tools
```

Agents don't communicate directly with each other — they each receive tasks independently and produce deliverables.

See: [Agent Guide](agents.md)

---

## Goals

A **Goal** is a high-level objective expressed in natural language. Goals don't specify *how* to accomplish the work — that's the Planner's job.

```typescript
const goal = swarm.createGoal({
  title: 'Launch new feature X',
  description: 'Research competitor implementations, write the code, write tests, and deploy to staging.',
  priority: 2,
  tags: ['feature', 'q4'],
});
```

A goal has a lifecycle:

```
created → planning → in_progress → completed
                                 → failed
```

See: [Goals & Tasks](goals-and-tasks.md)

---

## Tasks

A **Task** is a concrete unit of work that an agent can execute. The Planner automatically decomposes a goal into tasks, assigns each to an agent type, and sequences them based on dependencies.

Each task has:

- A **title** and **description** (what to do)
- An **assignedTo** (which agent type handles it)
- **dependsOn** (task IDs that must complete first)
- **deliverables** (the output produced)
- A **status** in its lifecycle

Task lifecycle:

```
pending → assigned → in_progress → review → approved → completed
                                          → human_review
                  ← rework ←─────────── rejected
                  → failed (on error or max rework exceeded)
```

See: [Goals & Tasks](goals-and-tasks.md)

---

## Chief Review

The **Chief Review** is the quality gate. Every task's deliverables are scored by a reviewer LLM before being accepted.

The reviewer scores work on a 0-10 scale based on:

- **Completeness** — does it fully address the task?
- **Accuracy** — is the information correct?
- **Quality** — is it production-ready?
- **Clarity** — is it well-structured and clear?
- **Safety** — is it free of harmful content?

The score determines the decision:

| Score | Default Thresholds | Decision |
|-------|-------------------|----------|
| ≥ 8   | autoApproveThreshold | ✅ Auto-approved |
| 5–7   | humanReviewThreshold | 👀 Human review |
| < 5   | below humanReviewThreshold | ❌ Rejected + rework |

You can customize these thresholds, the reviewer model, and the criteria.

See: [Chief Review](chief-review.md)

---

## The ClawSwarm Orchestrator

The `ClawSwarm` class ties everything together. It:

1. Holds the agent registry
2. Manages goal and task state via `GoalManager` and `TaskManager`
3. Decomposes goals via `GoalPlanner`
4. Reviews output via `ChiefReviewer`
5. Emits typed events throughout (`SwarmEvents`)

```typescript
const swarm = new ClawSwarm(config);

swarm.on('goal:completed', (goal) => { ... });
swarm.on('task:review', (task, review) => { ... });
swarm.on('human:review_required', (task, review) => { ... });

const result = await swarm.execute(goal);
```

---

## Design Principles

**Separation of concerns** — Agents don't know about each other, goals, or review. They just execute tasks and return deliverables.

**Explicit quality gates** — Nothing reaches "completed" without passing review. Reject and rework is automatic.

**Observable by default** — Every state transition emits an event. Wire up logging, alerts, or dashboards without modifying the core.

**Model-agnostic** — Each agent can use a different LLM. Use Claude for research, GPT-4 for code, Gemini for ops — whatever fits.

**Extensible** — Subclass `Agent`, add custom tools, override the review prompt, add routing rules to the bridge. The framework stays out of your way.
