// src/index.ts
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
var name = "tool-lazy-gate";
var inject = ["tools", "agents"];
var GATE_NAMESPACE = settingsNamespace("tool-lazy-gate");
var GATE_METADATA_KEY = "dsh:gate";
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
function stringList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
function association(toolPrefixes, promptSections) {
  const normalized = {
    toolPrefixes: stringList(toolPrefixes),
    promptSections: stringList(promptSections)
  };
  return normalized.toolPrefixes.length > 0 || normalized.promptSections.length > 0 ? normalized : void 0;
}
function skillGateAssociation(skill) {
  if (typeof skill !== "object" || skill === null) return void 0;
  const metadata = skill.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return void 0;
  const gate2 = metadata[GATE_METADATA_KEY];
  if (typeof gate2 !== "object" || gate2 === null || Array.isArray(gate2)) return void 0;
  const record = gate2;
  return association(record.toolPrefixes, record.promptSections);
}
function mergeAssociation(left, right) {
  return {
    toolPrefixes: [.../* @__PURE__ */ new Set([...left?.toolPrefixes ?? [], ...right.toolPrefixes])],
    promptSections: [.../* @__PURE__ */ new Set([...left?.promptSections ?? [], ...right.promptSections])]
  };
}
function associationsFromCapabilities(capabilities) {
  const result = {};
  for (const cap of Object.values(capabilities)) {
    for (const skillName of stringList(cap.skillNames)) {
      const next = association(cap.toolPrefixes, cap.promptSections);
      if (next === void 0) continue;
      result[skillName] = mergeAssociation(result[skillName], next);
    }
  }
  return result;
}
var DEFAULT_SKILL_ASSOCIATIONS = associationsFromCapabilities(DEFAULT_CAPABILITIES);
function cloneAssociations(source) {
  const result = {};
  for (const [name2, value] of Object.entries(source)) {
    result[name2] = {
      toolPrefixes: [...value.toolPrefixes],
      promptSections: [...value.promptSections]
    };
  }
  return result;
}
function capabilitiesFromSkillAssociations(capabilities, associations = DEFAULT_SKILL_ASSOCIATIONS) {
  const result = {};
  for (const [key, cap] of Object.entries(capabilities)) {
    const skillNames = stringList(cap.skillNames).filter((skillName) => associations[skillName] !== void 0);
    const toolPrefixes = /* @__PURE__ */ new Set();
    const promptSections = /* @__PURE__ */ new Set();
    for (const skillName of skillNames) {
      const linked = associations[skillName];
      if (linked === void 0) continue;
      for (const prefix of linked.toolPrefixes) toolPrefixes.add(prefix);
      for (const section of linked.promptSections) promptSections.add(section);
    }
    result[key] = {
      ...cap,
      skillNames,
      toolPrefixes: [...toolPrefixes],
      promptSections: [...promptSections]
    };
  }
  return result;
}
function liveToolNames(ctx) {
  try {
    return ctx.tools.schemas().map((tool) => tool.name).filter((name2) => typeof name2 === "string");
  } catch {
    return [];
  }
}
async function livePromptSectionNames(ctx) {
  const systemPrompt = ctx.get("systemPrompt");
  if (systemPrompt?.assemble === void 0) return /* @__PURE__ */ new Set();
  try {
    const assembled = await systemPrompt.assemble();
    return new Set(
      (assembled.sections ?? []).map((section) => section.name).filter((name2) => typeof name2 === "string")
    );
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function discoverSkillAssociationCatalog(ctx) {
  const associations = cloneAssociations(DEFAULT_SKILL_ASSOCIATIONS);
  const skills = ctx.get("skills");
  let listedUserSkills;
  if (skills?.list !== void 0) {
    try {
      const listed = await skills.list();
      if (Array.isArray(listed)) {
        listedUserSkills = /* @__PURE__ */ new Set();
        for (const summary of listed) {
          if (typeof summary.name !== "string" || summary.name.length === 0) continue;
          if (summary.invocation?.userInvocable === false) continue;
          listedUserSkills.add(summary.name);
          let definition = summary;
          if (skills.get !== void 0) {
            try {
              definition = await skills.get(summary.name) ?? summary;
            } catch {
            }
          }
          const declared = skillGateAssociation(definition);
          if (declared !== void 0) associations[summary.name] = declared;
        }
      }
    } catch {
    }
  }
  if (listedUserSkills !== void 0) {
    for (const name2 of Object.keys(associations)) {
      if (!listedUserSkills.has(name2)) delete associations[name2];
    }
  }
  const toolNames = liveToolNames(ctx);
  const sectionNames = await livePromptSectionNames(ctx);
  const visibleSkills = [];
  for (const [name2, linked] of Object.entries(associations)) {
    const toolPrefixes = linked.toolPrefixes.filter((prefix) => toolNames.some((toolName) => toolName.startsWith(prefix)));
    const promptSections = linked.promptSections.filter((sectionName) => sectionNames.has(sectionName));
    if (toolPrefixes.length === 0 && promptSections.length === 0) continue;
    visibleSkills.push({ name: name2, toolPrefixes, promptSections });
  }
  visibleSkills.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return { associations, skills: visibleSkills };
}
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
function readCapabilities(settings, config, associations = DEFAULT_SKILL_ASSOCIATIONS) {
  const fromSettings = settings === void 0 ? void 0 : settings.get(GATE_NAMESPACE);
  if (fromSettings !== void 0 && typeof fromSettings === "object" && fromSettings !== null) {
    const caps = fromSettings.capabilities;
    if (typeof caps === "object" && caps !== null) {
      return enabledCapabilities(capabilitiesFromSkillAssociations(caps, associations));
    }
  }
  const fromConfig = config.capabilities ?? {};
  if (Object.keys(fromConfig).length > 0) {
    return enabledCapabilities(capabilitiesFromSkillAssociations(fromConfig, associations));
  }
  return enabledCapabilities(capabilitiesFromSkillAssociations(DEFAULT_CAPABILITIES, associations));
}
function settingsScope(ctx) {
  return ctx.get("settings");
}
function apply(ctx, config = {}) {
  let associationPromise;
  const associationCatalog = () => {
    associationPromise ??= discoverSkillAssociationCatalog(ctx);
    return associationPromise;
  };
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(GATE_NAMESPACE, Config, {
      base: { capabilities: config.capabilities ?? DEFAULT_CAPABILITIES },
      applies: "live"
    });
  });
  ctx.on("agent/pre-step", async ({ agent, messages }, next) => {
    const catalog = await associationCatalog();
    const state = gate(agent.session, agent, readCapabilities(settingsScope(ctx), config, catalog.associations));
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
    const catalog = await associationCatalog();
    const state = restoreState(agent.session, readCapabilities(settingsScope(ctx), config, catalog.associations));
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
        const catalog = await associationCatalog();
        const toolNames = liveToolNames(ctx);
        const toolGroups = catalog.skills.flatMap((skill) => skill.toolPrefixes).filter((prefix, index, prefixes) => prefixes.indexOf(prefix) === index).map((prefix) => {
          const tools = toolNames.filter((toolName) => toolName.startsWith(prefix));
          return { prefix, tools, count: tools.length };
        }).filter((group) => group.count > 0).sort((left, right) => right.count - left.count || left.prefix.localeCompare(right.prefix));
        const sections = catalog.skills.flatMap((skill) => skill.promptSections).filter((section, index, names) => names.indexOf(section) === index);
        return {
          ok: true,
          value: {
            // Each entry carries its own resources. The client can therefore
            // derive both fields from the selected Skill Names.
            skills: catalog.skills,
            // Keep these aggregate fields for older clients; they are already
            // restricted to resources declared by adapted skills.
            toolGroups,
            sections
          }
        };
      } catch (error) {
        return { ok: false, error: { code: "internal", message: error instanceof Error ? error.message : String(error), details: {} } };
      }
    }, { authority: "loopback" });
  });
}
export {
  Config,
  GATE_METADATA_KEY,
  GATE_NAMESPACE,
  apply,
  capabilitiesFromSkillAssociations,
  capabilityForSkill,
  capabilityForTool,
  enabledCapabilities,
  inject,
  name,
  skillGateAssociation,
  userInvokedSkillName,
  userInvokedSkillNames
};
