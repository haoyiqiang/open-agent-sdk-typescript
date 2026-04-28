/**
 * Domain re-export: Query interface and control request/response types.
 * Source of truth: ./official.d.ts.
 */
export type {
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
} from './official.js'

export { AbortError } from './official-values.js'
