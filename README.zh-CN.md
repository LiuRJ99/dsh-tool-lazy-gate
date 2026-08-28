# dsh-tool-lazy-gate

DeepSeek Harness (DSH) 权限门控插件：默认在会话内隐藏并拦截高权限工具家族（默认包括 `browser_*` 与 `computer_use_*`），仅当**用户显式触发**对应技能时按需解锁，具备不可绕过的执行守卫与会话恢复重构机制。

## 为什么需要

浏览器控制与桌面控制工具默认注册在 Host 宿主的 `tools` 注册表中，所有 Preset 默认都能看到，模型往往在常规 `bash` 或文件工具即可解决问题时过早尝试调用。通过会话级门控，既能避免模型误调，又保留了用户一条指令即可解锁的能力。

## 核心特性与行为语义

- **新会话默认锁定**：所有门控能力初始均为锁定状态。
- **用户显式解锁**：仅信任用户的显式技能指令（如 `/browser`、`/computer-use`，生成 `source.kind === 'skill-invocation'` 的 `user/message`）。
- **防模型自主提权**：模型自行调用 `skill("browser")` 仅产生 `tool/call`，无法触发解锁。
- **双层安全边界**：锁定状态下通过 `tools.restrict` 在模型视角隐藏工具，并通过 `tools.guard` 进行硬拦截。
- **系统提示词过滤**：未解锁时自动抑制相关工具的使用引导提示词块（`promptSections`）。
- **Session 恢复重构**：从持久化事件中精准重构用户曾解锁的状态，新会话重置为锁定。
- **优雅降级**：宿主未安装对应插件时自动降级为 no-op，不影响基础功能。

## 安装方式

```sh
# 从 GitHub 仓库安装到 web profile
dsh plugin --profile web add github:LiuRJ99/dsh-tool-lazy-gate

# 从本地源码安装
dsh plugin --profile web add <path>/dsh-tool-lazy-gate
```

## 配置说明

能力配置已改为以 `skillNames` 为唯一入口。`toolPrefixes`（门控工具前缀）和
`promptSections`（压制 Prompt 段）不再是独立候选项，而是由所选的、已经适配
Lazy Gate 的 Skill 自动关联得到。这样，其他插件的 Tool/Prompt 不会混入门禁配置。

预置配置只需要声明浏览器和电脑技能：

```yaml
- insert:
    - id: tool-lazy-gate
      name: dsh-tool-lazy-gate
      config:
        capabilities:
          browser:
            enabled: true
            skillNames: [browser]
          computer:
            enabled: true
            skillNames: [computer-use]
          taskboard:
            enabled: true
            skillNames: [taskboard]
```

已适配插件需要在注册授权 Skill 时发布关联元数据：

```ts
ctx.skills.register({
  name: 'deploy',
  description: '解锁本会话的 deploy 工具。',
  content: '# Deploy',
  source: '@example/dsh-deploy',
  invocation: { modelInvocable: false, userInvocable: true },
  metadata: {
    'dsh:gate': {
      toolPrefixes: ['deploy_'],
      promptSections: ['tool:deploy'],
    },
  },
})
```

设置页只显示带有上述关联的用户技能（浏览器/电脑旧版本另有兼容映射）。选择
Skill 后，两项资源会自动合并并以只读方式展示。旧配置中没有对应 Skill 的
Tool/Prompt 值会被运行时忽略，并在保存设置时清理。

安装或配置后重启 `dsh web` 并刷新页面即可生效。
