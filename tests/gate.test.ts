import { describe, expect, it } from 'vitest'
import {
  apply,
  capabilitiesFromSkillAssociations,
  TOOL_LAZY_GATE_SERVICE,
  capabilityForSkill,
  capabilityForTool,
  enabledCapabilities,
  skillGateAssociation,
  userInvokedSkillName,
  userInvokedSkillNames,
} from '../src/index.ts'

const CAPS = {
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

describe('userInvokedSkillName — the unlock signal', () => {
  it('accepts a USER skill-invocation user/message', () => {
    const event = { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'browser' } } }
    expect(userInvokedSkillName(event)).toBe('browser')
  })

  it('rejects a MODEL skill tool/call (the dangerous case)', () => {
    const event = { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'browser' }) } }
    expect(userInvokedSkillName(event)).toBeUndefined()
  })

  it('rejects a plain user message (no invocation source)', () => {
    const event = { type: 'user/message', data: { source: { kind: 'user' } } }
    expect(userInvokedSkillName(event)).toBeUndefined()
  })

  it('rejects a non-message event', () => {
    expect(userInvokedSkillName({ type: 'assistant/message' })).toBeUndefined()
  })

  it('rejects garbage input without throwing', () => {
    expect(userInvokedSkillName(null)).toBeUndefined()
    expect(userInvokedSkillName(undefined)).toBeUndefined()
    expect(userInvokedSkillName(42)).toBeUndefined()
  })
})

describe('userInvokedSkillNames — pre-step unlock signal', () => {
  it('extracts and deduplicates skill gestures from trusted user messages', () => {
    const messages = [{
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Please use /browser then /computer-use and /browser again.' }],
    }]
    expect(userInvokedSkillNames(messages)).toEqual(['browser', 'computer-use'])
  })

  it('matches whitespace-bounded gestures like the skill plugin', () => {
    const messages = [{
      source: { kind: 'user' },
      content: [{ type: 'text', text: '/browser /computer-use /browser' }],
    }]
    expect(userInvokedSkillNames(messages)).toEqual(['browser', 'computer-use'])
  })

  it('ignores model-shaped messages, paths, and non-text blocks', () => {
    const messages = [
      {
        source: { kind: 'assistant' },
        content: [{ type: 'text', text: '/browser /computer-use' }],
      },
      {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: '/usr/bin and 5/8 are not skill gestures' },
          { type: 'image', data: '/browser' },
        ],
      },
    ]
    expect(userInvokedSkillNames(messages)).toEqual([])
  })
})

describe('capability routing', () => {
  it('maps skill names to capabilities', () => {
    expect(capabilityForSkill(CAPS, 'browser')).toBe('browser')
    expect(capabilityForSkill(CAPS, 'computer-use')).toBe('computer')
    expect(capabilityForSkill(CAPS, 'unknown')).toBeUndefined()
  })

  it('maps tool prefixes to capabilities', () => {
    expect(capabilityForTool(CAPS, 'browser_snapshot')).toBe('browser')
    expect(capabilityForTool(CAPS, 'computer_use_click')).toBe('computer')
    expect(capabilityForTool(CAPS, 'bash')).toBeUndefined()
  })

  it('does not match prefix as substring (only startswith)', () => {
    expect(capabilityForTool(CAPS, 'my_browser_tool')).toBeUndefined()
  })
})

describe('skill-driven Tool/Prompt associations', () => {
  it('reads only the namespaced association metadata', () => {
    expect(skillGateAssociation({
      metadata: {
        'dsh:gate': {
          toolPrefixes: [' browser_ ', 'browser_', ''],
          promptSections: ['tool:bridge-browser'],
        },
      },
    })).toEqual({
      toolPrefixes: ['browser_'],
      promptSections: ['tool:bridge-browser'],
    })
    expect(skillGateAssociation({ metadata: { other: { toolPrefixes: ['task_'] } } })).toBeUndefined()
    expect(skillGateAssociation(null)).toBeUndefined()
  })

  it('derives Tool Prefixes and Prompt Sections only from selected skills', () => {
    const capabilities = {
      browser: {
        enabled: true,
        skillNames: ['browser', 'not-adapted'],
        // These stale values must not leak into the resolved gate.
        toolPrefixes: ['browser_', 'task_'],
        promptSections: ['tool:bridge-browser', 'tool:taskboard'],
      },
      stale: {
        enabled: true,
        skillNames: [],
        toolPrefixes: ['other_'],
        promptSections: ['tool:other'],
      },
    }
    const associations = {
      browser: { toolPrefixes: ['browser_'], promptSections: ['tool:bridge-browser'] },
    }

    expect(capabilitiesFromSkillAssociations(capabilities, associations)).toEqual({
      browser: {
        enabled: true,
        skillNames: ['browser'],
        toolPrefixes: ['browser_'],
        promptSections: ['tool:bridge-browser'],
      },
      stale: {
        enabled: true,
        skillNames: [],
        toolPrefixes: [],
        promptSections: [],
      },
    })
  })
})

