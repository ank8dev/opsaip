// The interface between a Conductor run and the coding agent it drives.
// ClaudeCliDriver (claudeCliDriver.ts) is the only implementation for now.
//
// Next: an AcpDriver for agents that speak the Agent Client Protocol v1
// (https://agentclientprotocol.com), first Codex through the codex-acp adapter
// (npm @agentclientprotocol/codex-acp, binary `codex-acp`, a stdio ACP server
// that starts the Codex App Server itself). We found no `codex --acp` flag:
// ACP for Codex goes through that adapter. ACP v1 maps onto this interface:
//
//   start(options)        -> spawn the adapter (args array, no shell), then
//                            `initialize` (protocolVersion 1, clientCapabilities
//                            without fs/terminal, so the agent works on its own
//                            files in `cwd`), then `session/new` { cwd, mcpServers: [] },
//                            then `session/prompt` { sessionId, prompt: [{ type: "text", text }] }.
//                            Emit "started" once session/new answers.
//   sendMessage(text)     -> ACP v1 has one prompt per turn: a follow-up while
//                            a prompt runs is either queued for the next turn
//                            or sent with the adapter's steering extension
//                            (codex-acp: "_session/steering"). Decide then.
//   session/update notifications
//                         -> "agent_message_chunk" text is collected into
//                            "message" events; tool_call / plan updates are ignored.
//   session/request_permission { toolCall, options }
//                         -> "permissionRequested" (tool = toolCall.title/kind,
//                            summary from toolCall). answerPermission(allow) replies
//                            { outcome: { outcome: "selected", optionId } } with the
//                            option whose kind is "allow_once" or "reject_once"
//                            (never the "*_always" kinds: every call is asked).
//   session/prompt response { stopReason }
//                         -> "result": ok for "end_turn"; "refusal",
//                            "max_tokens", "max_turn_requests" are not ok.
//                            "cancelled" follows our own cancel.
//   cancel()              -> answer pending permissions with
//                            { outcome: { outcome: "cancelled" } }, send the
//                            `session/cancel` notification, wait briefly for the
//                            prompt response, then SIGTERM / SIGKILL like below.
//   process exit          -> "exited".
// Authentication stays with the agent: Opsaip never passes or reads keys.

/** One thing that happened in a run, in order. */
export type RunEvent =
  /** The agent process is running. */
  | { type: 'started' }
  /** The agent wrote text (its latest message, not a delta). */
  | { type: 'message'; text: string }
  /** The agent needs a person to allow or deny a tool call. Answer with answerPermission. */
  | { type: 'permissionRequested'; permission: PermissionRequest }
  /** The agent gave up on a request before it was answered (e.g. it cancelled the tool call). */
  | { type: 'permissionWithdrawn'; permissionId: string }
  /** The turn ended. The driver closes the agent's input: the run is over. */
  | { type: 'result'; ok: boolean; text?: string }
  /**
   * The agent process is gone. Always the last event. startFailed: it never
   * ran (for example the binary was not found).
   */
  | { type: 'exited'; code: number | null; signal: string | null; startFailed: boolean };

export interface PermissionRequest {
  /** Random, unique per request. The person's answer must name it. */
  id: string;
  /** The tool, e.g. "Bash". At most MAX_TOOL_CHARS. */
  tool: string;
  /** What it would do, one line, at most MAX_SUMMARY_CHARS (toolSummary.ts). */
  summary: string;
}

export interface DriverStartOptions {
  /** The run's own git worktree: the agent's working directory. */
  cwd: string;
  /** The first message. Goes to the agent's stdin, never into argv. */
  prompt: string;
  /** Receives every event, in order. Called synchronously, never after "exited". */
  onEvent(event: RunEvent): void;
}

/** One agent session. One driver object per run. */
export interface AgentDriver {
  /** Who works on the task, as written on it: "claude-code". */
  readonly agent: string;
  /**
   * Start the agent. Resolves once the process is spawned or failed to start.
   * Never rejects for a run that cannot start (no binary, no temporary
   * directory): "exited" with startFailed reports it. Throws if called twice.
   */
  start(options: DriverStartOptions): Promise<void>;
  /** A follow-up message while the turn runs. False once the turn ended or the run stops. */
  sendMessage(text: string): boolean;
  /** Answer a pending permission request. False if it is unknown or already settled. */
  answerPermission(permissionId: string, allow: boolean, message?: string): boolean;
  /**
   * Stop the run: deny every pending permission request first (a request
   * left open when the process dies stays unanswered in the agent's session),
   * close the input, then SIGTERM, then SIGKILL after a short grace.
   * Resolves once the process has exited. Safe to call more than once.
   */
  cancel(denyMessage?: string): Promise<void>;
}
