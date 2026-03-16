# Goals and Tasks

Understanding the goal → task lifecycle is key to using ClawSwarm effectively.

---

## Goals

A **Goal** represents a high-level business objective. Goals are intentionally broad — they describe *what* you want to achieve, not *how*.

### Creating a Goal

```typescript
const goal = swarm.createGoal({
  title: 'Launch feature X',
  description: `
    Feature X allows users to export their data in CSV format.
    Requirements:
    - Export button in the dashboard settings
    - Support for up to 100k rows
    - Email delivery for large exports
    - Audit log entry on export
  `,
  priority: 2,           // optional, higher = more urgent
  deadline: '2026-12-31T00:00:00Z',  // optional ISO timestamp
  tags: ['feature', 'q4', 'data'],   // optional tags
});
```

### Goal Lifecycle

```
created → planning → in_progress → completed
                                 → failed
```

- **created** — goal has been defined but not started
- **planning** — the Planner is decomposing it into tasks
- **in_progress** — tasks are executing
- **completed** — all tasks finished (some may have failed)
- **failed** — an unrecoverable error occurred

### Executing a Goal

```typescript
const result = await swarm.execute(goal);
// GoalResult:
// {
//   goal: Goal,
//   deliverables: Deliverable[],
//   cost: CostSummary,
//   hadHumanReview: boolean,
//   durationMs: number,
// }
```

`execute()` is async and resolves when the goal reaches a terminal state (`completed` or `failed`).

---

## Task Decomposition

When a goal enters the **planning** phase, the `GoalPlanner` calls an LLM to break it down into tasks.

### What the Planner Produces

For each task, the planner determines:

- **title** — short, action-oriented title
- **description** — detailed instructions for the agent
- **agentType** — which specialist handles this task (`research`, `code`, `ops`, etc.)
- **dependsOn** — task IDs that must complete before this one starts

### Example Decomposition

Goal: *"Build and deploy a REST API for user authentication"*

Decomposed into:

```
Task 1: Research auth patterns (research) — no deps
Task 2: Implement JWT auth service (code) — depends on Task 1
Task 3: Write unit tests (code) — depends on Task 2
Task 4: Deploy to staging (ops) — depends on Task 3
Task 5: Write API documentation (research) — depends on Task 2
```

Tasks 4 and 5 can run concurrently since they both depend on Task 2 but not on each other.

---

## Task Lifecycle

```
pending → assigned → in_progress → review → approved → completed
                                           → human_review
         ← rework ←──────────────────── rejected
         → failed
```

### States

| Status | Description |
|--------|-------------|
| `pending` | Created but not yet assigned |
| `assigned` | Assigned to an agent, waiting to start |
| `in_progress` | Agent is actively working |
| `review` | Work submitted, awaiting chief review |
| `approved` | Review passed |
| `human_review` | Score in middle tier — needs human decision |
| `rework` | Rejected by review, being retried |
| `completed` | Fully done |
| `failed` | Unrecoverable error |
| `rejected` | Rejected after max rework cycles |

### Rework Cycles

If a task is rejected, it automatically enters a rework cycle:

1. The rejection feedback is attached to the task's deliverables
2. The task status resets to `pending`
3. The agent re-executes with the feedback context
4. After `maxReworkCycles` (default: 3), the task is marked `rejected`

```typescript
// Customize max rework via task creation
// (currently set at the TaskManager level)
const task = taskManager.create({
  // ...
  maxReworkCycles: 5, // allow more rework for complex tasks
});
```

---

## Deliverables

Each task produces one or more **deliverables** — the concrete outputs.

```typescript
interface Deliverable {
  type: 'text' | 'code' | 'file' | 'url' | 'data';
  label: string;       // human-readable label
  content: string;     // the actual content
  mimeType?: string;   // e.g., 'text/markdown', 'text/x-python'
  filePath?: string;   // for 'file' type deliverables
}
```

### Examples

```typescript
// Research report
{ type: 'text', label: 'Market Analysis', content: '# Market Analysis\n...' }

// Code file
{ type: 'code', label: 'auth.service.ts', content: 'export class AuthService { ... }', mimeType: 'text/typescript' }

// File reference
{ type: 'file', label: 'Report PDF', content: '', filePath: '/tmp/report.pdf' }

// URL to an artifact
{ type: 'url', label: 'Staging URL', content: 'https://staging.example.com' }

// Structured data
{ type: 'data', label: 'Analysis Results', content: '{"rows": 1042, "trends": [...]}', mimeType: 'application/json' }
```

---

## Dependency Handling

ClawSwarm automatically runs tasks in waves:

1. Find all `pending` tasks whose `dependsOn` IDs are all `completed`
2. Run them concurrently
3. When they all finish, repeat

If a circular dependency exists or a dependency fails, the dependent task cannot proceed and will be marked `failed`.

---

## Direct Task Management

You can access the `TaskManager` directly for fine-grained control:

```typescript
const tm = swarm.getTaskManager();

// Get all tasks for a goal
const tasks = tm.getByGoal(goal.id);

// Get tasks ready to run
const ready = tm.getReady(goal.id);

// Check if goal is done
const done = tm.isGoalDone(goal.id);

// Manually complete a task
tm.complete(taskId);
```
