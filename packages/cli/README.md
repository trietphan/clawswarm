# @clawswarm/cli

Command-line interface for ClawSwarm. Initialize new projects, start the bridge server, and inspect agent/task status.

## Installation

```bash
# Install globally
npm install -g @clawswarm/cli

# Or use via npx
npx clawswarm <command>
```

## Commands

### `clawswarm init`

Initialize a new ClawSwarm project in the current directory.

```bash
clawswarm init
clawswarm init --name my-swarm --model claude-sonnet-4
```

Creates:
- `clawswarm.config.ts` — Swarm configuration
- `.env.example` — Environment variable template
- `goals/` — Directory for goal definitions

### `clawswarm start`

Start the ClawSwarm bridge server.

```bash
clawswarm start
clawswarm start --port 8787 --host 0.0.0.0
clawswarm start --config ./clawswarm.config.ts
```

Options:
- `--port, -p` — Port to listen on (default: 8787)
- `--host` — Host to bind to (default: 0.0.0.0)
- `--config, -c` — Path to config file

### `clawswarm status`

Show the status of running agents and active tasks.

```bash
clawswarm status
clawswarm status --bridge ws://localhost:8787
clawswarm status --org my-org-id
```

Options:
- `--bridge` — Bridge URL to connect to
- `--org` — Organization ID to filter by
- `--watch, -w` — Watch for updates (refresh every 2s)

## License

MIT
