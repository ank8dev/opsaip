// The MCP server and its two tools: start_task and update_status.
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_TASK_STATUSES,
  MAX_AGENT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TASK_ID_LENGTH,
  MAX_TITLE_LENGTH,
  type AgentTaskStatus,
  type StatusReport,
} from '@opsaip/core';
import { z } from 'zod';
import type { ReportClient } from './reportClient';

/**
 * Create the Opsaip MCP server. Not connected yet: call server.connect(transport).
 *
 * Every report carries `agent`: the name the MCP client gave in its
 * initialize request (its clientInfo.name), cut to the limit.
 * The token never reaches this layer: it lives inside the ReportClient.
 */
export function createOpsaipMcpServer(client: ReportClient): McpServer {
  const server = new McpServer({ name: 'opsaip', version: '0.1.0' });

  const agentName = (): string | undefined => {
    const name = server.server.getClientVersion()?.name;
    if (typeof name !== 'string' || name.trim() === '') return undefined;
    return name.slice(0, MAX_AGENT_LENGTH);
  };

  const report = (
    taskId: string,
    status: AgentTaskStatus,
    extra: { title?: string; note?: string } = {},
  ): StatusReport => {
    const result: StatusReport = { taskId, status, at: new Date().toISOString(), ...extra };
    const agent = agentName();
    if (agent !== undefined) result.agent = agent;
    return result;
  };

  server.registerTool(
    'start_task',
    {
      title: 'Start an Opsaip task',
      description:
        'Call once when you begin a new piece of work for the user. Reports the task to Opsaip ' +
        '(queued, then running) and returns its taskId. Keep the taskId and pass it to update_status.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(MAX_TITLE_LENGTH)
          .describe('Short summary of the task, e.g. "Fix the login redirect"'),
      },
      outputSchema: { taskId: z.string() },
    },
    async ({ title }): Promise<CallToolResult> => {
      const taskId = randomUUID();

      const queued = await client.send(report(taskId, 'queued', { title }));
      if (!queued.ok) return toolError(`Could not start the task: ${queued.message}`);

      const running = await client.send(report(taskId, 'running'));
      if (!running.ok) {
        // The task exists now. Say so, so the agent retries instead of
        // calling start_task again and creating a second task.
        return toolError(
          `Task ${taskId} was created (queued), but reporting it as running failed: ` +
            `${running.message}. Retry with update_status(taskId: "${taskId}", status: "running").`,
        );
      }

      return {
        content: [{ type: 'text', text: `Task started. taskId: ${taskId}` }],
        structuredContent: { taskId },
      };
    },
  );

  server.registerTool(
    'update_status',
    {
      title: 'Update an Opsaip task',
      description:
        'Report a status change of a task created by start_task. Use "waiting_on_human" with the ' +
        'question in note before you ask the user something, "running" when you continue, ' +
        '"done" when the task is finished, "failed" with the reason in note if you give up.',
      inputSchema: {
        taskId: z.string().min(1).max(MAX_TASK_ID_LENGTH).describe('The taskId from start_task'),
        status: z.enum(AGENT_TASK_STATUSES as [AgentTaskStatus, ...AgentTaskStatus[]]),
        note: z
          .string()
          .min(1)
          .max(MAX_NOTE_LENGTH)
          .optional()
          .describe('About this status: the question for the user, or why the task failed'),
      },
    },
    async ({ taskId, status, note }): Promise<CallToolResult> => {
      const sent = await client.send(report(taskId, status, note === undefined ? {} : { note }));
      if (!sent.ok) return toolError(`Could not update task ${taskId}: ${sent.message}`);
      return { content: [{ type: 'text', text: `Task ${taskId} is now ${sent.task.status}.` }] };
    },
  );

  return server;
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
