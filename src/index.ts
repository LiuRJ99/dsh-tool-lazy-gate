/**
 * Session-lazy capability gate for high-privilege tool families (browser_*,
 * computer_use_* by default).
 *
 * These tools register into the HOST `tools` registry, so every preset in the
 * profile sees them by default. This plugin mounts one host-plane row of its
 * own and gates them per session:
 *
 * - Before the first model request it restricts the tools the agent can
 *   actually see via `agent.ctx.tools.restrict({ deny })`, which hides them from
 *   the model catalog AND rejects execution (`UNKNOWN_TOOL`), not just the
 *   prompt surface. The deny list is discovered dynamically from the visible
 *   tool names, so the plugin degrades to a no-op when a source plugin is
 *   missing or renamed.
 * - The ONLY unlock signal is a USER-explicit skill invocation. For the live
 *   step, the trusted user `/skill` gesture is consumed at `agent/pre-step`
 *   before the first model request; the durable `user/message` carrying
 *   `source.kind === 'skill-invocation'` remains the resume/replay signal. A
 *   model calling `skill("browser")` produces a `tool/call` + `tool/result`,
 *   never either user signal, so it can never grant itself access.
 * - A per-agent execution guard (`ctx.tools.guard`) is the second, bypass-proof
 *   boundary: even a call that evades visibility is denied while the
 *   capability is still locked.
 * - `system-prompt/assemble` filters the gated capability guidance sections
 *   until the matching group is unlocked, so the prompt does not advertise
 *   tools the model cannot yet call.
 * - On resume the gate reconstructs prior unlocks from the durable
 *   `user/message` log (only `skill-invocation` entries), never from model
 *   `tool/call` history. A new session starts locked again.
 *
 * Configuration is capability-driven: tool prefixes, skill names, and prompt
 * sections are data, not code (see `cordis.patch.yml`).
 *
 * @module dsh-tool-lazy-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-lazy-gate'

/** Host services this plugin requires. */
export const inject = ['tools', 'agents']

/** Durable settings namespace owning the runtime-managed capability list. */
export const GATE_NAMESPACE = settingsNamespace('tool-lazy-gate')

/** One gated capability family, fully data-driven. */
export interface Capability {
  /** Whether this capability participates in gating at all. */
  enabled: boolean
  /** Skill names whose USER invocation unlocks this capability (e.g. `/browser`). */
  skillNames: string[]
  /** Tool-name prefixes this capability gates (e.g. `browser_`). */
  toolPrefixes: string[]
  /** System-prompt section names to suppress while locked. */
  promptSections: string[]
}

export interface Config {
  capabilities: Record<string, Capability>
}

const capabilitySchema = z.object({
  enabled: z.boolean().default(true),
  skillNames: z.array(z.string()).default([]),
  toolPrefixes: z.array(z.string()).default([]),
  promptSections: z.array(z.string()).default([]),
})

export const Config: z<Config> = z.object({
  capabilities: z.dict(capabilitySchema).default({}),
})

/** Fallback capabilities used when no config is supplied. */
const DEFAULT_CAPABILITIES: Record<string, Capability> = {
  browser: {
    enabled: true,
    skillNames: ['browser'],
    toolPrefixes: ['browser_'],
    promptSections: ['tool:bridge-browser'],
  },
  computer: {
    enabled: true,
    skillNames: ['computer-use'],
    toolPrefixes: ['computer_use_'],
    promptSections: ['tool:computer', 'tool:computer-policy'],
  },
}

/** Per-session gate state, keyed by the durable Session object. */
interface GateEntry {
  unlocked: boolean
  disposer: (() => void) | undefined
}

interface GateState {
  /** The capability snapshot this session started with (route-A: immutable per session). */
  capabilities: Record<string, Capability>
  entries: Record<string, GateEntry>
}

const stateBySession = new WeakMap<object, GateState>()

function stateFor(session: object, capabilities: Record<string, Capability>): GateState {
  let state = stateBySession.get(session)
  if (state === undefined) {
    state = { capabilities, entries: {} }
    for (const key of Object.keys(capabilities)) state.entries[key] = { unlocked: false, disposer: undefined }
    stateBySession.set(session, state)
  }
  return state
}

/** Drop capabilities whose `enabled` flag is off before they reach any gate logic. */
export function enabledCapabilities(capabilities: Record<string, Capability>): Record<string, Capability> {
  const result: Record<string, Capability> = {}
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.enabled !== false) result[key] = cap
  }
  return result
}

/** The capability key whose `skillNames` contain `skillName`, or undefined. */
export function capabilityForSkill(capabilities: Record<string, Capability>, skillName: string): string | undefined {
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.skillNames.includes(skillName)) return key
  }
  return undefined
}

/** The capability key whose `toolPrefixes` match `toolName`, or undefined. */
export function capabilityForTool(capabilities: Record<string, Capability>, toolName: string): string | undefined {
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.toolPrefixes.some(prefix => toolName.startsWith(prefix))) return key
  }
  return undefined
}

