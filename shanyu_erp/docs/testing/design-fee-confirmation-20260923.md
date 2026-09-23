# 设计费直接确认与内部修订验收（2026-09-23）

## 本轮范围

按用户最新确认实施：主案直接编辑并“确认设计费”；正式报价确认后不再走生成步骤，页面 V 号不变，内部建立独立快照。未提交、未推送、未部署；保留工作树原有修改。

- 首次生成必须确认设计费，空值不允许，明确 0 有效。
- 草稿按当前外框面积确认；面积变化后原确认失效。
- 当前正式报价创建新 ID、同一 version_number、递增 design_fee_revision，保留原快照与导出；普通继续编辑和审批仍沿用原有 V 号递增规则。
- 仅调整设计费及其项目总额；复制原半包、主材、选色、数量和价格快照，不刷新主材库。待审批优惠不生效、不复制审批记录；已批准报价保留原有效优惠状态。
- 新确认接口校验项目权限、报价 ID 和 revision。旧页面、重复提交、并发覆盖均不能直接覆盖新报价。
- 不修改导出模板或成本毛利规则。设计费仍计入客户应付、收入单列，成本毛利不包含设计费。

## 修改位置

- `migrations/036_design_fee_confirmation.mjs`：确认面积、内部修订序号及唯一约束；历史快照保护。
- `apps/api/src/quotation/{quotation.repository,pg-quotation.repository,quotation.service,quotation.controller}.ts`：受控确认、快照保存、生成前校验。
- `packages/contracts/src/index.ts`、`apps/web/src/lib/quotation-client.ts`：确认状态及当前报价 ID 传输。
- `apps/web/src/app/projects/[projectId]/design-fee.tsx`：编辑、确认及状态提示。
- `apps/web/src/app/projects/[projectId]/quotation/submit/submit-quotation-panel.tsx`：首次生成前可确认；编辑未确认时阻断生成。
- `apps/api/test/{design-fee.pg,quotation.service,quotation.e2e}.spec.ts`：新增专项及既有流程的设计费前置确认。
- `docs/contexts/quotation/CONTEXT.md`：同步最新业务口径。

## 实测结果

Node.js 24.20.0、pnpm 10.29.2。

| 检查 | 结果 |
| --- | --- |
| lint / typecheck / build | 全部通过 |
| API 全量 | 220/220 通过，0 失败、0 跳过 |
| Web 全量 | 85/85 通过，0 失败、0 跳过 |
| 新增设计费 PostgreSQL 专项 | 6/6 通过，已显式启用 |
| 原有部署回归 | 全部通过；仅本地替身及隔离容器 |
| 036 全新库迁移 | 通过 |
| 浏览器及真实 PDF 下载 | 通过 |
| git diff --check | 通过 |

数据库测试仅使用 `127.0.0.1:55468/shanyu_catalog_safe_test`；显式设置 `SHANYU_SAFE_UPDATE_DB_TEST=1`，未使用日常库运行测试。测试夹具最初存在参数类型及 is_current 默认值错误，修正后重跑通过；不计为业务通过。浏览器最初测试 CORS 来源和按钮定位不正确，修正隔离配置/定位后完整重跑通过。

### 浏览器验收

隔离 API 3114、Web 3214，以主案 Alex 登录，独立创建合成项目：

1. 确认页空值被拒绝；确认 0 后允许生成；再编辑未确认则禁止生成。
2. 生成 V1 后不点“继续编辑”，直接确认单价 20、面积 130，设计费 2600。
3. 仍为 V1 已报价，新报价 ID 为 `55b7c746-7c54-4a1d-81ec-51dd743f2618`，旧 ID 为 `0664c7cf-f817-4f90-98b3-be4613b91dfa`。
4. 145 条半包行、1 条主材行的业务字段逐项一致；旧行原样保留，新行仅重新分配快照身份及关联 ID。
5. 刷新后回显单价 20；模拟保存 500 时保留输入 30，服务端报价未变。
6. 新 PDF 汇总页显示：半包 55990、主材 440、设计费 2600、合计 59030；元数据总额与服务端一致。第 3 页已渲染并目视检查，无截断或重叠。
7. 设计费变更后重新下载旧 PDF，字节完全一致。

## 本地生效与业务数据保护

为使日常本地页面能使用新字段，在隔离验收通过后仅执行 036 结构迁移。执行前确认当前迁移为 035，且已备份：

`tmp/backups/design-fee-0923/before-036-1927.dump`

SHA-256：`d09dcc6eb96f47f4e80cbecb65b3c2ff27a68dec2469448f06442ea5c8d63c21`

迁移前后逐行比较全部原业务字段完全一致：报价 5、报价空间 42、半包行 1247、主材行 39、审批 5、导出 8、库版本 8、商品版本 5550、项目 2、项目空间 10、账号 6。未替现有报价设置或确认设计费，新增确认字段仍为 NULL，内部修订序号为 0。

核验记录：`tmp/backups/design-fee-0923/036-verification.json`。

随后只读打开 localhost:3000 的指定项目，确认设计费输入可编辑且存在“确认设计费”按钮；未填写或保存该项目。云端未连接、未迁移、未部署。
