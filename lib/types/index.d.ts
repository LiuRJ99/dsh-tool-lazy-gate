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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-lazy-gate";
/** Host services this plugin requires. */
export declare const inject: string[];
/** Host-only service consumed by trusted same-process plugins. */
export declare const TOOL_LAZY_GATE_SERVICE = "toolLazyGate";
export type ToolLazyGateGrantProvenance = 'panel-create' | 'execution' | 'claim';
export interface ToolLazyGateService {
    /** Grant configured lazy-gate Skills on one live Agent/session. */
    grant(agent: Agent, skillNames: readonly string[], provenance: ToolLazyGateGrantProvenance): void;
}
/** Durable settings namespace owning the runtime-managed capability list. */
export declare const GATE_NAMESPACE: "tool-lazy-gate";
/** One gated capability family, fully data-driven. */
export interface Capability {
    /** Whether this capability participates in gating at all. */
    enabled: boolean;
    /** Skill names whose USER invocation unlocks this capability (e.g. `/browser`). */
    skillNames: string[];
    /**
     * Tool-name prefixes this capability gates. These values are derived from the
     * selected `skillNames`; they remain in the config for backwards-compatible
     * persistence and direct YAML seeds.
     */
    toolPrefixes: string[];
    /**
     * System-prompt section names to suppress while locked. These values are
     * derived from the selected `skillNames` for the same reason as prefixes.
     */
    promptSections: string[];
}
/** Metadata key used by an adapted skill to publish its gateable resources. */
export declare const GATE_METADATA_KEY = "dsh:gate";
/** Tool and prompt resources associated with one user-invocable skill. */
export interface SkillGateAssociation {
    toolPrefixes: string[];
    promptSections: string[];
}
/** A skill plus the resources an adapted plugin explicitly associates with it. */
export interface DiscoveredSkillGateAssociation extends SkillGateAssociation {
    name: string;
}
export interface Config {
    capabilities: Record<string, Capability>;
}
export declare const Config: z<Config>;
/**
 * Read the opt-in association published by an adapted skill plugin.
 *
 * The namespace deliberately lives under the skill's generic metadata object so
 * an adapted plugin does not need to depend on this package. Unannotated skills
 * are not gate candidates, which prevents unrelated tools or prompt sections
 * from leaking into the configuration UI.
 */
export declare function skillGateAssociation(skill: unknown): SkillGateAssociation | undefined;
/**
 * Apply the skill association map to a capability config. `skillNames` is the
 * only authoritative selector; stale or hand-added prefixes/sections are
 * discarded rather than silently gating an unrelated plugin.
 */
export declare function capabilitiesFromSkillAssociations(capabilities: Record<string, Capability>, associations?: Record<string, SkillGateAssociation>): Record<string, Capability>;
/** Drop capabilities whose `enabled` flag is off before they reach any gate logic. */
export declare function enabledCapabilities(capabilities: Record<string, Capability>): Record<string, Capability>;
/** The capability key whose `skillNames` contain `skillName`, or undefined. */
export declare function capabilityForSkill(capabilities: Record<string, Capability>, skillName: string): string | undefined;
/** The capability key whose `toolPrefixes` match `toolName`, or undefined. */
export declare function capabilityForTool(capabilities: Record<string, Capability>, toolName: string): string | undefined;
/**
 * Extract the skill name from a durable `user/message` event when — and only
 * when — it carries the USER-explicit invocation source. Returns undefined for
 * every other message shape, so model tool calls can never trip it.
 */
export declare function userInvokedSkillName(event: unknown): string | undefined;
/**
 * The same whitespace-bounded gesture recognized by dsh-tool-skill, applied to
 * the trusted user messages claimed for the next agent step. This early path
 * lets the gate unlock before the first model request assembles its tool list;
 * only `source.kind === 'user'` messages are considered, so model output cannot
 * forge the gesture.
 */
export declare function userInvokedSkillNames(messages: readonly unknown[]): string[];
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map