/**
 * Extract the skill name from a durable `user/message` event when — and only
 * when — it carries the USER-explicit invocation source. Returns undefined for
 * every other message shape, so model tool calls can never trip it.
 */
export function userInvokedSkillName(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const record = event as { type?: unknown; data?: unknown }
  if (record.type !== 'user/message') return undefined
  const data = record.data as { source?: { kind?: unknown; name?: unknown } } | undefined
  const source = data?.source
  if (source?.kind !== 'skill-invocation') return undefined
  const name = source.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/**
 * The same whitespace-bounded gesture recognized by dsh-tool-skill, applied to
 * the trusted user messages claimed for the next agent step. This early path
 * lets the gate unlock before the first model request assembles its tool list;
 * only `source.kind === 'user'` messages are considered, so model output cannot
 * forge the gesture.
 */
export function userInvokedSkillNames(messages: readonly unknown[]): string[] {
  const names: string[] = []
  const gesture = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const record = message as { source?: unknown; content?: unknown }
    const source = record.source
    if (typeof source !== 'object' || source === null || (source as { kind?: unknown }).kind !== 'user') continue
    if (!Array.isArray(record.content)) continue

    for (const block of record.content) {
      if (typeof block !== 'object' || block === null || (block as { type?: unknown }).type !== 'text') continue
      const text = (block as { text?: unknown }).text
      if (typeof text !== 'string') continue
      for (const match of text.matchAll(gesture)) {
        const name = match[2]
        if (name !== undefined && !names.includes(name)) names.push(name)
      }
    }
  }

  return names
}

/** Mark one capability unlocked and release its restriction (idempotent). */
function unlock(state: GateState, key: string): void {
  const entry = state.entries[key]
  if (entry === undefined || entry.unlocked) return
  entry.unlocked = true
  try {
    entry.disposer?.()
  } catch {
    // A failed disposal must not break the unlock; the guard still gates.
  }
  entry.disposer = undefined
}

/** Unlock every configured capability named by one trusted user gesture batch. */
function unlockForSkillNames(state: GateState, skillNames: readonly string[]): void {
  for (const skillName of skillNames) {
    const key = capabilityForSkill(state.capabilities, skillName)
    if (key !== undefined) unlock(state, key)
  }
}

/** Reconstruct prior unlocks from the durable log: USER skill invocations only. */
function scanPriorUnlocks(session: { events: ArrayLike<unknown> }, capabilities: Record<string, Capability>): string[] {
  const unlocked = new Set<string>()
  for (const event of Array.from(session.events)) {
    const skillName = userInvokedSkillName(event)
    if (skillName === undefined) continue
    const key = capabilityForSkill(capabilities, skillName)
    if (key !== undefined) unlocked.add(key)
  }
  return [...unlocked]
}

/** Apply the per-session deny for every still-locked capability group. */
function gate(session: object, agent: Agent, capabilities: Record<string, Capability>): GateState {
  const state = stateFor(session, capabilities)
  const prior = scanPriorUnlocks(agent.session, capabilities)
  for (const key of prior) unlock(state, key)

  const tools = agent.ctx.tools
  const visible = new Set(tools.schemas(agent).map(tool => tool.name))

  for (const [key, cap] of Object.entries(capabilities)) {
    const entry = state.entries[key]
    if (entry === undefined || entry.unlocked) continue
    const deny = [...visible].filter(toolName => cap.toolPrefixes.some(prefix => toolName.startsWith(prefix)))
    if (deny.length === 0) continue
    entry.disposer = tools.restrict({ deny })
  }

  return state
}

