/**
 * Official Session API — function shapes mirror `@anthropic-ai/claude-agent-sdk`.
 *
 * Provides:
 *   - listSessions / getSessionInfo / getSessionMessages
 *   - getSubagentMessages / listSubagents
 *   - renameSession / tagSession / deleteSession / forkSession
 *   - importSessionToStore / foldSessionSummary
 *
 * Default storage: local filesystem at
 *   `${process.env.CLAUDE_CONFIG_DIR ?? ~/.claude}/projects/<projectKey>/<sessionId>.jsonl`
 *
 * Each line of the JSONL transcript is a `SessionStoreEntry` (POJO with a
 * `type` discriminator). When `sessionStore` is supplied via the per-call
 * options, all I/O is routed through that store instead of the local fs.
 *
 * The legacy `src/session.ts` exposes a different, internal-only API and is
 * NOT part of the public surface. This file is the canonical Session API.
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

import type {
  ListSessionsOptions,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  GetSubagentMessagesOptions,
  ListSubagentsOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SDKSessionInfo,
  SessionMessage,
  SessionStore,
  SessionStoreEntry,
  SessionSummaryEntry,
  SessionKey,
  ImportSessionToStoreOptions,
} from './types/index.js'

// --------------------------------------------------------------------------
// Path helpers
// --------------------------------------------------------------------------

const PROJECT_KEY_MAX_LEN = 200

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
}

function projectsDir(): string {
  return path.join(configDir(), 'projects')
}

/**
 * Sanitize a cwd into a project-key folder name. Mirrors the official
 * convention: replace path separators with '-', truncate at 200 chars and
 * append a portable djb2 hash so identical paths always yield the same key.
 */
export function projectKeyFromCwd(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/[\\/:]+/g, '-').replace(/^-+/, '')
  if (normalized.length <= PROJECT_KEY_MAX_LEN) return normalized
  const hash = djb2(normalized)
  return normalized.slice(0, PROJECT_KEY_MAX_LEN) + '-' + hash
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16)
}

function sessionFilePath(projectKey: string, sessionId: string): string {
  return path.join(projectsDir(), projectKey, sessionId + '.jsonl')
}

function subagentFilePath(projectKey: string, sessionId: string, agentId: string): string {
  return path.join(projectsDir(), projectKey, sessionId, 'subagents', `agent-${agentId}.jsonl`)
}

// --------------------------------------------------------------------------
// JSONL I/O
// --------------------------------------------------------------------------

async function readJsonl(file: string): Promise<SessionStoreEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: SessionStoreEntry[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as SessionStoreEntry)
    } catch {
      // Skip malformed lines — be lenient like the CLI.
    }
  }
  return out
}

async function appendJsonl(file: string, entries: SessionStoreEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fs.appendFile(file, lines, 'utf8')
}

// --------------------------------------------------------------------------
// Project resolution: when `dir` is omitted, scan all projects under projectsDir.
// --------------------------------------------------------------------------

async function listAllProjectKeys(): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectsDir(), { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function findSessionFile(sessionId: string, dir?: string): Promise<{ projectKey: string; file: string } | null> {
  const keys = dir ? [projectKeyFromCwd(dir)] : await listAllProjectKeys()
  for (const k of keys) {
    const f = sessionFilePath(k, sessionId)
    try {
      await fs.access(f)
      return { projectKey: k, file: f }
    } catch {
      // continue
    }
  }
  return null
}

// --------------------------------------------------------------------------
// Summary derivation (shared by listSessions / getSessionInfo)
// --------------------------------------------------------------------------

function entryUserText(entry: SessionStoreEntry): string | undefined {
  if (entry.type !== 'user') return undefined
  const m = (entry as { message?: { content?: unknown } }).message
  if (!m) return undefined
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    for (const block of m.content as Array<{ type?: string; text?: string }>) {
      if (block.type === 'text' && typeof block.text === 'string') return block.text
    }
  }
  return undefined
}

function summarize(entries: SessionStoreEntry[]): Pick<SDKSessionInfo, 'summary' | 'firstPrompt' | 'customTitle' | 'tag' | 'gitBranch' | 'cwd' | 'createdAt'> {
  let firstPrompt: string | undefined
  let customTitle: string | undefined
  let tag: string | undefined
  let gitBranch: string | undefined
  let cwd: string | undefined
  let createdAt: number | undefined

  for (const e of entries) {
    if (createdAt === undefined && typeof e.timestamp === 'string') {
      const t = Date.parse(e.timestamp)
      if (!Number.isNaN(t)) createdAt = t
    }
    if (firstPrompt === undefined) {
      const t = entryUserText(e)
      if (t) firstPrompt = t.slice(0, 200)
    }
    if (e.type === 'session_title') customTitle = (e as { title?: string }).title
    if (e.type === 'session_tag') tag = (e as { tag?: string }).tag
    if (typeof (e as { gitBranch?: unknown }).gitBranch === 'string') {
      gitBranch = (e as { gitBranch?: string }).gitBranch
    }
    if (typeof (e as { cwd?: unknown }).cwd === 'string') {
      cwd = (e as { cwd?: string }).cwd
    }
  }

  const summary = customTitle ?? firstPrompt ?? '(empty session)'
  return { summary, firstPrompt, customTitle, tag, gitBranch, cwd, createdAt }
}

