// The calls the chat makes to the server, with the token already inside. The
// workspace provider builds one of these, so the token never reaches a
// component. Pure: no React. Without a token (Demo) every call is
// 'unauthorized', with no request.

import type { Task } from '../../types';
import { answerPermission, cancelRun, fetchConductorStatus, fetchRun, sendFollowUp, startRun, startRunExact, type ConductorStatus, type Run } from './conductor';
import type { ApiResult } from './serverCall';
import { createTask } from './tasks';
import { createChat, deleteChat, listChats, loadMessages, renameChat, saveMessages, type ChatInfo } from '../chats/chats';
import type { ThreadMessage } from './types';
import { fetchAbout, fetchUpdate, type About, type UpdateInfo } from '../about';
import { fetchCapabilities, type AttachPurpose, type Capabilities } from '../attachments/capabilities';
import { deleteUpload, uploadFile, type UploadResult } from '../attachments/upload';
import { addRepo, fetchRepos, removeRepo, type RepoEntry } from './repos';
import { fetchTranscript, type Transcript } from './transcript';

export interface ServerApi {
  createTask: (text: string, signal: AbortSignal) => Promise<ApiResult<Task>>;
  conductor: (signal: AbortSignal) => Promise<ApiResult<ConductorStatus>>;
  /** `attachments`: upload ids for this message (Agent mode). `repoId`: the repository to work in. */
  startRun: (text: string, signal: AbortSignal, attachments?: readonly string[], repoId?: string) => Promise<ApiResult<Run>>;
  /** Start a run with exactly this title, prompt and repository (a Proposed action card's Approve). */
  startRunExact: (run: { title: string; prompt: string; attachments?: readonly string[]; repoId?: string }, signal: AbortSignal) => Promise<ApiResult<Run>>;
  getRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  transcript: (id: string, signal: AbortSignal) => Promise<ApiResult<Transcript>>;
  answerPermission: (id: string, permissionId: string, allow: boolean, signal: AbortSignal) => Promise<ApiResult<Run>>;
  followUp: (id: string, text: string, signal: AbortSignal, attachments?: readonly string[]) => Promise<ApiResult<Run>>;
  /** Chat sessions, stored on the server. */
  listChats: (signal: AbortSignal) => Promise<ApiResult<ChatInfo[]>>;
  createChat: (title: string, signal: AbortSignal) => Promise<ApiResult<ChatInfo>>;
  renameChat: (id: string, title: string, signal: AbortSignal) => Promise<ApiResult<ChatInfo>>;
  deleteChat: (id: string, signal: AbortSignal) => Promise<ApiResult<true>>;
  loadMessages: (id: string, signal: AbortSignal) => Promise<ApiResult<ThreadMessage[]>>;
  saveMessages: (id: string, messages: readonly ThreadMessage[], signal: AbortSignal) => Promise<ApiResult<ChatInfo>>;
  about: (signal: AbortSignal) => Promise<ApiResult<About>>;
  update: (signal: AbortSignal) => Promise<ApiResult<UpdateInfo>>;
  /** What can be attached in Ask and in Agent mode. */
  capabilities: (signal: AbortSignal) => Promise<ApiResult<Capabilities>>;
  upload: (purpose: AttachPurpose, file: Blob & { name: string }, signal: AbortSignal) => Promise<UploadResult>;
  deleteUpload: (id: string) => Promise<void>;
  cancelRun: (id: string, signal: AbortSignal) => Promise<ApiResult<Run>>;
  /** The repositories Conductor mode can use (with paths): Settings > Repositories. */
  repos: (signal: AbortSignal) => Promise<ApiResult<RepoEntry[]>>;
  addRepo: (path: string, signal: AbortSignal) => Promise<ApiResult<RepoEntry>>;
  removeRepo: (id: string, signal: AbortSignal) => Promise<ApiResult<true>>;
}

export function makeServerApi(token: string | null, fetchImpl?: typeof fetch): ServerApi {
  if (token === null) {
    const none = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, problem: 'unauthorized' });
    return {
      createTask: none, conductor: none, startRun: none, startRunExact: none, getRun: none, transcript: none, answerPermission: none, followUp: none, cancelRun: none, capabilities: none, about: none, update: none, repos: none, addRepo: none, removeRepo: none,
      listChats: none, createChat: none, renameChat: none, deleteChat: none, loadMessages: none, saveMessages: none,
      upload: () => Promise.resolve({ ok: false, problem: 'unauthorized' }), deleteUpload: () => Promise.resolve(),
    };
  }
  return {
    createTask: (text, signal) => createTask(token, text, signal, fetchImpl),
    conductor: (signal) => fetchConductorStatus(token, signal, fetchImpl),
    startRun: (text, signal, attachments, repoId) => startRun(token, text, signal, fetchImpl, attachments, repoId),
    startRunExact: (run, signal) => startRunExact(token, run, signal, fetchImpl),
    getRun: (id, signal) => fetchRun(token, id, signal, fetchImpl),
    transcript: (id, signal) => fetchTranscript(token, id, signal, fetchImpl),
    answerPermission: (id, permissionId, allow, signal) => answerPermission(token, id, permissionId, allow, signal, fetchImpl),
    followUp: (id, text, signal, attachments) => sendFollowUp(token, id, text, signal, fetchImpl, attachments),
    listChats: (signal) => listChats(token, signal, fetchImpl),
    createChat: (title, signal) => createChat(token, title, signal, fetchImpl),
    renameChat: (id, title, signal) => renameChat(token, id, title, signal, fetchImpl),
    deleteChat: (id, signal) => deleteChat(token, id, signal, fetchImpl),
    loadMessages: (id, signal) => loadMessages(token, id, signal, fetchImpl),
    saveMessages: (id, messages, signal) => saveMessages(token, id, messages, signal, fetchImpl),
    about: (signal) => fetchAbout(token, signal, fetchImpl),
    update: (signal) => fetchUpdate(token, signal, fetchImpl),
    capabilities: (signal) => fetchCapabilities(token, signal, fetchImpl),
    upload: (purpose, file, signal) => uploadFile(token, purpose, file, signal, fetchImpl),
    deleteUpload: (id) => deleteUpload(token, id, fetchImpl),
    cancelRun: (id, signal) => cancelRun(token, id, signal, fetchImpl),
    repos: (signal) => fetchRepos(token, signal, fetchImpl),
    addRepo: (path, signal) => addRepo(token, path, signal, fetchImpl),
    removeRepo: (id, signal) => removeRepo(token, id, signal, fetchImpl),
  };
}