describe('discovery exposes only adapted skill resources', () => {
  it('does not surface unannotated plugin tools or prompt sections', async () => {
    let discoverHandler: ((endpoint: string, payload: unknown) => Promise<any>) | undefined
    const connection = {
      rpc: {
        handle: (_path: string, handler: (endpoint: string, payload: unknown) => Promise<any>) => {
          discoverHandler = handler
        },
      },
    }
    const skills = {
      list: async () => [
        { name: 'browser', invocation: { userInvocable: true } },
        { name: 'taskboard', invocation: { userInvocable: true } },
      ],
      get: async (name: string) => ({ name }),
    }
    const context = {
      get: (name: string) => name === 'skills'
        ? skills
        : name === 'systemPrompt'
          ? { assemble: async () => ({ sections: [
              { name: 'general:intro' },
              { name: 'tool:bridge-browser' },
              { name: 'tool:taskboard' },
            ] }) }
          : undefined,
      inject: (deps: string[], callback: (scope: any) => void) => {
        if (deps.includes('connection')) callback({ get: () => connection })
        else callback({ settings: { register: () => undefined } })
      },
      on: () => undefined,
      tools: {
        guard: () => undefined,
        schemas: () => [
          { name: 'browser_snapshot' },
          { name: 'taskboard_list' },
        ],
      },
    }

    apply(context as never, { capabilities: CAPS })
    expect(discoverHandler).toBeDefined()
    const result = await discoverHandler?.('discover', {})

    expect(result?.ok).toBe(true)
    expect(result?.value.skills).toEqual([{
      name: 'browser',
      toolPrefixes: ['browser_'],
      promptSections: ['tool:bridge-browser'],
    }])
    expect(result?.value.enabledSkills).toEqual(result?.value.skills)
    expect(result?.value.toolGroups.map((group: any) => group.prefix)).toEqual(['browser_'])
    expect(result?.value.sections).toEqual(['tool:bridge-browser'])
  })

  it('filters discovery by enabled capability configuration', async () => {
    let discoverHandler: ((endpoint: string, payload: unknown) => Promise<any>) | undefined
    const connection = {
      rpc: {
        handle: (_path: string, handler: (endpoint: string, payload: unknown) => Promise<any>) => {
          discoverHandler = handler
        },
      },
    }
    const context = {
      get: (name: string) => name === 'skills'
        ? {
            list: async () => [{ name: 'foo', invocation: { userInvocable: true }, metadata: { 'dsh:gate': { toolPrefixes: ['foo_'], promptSections: ['tool:foo'] } } }],
            get: async () => ({ name: 'foo', metadata: { 'dsh:gate': { toolPrefixes: ['foo_'], promptSections: ['tool:foo'] } } }),
          }
        : name === 'systemPrompt'
          ? { assemble: async () => ({ sections: [{ name: 'tool:foo' }] }) }
          : undefined,
      inject: (deps: string[], callback: (scope: any) => void) => {
        if (deps.includes('connection')) callback({ get: (name: string) => name === 'connection' ? connection : undefined })
        else callback({ settings: { register: () => undefined } })
      },
      on: () => undefined,
      tools: { guard: () => undefined, schemas: () => [{ name: 'foo_run' }] },
    }

    apply(context as never, {
      capabilities: {
        foo: { enabled: false, skillNames: ['foo'], toolPrefixes: [], promptSections: [] },
      },
    })
    const hidden = await discoverHandler?.('discover', {})
    expect(hidden?.value.skills).toHaveLength(1)
    expect(hidden?.value.enabledSkills).toEqual([])

    apply(context as never, {
      capabilities: {
        foo: { enabled: true, skillNames: ['foo'], toolPrefixes: [], promptSections: [] },
      },
    })
    const visible = await discoverHandler?.('discover', {})
    expect(visible?.value.enabledSkills).toEqual([{
      name: 'foo', toolPrefixes: ['foo_'], promptSections: ['tool:foo'],
    }])
  })
})