async function fileToSessionInfo(sessionId: string, file: string): Promise<SDKSessionInfo | undefined> {
  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(file)
  } catch {
    return undefined
  }
  const entries = await readJsonl(file)
  if (entries.length === 0) return undefined
  const s = summarize(entries)
  return {
    sessionId,
    summary: s.summary,
    lastModified: Math.floor(stat.mtimeMs),
    fileSize: stat.size,
    customTitle: s.customTitle,
    firstPrompt: s.firstPrompt,
    gitBranch: s.gitBranch,
    cwd: s.cwd,
    tag: s.tag,
    createdAt: s.createdAt,
  }
}

// --------------------------------------------------------------------------
// Public functions
// --------------------------------------------------------------------------

/** List sessions with metadata. Mirrors the official `listSessions`. */
export async function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]> {
  const store = options?.sessionStore
  if (store) {
    if (!store.listSessions) {
      throw new Error('sessionStore.listSessions is not implemented')
    }
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    const list = await store.listSessions(projectKey)
    const items: SDKSessionInfo[] = []
    for (const { sessionId, mtime } of list) {
      const entries = await store.load({ projectKey, sessionId })
      if (!entries || entries.length === 0) continue
      const s = summarize(entries)
      items.push({
        sessionId,
        summary: s.summary,
        lastModified: mtime,
        customTitle: s.customTitle,
        firstPrompt: s.firstPrompt,
        gitBranch: s.gitBranch,
        cwd: s.cwd,
        tag: s.tag,
        createdAt: s.createdAt,
      })
    }
    return paginate(items, options)
  }

  const keys = options?.dir ? [projectKeyFromCwd(options.dir)] : await listAllProjectKeys()
  const out: SDKSessionInfo[] = []
  for (const k of keys) {
    const dir = path.join(projectsDir(), k)
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const sessionId = e.name.slice(0, -'.jsonl'.length)
      const info = await fileToSessionInfo(sessionId, path.join(dir, e.name))
      if (info) out.push(info)
    }
  }
  out.sort((a, b) => b.lastModified - a.lastModified)
  return paginate(out, options)
}

function paginate<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
  const offset = options?.offset ?? 0
  const limit = options?.limit
  return limit !== undefined ? items.slice(offset, offset + limit) : items.slice(offset)
}

/** Read metadata for a single session by ID. */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  const store = options?.sessionStore
  if (store) {
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    const entries = await store.load({ projectKey, sessionId })
    if (!entries || entries.length === 0) return undefined
    const list = store.listSessions ? await store.listSessions(projectKey) : []
    const mtime = list.find((x) => x.sessionId === sessionId)?.mtime ?? Date.now()
    const s = summarize(entries)
    return {
      sessionId,
      summary: s.summary,
      lastModified: mtime,
      customTitle: s.customTitle,
      firstPrompt: s.firstPrompt,
      gitBranch: s.gitBranch,
      cwd: s.cwd,
      tag: s.tag,
      createdAt: s.createdAt,
    }
  }
  const found = await findSessionFile(sessionId, options?.dir)
  if (!found) return undefined
  return fileToSessionInfo(sessionId, found.file)
}

/** Read a session's conversation messages from its transcript. */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const includeSystem = options?.includeSystemMessages === true
  const entries = await loadEntries(sessionId, options?.dir, options?.sessionStore)
  return entriesToMessages(entries, sessionId, includeSystem, options)
}

/** Read subagent messages from a sub-transcript. */
export async function getSubagentMessages(
  sessionId: string,
  agentId: string,
  options?: GetSubagentMessagesOptions,
): Promise<SessionMessage[]> {
  const store = options?.sessionStore
  let entries: SessionStoreEntry[] = []
  if (store) {
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    entries = (await store.load({ projectKey, sessionId, subpath: `agent-${agentId}` })) ?? []
  } else {
    const found = await findSessionFile(sessionId, options?.dir)
    if (!found) return []
    entries = await readJsonl(subagentFilePath(found.projectKey, sessionId, agentId))
  }
  return entriesToMessages(entries, sessionId, false, options)
}

