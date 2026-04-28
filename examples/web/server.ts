/**
 * Web Chat Server — built on the official `query()` API
 *
 *   GET  /           — serves the chat UI
 *   POST /api/chat   — SSE stream of agent events
 *   POST /api/new    — resets the session (next /api/chat starts a fresh session)
 *
 * Run: npx tsx examples/web/server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as crypto from 'node:crypto'
import { query, type Query, type SDKUserMessage } from '../../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '8081')

// One persistent Query for the lifetime of a "session". Inputs are pushed in
// via streamInput; outputs flow back through the AsyncGenerator.
type ChatSession = {
  q: Query
  pump: { push(text: string): void; close(): void }
}

let session: ChatSession | null = null

function ensureSession(): ChatSession {
  if (session) return session

  const queue: SDKUserMessage[] = []
  let resolveNext: ((v: IteratorResult<SDKUserMessage>) => void) | null = null
  let closed = false
  const sessionId = crypto.randomUUID()

  const stream: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
          }
          return new Promise<IteratorResult<SDKUserMessage>>((res) => {
            resolveNext = res
          })
        },
      }
    },
  }

  const pump = {
    push(text: string) {
      const msg: SDKUserMessage = {
        type: 'user',
        uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: text },
      }
      if (resolveNext) {
        const r = resolveNext
        resolveNext = null
        r({ value: msg, done: false })
      } else {
        queue.push(msg)
      }
    },
    close() {
      closed = true
      if (resolveNext) {
        const r = resolveNext
        resolveNext = null
        r({ value: undefined as unknown as SDKUserMessage, done: true })
      }
    },
  }

  const q = query({
    prompt: stream,
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 20,
      sessionId,
    },
  })

  session = { q, pump }
  return session
}

function resetSession(): void {
  if (!session) return
  session.pump.close()
  session.q.close()
  session = null
}

/** Read the full request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

/** Handle POST /api/chat — SSE stream */
async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const prompt = body.message?.trim()
  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'empty message' }))
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = (event: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ event, data })}\n\n`)
  }

  const startMs = Date.now()
  const s = ensureSession()
  s.pump.push(prompt)

  try {
    for await (const ev of s.q) {
      const m = ev as any
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text') send('text', { text: block.text })
          else if (block.type === 'tool_use')
            send('tool_use', { id: block.id, name: block.name, input: block.input })
          else if ('thinking' in block) send('thinking', { thinking: block.thinking })
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        // Tool results are emitted as SDKUserMessages in the official shape.
        for (const block of m.message.content) {
          if (block.type === 'tool_result') {
            send('tool_result', {
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: !!block.is_error,
            })
          }
        }
      } else if (m.type === 'result') {
        send('result', {
          num_turns: m.num_turns ?? 0,
          input_tokens: m.usage?.input_tokens ?? 0,
          output_tokens: m.usage?.output_tokens ?? 0,
          cost: m.total_cost_usd ?? 0,
          duration_ms: Date.now() - startMs,
        })
        break // wait for next /api/chat
      }
    }
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : String(err) })
  }

  send('done', null)
  res.end()
}

/** Handle POST /api/new */
function handleNewSession(_req: IncomingMessage, res: ServerResponse) {
  resetSession()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

/** Serve the static index.html */
async function serveIndex(_req: IncomingMessage, res: ServerResponse) {
  const html = await readFile(join(__dirname, 'index.html'), 'utf-8')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// --- HTTP Server ---

const server = createServer(async (req, res) => {
  const url = req.url || '/'
  const method = req.method || 'GET'

  try {
    if (url === '/' && method === 'GET') return await serveIndex(req, res)
    if (url === '/api/chat' && method === 'POST') return await handleChat(req, res)
    if (url === '/api/new' && method === 'POST') return handleNewSession(req, res)

    res.writeHead(404)
    res.end('Not Found')
  } catch (err) {
    console.error(err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
  }
})

server.listen(PORT, () => {
  console.log(`\n  Open Agent SDK — Web Chat`)
  console.log(`  http://localhost:${PORT}\n`)
})