/** Read the live capability list: settings user layer wins, then config, then defaults. */
function readCapabilities(settings: { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined, config: Config): Record<string, Capability> {
  const fromSettings = settings === undefined ? undefined : settings.get(GATE_NAMESPACE)
  // `settings.get` returns the schema-resolved value (base + user layer +
  // defaults), so `capabilities` is always present once the namespace is
  // registered — including an explicit empty dict, which means "gate nothing".
  if (fromSettings !== undefined && typeof fromSettings === 'object' && fromSettings !== null) {
    const caps = (fromSettings as { capabilities?: unknown }).capabilities
    if (typeof caps === 'object' && caps !== null) {
      return enabledCapabilities(caps as Record<string, Capability>)
    }
  }
  const fromConfig = config.capabilities ?? {}
  if (Object.keys(fromConfig).length > 0) return enabledCapabilities(fromConfig)
  return enabledCapabilities(DEFAULT_CAPABILITIES)
}

/** Get the live settings scope, or undefined when no settings provider is mounted. */
function settingsScope(ctx: Context): { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined {
  return ctx.get('settings') as { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined
}

export function apply(ctx: Context, config: Config = {} as Config): void {
  // Register the durable settings namespace so a configuration UI renders the
  // capability list. The composition `base` seeds it from `cordis.patch.yml`;
  // `applies: 'live'` reflects that changes take effect on the next session
  // (route A: no in-flight session is re-gated).
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(GATE_NAMESPACE, Config, {
      base: { capabilities: config.capabilities ?? DEFAULT_CAPABILITIES },
      applies: 'live',
    })
  })

  // The first real pre-step is the session's configuration snapshot boundary.
  // An empty session can be created before its first user message, so taking
  // the snapshot at `agent/session-start` could capture settings that were
  // changed before the user actually began the new conversation.
  //
  // Unlock from the trusted user gesture before the first model request. The
  // skill plugin turns `/browser` and `/computer-use` into a skill-invocation
  // message later in the same step, but that durable append is intentionally
  // fire-and-forget. Inspecting the claimed user messages here both snapshots
  // the latest settings and removes the first-request race while keeping
  // model-generated tool calls ineligible.
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    const state = stateBySession.get(agent.session)
      ?? gate(agent.session, agent, readCapabilities(settingsScope(ctx), config))
    unlockForSkillNames(state, userInvokedSkillNames(messages))
    return next()
  })

  // Keep the durable event listener for resume and for invocation paths that do
  // not pass through the current step's user-message batch. The unlocked
  // capability is always looked up against the SESSION's own snapshot.
  ctx.on('session/event', (session, event) => {
    const skillName = userInvokedSkillName(event)
    if (skillName === undefined) return
    const state = stateBySession.get(session)
    if (state === undefined) return
    unlockForSkillNames(state, [skillName])
  })

  // Execution-layer backstop: deny a gated tool call even if visibility was
  // somehow bypassed. Host-level guard, evaluated for every agent.
  ctx.tools.guard((execution: Readonly<ToolExecution>) => {
    const agent = execution.agent
    if (agent === undefined) return undefined
    const state = stateBySession.get(agent.session)
    if (state === undefined) return undefined
    const key = capabilityForTool(state.capabilities, execution.name)
    if (key === undefined) return undefined
    const cap = state.capabilities[key]
    const entry = state.entries[key]
    if (entry?.unlocked) return undefined
    const skillHint = cap?.skillNames[0] ?? key
    return `"${execution.name}" is locked in this session; the user must first invoke the matching skill (e.g. /${skillHint})`
  })

  // Suppress gated capability guidance until the matching group is unlocked.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent as Agent | undefined
    if (agent === undefined) return assembled
    const state = stateBySession.get(agent.session)
    if (state === undefined) return assembled
    let filtered = false
    const sections = assembled.sections.filter(section => {
      for (const [key, cap] of Object.entries(state.capabilities)) {
        if (state.entries[key]?.unlocked) continue
        if (cap.promptSections.includes(section.name)) {
          filtered = true
          return false
        }
      }
      return true
    })
    if (!filtered) return assembled
    return { ...assembled, sections }
  })

  // Discovery RPC for the configuration page: enumerate candidate skills,
  // tool prefixes (grouped), and prompt sections so the form presents
  // selectable options instead of requiring hand-typed internal identifiers.
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get('connection') as { rpc?: { handle?: (path: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>, opts?: unknown) => void } } | undefined
    if (connection?.rpc?.handle === undefined) return

    connection.rpc.handle('/tool-lazy-gate', async (endpoint: string) => {
      try {
        if (endpoint !== 'discover') {
          return { ok: false, error: { code: 'bad-request', message: `Unknown tool-lazy-gate RPC endpoint: ${endpoint}`, details: {} } }
        }

        // 1. Tool names (global registry view) → group by prefix.
        const toolNames = ctx.tools.schemas().map(tool => tool.name)
        const prefixMap = new Map<string, string[]>()
        for (const name of toolNames) {
          const sep = name.lastIndexOf('_')
          const prefix = sep > 0 ? name.slice(0, sep + 1) : name
          const bucket = prefixMap.get(prefix) ?? []
          bucket.push(name)
          prefixMap.set(prefix, bucket)
        }
        const toolGroups = [...prefixMap.entries()]
          .map(([prefix, tools]) => ({ prefix, tools, count: tools.length }))
          .sort((a, b) => b.count - a.count)

        // 2. Skills (user-invocable only, as unlock candidates).
        const skillsService = ctx.get('skills') as { list?: (opts?: unknown) => Promise<Array<{ name: string; invocation?: { userInvocable?: boolean } }>> } | undefined
        const skills = skillsService?.list !== undefined
          ? (await skillsService.list())
              .filter(skill => skill.invocation?.userInvocable !== false)
              .map(skill => ({ name: skill.name }))
          : []

        // 3. Prompt sections (global assembly).
        const systemPrompt = ctx.get('systemPrompt') as { assemble?: (ctx?: unknown) => Promise<{ sections: Array<{ name: string }> }> } | undefined
        const sections = systemPrompt?.assemble !== undefined
          ? (await systemPrompt.assemble()).sections.map(section => section.name)
          : []

        return { ok: true, value: { skills, toolGroups, sections } }
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }, { authority: 'loopback' })
  })
}
