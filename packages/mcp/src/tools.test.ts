// The tools with a fake ReportClient, for cases the real server cannot be
// made to produce on demand (a failure between the two start_task reports).
// The real server is used in e2e.test.ts.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { StatusReport } from '@opsaip/core';
import { describe, expect, it } from 'vitest';
import type { ReportClient, SendResult } from './reportClient';
import { createOpsaipMcpServer } from './tools';

/** A ReportClient that records reports and answers with `answers`, in order. */
function fakeClient(answers: SendResult[]): ReportClient & { sent: StatusReport[] } {
  const sent: StatusReport[] = [];
  return {
    sent,
    async send(report) {
      sent.push(report);
      return answers.shift() ?? { ok: false, message: 'no answer left' };
    },
  };
}

const okTask = (status: StatusReport['status']): SendResult => ({
  ok: true,
  task: { id: 'x', status, updatedAt: '2026-11-01T10:00:00Z' },
});

async function connect(reports: ReportClient, clientName: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createOpsaipMcpServer(reports).connect(serverSide);
  const client = new Client({ name: clientName, version: '0.0.0-test' });
  await client.connect(clientSide);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

const textOf = (result: CallToolResult) =>
  result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');

describe('start_task', () => {
  it('sends queued (with title) then running, with the same id and the agent name', async () => {
    const reports = fakeClient([okTask('queued'), okTask('running')]);
    const client = await connect(reports, 'claude-code');
    const result = await call(client, 'start_task', { title: 'Fix login' });

    expect(result.isError).toBeFalsy();
    const [queued, running] = reports.sent;
    expect(queued).toMatchObject({ status: 'queued', title: 'Fix login', agent: 'claude-code' });
    expect(running).toMatchObject({ taskId: queued.taskId, status: 'running', agent: 'claude-code' });
    expect(running).not.toHaveProperty('title');
    expect(Date.parse(running.at)).toBeGreaterThanOrEqual(Date.parse(queued.at));
    expect(result.structuredContent).toEqual({ taskId: queued.taskId });
  });

  it('stops after a failed queued report', async () => {
    const reports = fakeClient([{ ok: false, message: 'boom' }]);
    const client = await connect(reports, 'claude-code');
    const result = await call(client, 'start_task', { title: 'Fix login' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Could not start the task: boom');
    expect(reports.sent).toHaveLength(1);
  });

  it('names the created task when only the running report fails, so the agent can retry it', async () => {
    const reports = fakeClient([okTask('queued'), { ok: false, message: 'boom' }]);
    const client = await connect(reports, 'claude-code');
    const result = await call(client, 'start_task', { title: 'Fix login' });
    const { taskId } = reports.sent[0];
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      `Task ${taskId} was created (queued), but reporting it as running failed: boom. ` +
        `Retry with update_status(taskId: "${taskId}", status: "running").`,
    );
  });
});

describe('agent name', () => {
  it('is cut to 100 characters', async () => {
    const reports = fakeClient([okTask('queued'), okTask('running')]);
    const client = await connect(reports, 'a'.repeat(150));
    await call(client, 'start_task', { title: 'Fix login' });
    expect(reports.sent[0].agent).toBe('a'.repeat(100));
  });

  it('is left out when the client name is blank', async () => {
    const reports = fakeClient([okTask('done')]);
    const client = await connect(reports, '   ');
    await call(client, 'update_status', { taskId: 't1', status: 'done' });
    expect(reports.sent[0]).not.toHaveProperty('agent');
  });
});

describe('update_status', () => {
  it('sends the note only when given', async () => {
    const reports = fakeClient([okTask('waiting_on_human'), okTask('running')]);
    const client = await connect(reports, 'codex');
    await call(client, 'update_status', { taskId: 't1', status: 'waiting_on_human', note: 'Which branch?' });
    await call(client, 'update_status', { taskId: 't1', status: 'running' });
    expect(reports.sent[0]).toMatchObject({ taskId: 't1', status: 'waiting_on_human', note: 'Which branch?' });
    expect(reports.sent[1]).not.toHaveProperty('note');
  });

  it('rejects a note over 500 characters before sending anything', async () => {
    const reports = fakeClient([]);
    const client = await connect(reports, 'codex');
    const result = await call(client, 'update_status', { taskId: 't1', status: 'failed', note: 'x'.repeat(501) });
    expect(result.isError).toBe(true);
    expect(reports.sent).toEqual([]);
  });
});
