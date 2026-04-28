/**
 * Domain re-export: Session storage abstraction & session info types.
 * Source of truth: ./official.d.ts.
 */
export type {
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
} from './official.js'

export { InMemorySessionStore } from './official-values.js'