/** List subagent IDs registered under a session. */
export async function listSubagents(
  sessionId: string,
  options?: ListSubagentsOptions,
): Promise<string[]> {
  const store = options?.sessionStore
  if (store) {
    if (!store.listSubkeys) return []
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    const subs = await store.listSubkeys({ projectKey, sessionId })
    return subs.filter((s) => s.startsWith('agent-')).map((s) => s.slice('agent-'.length))
  }
  const found = await findSessionFile(sessionId, options?.dir)
  if (!found) return []
  const dir = path.join(path.dirname(found.file), sessionId, 'subagents')
  try {
    const entries = await fs.readdir(dir)
    return entries
      .filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'))
      .map((n) => n.slice('agent-'.length, -'.jsonl'.length))
  } catch {
    return []
  }
}

/** Rename a session (appends a custom-title entry). */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  const entry: SessionStoreEntry = {
    type: 'session_title',
    title,
    timestamp: new Date().toISOString(),
  } as SessionStoreEntry
  await appendMutation(sessionId, [entry], options)
}

/** Tag a session with an arbitrary tag (or `null` to clear). */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  const entry: SessionStoreEntry = {
    type: 'session_tag',
    tag,
    timestamp: new Date().toISOString(),
  } as SessionStoreEntry
  await appendMutation(sessionId, [entry], options)
}

/**
 * Delete a session.
 *
 * With `sessionStore`: calls `store.delete()` if implemented; no-op otherwise.
 * Without: removes the JSONL transcript and the subagent subdirectory.
 */
export async function deleteSession(
  sessionId: string,
  options?: SessionMutationOptions,
): Promise<void> {
  const store = options?.sessionStore
  if (store) {
    if (!store.delete) return
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    await store.delete({ projectKey, sessionId })
    return
  }
  const found = await findSessionFile(sessionId, options?.dir)
  if (!found) throw new Error(`Session not found: ${sessionId}`)
  await fs.rm(found.file, { force: true })
  await fs.rm(path.join(path.dirname(found.file), sessionId), { recursive: true, force: true })
}

/** Fork a session into a new branch with fresh UUIDs. */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const newId = crypto.randomUUID()
  const entries = await loadEntries(sessionId, options?.dir, options?.sessionStore)
  if (entries.length === 0) {
    throw new Error(`Cannot fork empty/missing session: ${sessionId}`)
  }
  const upTo = options?.upToMessageId
  const sliced = upTo ? sliceUpTo(entries, upTo) : entries
  const remapped = remapUuids(sliced)

  if (options?.title) {
    remapped.push({
      type: 'session_title',
      title: options.title,
      timestamp: new Date().toISOString(),
    } as SessionStoreEntry)
  }

  const store = options?.sessionStore
  if (store) {
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    await store.append({ projectKey, sessionId: newId }, remapped)
  } else {
    const found = await findSessionFile(sessionId, options?.dir)
    const projectKey = found?.projectKey ?? (options?.dir ? projectKeyFromCwd(options.dir) : 'default')
    await appendJsonl(sessionFilePath(projectKey, newId), remapped)
  }
  return { sessionId: newId }
}

function sliceUpTo(entries: SessionStoreEntry[], uuid: string): SessionStoreEntry[] {
  const idx = entries.findIndex((e) => e.uuid === uuid)
  if (idx < 0) return entries
  return entries.slice(0, idx + 1)
}

function remapUuids(entries: SessionStoreEntry[]): SessionStoreEntry[] {
  const map = new Map<string, string>()
  return entries.map((e) => {
    const out: SessionStoreEntry = { ...e }
    if (typeof e.uuid === 'string') {
      const next = crypto.randomUUID()
      map.set(e.uuid, next)
      out.uuid = next
    }
    const parent = (e as { parentUuid?: string }).parentUuid
    if (typeof parent === 'string' && map.has(parent)) {
      ;(out as { parentUuid?: string }).parentUuid = map.get(parent)
    }
    return out
  })
}

