// src/index.ts
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
var name = "tool-lazy-gate";
var inject = ["tools", "agents"];
var GATE_NAMESPACE = settingsNamespace("tool-lazy-gate");
var capabilitySchema = z.object({
  enabled: z.boolean().default(true),
  skillNames: z.array(z.string()).default([]),
  toolPrefixes: z.array(z.string()).default([]),
  promptSections: z.array(z.string()).default([])
});
var Config = z.object({
  capabilities: z.dict(capabilitySchema).default({})
});
var DEFAULT_CAPABILITIES = {
  browser: {
    enabled: true,
    skillNames: ["browser"],
    toolPrefixes: ["browser_"],
    promptSections: ["tool:bridge-browser"]
  },
  computer: {
    enabled: true,
    skillNames: ["computer-use"],
    toolPrefixes: ["computer_use_"],
    promptSections: ["tool:computer", "tool:computer-policy"]
  }
};
var stateBySession = /* @__PURE__ */ new WeakMap();
function stateFor(session, capabilities) {
  let state = stateBySession.get(session);
  if (state === void 0) {
    state = { capabilities, entries: {}, restored: false, enforced: false };
    for (const key of Object.keys(capabilities)) state.entries[key] = { unlocked: false, disposer: void 0 };
    stateBySession.set(session, state);
  }
  return state;
}
function enabledCapabilities(capabilities) {
  const result = {};
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.enabled !== false) result[key] = cap;
  }
  return result;
}
function capabilityForSkill(capabilities, skillName) {
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.skillNames.includes(skillName)) return key;
  }
  return void 0;
}
function capabilityForTool(capabilities, toolName) {
  for (const [key, cap] of Object.entries(capabilities)) {
    if (cap.toolPrefixes.some((prefix) => toolName.startsWith(prefix))) return key;
  }
  return void 0;
}
function userInvokedSkillName(event) {
  if (typeof event !== "object" || event === null) return void 0;
  const record = event;
  if (record.type !== "user/message") return void 0;
  const data = record.data;
  const source = data?.source;
  if (source?.kind !== "skill-invocation") return void 0;
  const name2 = source.name;
  return typeof name2 === "string" && name2.length > 0 ? name2 : void 0;
}
function userInvokedSkillNames(messages) {
  const names = [];
  const gesture = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message;
    const source = record.source;
    if (typeof source !== "object" || source === null || source.kind !== "user") continue;
    if (!Array.isArray(record.content)) continue;
    for (const block of record.content) {
      if (typeof block !== "object" || block === null || block.type !== "text") continue;
      const text = block.text;
      if (typeof text !== "string") continue;
      for (const match of text.matchAll(gesture)) {
        const name2 = match[2];
        if (name2 !== void 0 && !names.includes(name2)) names.push(name2);
      }
    }
  }
  return names;
}
function unlock(state, key) {
  const entry = state.entries[key];
  if (entry === void 0 || entry.unlocked) return;
  entry.unlocked = true;
  try {
    entry.disposer?.();
  } catch {
  }
  entry.disposer = void 0;
}
function unlockForSkillNames(state, skillNames) {
  for (const skillName of skillNames) {
    const key = capabilityForSkill(state.capabilities, skillName);
    if (key !== void 0) unlock(state, key);
  }
}
function scanPriorUnlocks(session, capabilities) {
  const unlocked = /* @__PURE__ */ new Set();
  for (const event of Array.from(session.events)) {
    const skillName = userInvokedSkillName(event);
    if (skillName === void 0) continue;
    const key = capabilityForSkill(capabilities, skillName);
    if (key !== void 0) unlocked.add(key);
  }
  return [...unlocked];
}
function restoreState(session, capabilities) {
  const state = stateFor(session, capabilities);
  if (state.restored) return state;
  for (const key of scanPriorUnlocks(session, capabilities)) unlock(state, key);
  state.restored = true;
  return state;
}
function enforceGate(agent, state) {
  if (state.enforced) return;
  const tools = agent.ctx.tools;
  const visible = new Set(tools.schemas(agent).map((tool) => tool.name));
  for (const [key, cap] of Object.entries(state.capabilities)) {
    const entry = state.entries[key];
    if (entry === void 0 || entry.unlocked || entry.disposer !== void 0) continue;
    const deny = [...visible].filter((toolName) => cap.toolPrefixes.some((prefix) => toolName.startsWith(prefix)));
    if (deny.length === 0) continue;
    entry.disposer = tools.restrict({ deny });
  }
  state.enforced = true;
}
function gate(session, agent, capabilities) {
  const state = restoreState(session, capabilities);
  enforceGate(agent, state);
  return state;
}
function readCapabilities(settings, config) {
  const fromSettings = settings === void 0 ? void 0 : settings.get(GATE_NAMESPACE);
  if (fromSettings !== void 0 && typeof fromSettings === "object" && fromSettings !== null) {
    const caps = fromSettings.capabilities;
    if (typeof caps === "object" && caps !== null) {
      return enabledCapabilities(caps);
    }
  }
  const fromConfig = config.capabilities ?? {};
  if (Object.keys(fromConfig).length > 0) return enabledCapabilities(fromConfig);
  return enabledCapabilities(DEFAULT_CAPABILITIES);
}
function settingsScope(ctx) {
  return ctx.get("settings");
}
function apply(ctx, config = {}) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(GATE_NAMESPACE, Config, {
      base: { capabilities: config.capabilities ?? DEFAULT_CAPABILITIES },
      applies: "live"
    });
  });
  ctx.on("agent/pre-step", ({ agent, messages }, next) => {
    const state = gate(agent.session, agent, readCapabilities(settingsScope(ctx), config));
    unlockForSkillNames(state, userInvokedSkillNames(messages));
    return next();
  });
  ctx.on("session/event", (session, event) => {
    const skillName = userInvokedSkillName(event);
    if (skillName === void 0) return;
    const state = stateBySession.get(session);
    if (state === void 0) return;
    unlockForSkillNames(state, [skillName]);
  });
  ctx.tools.guard((execution) => {
    const agent = execution.agent;
    if (agent === void 0) return void 0;
    const state = stateBySession.get(agent.session);
    if (state === void 0) return void 0;
    const key = capabilityForTool(state.capabilities, execution.name);
    if (key === void 0) return void 0;
    const cap = state.capabilities[key];
    const entry = state.entries[key];
    if (entry?.unlocked) return void 0;
    const skillHint = cap?.skillNames[0] ?? key;
    return `"${execution.name}" is locked in this session; the user must first invoke the matching skill (e.g. /${skillHint})`;
  });
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const agent = context.agent;
    if (agent === void 0) return next();
    const state = restoreState(agent.session, readCapabilities(settingsScope(ctx), config));
    const assembled = await next();
    let filtered = false;
    const sections = assembled.sections.filter((section) => {
      for (const [key, cap] of Object.entries(state.capabilities)) {
        if (state.entries[key]?.unlocked) continue;
        if (cap.promptSections.includes(section.name)) {
          filtered = true;
          return false;
        }
      }
      return true;
    });
    if (!filtered) return assembled;
    return { ...assembled, sections };
  });
  ctx.inject(["connection"], (scope) => {
    const connection = scope.get("connection");
    if (connection?.rpc?.handle === void 0) return;
    connection.rpc.handle("/tool-lazy-gate", async (endpoint) => {
      try {
        if (endpoint !== "discover") {
          return { ok: false, error: { code: "bad-request", message: `Unknown tool-lazy-gate RPC endpoint: ${endpoint}`, details: {} } };
        }
        const toolNames = ctx.tools.schemas().map((tool) => tool.name);
        const prefixMap = /* @__PURE__ */ new Map();
        for (const name2 of toolNames) {
          const sep = name2.lastIndexOf("_");
          const prefix = sep > 0 ? name2.slice(0, sep + 1) : name2;
          const bucket = prefixMap.get(prefix) ?? [];
          bucket.push(name2);
          prefixMap.set(prefix, bucket);
        }
        const toolGroups = [...prefixMap.entries()].map(([prefix, tools]) => ({ prefix, tools, count: tools.length })).sort((a, b) => b.count - a.count);
        const skillsService = ctx.get("skills");
        const skills = skillsService?.list !== void 0 ? (await skillsService.list()).filter((skill) => skill.invocation?.userInvocable !== false).map((skill) => ({ name: skill.name })) : [];
        const systemPrompt = ctx.get("systemPrompt");
        const sections = systemPrompt?.assemble !== void 0 ? (await systemPrompt.assemble()).sections.map((section) => section.name) : [];
        return { ok: true, value: { skills, toolGroups, sections } };
      } catch (error) {
        return { ok: false, error: { code: "internal", message: error instanceof Error ? error.message : String(error), details: {} } };
      }
    }, { authority: "loopback" });
  });
}
export {
  Config,
  GATE_NAMESPACE,
  apply,
  capabilityForSkill,
  capabilityForTool,
  enabledCapabilities,
  inject,
  name,
  userInvokedSkillName,
  userInvokedSkillNames
};
