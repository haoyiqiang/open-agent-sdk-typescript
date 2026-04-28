/**
 * `tool()` helper — official `@anthropic-ai/claude-agent-sdk` shape.
 *
 * Defines a tool from a Zod raw shape. Used together with
 * `createSdkMcpServer()` to register in-process tools an agent can call.
 *
 * Usage:
 * ```ts
 * import { tool, createSdkMcpServer } from '@codeany/open-agent-sdk'
 * import { z } from 'zod'
 *
 * const weather = tool(
 *   'get_weather', 'Get weather for a city',
 *   { city: z.string().describe('City name') },
 *   async ({ city }) => ({ content: [{ type: 'text', text: `Weather in ${city}: 22°C` }] })
 * )
 *
 * const server = createSdkMcpServer({ name: 'weather', tools: [weather] })
 * ```
 */

import { z, type ZodRawShape, type ZodObject } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolDefinition, ToolResult, ToolContext } from './types.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

export type { CallToolResult, ToolAnnotations }

/**
 * SDK MCP tool definition. Mirrors the official `SdkMcpToolDefinition` shape
 * (inputSchema is the raw Zod shape, not a wrapped `ZodObject`).
 */
export interface SdkMcpToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  inputSchema: Schema
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
  handler: (args: z.infer<ZodObject<Schema>>, extra: unknown) => Promise<CallToolResult>
}

/**
 * Define an SDK MCP tool. Mirrors the official `tool()` signature, including
 * the optional `_meta` and `alwaysLoad` extras.
 */
export function tool<Schema extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: z.infer<ZodObject<Schema>>, extra: unknown) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    _meta?: Record<string, unknown>
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  // alwaysLoad is folded into _meta as `anthropic/alwaysLoad`, matching
  // upstream behaviour in the official package.
  const _meta: Record<string, unknown> | undefined = extras?.alwaysLoad
    ? { ...(extras._meta ?? {}), 'anthropic/alwaysLoad': true }
    : extras?._meta
  return {
    name,
    description,
    inputSchema,
    annotations: extras?.annotations,
    _meta,
    handler,
  }
}

// --------------------------------------------------------------------------
// Internal: convert an SdkMcpToolDefinition to the engine's ToolDefinition.
// --------------------------------------------------------------------------
//
// The engine consumes JSON-schema based ToolDefinitions. This adapter is used
// when wiring an SDK MCP server's tools into the in-process tool pool.

export function sdkToolToToolDefinition(sdkTool: SdkMcpToolDefinition<any>): ToolDefinition {
  const wrapped = z.object(sdkTool.inputSchema)
  const jsonSchema = zodToJsonSchema(wrapped, { target: 'openApi3' }) as {
    properties?: Record<string, unknown>
    required?: string[]
  }

  return {
    name: sdkTool.name,
    description: sdkTool.description,
    inputSchema: {
      type: 'object',
      properties: jsonSchema.properties ?? {},
      required: jsonSchema.required ?? [],
    },
    isReadOnly: () => sdkTool.annotations?.readOnlyHint ?? false,
    isConcurrencySafe: () => sdkTool.annotations?.readOnlyHint ?? false,
    isEnabled: () => true,
    async prompt() {
      return sdkTool.description
    },
    async call(input: unknown, _context: ToolContext): Promise<ToolResult> {
      try {
        const parsed = wrapped.parse(input)
        const result = await sdkTool.handler(parsed, {})
        const text = result.content
          .map((block) => {
            if (block.type === 'text') return block.text
            if (block.type === 'image') return `[Image: ${block.mimeType}]`
            if (block.type === 'resource') {
              const r = block.resource as { uri?: string; text?: string }
              return r.text ?? `[Resource: ${r.uri ?? '?'}]`
            }
            return JSON.stringify(block)
          })
          .join('\n')
        return {
          type: 'tool_result',
          tool_use_id: '',
          content: text,
          is_error: result.isError ?? false,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          type: 'tool_result',
          tool_use_id: '',
          content: `Error: ${msg}`,
          is_error: true,
        }
      }
    },
  }
}
