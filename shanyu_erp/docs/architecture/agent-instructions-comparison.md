# `andrej-karpathy-skills` 与山屿 ERP `AGENTS.md` 适配性比较

> 调研日期：2026-08-28  
> 结论：**择优合并，不直接替换，也不整段追加。**

## 问题与范围

本记录比较：

- 山屿 ERP 当前的仓库级 [`AGENTS.md`](../../AGENTS.md)；
- [`multica-ai/andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills) 当前 `main` 分支提供的通用行为准则；
- Codex 官方对 `AGENTS.md` 的用途、加载范围和上下文控制建议。

这里的“更合适”指：能否作为 **Codex 在本仓库中的持久项目指令**，稳定约束实现范围、领域边界、运行验证与完成标准，而不是只评价其通用编程建议是否有价值。

## 先澄清：它并不是一个现成的 `AGENTS.md`

目标仓库自述为“一份改善 Claude Code 行为的 `CLAUDE.md`”，主体是四组通用原则：编码前思考、简洁优先、精准修改、目标驱动执行。其可复用 Skill 版本内容基本相同，插件清单也明确把它注册为 `karpathy-guidelines` Skill，而非 Codex 的项目指令文件。[README](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/README.md)、[`CLAUDE.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/CLAUDE.md)、[`SKILL.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md)、[插件清单](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/.claude-plugin/plugin.json)

Codex 官方说明，`AGENTS.md` 用于随仓库持久存在的项目指导，例如构建和测试命令、评审要求、仓库约定以及目录级规则；Skill 则用于可复用的工作流或领域能力。这两者是互补的，不是互相替代的。[Codex 自定义概览](https://learn.chatgpt.com/docs/customization/overview#agents-guidance)

另外，Codex 原生发现的是 `AGENTS.override.md`、`AGENTS.md` 及显式配置的回退文件名。`CLAUDE.md` 不会仅因放在仓库中就自动成为 Codex 项目指令；要让它生效，必须改名、合并，或额外配置 `project_doc_fallback_filenames`。[Codex `AGENTS.md` 发现规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)

## 逐项比较

| 维度    | 当前山屿 ERP `AGENTS.md`                                                        | `andrej-karpathy-skills`                                            | 判断                       |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| 项目适配度 | 明确项目目标、一期边界、Next/Nest 职责、contracts 边界、基础设施、领域文档路由、业务不变量与完成标准                | 不知道本仓库的技术栈、领域、命令和部署方式                                               | **当前文件显著更适合做仓库级主文件**     |
| 可执行约束 | 给出具体文件、端口、版本和 `pnpm`/Docker 命令，可直接验证                                        | “不要过度复杂”“每行都应追溯到请求”等多数是行为启发式；只有计划与测试例子接近可验证                         | 目标仓库适合补充工作方式，不足以独立验收项目任务 |
| 上下文负担 | 根文件约 5 KiB、98 行；Web 子树另有约 0.7 KiB 的 Next.js 自动生成规则，远低于 Codex 默认 32 KiB 合并上限 | `CLAUDE.md` 59 行；若整段追加，会与现有“不要提前造空模块”“不顺带重构”“先列计划/验收条件”“根命令验证”等规则重复 | 不存在容量风险，但存在重复和注意力稀释风险    |
| 维护成本  | 项目结构、命令或架构变化时必须同步维护，但这些信息本来就需要一个仓库内单一来源                                     | 内容短且通用；复制后仍需自行判断上游变更是否适用                                            | 选择性吸收后不应建立上游同步依赖         |
| 风险    | 主要风险是随着项目演进变旧，或规则过多时重复                                                      | 直接替换会丢失 ERP 的架构与安全边界；照抄部分绝对化措辞会制造过度澄清或错误删减防御代码                      | **替换风险高，压缩合并风险低**        |

Codex 官方默认最多合并 32 KiB 项目指导，并建议把专用规则放到最接近其代码的目录；当前约 5.7 KiB 的根级加 Web 子树指导没有接近该上限。[Codex 指令链与大小限制](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance) 官方同时建议保持 `AGENTS.md` 小而关键、从反复出现的错误和评审意见迭代，而不是预先堆满通用规则。[Codex 自定义概览](https://learn.chatgpt.com/docs/customization/overview#agents-guidance)

OpenAI 的 Codex 工程实践进一步建议把短 `AGENTS.md` 当作目录和导航，把详细知识保存在结构化 `docs/` 中；其案例的根文件约 100 行。当前文件正好约 98 行，并将领域、产品和架构细节路由到 `CONTEXT-MAP.md`、`docs/contexts`、phase boundaries 和 ADR，结构上已经接近这种“地图而非百科全书”的模式。[OpenAI Harness Engineering：repository knowledge](https://openai.com/index/harness-engineering/#we-made-repository-knowledge-the-system-of-record)

## 哪些内容已经覆盖

目标仓库的主要价值在当前文件中大多已有项目化表达：

- “简洁优先”已经落在“不提前生成施工、财务空壳”“只有真实需求才增加抽象层”“不引入 Redis、消息队列或微服务”等明确边界上；
- “精准修改”已经落在“不顺带重构与当前任务无关的代码”；
- “目标驱动执行”已经落在多领域变更先列计划、验收条件、受影响模块，以及统一的 lint、类型检查、测试、构建和运行时完成标准；
- “不确定时澄清”已经落在发现需求歧义时先记录问题、确认后再固化业务规则。

保留当前的项目化措辞比用通用口号替换更可执行。例如“保持 contracts 不含数据库实体”和“金额不得用 JavaScript 浮点数直接运算”都是目标仓库无法提供、却会直接影响 ERP 正确性的约束。

## 建议择优合并的最小增量

如果后续要修改根 `AGENTS.md`，建议只吸收以下四个尚未完全显式化的点，并与现有段落去重后合并，而不是新增完整的“四原则”章节：

1. **显式呈现重要假设与权衡**：当多个解释会改变业务规则、公共 API、数据模型或架构边界时，先写出解释和影响；只有无法安全推进时才请求确认。这样保留主动性，不采用“一有不清楚就停止”的绝对规则。
2. **让计划逐步可验证**：多步骤任务的每一步附一个对应检查；无法运行验证时说明原因和次优检查。现有“计划 + 验收条件”可直接扩展，无需重复一套模板。
3. **只清理本次改动造成的孤儿代码**：删除由本次修改新产生的未使用导入、变量或函数；已有的无关死代码只报告、不顺手删除。
4. **按目标追溯变更**：每项改动必须直接支持用户请求或其完成标准；必要的 contracts、迁移、测试、文档与 ADR 也属于完成标准，不能因机械理解“只改请求中的文件”而遗漏。

可压缩为类似下面四条（仅为建议文本，本次不修改 `AGENTS.md`）：

```markdown
- 会影响业务规则、公共 API、数据模型或架构边界的假设必须显式写出，并说明可选解释与权衡；无法安全推进时再请求确认。
- 多步骤计划为每一步注明验证方式；无法执行验证时说明原因和次优检查。
- 只清理本次修改造成的未使用代码；发现既有无关死代码时报告但不顺手删除。
- 每项改动必须直接支持用户请求或其完成标准，包括必要的契约、迁移、测试和文档更新。
```

## 不建议合并的内容

- **不要整段追加四原则。** 当前文件已有大量语义重叠。OpenAI 当前模型指导建议精简提示、每条规则只陈述一次，并用代表性任务验证删减效果；重复“询问、不要修改、等待批准”等指令还可能造成对安全常规操作的多余确认。[OpenAI 模型指导：Favor leaner prompts](https://developers.openai.com/api/docs/guides/latest-model#favor-leaner-prompts)
- **不要采用“不要为不可能场景做错误处理”。** “不可能”本身常由错误假设得出；对长期运行且涉及金额、权限、审批和审计的 ERP，这条过于宽泛。应由类型、不变量、边界校验和威胁模型决定哪些防御是必要的。
- **不要采用“200 行能写 50 行就重写”作为硬规则。** 行数不是正确性、可读性或领域完整性的验收指标，也可能诱发与任务无关的重写。
- **不要把“遇到不清楚就停止”原样写入。** 对会改变核心语义的歧义应停止并确认；对低风险、可逆且能从仓库事实验证的细节，应先调查并作出显式、可验证的合理假设。
- **不要把 Claude 插件安装方式当作 Codex 配置。** 该仓库 README 的安装说明针对 Claude Code 插件或 `CLAUDE.md`；Codex 的持久项目指导仍应使用原生 `AGENTS.md` 作用域。[目标仓库安装说明](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/README.md#install)、[Codex `AGENTS.md` 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## 维护状态与供应风险

截至调研日，GitHub 仓库页面显示 28 个提交；最近提交为 2026-04-20，内容是同步中文 README 的 Cursor 章节。提交历史主要集中在 2026 年 1 月的 Claude 插件结构修复与 4 月的文档/Cursor 支持，GitHub Releases 页面没有正式发布。[提交历史](https://github.com/multica-ai/andrej-karpathy-skills/commits/main/)、[最近提交](https://github.com/multica-ai/andrej-karpathy-skills/commit/2c606141936f1eeef17fa3043a72095b4765b9c2)、[Releases](https://github.com/multica-ai/andrej-karpathy-skills/releases)

插件清单仍固定为 `1.0.0`，README 中部分安装 URL 仍指向旧的 `forrestchang/andrej-karpathy-skills` 路径，而当前仓库归属为 `multica-ai`。这不证明项目不安全或停止维护，但说明不适合把远端 `main` 当作需要自动同步的仓库规则来源。[插件清单](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/.claude-plugin/plugin.json)、[README 安装命令](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/README.md#install)

更稳妥的维护方式是：把验证过、确实能减少本项目重复错误的原则改写成本项目自己的少量规则；之后只根据山屿 ERP 的真实代码评审反馈更新，而不追随目标仓库同步。

## 最终建议

**选择“择优合并”。**

- 不直接替换：目标仓库缺失山屿 ERP 必须长期保留的目录、领域、架构、安全、运行和完成标准。
- 不整段追加：四原则与当前文件重复较多，会增加上下文噪声，且有几条绝对化措辞不适合 ERP。
- 仅合并最小差异：显式假设与权衡、逐步验证、只清理由本次修改造成的孤儿代码、按请求或完成标准追溯变更。
- 若希望跨所有仓库复用四原则，应把它放在个人全局指导或独立 Skill，而不是让山屿 ERP 的仓库级 `AGENTS.md` 承担通用人格提示；项目根文件继续只保留本仓库每次任务都必须遵守的规则。

## 证据局限

这是一项基于当前文件和一手文档的静态适配性评估，不是 A/B 编码效果实验。若要进一步确认收益，建议选取若干真实、可重复的 ERP 任务，分别以当前版本和“最小合并版”运行，比较无关 diff、澄清次数、一次通过率、验证遗漏和 token 使用，再决定是否落地。