describe('loopback panel grant', () => {
  it('requires a live session and can never grant browser/computer from client payload', async () => {
    let handler: ((endpoint: string, payload: unknown) => Promise<any>) | undefined
    const agent = { session: { events: [] }, ctx: { tools: { schemas: () => [], restrict: () => () => undefined } } }
    const connection = {
      rpc: {
        handle: (_path: string, callback: (endpoint: string, payload: unknown) => Promise<any>) => {
          handler = callback
        },
      },
    }
    const context = {
      get: () => undefined,
      inject: (deps: string[], callback: (scope: any) => void) => {
        if (deps.includes('connection')) {
          callback({ get: (name: string) => name === 'connection' ? connection : name === 'agents' ? { get: (id: string) => id === 'live' ? agent : undefined } : undefined })
        } else {
          callback({ settings: { register: () => undefined } })
        }
      },
      on: () => undefined,
      tools: { guard: () => undefined, schemas: () => [] },
    }

    apply(context as never, { capabilities: CAPS })
    expect(handler).toBeDefined()
    expect((await handler?.('grant-taskboard', { sessionId: 'missing', skillNames: ['browser'] }))?.error.code).toBe('not-found')
    expect((await handler?.('grant-taskboard', { sessionId: '../live' }))?.error.code).toBe('bad-request')
    expect(await handler?.('grant-taskboard', { sessionId: 'live', skillNames: ['browser', 'computer-use'] })).toMatchObject({
      ok: true,
      value: { sessionId: 'live', granted: ['taskboard'] },
    })
  })
})

describe('enabledCapabilities — the enable/disable switch', () => {
  it('drops capabilities whose enabled flag is false', () => {
    const mixed = {
      browser: { enabled: true, skillNames: ['browser'], toolPrefixes: ['browser_'], promptSections: [] },
      computer: { enabled: false, skillNames: ['computer-use'], toolPrefixes: ['computer_use_'], promptSections: [] },
    }
    const result = enabledCapabilities(mixed)
    expect(Object.keys(result)).toEqual(['browser'])
  })

  it('keeps a capability when enabled is omitted (defaults true)', () => {
    const mixed = {
      browser: { enabled: undefined, skillNames: ['browser'], toolPrefixes: ['browser_'], promptSections: [] },
    }
    const result = enabledCapabilities(mixed as unknown as Record<string, never>)
    expect(Object.keys(result)).toEqual(['browser'])
  })
})

