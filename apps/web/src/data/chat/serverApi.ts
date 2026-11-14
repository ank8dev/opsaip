// The calls the chat makes to the server, with the token already inside. The
// workspace provider builds one of these, so the token never reaches a
// component. Pure: no React. Without a token (Demo) every call is
// 'unauthorized', with no request.

import type { Task } from '../../types';
import { answerPermission, cancelRun, fetchConductorStatus, fetchRun, sendFollowUp, startRun, startRunExact, type ConductorStatus, type Run } from './conductor';
import type { ApiResult } from './serverCall';
import { createTask } from './tasks';
import { fetchTranscript, type Transcript } from './transcript';

export interface ServerApi {
  createTask: (text: string, signal: AbortSignal) => Promise<ApiResult<Task>>;
  conductor: (signal: AbortSignal) => Promise<ApiResult<ConductorStatus>>;
  startRun: (text: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  /** Start a run with exactly this title and prompt (a Proposed action card's Approve). */
  startRunExact: (run: { title: string; prompt: string }, signal: AbortSignal) => Promise<ApiResult<Run>>;
  getRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  transcript: (id: string, signal: AbortSignal) => Promise<ApiResult<Transcript>>;
  answerPermission: (id: string, permissionId: string, allow: boolean, signal: AbortSignal) => Promise<ApiResult<Run>>;
  followUp: (id: string, text: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  cancelRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
}

export function makeServerApi(token: string | null, fetchImpl?: typeof fetch): ServerApi {
  if (token === null) {
    const none = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, problem: 'unauthorized' });
    return {
      createTask: none, conductor: none, startRun: none, startRunExact: none, getRun: none, transcript: none, answerPermission: none, followUp: none, cancelRun: none,
    };
  }
  return {
    createTask: (text, signal) => createTask(token, text, signal, fetchImpl),
    conductor: (signal) => fetchConductorStatus(token, signal, fetchImpl),
    startRun: (text, signal) => startRun(token, text, signal, fetchImpl),
    startRunExact: (run, signal) => startRunExact(token, run, signal, fetchImpl),
    getRun: (id, signal) => fetchRun(token, id, signal, fetchImpl),
    transcript: (id, signal) => fetchTranscript(token, id, signal, fetchImpl),
    answerPermission: (id, permissionId, allow, signal) => answerPermission(token, id, permissionId, allow, signal, fetchImpl),
    followUp: (id, text, signal) => sendFollowUp(token, id, text, signal, fetchImpl),
    cancelRun: (id, signal) => cancelRun(token, id, signal, fetchImpl),
  };
}
