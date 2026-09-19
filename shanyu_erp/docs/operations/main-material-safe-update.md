# 主材库零影响自动更新

本方案只在本地开发、验证；尚未部署到任何云环境。

## 规则

1. 自动更新仅面向当前首次编辑草稿：DRAFT、is_current=true、version_number=1、parent_version_id 为空，且项目无其他报价版本。
2. 非编辑版本、历史版本、由历史版本继续编辑而来的草稿永远跳过，不因后续发布再次变为候选。该规则不限制用户明确进行的业务编辑。
3. “零影响”是保守的逐字段相同，不只比较总价。比较已选商品的品名、类别、品牌、系列、型号、规格、单位、售价、成本、可选颜色、属性、说明、图片及当前快照；检查有效状态、选色与瓷砖规格/单位兼容性。
4. 仅有商品版本号、导入来源行等追溯信息变化可以通过。新增未选商品不会自动加入报价。
5. 一条主材不通过就跳过整份报价。自动流程不清空选型、不删除行、不重算、不覆盖原业务内容。
6. 安全更新只改报价的库引用、行的 item_version_id、报价 revision 和更新时间，并写审计。账号、项目、半包、审批、导出不改变。
7. 继续编辑复制原快照，包括原折扣、抹零、价格、数量、图片和手动工程量标记。新版本必要的 ID、父版本引用、草稿状态等正常变化；旧版本不再是 current，但业务内容不改写。新草稿不自动继承“已批准”状态。

## 入口

- 应用内 FULL / DELTA / 在线编辑（经 publishImportBatch 发布）：自动在发布事务中执行；分析清单写入 MAIN_MATERIAL_SAFE_UPDATE_ANALYZED 审计。异常将回滚该次发布；有业务差异仅跳过对应报价，不阻止发布新库。
- 部署中的数据库迁移发布：server-deploy.sh 在迁移后、启动服务前调用下述脚本。部署前备份沿用现有 server-backup.sh。迁移已提交时若脚本失败，只回滚脚本事务并停止部署，不自动回滚迁移或恢复数据库。
- 独立脚本：apps/api/scripts/reconcile-main-material-drafts.mjs。与发布钩子复用同一个 TypeScript 领域分析器，不维护第二套业务规则。

## 本地使用

先在应用目录构建 API，再进入 apps/api。脚本本身不加载 .env，也不读取 SSH 配置。

```bash
pnpm --filter @shanyu/api build
cd apps/api
# 使用当前本地配置，只读预览；不会应用。
node --env-file-if-exists=../../.env scripts/reconcile-main-material-drafts.mjs --dry-run --environment=local
# 已确认目标并备份后，只应用当时仍为零影响的草稿。
node --env-file-if-exists=../../.env scripts/reconcile-main-material-drafts.mjs --apply --environment=local
```

默认 dry-run、默认 local；local 只允许 POSTGRES_HOST 为 127.0.0.1、localhost 或 ::1。不输出密码、连接串等配置。可用 --target=<已发布库UUID> 固定目标，目标已变化则拒绝；apply 会重新分析，不能复用过期预览直接写入。

报告为 JSON，含目标库、项目地址/ID、报价 ID/版本/revision/status、原库、结果和逐行逐字段前后差异。报告可能含成本，仅供授权运维人员保存。

| outcome | 含义 |
|---|---|
| PROTECTED | 非当前首次编辑草稿，或有历史血缘；不修改 |
| CURRENT | 已是目标库，不修改 |
| BLOCKED | 存在业务差异/不兼容；整份报价跳过 |
| SAFE | 只读预览通过，尚未修改 |
| UPDATED | 已安全更换引用并写审计 |

BLOCKED 是正常保护结果，进程可成功退出；技术错误、目标不符、锁超时等退出非零。重复执行已更新报价不会重复更新 revision 或审计。

## 未来云端运行边界

本次没有执行此节。需先发布包含新代码及脚本的 API 镜像/部署配置，并按环境完成备份与确认。
在 API 容器内，脚本使用容器已有的 PostgreSQL 环境变量；命令为：

```bash
node scripts/reconcile-main-material-drafts.mjs --dry-run --environment=test
# 生产必须显式使用 --environment=production；不要把 test 参数用于生产。
```

部署脚本自动根据已有 deployment_environment 传递 test/production。单独 --apply 前由运维明确核对所在服务器、目标库和备份；本脚本不负责 SSH、备份上传或恢复。不将测试报告视为生产验收，不替换原 .env.production，不执行 seed/restore/down -v。

## 事务与并发

预览使用 REPEATABLE READ READ ONLY；应用重新分析并持有库发布锁和报价行锁，逐行写引用，与审计同一事务提交。CLI 锁等待上限 10 秒、语句上限 120 秒；锁冲突、约束或审计失败时不提交任何脚本变更。应用内发布复用既有事务。没有把分析结果当作脱离事务的更新授权。

## 本地隔离测试

新增纯规则测试 main-material-safe-update.spec.ts；新增真实 PostgreSQL 测试 main-material-safe-update.pg.spec.ts。
数据库测试必须同时设置 SHANYU_SAFE_UPDATE_DB_TEST=1、POSTGRES_HOST=本机回环地址、POSTGRES_DB=shanyu_catalog_safe_test，否则不运行/拒绝；不得指向云端或日常开发库。
先在独立 PostgreSQL 18 数据库执行全部迁移，并通过现有导入接口准备半包模板；测试自建合成报价，每条用例最终 ROLLBACK。发布自动联动、整单保护、精确继承、重复执行、过期预览复查、错误目标、审计失败回滚和发布锁均有用例。

```bash
# 在 apps/api，凭据通过安全环境变量注入，不在命令中写真实密码。
SHANYU_SAFE_UPDATE_DB_TEST=1 pnpm exec vitest run test/main-material-safe-update.spec.ts test/main-material-safe-update.pg.spec.ts --maxWorkers=1
```

完整执行记录见 main-material-safe-update-local-results-20260919.md。
