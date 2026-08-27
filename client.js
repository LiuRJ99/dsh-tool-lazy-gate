window.__ModuleLoader__.load({
  id: 'dsh-tool-lazy-gate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const SETTINGS_NS = 'tool-lazy-gate'
    const SETTINGS_SLOT = 'settings.section'
    const SETTINGS_SECTION_ID = 'tool-lazy-gate'
    const SETTINGS_NAV_MARKER = 'data-dsh-lazy-gate-settings-nav'

    const inject = ['slots', 'locale', 'settingsScope', 'connection']

    const copy = {
      zh: {
        tab: '能力门控',
        title: '会话能力门控 (Lazy Gate)',
        intro: '高权限工具（如浏览器、电脑操作）默认锁定。仅当你在当前会话显式调用对应技能时才解锁，防止智能体误用与绕路。配置对新会话即时生效。',
        statusSummary: (total, enabled) => `已配置 ${total} 个能力（${enabled} 个已启用）`,
        add: '+ 新增能力门控',
        remove: '删除',
        enabled: '已启用',
        disabled: '已停用',
        skillNamesLabel: '解锁技能 (Skill Names)',
        skillNamesHint: '用户在当前会话显式输入（如 /browser 或 /computer-use）时，触发解锁对应能力。',
        skillNamesPlaceholder: '点击选择解锁技能…',
        toolPrefixesLabel: '门控工具前缀 (Tool Prefixes)',
        toolPrefixesHint: '以此前缀开头的全局工具在未解锁时将被隐藏并不允许执行。',
        toolPrefixesPlaceholder: '点击选择门控工具前缀组…',
        promptSectionsLabel: '压制 Prompt 段 (Prompt Sections)',
        promptSectionsHint: '能力锁定时同步过滤系统提示词段，避免向模型暴露未解锁工具的引导信息。',
        promptSectionsPlaceholder: '点击选择要压制的系统提示词段…',
        nameLabel: '能力标识符 (Key)',
        nameHint: '唯一小写英文标识符（例如 browser / computer / deploy）。',
        save: '保存更改',
        saving: '正在保存…',
        saved: '已保存设置，新会话将自动应用最新能力门控配置。',
        saveFailed: '保存失败，请检查配置后重试',
        empty: '暂无门控规则，所有高权限工具将保持默认可见状态。',
        loading: '正在读取门控配置…',
        unavailable: '当前环境无法访问设置存储。',
        discovering: '正在从宿主发现可用技能与工具前缀…',
        discoverFailed: '候选资源发现未就绪（支持直接文本输入）。',
        noOptionsFound: '未发现候选项，支持手动输入',
      },
      en: {
        tab: 'Lazy Gate',
        title: 'Session Capability Gate (Lazy Gate)',
        intro: 'High-privilege tools (Browser, Computer Use, etc.) are locked by default. They are unlocked only when you explicitly invoke the corresponding skill in the current session. Settings take effect on new sessions.',
        statusSummary: (total, enabled) => `${total} capabilities configured (${enabled} enabled)`,
        add: '+ Add Capability Gate',
        remove: 'Delete',
        enabled: 'Enabled',
        disabled: 'Disabled',
        skillNamesLabel: 'Unlock Skills',
        skillNamesHint: 'Invoking one of these skills (e.g. /browser) explicitly will unlock this capability.',
        skillNamesPlaceholder: 'Select unlock skills…',
        toolPrefixesLabel: 'Tool Prefixes',
        toolPrefixesHint: 'Global tools starting with these prefixes will be hidden and rejected while locked.',
        toolPrefixesPlaceholder: 'Select tool prefix groups…',
        promptSectionsLabel: 'Suppressed Prompt Sections',
        promptSectionsHint: 'System prompt sections to suppress while locked to prevent accidental model induction.',
        promptSectionsPlaceholder: 'Select prompt sections to suppress…',
        nameLabel: 'Capability Key',
        nameHint: 'Unique lowercase identifier (e.g. browser / computer / deploy).',
        save: 'Save Changes',
        saving: 'Saving…',
        saved: 'Settings saved. Changes will take effect on new sessions.',
        saveFailed: 'Failed to save settings. Please retry.',
        empty: 'No capability gates configured. Tools remain visible by default.',
        loading: 'Loading gate settings…',
        unavailable: 'Settings storage is unavailable.',
        discovering: 'Discovering available skills and tool prefixes from host…',
        discoverFailed: 'Candidate discovery unavailable (manual text entry is supported).',
        noOptionsFound: 'No options found, manual entry supported',
      },
    }

    const styles = {
      section: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '720px',
        padding: '16px 0 32px',
        margin: '0 auto',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      },
      heading: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      title: {
        margin: 0,
        fontSize: '16px',
        fontWeight: 600,
        letterSpacing: '-0.01em',
      },
      intro: {
        margin: 0,
        color: 'var(--dsw-alias-label-secondary, #717782)',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      status: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        margin: 0,
        color: 'var(--dsw-alias-label-secondary, #717782)',
        fontSize: '13px',
        lineHeight: 1.4,
      },
      statusDot: {
        width: '8px',
        height: '8px',
        flex: '0 0 auto',
        borderRadius: '999px',
      },
      cardList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      card: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.14))',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1, rgba(31, 35, 41, 0.025))',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
      },
      cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 14px',
        cursor: 'pointer',
      },
      cardHeaderExpanded: {
        borderBottom: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.08))',
      },
      cardChevron: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        flex: '0 0 auto',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        transition: 'transform 0.18s ease',
      },
      cardBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px',
      },
      cardKeyGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minWidth: 0,
        flex: '1 1 auto',
      },
      keyInput: {
        boxSizing: 'border-box',
        height: '32px',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.14))',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        padding: '4px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '13px',
        fontWeight: 600,
        maxWidth: '220px',
      },
      cardBadge: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(31, 35, 41, 0.05))',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.08))',
        borderRadius: '6px',
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      },
      cardActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        flex: '0 0 auto',
      },
      toggleLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        userSelect: 'none',
      },
      checkbox: {
        width: '16px',
        height: '16px',
        flex: '0 0 auto',
        margin: 0,
        accentColor: 'var(--dsw-alias-brand-primary, #2563eb)',
        cursor: 'pointer',
      },
      removeBtn: {
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        padding: '4px 6px',
        borderRadius: '6px',
        fontSize: '12px',
        transition: 'color 0.15s ease, background 0.15s ease',
      },
      field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      label: {
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      },
      hint: {
        margin: 0,
        color: 'var(--dsw-alias-label-secondary, #717782)',
        fontSize: '12px',
        lineHeight: 1.4,
      },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '38px',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.14))',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        padding: '8px 12px',
        font: 'inherit',
        fontSize: '13px',
      },
      comboWrap: {
        position: 'relative',
        width: '100%',
      },
      comboInputWrapper: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
      },
      comboInput: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '38px',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.14))',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        padding: '8px 32px 8px 12px',
        font: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      comboChevron: {
        position: 'absolute',
        right: '10px',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        transition: 'transform 0.18s ease',
      },
      comboDropdown: {
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        zIndex: 50,
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.14))',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        boxShadow: 'var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, 0.12))',
        maxHeight: '220px',
        overflowY: 'auto',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      },
      comboOption: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 10px',
        borderRadius: '7px',
        cursor: 'pointer',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        userSelect: 'none',
        transition: 'background 0.12s ease',
      },
      comboOptionActive: {
        background: 'var(--dsw-specific-sidebar-nav-item-active, rgba(37, 99, 235, 0.08))',
        fontWeight: 500,
      },
      comboOptionEmpty: {
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        fontSize: '12px',
        fontStyle: 'italic',
      },
      addBtn: {
        boxSizing: 'border-box',
        cursor: 'pointer',
        width: '100%',
        minHeight: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        border: '1px dashed var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.22))',
        borderRadius: '10px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        fontSize: '13px',
        fontWeight: 500,
        padding: '10px 14px',
        transition: 'border-color 0.15s ease, background 0.15s ease',
      },
      actionsBar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        borderTop: '1px solid var(--dsw-alias-border-primary, rgba(31, 35, 41, 0.12))',
        paddingTop: '16px',
      },
      saveNoticeSuccess: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        margin: 0,
        color: '#16a34a',
        fontSize: '13px',
        lineHeight: 1.4,
      },
      saveNoticeError: {
        margin: 0,
        color: '#dc2626',
        fontSize: '13px',
        lineHeight: 1.4,
      },
      saveBtn: {
        cursor: 'pointer',
        minHeight: '38px',
        border: '1px solid transparent',
        borderRadius: '10px',
        background: 'var(--dsw-alias-brand-primary, #111827)',
        color: '#fff',
        padding: '8px 18px',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        transition: 'opacity 0.15s ease, background 0.15s ease',
        marginLeft: 'auto',
      },
      btnDisabled: {
        cursor: 'default',
        opacity: 0.55,
      },
      notice: {
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary, #717782)',
        margin: 0,
        lineHeight: 1.4,
      },
    }

    // ── nav icon: CSS-mask swap (matching WorkBuddy design) ──
    const NAV_ICON_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'><path d='M3 3h10v10H3z'/><path d='M8 3v10'/><path d='M5.5 6.5h.01M10.5 6.5h.01'/><path d='M5.5 6.5v2a1.5 1.5 0 0 0 3 0v-2'/><path d='M2 7h2M12 7h2'/></svg>"

    const STYLE_TAG_ID = 'dsh-tool-lazy-gate/nav-icon.css'
    function ensureNavIconStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-tool-lazy-gate'
      style.dataset.pluginCss = STYLE_TAG_ID
      const mask = `url("data:image/svg+xml,${encodeURIComponent(NAV_ICON_SVG)}") center / contain no-repeat`
      style.textContent = [
        `[${SETTINGS_NAV_MARKER}] > svg:first-child { display: none !important; }`,
        `[${SETTINGS_NAV_MARKER}]::before { content: ''; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: ${mask}; mask: ${mask}; }`,
      ].join('\n')
      document.head.appendChild(style)
    }

    function registerSettingsNavIcon(labelResolver) {
      if (typeof document === 'undefined') return () => {}
      let disposed = false
      const sync = () => {
        if (disposed) return
        const currentLabel = typeof labelResolver === 'function' ? labelResolver().trim() : String(labelResolver).trim()
        const buttons = document.querySelectorAll('[role="dialog"] nav button')
        for (const button of buttons) {
          const matches = currentLabel.length > 0 && button.textContent?.trim() === currentLabel
          if (matches) button.setAttribute(SETTINGS_NAV_MARKER, '')
          else button.removeAttribute(SETTINGS_NAV_MARKER)
        }
      }
      sync()
      const observer = new MutationObserver(sync)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        disposed = true
        observer.disconnect()
        document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`).forEach((element) => {
          element.removeAttribute(SETTINGS_NAV_MARKER)
        })
      }
    }

    // ── helpers ──
    function splitList(value) {
      if (value === undefined || value === null) return []
      if (Array.isArray(value)) return value
      return String(value).split(',').map((item) => item.trim()).filter(Boolean)
    }
    function joinList(list) {
      return (list || []).join(', ')
    }

    // ── Combobox MultiSelect Component ──
    function MultiSelect({ value, options, onChange, placeholder, emptyText }) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)

      useEffect(() => {
        if (!open) return
        const onDoc = (event) => {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
      }, [open])

      if (!options || options.length === 0) {
        return React.createElement('input', {
          type: 'text',
          value: joinList(value),
          style: styles.input,
          placeholder: placeholder || '',
          onChange: (event) => onChange(splitList(event.currentTarget.value)),
        })
      }

      const list = value || []
      const displayText = joinList(list)

      return React.createElement('div', { ref: wrapRef, style: styles.comboWrap },
        React.createElement('div', { style: styles.comboInputWrapper },
          React.createElement('input', {
            type: 'text',
            readOnly: true,
            value: displayText,
            placeholder: placeholder || '',
            style: styles.comboInput,
            onClick: () => setOpen((v) => !v),
          }),
          React.createElement('span', {
            style: {
              ...styles.comboChevron,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            },
            'aria-hidden': true,
          },
            React.createElement('svg', {
              width: 12,
              height: 12,
              viewBox: '0 0 16 16',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: '1.75',
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            },
              React.createElement('path', { d: 'M3.5 6l4.5 4.5 4.5-4.5' })
            ),
          ),
        ),
        open && React.createElement('div', { style: styles.comboDropdown },
          options.length === 0
            ? React.createElement('div', { style: styles.comboOptionEmpty }, emptyText || '无候选项')
            : options.map((option) => {
                const checked = list.includes(option.value)
                return React.createElement('label', {
                  key: option.value,
                  style: {
                    ...styles.comboOption,
                    ...(checked ? styles.comboOptionActive : {}),
                  },
                },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked,
                    style: styles.checkbox,
                    onChange: () => {
                      const next = checked ? list.filter((item) => item !== option.value) : [...list, option.value]
                      onChange(next)
                    },
                  }),
                  React.createElement('span', { style: { flex: '1 1 auto', minWidth: 0 } }, option.label),
                )
              }),
        ),
      )
    }

    // ── Main Settings View ──
    function CapabilitiesView({ ctx, settingsScope }) {
      const isZh = (ctx.locale?.current || 'zh').startsWith('zh')
      const t = isZh ? copy.zh : copy.en

      const snapshot = useSyncExternalStore(
        (listener) => settingsScope.subscribe(listener),
        () => settingsScope.getSnapshot(),
        () => settingsScope.getSnapshot(),
      )

      const rawCaps = snapshot.value?.capabilities ?? {}
      const [caps, setCaps] = useState(() => JSON.parse(JSON.stringify(rawCaps)))
      const [expandedKeys, setExpandedKeys] = useState(() => ({}))
      const [isSaving, setIsSaving] = useState(false)
      const [saveNotice, setSaveNotice] = useState(null)
      const [discovery, setDiscovery] = useState({ state: 'loading', skills: [], toolGroups: [], sections: [] })

      const connection = ctx.connection || ctx.get?.('connection')

      // Auto-discover candidates from host
      useEffect(() => {
        let cancelled = false
        if (!connection?.rpc?.call) {
          setDiscovery({ state: 'failed', skills: [], toolGroups: [], sections: [] })
          return
        }
        connection.rpc.call('/tool-lazy-gate', 'discover', {}).then((raw) => {
          if (cancelled) return
          if (raw && raw.ok && raw.value) {
            setDiscovery({
              state: 'ready',
              skills: raw.value.skills || [],
              toolGroups: raw.value.toolGroups || [],
              sections: raw.value.sections || [],
            })
          } else {
            setDiscovery({ state: 'failed', skills: [], toolGroups: [], sections: [] })
          }
        }).catch(() => {
          if (!cancelled) setDiscovery({ state: 'failed', skills: [], toolGroups: [], sections: [] })
        })
        return () => { cancelled = true }
      }, [connection])

      // Re-sync when durable value updates
      useEffect(() => {
        if (snapshot.value?.capabilities !== undefined) {
          setCaps(JSON.parse(JSON.stringify(snapshot.value.capabilities)))
        }
      }, [snapshot.value])

      const toggleExpand = (key) => {
        setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }))
      }

      const patchCap = (key, patch) => {
        setCaps((prev) => {
          const next = { ...prev }
          next[key] = { ...(next[key] || { enabled: true, skillNames: [], toolPrefixes: [], promptSections: [] }), ...patch }
          return next
        })
      }

      const renameCap = (oldKey, newKey) => {
        const trimmed = newKey.trim()
        if (!trimmed || trimmed === oldKey) return
        setCaps((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, trimmed)) return prev
          const next = {}
          for (const [k, v] of Object.entries(prev)) {
            next[k === oldKey ? trimmed : k] = v
          }
          return next
        })
        setExpandedKeys((prev) => {
          if (prev[oldKey] === undefined) return prev
          const next = { ...prev, [trimmed]: prev[oldKey] }
          delete next[oldKey]
          return next
        })
      }

      const removeCap = (key) => {
        setCaps((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setExpandedKeys((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }

      const addCap = () => {
        setCaps((prev) => {
          let key = 'new-capability'
          let n = 1
          while (Object.prototype.hasOwnProperty.call(prev, key)) {
            key = `new-capability-${++n}`
          }
          setExpandedKeys((exp) => ({ ...exp, [key]: true }))
          return { ...prev, [key]: { enabled: true, skillNames: [], toolPrefixes: [], promptSections: [] } }
        })
      }

      const handleSave = async (event) => {
        event?.preventDefault?.()
        setIsSaving(true)
        setSaveNotice(null)
        try {
          await settingsScope.set('capabilities', caps)
          setSaveNotice({ type: 'success', text: t.saved })
          setTimeout(() => setSaveNotice(null), 3500)
        } catch (error) {
          setSaveNotice({ type: 'error', text: `${t.saveFailed}: ${error.message || String(error)}` })
        } finally {
          setIsSaving(false)
        }
      }

      if (snapshot.status === 'loading') {
        return React.createElement('div', { style: styles.section },
          React.createElement('p', { style: styles.notice }, t.loading))
      }
      if (snapshot.status === 'unavailable') {
        return React.createElement('div', { style: styles.section },
          React.createElement('p', { style: styles.notice }, t.unavailable))
      }

      const keys = Object.keys(caps)
      const totalCount = keys.length
      const enabledCount = keys.filter((k) => caps[k]?.enabled !== false).length

      const skills = discovery.skills || []
      const toolGroups = discovery.toolGroups || []
      const sections = discovery.sections || []

      const skillOptions = skills.map((s) => ({ value: s.name, label: s.name }))
      const toolGroupOptions = toolGroups.map((g) => ({ value: g.prefix, label: `${g.prefix} (${g.count} 个工具)` }))
      const sectionOptions = sections.map((s) => ({ value: s, label: s }))

      return React.createElement('div', {
        style: styles.section,
        'aria-busy': isSaving || snapshot.status === 'loading',
      },
        React.createElement('div', { style: styles.heading },
          React.createElement('h2', { style: styles.title }, t.title),
          React.createElement('p', { style: styles.intro }, t.intro),
        ),
        React.createElement('div', { style: styles.status },
          React.createElement('span', {
            style: {
              ...styles.statusDot,
              background: enabledCount > 0 ? '#22c55e' : '#9ca3af',
            },
          }),
          React.createElement('span', null, t.statusSummary(totalCount, enabledCount)),
          discovery.state === 'loading' && React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, `· ${t.discovering}`),
          discovery.state === 'failed' && React.createElement('span', { style: { color: '#d97706', fontSize: '12px' } }, `· ${t.discoverFailed}`),
        ),
        React.createElement('form', {
          style: { display: 'flex', flexDirection: 'column', gap: '16px' },
          onSubmit: handleSave,
          noValidate: true,
        },
          totalCount === 0
            ? React.createElement('p', { style: styles.notice }, t.empty)
            : React.createElement('div', { style: styles.cardList },
                keys.map((key) => {
                  const cap = caps[key] || { enabled: true, skillNames: [], toolPrefixes: [], promptSections: [] }
                  const isCapEnabled = cap.enabled !== false
                  const isExpanded = Boolean(expandedKeys[key])
                  const badges = [
                    (cap.skillNames?.length || 0) > 0 ? `${cap.skillNames.length} 技能` : null,
                    (cap.toolPrefixes?.length || 0) > 0 ? `${cap.toolPrefixes.length} 前缀组` : null,
                  ].filter(Boolean).join(' · ')

                  return React.createElement('div', {
                    key,
                    style: {
                      ...styles.card,
                      opacity: isCapEnabled ? 1 : 0.72,
                    },
                  },
                    React.createElement('div', {
                      style: {
                        ...styles.cardHeader,
                        ...(isExpanded ? styles.cardHeaderExpanded : {}),
                      },
                      onClick: () => toggleExpand(key),
                    },
                      React.createElement('div', { style: styles.cardKeyGroup },
                        React.createElement('span', {
                          style: {
                            ...styles.cardChevron,
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          },
                          'aria-hidden': true,
                        },
                          React.createElement('svg', {
                            width: 14,
                            height: 14,
                            viewBox: '0 0 16 16',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: '1.75',
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                          },
                            React.createElement('path', { d: 'M6 3.5l4.5 4.5-4.5 4.5' })
                          ),
                        ),
                        React.createElement('input', {
                          type: 'text',
                          value: key,
                          style: styles.keyInput,
                          title: t.nameHint,
                          onClick: (event) => event.stopPropagation(),
                          onChange: (event) => renameCap(key, event.currentTarget.value),
                        }),
                        badges && React.createElement('span', { style: styles.cardBadge }, badges),
                      ),
                      React.createElement('div', {
                        style: styles.cardActions,
                        onClick: (event) => event.stopPropagation(),
                      },
                        React.createElement('label', { style: styles.toggleLabel, htmlFor: `gate-enable-${key}` },
                          React.createElement('input', {
                            id: `gate-enable-${key}`,
                            type: 'checkbox',
                            checked: isCapEnabled,
                            style: styles.checkbox,
                            onChange: (event) => patchCap(key, { enabled: event.currentTarget.checked }),
                          }),
                          isCapEnabled ? t.enabled : t.disabled,
                        ),
                        React.createElement('button', {
                          type: 'button',
                          style: styles.removeBtn,
                          title: t.remove,
                          onClick: () => removeCap(key),
                        },
                          React.createElement('svg', {
                            width: 14,
                            height: 14,
                            viewBox: '0 0 16 16',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: '1.4',
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                          },
                            React.createElement('path', { d: 'M2 4h12M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M13 4v9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V4' }),
                            React.createElement('path', { d: 'M6.5 7.5v4.5M9.5 7.5v4.5' })
                          ),
                        ),
                      ),
                    ),
                    isExpanded && React.createElement('div', { style: styles.cardBody },
                      // Unlock Skills Combobox
                      React.createElement('div', { style: styles.field },
                        React.createElement('span', { style: styles.label }, t.skillNamesLabel),
                        React.createElement('p', { style: styles.hint }, t.skillNamesHint),
                        React.createElement(MultiSelect, {
                          value: cap.skillNames || [],
                          options: skillOptions,
                          placeholder: t.skillNamesPlaceholder,
                          emptyText: t.noOptionsFound,
                          onChange: (next) => patchCap(key, { skillNames: next }),
                        }),
                      ),
                      // Tool Prefixes Combobox
                      React.createElement('div', { style: styles.field },
                        React.createElement('span', { style: styles.label }, t.toolPrefixesLabel),
                        React.createElement('p', { style: styles.hint }, t.toolPrefixesHint),
                        React.createElement(MultiSelect, {
                          value: cap.toolPrefixes || [],
                          options: toolGroupOptions,
                          placeholder: t.toolPrefixesPlaceholder,
                          emptyText: t.noOptionsFound,
                          onChange: (next) => patchCap(key, { toolPrefixes: next }),
                        }),
                      ),
                      // Suppressed Prompt Sections Combobox
                      React.createElement('div', { style: styles.field },
                        React.createElement('span', { style: styles.label }, t.promptSectionsLabel),
                        React.createElement('p', { style: styles.hint }, t.promptSectionsHint),
                        React.createElement(MultiSelect, {
                          value: cap.promptSections || [],
                          options: sectionOptions,
                          placeholder: t.promptSectionsPlaceholder,
                          emptyText: t.noOptionsFound,
                          onChange: (next) => patchCap(key, { promptSections: next }),
                        }),
                      ),
                    ),
                  )
                }),
              ),
          React.createElement('button', {
            type: 'button',
            style: styles.addBtn,
            onClick: addCap,
          }, t.add),
          React.createElement('div', { style: styles.actionsBar },
            saveNotice && (
              saveNotice.type === 'success'
                ? React.createElement('p', { style: styles.saveNoticeSuccess },
                    React.createElement('svg', {
                      width: 14,
                      height: 14,
                      viewBox: '0 0 16 16',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: '2',
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    }, React.createElement('path', { d: 'M3 8.5l3.5 3.5 6.5-7' })),
                    saveNotice.text,
                  )
                : React.createElement('p', { style: styles.saveNoticeError }, saveNotice.text)
            ),
            React.createElement('button', {
              type: 'submit',
              style: {
                ...styles.saveBtn,
                ...(isSaving ? styles.btnDisabled : {}),
              },
              disabled: isSaving,
            },
              isSaving && React.createElement('span', {
                style: {
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  border: '2px solid #fff',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                },
              }),
              isSaving ? t.saving : t.save,
            ),
          ),
        ),
      )
    }

    exports.apply = function apply(ctx) {
      ensureNavIconStyle()
      const label = () => {
        const zh = (ctx.locale?.current || 'zh').startsWith('zh')
        return zh ? copy.zh.tab : copy.en.tab
      }
      const settingsScope = ctx.settingsScope.bind({ namespace: SETTINGS_NS })

      if (ctx.effect) {
        ctx.effect(() => registerSettingsNavIcon(label), 'dsh-tool-lazy-gate: settings nav icon')
      } else {
        registerSettingsNavIcon(label)
      }

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: SETTINGS_SECTION_ID,
        order: 40,
        label,
        inject: () => ({ ctx, settingsScope }),
      }, CapabilitiesView))
    }

    exports.inject = inject
    return module.exports
  },
})
