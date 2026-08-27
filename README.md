# dsh-tool-lazy-gate

Session-lazy capability gate for DeepSeek Harness (DSH): high-privilege tool
families — `browser_*` and `computer_use_*` by default — stay hidden and
blocked until the **user** explicitly invokes the matching skill in the current
session.

## Why

Browser / computer-use tools register into the host `tools` registry, so every
preset in a profile sees them and the model tends to reach for them even when a
plain `bash` + file-tool path would do. Hiding them per session removes that
temptation while keeping the capability one explicit user gesture away.

## Semantics

- New session: every gated capability starts **locked**.
- The **only** unlock signal is a user-explicit skill invocation
  (`/browser`, `/computer-use`), which produces a durable `user/message` with
  `source.kind === 'skill-invocation'`.
- A model calling `skill("browser")` produces a `tool/call` + `tool/result`,
  never a `skill-invocation` message, so it **cannot** grant itself access.
- While locked, tools are hidden (`tools.restrict`) **and** execution is
  rejected by a per-agent guard (`tools.guard`) — a bypass-proof second layer.
- Gated prompt guidance sections are suppressed until unlocked.
- Resume reconstructs prior unlocks from the durable `user/message` log only.
  A brand-new session starts locked again.
- Missing plugins degrade to a no-op: the deny list is discovered dynamically.

## Install

```sh
# local checkout
dsh plugin --profile <name> add <path>/dsh-tool-lazy-gate

# published
dsh plugin --profile <name> add dsh-tool-lazy-gate
```

## Configuration

Capabilities are data-driven. The seed list lives in `cordis.patch.yml` and is
also registered as a **durable settings namespace** (`tool-lazy-gate`), so a
configuration page renders it and edits persist to the user settings document.
Each capability carries an `enabled` switch.

```yaml
- insert:
    - id: tool-lazy-gate
      name: dsh-tool-lazy-gate
      config:
        capabilities:
          browser:
            enabled: true
            skillNames: [browser]
            toolPrefixes: [browser_]
            promptSections: [tool:bridge-browser]
          computer:
            enabled: true
            skillNames: [computer-use]
            toolPrefixes: [computer_use_]
            promptSections: [tool:computer, tool:computer-policy]
```

### When configuration takes effect

`applies: 'live'` means a settings edit affects the **first real step of a new
session** (or takes effect after a profile restart). An empty session shell may
exist before its first prompt; the capability snapshot is taken immediately
before that first model request, so settings saved before the prompt are used.
Once the first step begins, the session keeps its snapshot and is never re-gated
mid-flight.

## Adding a new capability

A capability is one entry in `capabilities` plus the capability plugin's own
authorization skill. **Hard prerequisites** before an entry can gate anything:

1. **Uniform tool-name prefix** — every tool this capability gates must share a
   `startsWith` prefix (e.g. `deploy_`). Prefix-free families (e.g. `ssh` +
   `scp` + `rsync`) are not supported without extending the matcher.
2. **The capability plugin registers its own authorization skill** with
   `invocation: { modelInvocable: false, userInvocable: true }`. The gate only
   unlocks on the user's `/skill` gesture; the skill body itself is the plugin's
   job (see `bridge-browser`'s `BROWSER_SKILL` as the reference).
3. **Prompt-section names are known** — any guidance section that advertises the
   gated tools (e.g. `tool:bridge-browser`) must be listed in `promptSections`
   so it is suppressed while locked. Omitting it leaves residual prompt
   guidance, not a security hole.

With those three met, adding a capability is configuration only:

```yaml
capabilities:
  deploy:
    enabled: true
    skillNames: [deploy]
    toolPrefixes: [deploy_]
    promptSections: [tool:deploy]
```

No `dsh-tool-lazy-gate` source change is required.
