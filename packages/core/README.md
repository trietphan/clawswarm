# @clawswarm/core

The core agent framework for ClawSwarm. Provides the base classes and types for building multi-agent systems.

## Installation

```bash
npm install @clawswarm/core
```

## Usage

```typescript
import { ClawSwarm, Agent, Goal } from '@clawswarm/core';

const swarm = new ClawSwarm({
  agents: [
    Agent.research({ model: 'claude-sonnet-4' }),
    Agent.code({ model: 'gpt-4o' }),
  ],
  chiefReview: {
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
  },
});

const goal = await swarm.createGoal({
  title: 'Build a REST API',
  description: 'Create a Node.js REST API with authentication',
});

const result = await swarm.execute(goal);
```

## API

See the [API Reference](../../docs/api-reference.md) for full documentation.

## License

MIT
