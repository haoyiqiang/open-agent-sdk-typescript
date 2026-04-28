/**
 * @codeany/open-agent-sdk
 *
 * Open-source TypeScript reimplementation of `@anthropic-ai/claude-agent-sdk`.
 * Runs the full agent loop in-process — no CLI subprocess.
 *
 * Public API mirrors the official SDK verbatim. Code written against
 * `@anthropic-ai/claude-agent-sdk` works without changes (Bridge / Worker /
 * remote-control symbols are intentionally omitted — see plan §5).
 *
 * Non-official extensions:
 *   - OpenAI-compatible provider via extra fields `apiType`, `apiKey`, `baseURL`
 *     on `Options`. Default behaviour is Anthropic, matching the official SDK.
 */

// --------------------------------------------------------------------------
// Public entry: query() + Query interface
// --------------------------------------------------------------------------

export { query } from './query.js'

// --------------------------------------------------------------------------
// Tool helper (Zod-based) — official `tool()` and `createSdkMcpServer()`
// --------------------------------------------------------------------------

export { tool, sdkToolToToolDefinition } from './tool-helper.js'
export type { CallToolResult, SdkMcpToolDefinition } from './tool-helper.js'
export type { ToolAnnotations } from './tool-helper.js'

export { createSdkMcpServer, isSdkServerConfig } from './sdk-mcp-server.js'

// --------------------------------------------------------------------------
// Official type surface — re-exported via the domain split in src/types
// --------------------------------------------------------------------------

export type {
  // Options & configuration
  Options,
  ThinkingConfig,
  ThinkingAdaptive,
  ThinkingEnabled,
  ThinkingDisabled,
  EffortLevel,
  SettingSource,
  ConfigScope,
  SdkBeta,
  SdkPluginConfig,
  ToolConfig,
  Settings,
  SandboxSettings,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SandboxIgnoreViolations,
  OutputFormat,
  OutputFormatType,
  BaseOutputFormat,
  JsonSchemaOutputFormat,
  ApiKeySource,
  ExitReason,
  TerminalReason,
  FastModeState,
  SpawnedProcess,
  SpawnOptions,

  // SDKMessage union (28 variants)
  SDKMessage,
  SDKMessageOrigin,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKPartialAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKStatusMessage,
  SDKStatus,
  SDKAPIRetryMessage,
  SDKLocalCommandOutputMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKPluginInstallMessage,
  SDKToolProgressMessage,
  SDKAuthStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKTaskProgressMessage,
  SDKSessionStateChangedMessage,
  SDKNotificationMessage,
  SDKFilesPersistedEvent,
  SDKToolUseSummaryMessage,
  SDKMemoryRecallMessage,
  SDKRateLimitEvent,
  SDKRateLimitInfo,
  SDKElicitationCompleteMessage,
  SDKPromptSuggestionMessage,
  SDKMirrorErrorMessage,
  SDKDeferredToolUse,
  SDKPermissionDenial,
  ModelUsage,
  NonNullableUsage,

  // Permissions
  PermissionMode,
  PermissionBehavior,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
  PermissionRuleValue,
  PermissionDecisionClassification,
  CanUseTool,

  // Hooks (32 events)
  HookEvent,
  HookInput,
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  HookPermissionDecision,
  AsyncHookJSONOutput,
  SyncHookJSONOutput,
  BaseHookInput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PostToolUseFailureHookInput,
  PostToolUseFailureHookSpecificOutput,
  PostToolBatchHookInput,
  PostToolBatchHookSpecificOutput,
  PostToolBatchToolCall,
  PreCompactHookInput,
  PostCompactHookInput,
  NotificationHookInput,
  NotificationHookSpecificOutput,
  UserPromptSubmitHookInput,
  UserPromptSubmitHookSpecificOutput,
  UserPromptExpansionHookInput,
  UserPromptExpansionHookSpecificOutput,
  SessionStartHookInput,
  SessionStartHookSpecificOutput,
  SessionEndHookInput,
  StopHookInput,
  StopFailureHookInput,
  SubagentStartHookInput,
  SubagentStartHookSpecificOutput,
  SubagentStopHookInput,
  PermissionRequestHookInput,
  PermissionRequestHookSpecificOutput,
  PermissionDeniedHookInput,
  PermissionDeniedHookSpecificOutput,
  SetupHookInput,
  SetupHookSpecificOutput,
  TeammateIdleHookInput,
  TaskCreatedHookInput,
  TaskCompletedHookInput,
  ElicitationHookInput,
  ElicitationHookSpecificOutput,
  ElicitationResultHookInput,
  ElicitationResultHookSpecificOutput,
  ElicitationRequest,
  ElicitationResult,
  ConfigChangeHookInput,
  WorktreeCreateHookInput,
  WorktreeCreateHookSpecificOutput,
  WorktreeRemoveHookInput,
  InstructionsLoadedHookInput,
  CwdChangedHookInput,
  CwdChangedHookSpecificOutput,
  FileChangedHookInput,
  FileChangedHookSpecificOutput,
  OnElicitation,

  // MCP
  McpServerConfig,
  McpServerConfigForProcessTransport,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpSdkServerConfig,
  McpSdkServerConfigWithInstance,
  McpClaudeAIProxyServerConfig,
  McpServerStatus,
  McpServerStatusConfig,
  McpServerToolPolicy,
  McpSetServersResult,
  AnyZodRawShape,
  InferShape,
  Transport,

  // Agent definitions
  AgentDefinition,
  AgentInfo,
  AgentMcpServerSpec,
  ModelInfo,

  // Session
  SessionStore,
  SessionKey,
  SessionStoreEntry,
  SessionSummaryEntry,
  SessionMessage,
  SessionMutationOptions,
  SDKSessionInfo,
  SDKSession,
  SDKSessionOptions,
  SDKSettingsParseError,
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  GetSubagentMessagesOptions,
  ListSessionsOptions,
  ListSubagentsOptions,
  ImportSessionToStoreOptions,

  // Query interface & control responses
  Query,
  WarmQuery,
  SlashCommand,
  AccountInfo,
  RewindFilesResult,
  InboundPrompt,
  PromptRequest,
  PromptRequestOption,
  PromptResponse,
  SDKControlRequest,
  SDKControlResponse,
  SDKControlInitializeResponse,
  SDKControlGetContextUsageResponse,
  SDKControlReadFileResponse,
  SDKControlReloadPluginsResponse,
} from './types/index.js'

export {
  HOOK_EVENTS,
  EXIT_REASONS,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  AbortError,
  InMemorySessionStore,
} from './types/index.js'

// --------------------------------------------------------------------------
// Session API (official function shapes)
// --------------------------------------------------------------------------

export {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
  renameSession,
  tagSession,
  deleteSession,
  forkSession,
  importSessionToStore,
  foldSessionSummary,
} from './session-official.js'