describe('capability gate state machine (including first-assembly and no-plugin behavior)', () => {
  type Handler = (...args: any[]) => any

  function createMockContext() {
    const handlers = new Map<string, Handler[]>()
    let guardFn: ((exec: any) => string | undefined) | undefined
    return {
      handlers,
      getGuard: () => guardFn,
      context: {
        get: (_service: string) => undefined,
        inject: (_deps: string[], cb: (scope: any) => void) => {
          cb({ settings: { register: () => undefined }, get: () => undefined })
        },
        on: (event: string, handler: Handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler])
        },
        tools: {
          guard: (fn: (exec: any) => string | undefined) => {
            guardFn = fn
          },
          schemas: () => [
            { name: 'browser_snapshot' },
            { name: 'browser_click' },
            { name: 'computer_use_click' },
            { name: 'bash' },
          ],
        },
      },
    }
  }

  // Case 1: Initial state - tools are locked by default and denied via tools.restrict
  it('Case 1: initial session start locks tools and calls tools.restrict with matching prefixes', async () => {
    const { context, handlers } = createMockContext()
    const deniedTools: string[][] = []
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }, { name: 'bash' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    expect(preStep).toBeDefined()

    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello, what tools do you have?' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    expect(deniedTools).toEqual([['browser_snapshot'], ['computer_use_click']])
  })

  // Case 2: Execution guard blocks locked tools
  it('Case 2: tools.guard denies execution when capability is locked with helpful hint', async () => {
    const { context, handlers, getGuard } = createMockContext()
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'bash' }],
          restrict: () => () => undefined,
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    const guard = getGuard()
    expect(guard).toBeDefined()

    // Gated tool is denied
    const blocked = guard?.({ agent, name: 'browser_snapshot' })
    expect(blocked).toContain('"browser_snapshot" is locked in this session')
    expect(blocked).toContain('/browser')

    // Non-gated tool is allowed
    const allowed = guard?.({ agent, name: 'bash' })
    expect(allowed).toBeUndefined()
  })

  // Case 3: Pre-step user gesture unlocks capability
  it('Case 3: user gesture (/browser) in user message unlocks capability at pre-step', async () => {
    const { context, handlers, getGuard } = createMockContext()
    let browserDisposed = false
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            return () => {
              if (deny.includes('browser_snapshot')) browserDisposed = true
            }
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]

    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/browser search google' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    expect(browserDisposed).toBe(true)
    const guard = getGuard()
    expect(guard?.({ agent, name: 'browser_snapshot' })).toBeUndefined()
    expect(guard?.({ agent, name: 'computer_use_click' })).toBeDefined()
  })

  // Case 4: Durable user/message event unlocks capability
  it('Case 4: durable user/message with skill-invocation source unlocks capability via session/event', async () => {
    const { context, handlers, getGuard } = createMockContext()
    let computerDisposed = false
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'computer_use_click' }],
          restrict: () => () => { computerDisposed = true },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    const guard = getGuard()
    expect(guard?.({ agent, name: 'computer_use_click' })).toBeDefined()

    const sessionEvent = handlers.get('session/event')?.[0]
    sessionEvent?.(session, {
      type: 'user/message',
      data: { source: { kind: 'skill-invocation', name: 'computer-use' } },
    })

    expect(computerDisposed).toBe(true)
    expect(guard?.({ agent, name: 'computer_use_click' })).toBeUndefined()
  })

  // Case 5: Model tool call does not unlock capability (security boundary)
  it('Case 5: model calling skill("browser") via tool/call cannot unlock capability', async () => {
    const { context, handlers, getGuard } = createMockContext()
    let browserDisposed = false
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }],
          restrict: () => () => { browserDisposed = true },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    // Model tries to unlock by emitting tool/call
    const sessionEvent = handlers.get('session/event')?.[0]
    sessionEvent?.(session, {
      type: 'tool/call',
      data: { name: 'skill', arguments: JSON.stringify({ name: 'browser' }) },
    })

    expect(browserDisposed).toBe(false)
    const guard = getGuard()
    expect(guard?.({ agent, name: 'browser_snapshot' })).toBeDefined()
  })

  // Case 6: Session resume reconstructs prior unlocks from durable log
  it('Case 6: session resume reconstructs prior unlocks from durable log (only skill-invocation events)', async () => {
    const { context, handlers, getGuard } = createMockContext()
    const session = {
      events: [
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"computer-use"}' } },
        { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'browser' } } },
      ],
    }
    const deniedTools: string[][] = []
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'resume step' }] }],
      turn: 2,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    // Browser was unlocked in past user event, so only computer is denied
    expect(deniedTools).toEqual([['computer_use_click']])
    const guard = getGuard()
    expect(guard?.({ agent, name: 'browser_snapshot' })).toBeUndefined()
    expect(guard?.({ agent, name: 'computer_use_click' })).toBeDefined()
  })

  // Case 7: First system-prompt assembly initializes the gate state
  it('Case 7: first system-prompt/assemble filters locked sections and initializes the guard before pre-step', async () => {
    const { context, handlers, getGuard } = createMockContext()
    const deniedTools: string[][] = []
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const assembleHandler = handlers.get('system-prompt/assemble')?.[0]
    expect(assembleHandler).toBeDefined()

    const fullAssembly = {
      sections: [
        { name: 'general:intro' },
        { name: 'tool:bridge-browser' },
        { name: 'tool:computer' },
        { name: 'general:outro' },
      ],
    }

    // Agent loop assembles the prompt before dispatching agent/pre-step.
    const filtered = await assembleHandler?.({}, { agent }, async () => fullAssembly)
    expect(filtered.sections.map((s: any) => s.name)).toEqual(['general:intro', 'general:outro'])
    expect(getGuard()?.({ agent, name: 'browser_snapshot' })).toContain('is locked in this session')

    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain user message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    expect(deniedTools).toEqual([['browser_snapshot'], ['computer_use_click']])
  })

  // Case 8: First system-prompt assembly restores a resumed capability
  it('Case 8: first system-prompt/assemble restores durable unlocks before pre-step', async () => {
    const { context, handlers, getGuard } = createMockContext()
    const deniedTools: string[][] = []
    const session = {
      events: [
        { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'browser' } } },
      ],
    }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const assembleHandler = handlers.get('system-prompt/assemble')?.[0]
    const fullAssembly = {
      sections: [
        { name: 'general:intro' },
        { name: 'tool:bridge-browser' },
        { name: 'tool:computer' },
      ],
    }

    const filtered = await assembleHandler?.({}, { agent }, async () => fullAssembly)
    expect(filtered.sections.map((s: any) => s.name)).toEqual(['general:intro', 'tool:bridge-browser'])
    expect(getGuard()?.({ agent, name: 'browser_snapshot' })).toBeUndefined()
    expect(getGuard()?.({ agent, name: 'computer_use_click' })).toContain('is locked in this session')

    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'resume step' }] }],
      turn: 2,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    expect(deniedTools).toEqual([['computer_use_click']])
  })

  // Case 9: System prompt section suppression when capability is locked
  it('Case 9: system-prompt/assemble suppresses prompt sections when capability is locked', async () => {
    const { context, handlers } = createMockContext()
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: () => () => undefined,
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain user message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    const assembleHandler = handlers.get('system-prompt/assemble')?.[0]
    expect(assembleHandler).toBeDefined()

    const fullAssembly = {
      sections: [
        { name: 'general:intro' },
        { name: 'tool:bridge-browser' },
        { name: 'tool:computer' },
        { name: 'tool:computer-policy' },
        { name: 'general:outro' },
      ],
    }

    const filtered = await assembleHandler?.({}, { agent }, async () => fullAssembly)
    expect(filtered.sections.map((s: any) => s.name)).toEqual(['general:intro', 'general:outro'])
  })

  // Case 10: System prompt section retention when capability is unlocked
  it('Case 10: system-prompt/assemble preserves prompt sections once capability is unlocked', async () => {
    const { context, handlers } = createMockContext()
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: () => () => undefined,
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]
    // Unlock browser via user gesture
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/browser search' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    const assembleHandler = handlers.get('system-prompt/assemble')?.[0]
    const fullAssembly = {
      sections: [
        { name: 'general:intro' },
        { name: 'tool:bridge-browser' },
        { name: 'tool:computer' },
      ],
    }

    const filtered = await assembleHandler?.({}, { agent }, async () => fullAssembly)
    // browser section preserved, computer section still filtered
    expect(filtered.sections.map((s: any) => s.name)).toEqual(['general:intro', 'tool:bridge-browser'])
  })

  // Case 11: Disabled capability switch (enabled: false)
  it('Case 11: disabled capability (enabled: false) is completely bypassed from gating', async () => {
    const { context, handlers, getGuard } = createMockContext()
    const customCaps = {
      browser: { enabled: false, skillNames: ['browser'], toolPrefixes: ['browser_'], promptSections: ['tool:bridge-browser'] },
      computer: { enabled: true, skillNames: ['computer-use'], toolPrefixes: ['computer_use_'], promptSections: ['tool:computer'] },
    }
    const deniedTools: string[][] = []
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: customCaps })
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    // Only enabled capability (computer) is denied, browser is completely ignored/open
    expect(deniedTools).toEqual([['computer_use_click']])

    const guard = getGuard()
    expect(guard?.({ agent, name: 'browser_snapshot' })).toBeUndefined()
    expect(guard?.({ agent, name: 'computer_use_click' })).toBeDefined()
  })

  it('host grant unlocks a live agent, including a grant issued before gate initialization', async () => {
    const { context, handlers, getGuard } = createMockContext()
    let service: any
    ;(context as any).reflect = {
      provide: (name: string, value: unknown) => {
        if (name === TOOL_LAZY_GATE_SERVICE) service = value
      },
    }
    const deniedTools: string[][] = []
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          schemas: () => [{ name: 'browser_snapshot' }, { name: 'computer_use_click' }],
          restrict: ({ deny }: { deny: string[] }) => {
            deniedTools.push(deny)
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    expect(service).toBeDefined()
    service.grant(agent, ['browser'], 'execution')
    const preStep = handlers.get('agent/pre-step')?.[0]
    await preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'plain message' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))

    expect(deniedTools).toEqual([['computer_use_click']])
    expect(getGuard()?.({ agent, name: 'browser_snapshot' })).toBeUndefined()
    expect(getGuard()?.({ agent, name: 'computer_use_click' })).toContain('/computer-use')
  })

  // Case 12: Graceful degradation / no-plugin fallback
  it('Case 12: graceful degradation when gated plugin is not installed (no matching tool schemas)', async () => {
    const { context, handlers } = createMockContext()
    let restrictCalled = false
    const session = { events: [] }
    const agent = {
      session,
      ctx: {
        tools: {
          // No browser_* or computer_use_* tools registered in profile
          schemas: () => [{ name: 'bash' }, { name: 'read' }, { name: 'write' }],
          restrict: () => {
            restrictCalled = true
            return () => undefined
          },
        },
      },
    }

    apply(context as never, { capabilities: CAPS })
    const preStep = handlers.get('agent/pre-step')?.[0]

    // Should complete cleanly without error or unnecessary restrict calls
    await expect(preStep?.({
      agent,
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'execute command' }] }],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))).resolves.toBeDefined()

    expect(restrictCalled).toBe(false)
  })
})
