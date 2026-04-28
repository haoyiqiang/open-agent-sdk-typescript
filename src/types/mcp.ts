/**
 * Domain re-export: MCP server config and SDK MCP tool definition.
 * Source of truth: ./official.d.ts.
 */
export type {
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

  SdkMcpToolDefinition,
  AnyZodRawShape,
  InferShape,

  Transport,
} from './official.js'
