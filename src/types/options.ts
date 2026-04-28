/**
 * Domain re-export: Options & related configuration types.
 *
 * All types mirror the official `@anthropic-ai/claude-agent-sdk` surface
 * verbatim. Source of truth: ./official.d.ts.
 */
export type {
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
} from './official.js'

export { EXIT_REASONS, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './official-values.js'
