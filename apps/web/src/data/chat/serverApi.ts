// The calls the chat makes to the server, with the token already inside. The
// workspace provider builds one of these, so the token never reaches a
// component. Pure: no React. Without a token (Demo) every call is
// 'unauthorized', with no request.

import type { Task } from '../../types';
import { answerPermission, cancelRun, fetchConductorStatus, fetchRun, sendFollowUp, startRun, startRunExact, type ConductorStatus, type Run } from './conductor';
import type { ApiResult } from './serverCall';
import { createTask } from './tasks';
import { fetchCapabilities, type AttachPurpose, type Capabilities } from '../attachments/capabilities';
import { deleteUpload, uploadFile, type UploadResult } from '../attachments/upload';
import { fetchTranscript, type Transcript } from './transcript';

export interface ServerApi {
  createTask: (text: string, signal: AbortSignal) => Promise<ApiResult<Task>>;
  conductor: (signal: AbortSignal) => Promise<ApiResult<ConductorStatus>>;
  /** `attachments`: upload ids for this message (Agent mode). */
  startRun: (text: string, signal: AbortSignal, attachments?: readonly string[]) => Promise<ApiResult<Run>>;
  /** Start a run with exactly this title and prompt (a Proposed action card's Approve). */
  startRunExact: (run: { title: string; prompt: string; attachments?: readonly string[] }, signal: AbortSignal) => Promise<ApiResult<Run>>;
  getRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  transcript: (id: string, signal: AbortSignal) => Promise<ApiResult<Transcript>>;
  answerPermission: (id: string, permissionId: string, allow: boolean, signal: AbortSignal) => Promise<ApiResult<Run>>;
  followUp: (id: string, text: string, signal: AbortSignal, attachments?: readonly string[]) => Promise<ApiResult<Run>>;
  /** What can be attached in Ask and in Agent mode. */
  capabilities: (signal: AbortSignal) => Promise<ApiResult<Capabilities>>;
  upload: (purpose: AttachPurpose, file: Blob & { name: string }, signal: AbortSignal) => Promise<UploadResult>;
  deleteUpload: (id: string) => Promise<void>;
  cancelRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
}

export function makeServerApi(token: string | null, fetchImpl?: typeof fetch): ServerApi {
  if (token === null) {
    const none = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, problem: 'unauthorized' });
    return {
      createTask: none, conductor: none, startRun: none, startRunExact: none, getRun: none, transcript: none, answerPermission: none, followUp: none, cancelRun: none, capabilities: none,
      upload: () => Promise.resolve({ ok: false, problem: 'unauthorized' }), deleteUpload: () => Promise.resolve(),
    };
  }
  return {
    createTask: (text, signal) => createTask(token, text, signal, fetchImpl),
    conductor: (signal) => fetchConductorStatus(token, signal, fetchImpl),
    startRun: (text, signal, attachments) => startRun(token, text, signal, fetchImpl, attachments),
    startRunExact: (run, signal) => startRunExact(token, run, signal, fetchImpl),
    getRun: (id, signal) => fetchRun(token, id, signal, fetchImpl),
    transcript: (id, signal) => fetchTranscript(token, id, signal, fetchImpl),
    answerPermission: (id, permissionId, allow, signal) => answerPermission(token, id, permissionId, allow, signal, fetchImpl),
    followUp: (id, text, signal, attachments) => sendFollowUp(token, id, text, signal, fetchImpl, attachments),
    capabilities: (signal) => fetchCapabilities(token, signal, fetchImpl),
    upload: (purpose, file, signal) => uploadFile(token, purpose, file, signal, fetchImpl),
    deleteUpload: (id) => deleteUpload(token, id, fetchImpl),
    cancelRun: (id, signal) => cancelRun(token, id, signal, fetchImpl),
  };
}
