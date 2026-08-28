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
 * Configuration is skill-driven: `skillNames` selects the capability, while
 * adapted plugins publish their Tool/Prompt association as skill metadata. The
 * shipped patch supplies browser/computer compatibility defaults.
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
  /**
   * Tool-name prefixes this capability gates. These values are derived from the
   * selected `skillNames`; they remain in the config for backwards-compatible
   * persistence and direct YAML seeds.
   */
  toolPrefixes: string[]
  /**
   * System-prompt section names to suppress while locked. These values are
   * derived from the selected `skillNames` for the same reason as prefixes.
   */
  promptSections: string[]
}

/** Metadata key used by an adapted skill to publish its gateable resources. */
export const GATE_METADATA_KEY = 'dsh:gate'

/** Tool and prompt resources associated with one user-invocable skill. */
export interface SkillGateAssociation {
  toolPrefixes: string[]
  promptSections: string[]
}

/** A skill plus the resources an adapted plugin explicitly associates with it. */
export interface DiscoveredSkillGateAssociation extends SkillGateAssociation {
  name: string
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

/**
 * Normalize a metadata/config list without retaining borrowed values. The
 * settings and skill registries are runtime-owned objects; gates only keep
 * these small string snapshots.
 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function association(toolPrefixes: unknown, promptSections: unknown): SkillGateAssociation | undefined {
  const normalized = {
    toolPrefixes: stringList(toolPrefixes),
    promptSections: stringList(promptSections),
  }
  return normalized.toolPrefixes.length > 0 || normalized.promptSections.length > 0 ? normalized : undefined
}

/**
 * Read the opt-in association published by an adapted skill plugin.
 *
 * The namespace deliberately lives under the skill's generic metadata object so
 * an adapted plugin does not need to depend on this package. Unannotated skills
 * are not gate candidates, which prevents unrelated tools or prompt sections
 * from leaking into the configuration UI.
 */
export function skillGateAssociation(skill: unknown): SkillGateAssociation | undefined {
  if (typeof skill !== 'object' || skill === null) return undefined
  const metadata = (skill as { metadata?: unknown }).metadata
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return undefined
  const gate = (metadata as Record<string, unknown>)[GATE_METADATA_KEY]
  if (typeof gate !== 'object' || gate === null || Array.isArray(gate)) return undefined
  const record = gate as { toolPrefixes?: unknown; promptSections?: unknown }
  return association(record.toolPrefixes, record.promptSections)
}

function mergeAssociation(left: SkillGateAssociation | undefined, right: SkillGateAssociation): SkillGateAssociation {
  return {
    toolPrefixes: [...new Set([...(left?.toolPrefixes ?? []), ...right.toolPrefixes])],
    promptSections: [...new Set([...(left?.promptSections ?? []), ...right.promptSections])],
  }
}

function associationsFromCapabilities(capabilities: Record<string, Capability>): Record<string, SkillGateAssociation> {
  const result: Record<string, SkillGateAssociation> = {}
  for (const cap of Object.values(capabilities)) {
    for (const skillName of stringList(cap.skillNames)) {
      const next = association(cap.toolPrefixes, cap.promptSections)
      if (next === undefined) continue
      result[skillName] = mergeAssociation(result[skillName], next)
    }
  }
  return result
}

/**
 * The shipped browser/computer rows predate the skill metadata contract. Keep
 * their explicit patch mapping as a narrow compatibility fallback, while all
 * other skills must opt in through `metadata['dsh:gate']`.
 */
const DEFAULT_SKILL_ASSOCIATIONS = associationsFromCapabilities(DEFAULT_CAPABILITIES)

function cloneAssociations(source: Record<string, SkillGateAssociation>): Record<string, SkillGateAssociation> {
  const result: Record<string, SkillGateAssociation> = {}
  for (const [name, value] of Object.entries(source)) {
    result[name] = {
      toolPrefixes: [...value.toolPrefixes],
      promptSections: [...value.promptSections],
    }
  }
  return result
}

/**
 * Apply the skill association map to a capability config. `skillNames` is the
 * only authoritative selector; stale or hand-added prefixes/sections are
 * discarded rather than silently gating an unrelated plugin.
 */
export function capabilitiesFromSkillAssociations(
  capabilities: Record<string, Capability>,
  associations: Record<string, SkillGateAssociation> = DEFAULT_SKILL_ASSOCIATIONS,
): Record<string, Capability> {
  const result: Record<string, Capability> = {}
  for (const [key, cap] of Object.entries(capabilities)) {
    const skillNames = stringList(cap.skillNames).filter(skillName => associations[skillName] !== undefined)
    const toolPrefixes = new Set<string>()
    const promptSections = new Set<string>()
    for (const skillName of skillNames) {
      const linked = associations[skillName]
      if (linked === undefined) continue
      for (const prefix of linked.toolPrefixes) toolPrefixes.add(prefix)
      for (const section of linked.promptSections) promptSections.add(section)
    }
    result[key] = {
      ...cap,
      skillNames,
      toolPrefixes: [...toolPrefixes],
      promptSections: [...promptSections],
    }
  }
  return result
}

interface SkillSummaryLike {
  name?: unknown
  invocation?: { userInvocable?: unknown }
  metadata?: unknown
}

interface SkillsService {
  list?: () => Promise<readonly SkillSummaryLike[]>
  get?: (name: string) => Promise<SkillSummaryLike | undefined>
}

interface SkillAssociationCatalog {
  /** All associations known to the runtime, used to resolve saved config. */
  associations: Record<string, SkillGateAssociation>
  /** Only associations whose declared resources are currently registered. */
  skills: DiscoveredSkillGateAssociation[]
}

function liveToolNames(ctx: Context): string[] {
  try {
    return ctx.tools.schemas().map(tool => tool.name).filter((name): name is string => typeof name === 'string')
  } catch {
    return []
  }
}

async function livePromptSectionNames(ctx: Context): Promise<Set<string>> {
  const systemPrompt = ctx.get('systemPrompt') as { assemble?: () => Promise<{ sections?: Array<{ name?: unknown }> }> } | undefined
  if (systemPrompt?.assemble === undefined) return new Set<string>()
  try {
    const assembled = await systemPrompt.assemble()
    return new Set(
      (assembled.sections ?? [])
        .map(section => section.name)
        .filter((name): name is string => typeof name === 'string'),
    )
  } catch {
    return new Set<string>()
  }
}

/**
 * Discover only user-invocable skills that opt into lazy-gate metadata. The
 * shipped browser/computer patch remains a compatibility fallback until those
 * external plugins publish the same metadata themselves.
 */
async function discoverSkillAssociationCatalog(ctx: Context): Promise<SkillAssociationCatalog> {
  const associations = cloneAssociations(DEFAULT_SKILL_ASSOCIATIONS)
  const skills = ctx.get('skills') as SkillsService | undefined
  let listedUserSkills: Set<string> | undefined

  if (skills?.list !== undefined) {
    try {
      const listed = await skills.list()
      if (Array.isArray(listed)) {
        listedUserSkills = new Set<string>()
        for (const summary of listed) {
          if (typeof summary.name !== 'string' || summary.name.length === 0) continue
          if (summary.invocation?.userInvocable === false) continue
          listedUserSkills.add(summary.name)

          let definition: SkillSummaryLike = summary
          if (skills.get !== undefined) {
            try {
              definition = (await skills.get(summary.name)) ?? summary
            } catch {
              // An unavailable body must not prevent the compatibility mapping
              // or the other skills from appearing in the settings page.
            }
          }
          const declared = skillGateAssociation(definition)
          if (declared !== undefined) associations[summary.name] = declared
        }
      }
    } catch {
      // The skill registry is optional. The default browser/computer mapping
      // still keeps the existing gate operational in older profiles.
    }
  }

  // If the skill catalog is authoritative, do not retain fallback entries for
  // plugins that are no longer installed or no longer expose user invocation.
  if (listedUserSkills !== undefined) {
    for (const name of Object.keys(associations)) {
      if (!listedUserSkills.has(name)) delete associations[name]
    }
  }

  const toolNames = liveToolNames(ctx)
  const sectionNames = await livePromptSectionNames(ctx)
  const visibleSkills: DiscoveredSkillGateAssociation[] = []
  for (const [name, linked] of Object.entries(associations)) {
    const toolPrefixes = linked.toolPrefixes.filter(prefix => toolNames.some(toolName => toolName.startsWith(prefix)))
    const promptSections = linked.promptSections.filter(sectionName => sectionNames.has(sectionName))
    if (toolPrefixes.length === 0 && promptSections.length === 0) continue
    visibleSkills.push({ name, toolPrefixes, promptSections })
  }
  visibleSkills.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

  return { associations, skills: visibleSkills }
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
  /** Whether durable history has been folded into this state. */
  restored: boolean
  /** Whether the first-step tool restriction has been installed. */
  enforced: boolean
}

const stateBySession = new WeakMap<object, GateState>()

function stateFor(session: object, capabilities: Record<string, Capability>): GateState {
  let state = stateBySession.get(session)
  if (state === undefined) {
    state = { capabilities, entries: {}, restored: false, enforced: false }
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

/** Restore prior user skill invocations into one session's in-memory state. */
function restoreState(session: { events: ArrayLike<unknown> }, capabilities: Record<string, Capability>): GateState {
  const state = stateFor(session, capabilities)
  if (state.restored) return state

  for (const key of scanPriorUnlocks(session, capabilities)) unlock(state, key)
  state.restored = true
  return state
}

/** Apply the per-session deny for every still-locked capability group once. */
function enforceGate(agent: Agent, state: GateState): void {
  if (state.enforced) return

  const tools = agent.ctx.tools
  const visible = new Set(tools.schemas(agent).map(tool => tool.name))

  for (const [key, cap] of Object.entries(state.capabilities)) {
    const entry = state.entries[key]
    if (entry === undefined || entry.unlocked || entry.disposer !== undefined) continue
    const deny = [...visible].filter(toolName => cap.toolPrefixes.some(prefix => toolName.startsWith(prefix)))
    if (deny.length === 0) continue
    entry.disposer = tools.restrict({ deny })
  }

  state.enforced = true
}

/** Restore durable state, then install the per-session tool restrictions. */
function gate(session: { events: ArrayLike<unknown> }, agent: Agent, capabilities: Record<string, Capability>): GateState {
  const state = restoreState(session, capabilities)
  enforceGate(agent, state)
  return state
}

/** Read the live capability list: settings user layer wins, then config, then defaults. */
function readCapabilities(
  settings: { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined,
  config: Config,
  associations: Record<string, SkillGateAssociation> = DEFAULT_SKILL_ASSOCIATIONS,
): Record<string, Capability> {
  const fromSettings = settings === undefined ? undefined : settings.get(GATE_NAMESPACE)
  // `settings.get` returns the schema-resolved value (base + user layer +
  // defaults), so `capabilities` is always present once the namespace is
  // registered — including an explicit empty dict, which means "gate nothing".
  if (fromSettings !== undefined && typeof fromSettings === 'object' && fromSettings !== null) {
    const caps = (fromSettings as { capabilities?: unknown }).capabilities
    if (typeof caps === 'object' && caps !== null) {
      return enabledCapabilities(capabilitiesFromSkillAssociations(caps as Record<string, Capability>, associations))
    }
  }
  const fromConfig = config.capabilities ?? {}
  if (Object.keys(fromConfig).length > 0) {
    return enabledCapabilities(capabilitiesFromSkillAssociations(fromConfig, associations))
  }
  return enabledCapabilities(capabilitiesFromSkillAssociations(DEFAULT_CAPABILITIES, associations))
}

/** Get the live settings scope, or undefined when no settings provider is mounted. */
function settingsScope(ctx: Context): { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined {
  return ctx.get('settings') as { get(ns: ReturnType<typeof settingsNamespace>): unknown } | undefined
}

export function apply(ctx: Context, config: Config = {} as Config): void {
  // Resolve skill associations once per catalog generation. The result is shared
  // by the first system-prompt assembly, the pre-step snapshot, and the settings
  // discovery RPC so all three surfaces agree on what a skill unlocks.
  // Defer the first catalog read until a real session/page request. This lets
  // later composition rows finish registering their skills before fallback
  // entries are pruned as absent.
  let associationPromise: Promise<SkillAssociationCatalog> | undefined
  const associationCatalog = (): Promise<SkillAssociationCatalog> => {
    associationPromise ??= discoverSkillAssociationCatalog(ctx)
    return associationPromise
  }

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

  // The first real pre-step remains the session's configuration snapshot and
  // enforcement boundary. An empty session can be created before its first
  // user message, so this is intentionally later than `agent/session-start`.
  // The system-prompt hook may have restored state earlier only to suppress
  // locked guidance; `gate()` is idempotent and installs the actual tool
  // restriction here before the model request.
  //
  // Unlock from the trusted user gesture before the first model request. The
  // skill plugin turns `/browser` and `/computer-use` into a skill-invocation
  // message later in the same step, but that durable append is intentionally
  // fire-and-forget. Inspecting the claimed user messages here both snapshots
  // the latest settings and removes the first-request race while keeping
  // model-generated tool calls ineligible.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const catalog = await associationCatalog()
    const state = gate(agent.session, agent, readCapabilities(settingsScope(ctx), config, catalog.associations))
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
  // Agent loop assembles the system prompt before dispatching agent/pre-step, so
  // restore the session state here as well. This keeps the first request after
  // creation or resume consistent with the tool guard; pre-step still owns the
  // actual tools.restrict() call and current-message unlock.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent as Agent | undefined
    if (agent === undefined) return next()
    const catalog = await associationCatalog()
    const state = restoreState(agent.session, readCapabilities(settingsScope(ctx), config, catalog.associations))
    const assembled = await next()
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

  // Discovery RPC for the configuration page. Resource candidates come only
  // from an adapted skill's `metadata['dsh:gate']` declaration (or the two
  // shipped compatibility rows), never from the global tool/prompt registries.
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get('connection') as { rpc?: { handle?: (path: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>, opts?: unknown) => void } } | undefined
    if (connection?.rpc?.handle === undefined) return

    connection.rpc.handle('/tool-lazy-gate', async (endpoint: string) => {
      try {
        if (endpoint !== 'discover') {
          return { ok: false, error: { code: 'bad-request', message: `Unknown tool-lazy-gate RPC endpoint: ${endpoint}`, details: {} } }
        }

        const catalog = await associationCatalog()
        const toolNames = liveToolNames(ctx)
        const toolGroups = catalog.skills
          .flatMap(skill => skill.toolPrefixes)
          .filter((prefix, index, prefixes) => prefixes.indexOf(prefix) === index)
          .map(prefix => {
            const tools = toolNames.filter(toolName => toolName.startsWith(prefix))
            return { prefix, tools, count: tools.length }
          })
          .filter(group => group.count > 0)
          .sort((left, right) => right.count - left.count || left.prefix.localeCompare(right.prefix))
        const sections = catalog.skills
          .flatMap(skill => skill.promptSections)
          .filter((section, index, names) => names.indexOf(section) === index)

        return {
          ok: true,
          value: {
            // Each entry carries its own resources. The client can therefore
            // derive both fields from the selected Skill Names.
            skills: catalog.skills,
            // Keep these aggregate fields for older clients; they are already
            // restricted to resources declared by adapted skills.
            toolGroups,
            sections,
          },
        }
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }, { authority: 'loopback' })
  })
}
