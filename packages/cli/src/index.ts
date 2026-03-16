#!/usr/bin/env node
/**
 * ClawSwarm CLI entry point.
 *
 * Usage:
 *   clawswarm init [options]
 *   clawswarm start [options]
 *   clawswarm status [options]
 *
 * @module @clawswarm/cli
 */

import { Command } from 'commander';
import { initProject } from './commands/init.js';
import { startBridge } from './commands/start.js';
import { showStatus } from './commands/status.js';

const program = new Command();

program
  .name('clawswarm')
  .description('🐾 ClawSwarm — Your AI Department, Ready in Minutes')
  .version('0.1.0');

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new ClawSwarm project')
  .option('-n, --name <name>', 'Project name')
  .option('-m, --model <model>', 'Default LLM model for agents', 'claude-sonnet-4')
  .option('-d, --dir <dir>', 'Target directory', process.cwd())
  .action(async (opts) => {
    await initProject(opts).catch(exitOnError);
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
