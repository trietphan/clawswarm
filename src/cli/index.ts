#!/usr/bin/env node
/**
 * ClawSwarm CLI entry point.
 *
 * Usage:
 *   clawswarm init [options]
 *   clawswarm run "<goal>"
 *   clawswarm start [options]
 *   clawswarm status [options]
 *
 * @module clawswarm/cli
 */

import { Command } from 'commander';
import { initProject } from './commands/init.js';
import { startBridge } from './commands/start.js';
import { showStatus } from './commands/status.js';
import { runGoal } from './commands/run.js';

const program = new Command();

program
  .name('clawswarm')
  .description('🐾 ClawSwarm — Your AI Department, Ready in Minutes')
  .version('0.3.0-alpha');

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new ClawSwarm project (interactive wizard)')
  .option('-n, --name <name>', 'Project name')
  .option('-d, --dir <dir>', 'Target directory', process.cwd())
  .option('-y, --yes', 'Skip prompts and use defaults')
  .action(async (opts) => {
    await initProject(opts).catch(exitOnError);
  });

// ─── run ──────────────────────────────────────────────────────────────────────

program
  .command('run <goal>')
  .description('Execute a goal using the ClawSwarm agent framework')
  .option('-c, --config <path>', 'Path to clawswarm.config.ts')
  .option('-v, --verbose', 'Verbose output')
  .option('--dashboard-url <url>', 'clawswarm.app dashboard URL (or set CLAWSWARM_DASHBOARD_URL)')
  .option('--bridge-token <token>', 'Bridge auth token (or set CLAWSWARM_BRIDGE_TOKEN)')
  .action(async (goal: string, opts) => {
    await runGoal(goal, {
      config: opts.config as string | undefined,
      verbose: opts.verbose as boolean | undefined,
      dashboardUrl: opts.dashboardUrl as string | undefined,
      bridgeToken: opts.bridgeToken as string | undefined,
    }).catch(exitOnError);
  });

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the ClawSwarm bridge server')
  .option('-p, --port <port>', 'Port to listen on', '8787')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .option('-c, --config <path>', 'Path to config file')
  .option('-t, --tokens <tokens>', 'Comma-separated auth tokens')
  .action(async (opts) => {
    await startBridge({
      port: parseInt(opts.port, 10),
      host: opts.host,
      config: opts.config,
      tokens: opts.tokens,
    }).catch(exitOnError);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show agent and task status')
  .option('-b, --bridge <url>', 'Bridge WebSocket URL', 'ws://localhost:8787')
  .option('--org <orgId>', 'Organization ID')
  .option('--token <token>', 'Auth token')
  .option('-w, --watch', 'Watch mode — refresh continuously')
  .action(async (opts) => {
    await showStatus(opts).catch(exitOnError);
  });

// ─── Parse ────────────────────────────────────────────────────────────────────

program.parse(process.argv);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exitOnError(err: Error): never {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
}
