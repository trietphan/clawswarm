/**
 * Org-scoped task router for the ClawSwarm bridge.
 *
 * Routes messages from ClawSwarm events to the appropriate
 * WebSocket clients based on organization ID and client role.
 *
 * @module @clawswarm/bridge/router
 */

import { BridgeServer } from './bridge.js';
import { BridgeMessage, BridgeMessageType, ClientRole } from './types.js';

// ─── TaskRouter ───────────────────────────────────────────────────────────────

/**
 * Routes ClawSwarm events to connected bridge clients.
 *
 * Provides a high-level API for broadcasting goal/task events
 * to the right clients within an organization.
 *
 * @example
 * ```typescript
 * const bridge = new BridgeServer({ port: 8787 });
 * await bridge.start();
 *
 * const router = new TaskRouter(bridge);
 *
 * // Connect a ClawSwarm instance to the router
 * swarm.on('task:completed', (task) => {
 *   router.routeTaskEvent('task:completed', task.goalId, task, 'my-org-id');
 * });
 * ```
 */
export class TaskRouter {
  private readonly bridge: BridgeServer;
  private readonly rules: Map<string, RouteRule> = new Map();

  constructor(bridge: BridgeServer) {
    this.bridge = bridge;
  }

  // ─── Routing Methods ──────────────────────────────────────────────────────

  /**
   * Route a task-related event to all dashboard clients in the org.
   *
   * @param type - Event type
   * @param goalId - Goal ID for context
   * @param payload - Event payload
   * @param orgId - Organization to route to
   */
  routeTaskEvent(
    type: BridgeMessageType,
    goalId: string,
    payload: unknown,
    orgId: string
  ): number {
    return this.bridge.broadcast(
      orgId,
      this._buildMessage(type, orgId, payload),
      ['dashboard', 'external']
    );
  }

  /**
   * Route a goal-related event.
   *
   * @param type - Event type
   * @param payload - Event payload (the Goal object)
   * @param orgId - Organization to route to
   */
  routeGoalEvent(
    type: BridgeMessageType,
    payload: unknown,
    orgId: string
  ): number {
    return this.bridge.broadcast(
      orgId,
      this._buildMessage(type, orgId, payload),
      ['dashboard', 'external']
    );
  }

  /**
   * Route an agent status update to dashboard clients.
   */
  routeAgentStatus(
    agentId: string,
    agentType: string,
    status: 'idle' | 'busy' | 'error' | 'offline',
    orgId: string,
    currentTaskId?: string
  ): number {
    return this.bridge.broadcast(
      orgId,
      this._buildMessage('agent:status', orgId, { agentId, agentType, status, currentTaskId }),
      ['dashboard']
    );
  }

  /**
   * Broadcast a raw message to all clients in an org.
   */
  broadcast(
    orgId: string,
    message: BridgeMessage,
    roles?: ClientRole[]
  ): number {
    return this.bridge.broadcast(orgId, message, roles);
  }

  /**
   * Add a routing rule for custom message handling.
   * Rules are evaluated before default routing.
   *
   * @param id - Unique rule identifier
   * @param rule - Route rule definition
   */
  addRule(id: string, rule: RouteRule): void {
    this.rules.set(id, rule);
  }

  /**
   * Remove a routing rule.
   */
  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Route a message through all matching rules.
   * Returns the number of clients that received the message.
   */
  route(orgId: string, message: BridgeMessage): number {
    let count = 0;

    for (const rule of this.rules.values()) {
      if (rule.messageType !== '*' && rule.messageType !== message.type) continue;
      if (rule.orgIds && !rule.orgIds.includes(orgId)) continue;

      count += this.bridge.broadcast(orgId, message, rule.roles);
    }

    // Default: broadcast to all in org if no rules matched
    if (count === 0) {
      count = this.bridge.broadcast(orgId, message);
    }

    return count;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Build a typed bridge message.
   * @internal
   */
  /**
   * Safely route — wraps broadcast so a single send failure doesn't
   * propagate up to the caller.
   * @internal
   */
  private _safeBroadcast(
    orgId: string,
    message: BridgeMessage,
    roles?: ClientRole[]
  ): number {
    try {
      return this.bridge.broadcast(orgId, message, roles);
    } catch {
      return 0;
    }
  }

  private _buildMessage(
    type: BridgeMessageType,
    orgId: string,
    payload: unknown
  ): BridgeMessage {
    return {
      type,
      ts: new Date().toISOString(),
      orgId,
      payload,
    };
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface RouteRule {
  messageType: BridgeMessageType | '*';
  orgIds?: string[];
  roles?: ClientRole[];
}
