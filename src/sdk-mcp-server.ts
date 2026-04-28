/**
 * `createSdkMcpServer()` — official `@anthropic-ai/claude-agent-sdk` shape.
 *
 * Returns `McpSdkServerConfigWithInstance` carrying a real
 * `@modelcontextprotocol/sdk/server/mcp.js` `McpServer` instance, with all
 * provided `tool()` definitions registered onto it.
 *
 * Tools are namespaced as `mcp__${serverName}__${toolName}` when the engine
 * pulls them into the in-process tool pool.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SdkMcpToolDefinition } from './tool-helper.js'
import type { McpSdkServerConfigWithInstance } from './types/index.js'

/**
 * Internal sigil used when we attach raw `SdkMcpToolDefinition[]` to the
 * returned config. The engine's MCP integration reads this to enumerate tools
 * without having to introspect the McpServer's private state.
 */
const SDK_TOOLS_SYMBOL: unique symbol = Symbol.for('@codeany/open-agent-sdk:sdk-tools')

/** Internal carrier shape — extends the official type with a private bag. */
export type McpSdkServerConfigInternal = McpSdkServerConfigWithInstance & {
  [SDK_TOOLS_SYMBOL]?: SdkMcpToolDefinition<any>[]
}

/**
 * Create an in-process MCP server from `tool()` definitions.
 *
 * The returned object satisfies the official
 * `McpSdkServerConfigWithInstance` shape exactly:
 *   `{ type: 'sdk', name: string, instance: McpServer }`
 *
 * The agent runtime detects this shape and pulls the registered tools into
 * its in-process tool pool, so no MCP transport is involved at runtime.
 */
export function createSdkMcpServer(options: {
  name: string
  version?: string
  tools?: SdkMcpToolDefinition<any>[]
  alwaysLoad?: boolean
}): McpSdkServerConfigWithInstance {
  const instance = new McpServer({
    name: options.name,
    version: options.version ?? '1.0.0',
  })

  const tools = options.tools ?? []
  for (const t of tools) {
    const _meta = options.alwaysLoad
      ? { ...(t._meta ?? {}), 'anthropic/alwaysLoad': true }
      : t._meta
    // Register with the underlying MCP SDK server so consumers that connect
    // a transport see the tools listed correctly.
    instance.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema as never,
        annotations: t.annotations,
        _meta,
      },
      // Cast: registerTool's typed handler is structurally equivalent to ours
      // (args, extra) => Promise<CallToolResult>.
      t.handler as never,
    )
  }

  const config: McpSdkServerConfigInternal = {
    type: 'sdk',
    name: options.name,
    instance,
    [SDK_TOOLS_SYMBOL]: tools,
  }
  return config
}

/**
 * Type-guard for the SDK MCP server config (official shape — has `.instance`).
 */
export function isSdkServerConfig(config: unknown): config is McpSdkServerConfigWithInstance {
  if (!config || typeof config !== 'object') return false
  const c = config as { type?: unknown; instance?: unknown }
  return c.type === 'sdk' && c.instance != null && typeof c.instance === 'object'
}

/**
 * Internal: pull the original SdkMcpToolDefinition list off a config returned
 * by `createSdkMcpServer`. Used by the engine to assemble the tool pool
 * without going through the McpServer transport layer. Returns an empty array
 * if the carrier symbol is missing (e.g. config built externally).
 */
export function getSdkServerTools(
  config: McpSdkServerConfigWithInstance,
): SdkMcpToolDefinition<any>[] {
  const c = config as McpSdkServerConfigInternal
  return c[SDK_TOOLS_SYMBOL] ?? []
}