/** Copy a local JSONL session into a SessionStore. */
export async function importSessionToStore(
  sessionId: string,
  store: SessionStore,
  options?: ImportSessionToStoreOptions,
): Promise<void> {
  const found = await findSessionFile(sessionId, options?.dir)
  if (!found) throw new Error(`Session not found: ${sessionId}`)
  const includeSubagents = options?.includeSubagents !== false
  const batchSize = options?.batchSize ?? 500

  const main = await readJsonl(found.file)
  const projectKey = found.projectKey
  await appendInBatches(store, { projectKey, sessionId }, main, batchSize)

  if (includeSubagents) {
    const subDir = path.join(path.dirname(found.file), sessionId, 'subagents')
    let subEntries: import('node:fs').Dirent[] = []
    try {
      subEntries = await fs.readdir(subDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of subEntries) {
      if (!e.isFile() || !e.name.startsWith('agent-') || !e.name.endsWith('.jsonl')) continue
      const agentId = e.name.slice('agent-'.length, -'.jsonl'.length)
      const sub = await readJsonl(path.join(subDir, e.name))
      await appendInBatches(store, { projectKey, sessionId, subpath: `agent-${agentId}` }, sub, batchSize)
    }
  }
}

async function appendInBatches(
  store: SessionStore,
  key: SessionKey,
  entries: SessionStoreEntry[],
  batchSize: number,
): Promise<void> {
  for (let i = 0; i < entries.length; i += batchSize) {
    await store.append(key, entries.slice(i, i + batchSize))
  }
}

/**
 * Fold a batch of appended entries into the running summary for `key`.
 * Pure function — adapters call it from inside `append()`.
 */
export function foldSessionSummary(
  prev: SessionSummaryEntry | undefined,
  key: SessionKey,
  entries: SessionStoreEntry[],
  options?: { mtime?: number },
): SessionSummaryEntry {
  const data: Record<string, unknown> = { ...(prev?.data ?? {}) }
  let mtime = options?.mtime ?? prev?.mtime ?? 0

  // Set-once fields
  if (data.createdAt === undefined) {
    for (const e of entries) {
      if (typeof e.timestamp === 'string') {
        const t = Date.parse(e.timestamp)
        if (!Number.isNaN(t)) {
          data.createdAt = t
          break
        }
      }
    }
  }
  if (data.cwd === undefined) {
    for (const e of entries) {
      const c = (e as { cwd?: unknown }).cwd
      if (typeof c === 'string') {
        data.cwd = c
        break
      }
    }
  }
  if (data.firstPrompt === undefined) {
    for (const e of entries) {
      const t = entryUserText(e)
      if (t) {
        data.firstPrompt = t.slice(0, 200)
        break
      }
    }
  }
  if (data.isSidechain === undefined) {
    data.isSidechain = key.subpath !== undefined
  }

  // Last-wins fields
  for (const e of entries) {
    if (e.type === 'session_title') data.customTitle = (e as { title?: string }).title
    if (e.type === 'session_tag') data.tag = (e as { tag?: string | null }).tag
    if (typeof (e as { gitBranch?: unknown }).gitBranch === 'string') {
      data.gitBranch = (e as { gitBranch?: string }).gitBranch
    }
    if (e.type === 'summary') data.summaryHint = (e as { summary?: string }).summary
    const lp = entryUserText(e)
    if (lp) data.lastPrompt = lp.slice(0, 200)
  }

  if (options?.mtime !== undefined) mtime = options.mtime

  return { sessionId: key.sessionId, mtime, data }
}

// --------------------------------------------------------------------------
// Helpers shared between functions
// --------------------------------------------------------------------------

async function loadEntries(
  sessionId: string,
  dir: string | undefined,
  store: SessionStore | undefined,
): Promise<SessionStoreEntry[]> {
  if (store) {
    const projectKey = dir ? projectKeyFromCwd(dir) : ''
    return (await store.load({ projectKey, sessionId })) ?? []
  }
  const found = await findSessionFile(sessionId, dir)
  if (!found) return []
  return readJsonl(found.file)
}

async function appendMutation(
  sessionId: string,
  entries: SessionStoreEntry[],
  options: SessionMutationOptions | undefined,
): Promise<void> {
  const store = options?.sessionStore
  if (store) {
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : ''
    await store.append({ projectKey, sessionId }, entries)
    return
  }
  const found = await findSessionFile(sessionId, options?.dir)
  if (!found) {
    const projectKey = options?.dir ? projectKeyFromCwd(options.dir) : 'default'
    await appendJsonl(sessionFilePath(projectKey, sessionId), entries)
    return
  }
  await appendJsonl(found.file, entries)
}

function entriesToMessages(
  entries: SessionStoreEntry[],
  sessionId: string,
  includeSystem: boolean,
  options?: { limit?: number; offset?: number },
): SessionMessage[] {
  const out: SessionMessage[] = []
  for (const e of entries) {
    if (e.type === 'user' || e.type === 'assistant' || (includeSystem && e.type === 'system')) {
      out.push({
        type: e.type as 'user' | 'assistant' | 'system',
        uuid: typeof e.uuid === 'string' ? e.uuid : '',
        session_id: sessionId,
        message: (e as { message?: unknown }).message,
        parent_tool_use_id: null,
      })
    }
  }
  return paginate(out, options)
}
