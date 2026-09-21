# 0921 提交与下一次测试环境发布

当前状态：代码检查点可供审查；**尚未满足发布条件**。先解决 0921-local-acceptance.md 中的业务确认及缺失验收，再制作发布包。本文没有执行任何 Git 写入或云端操作。

## 1. 仅提交本次功能代码检查点

在仓库根执行。暂存区必须先为空，避免带入其他已暂存文件；不要 git add .。

```bash
cd /Users/lulu/Codex/山屿
test "$(git branch --show-current)" = "codex/v2-main-materials-v1" &&
git diff --cached --quiet &&
git --literal-pathspecs add --pathspec-from-file=shanyu_erp/docs/testing/0921-commit-paths.txt &&
git diff --cached --check &&
git diff --cached --stat
```

人工核对名单和 diff 后再执行：

```bash
git commit -m "feat: 保存0920模块计价与选材单验收检查点"
git log -1 --format='%H %s'
```

当前清单不包含材料源表和设计资料，不包含候选发布能力；此提交不是“全部0920完成”的声明。资料如需进 Git，请独立核对 PRD/Pencil/总表/朗格表后单独提交。无关运维改动及 Excel 删除不随本清单暂存。

## 2. 业务问题关闭并重验后，从最终提交构建

以下仅准备本地包。新提交短哈希决定新版本，禁止复用旧 fa25ec6 镜像或同名覆盖。需要 Docker 已运行、磁盘足够及联网下载构建依赖；镜像构建与发布候选验收须另行实际执行，不能仅凭本地 pnpm build 视作镜像通过。

```bash
(
  set -eu
  cd /Users/lulu/Codex/山屿
  test "$(git branch --show-current)" = "codex/v2-main-materials-v1"
  COMMIT=$(git rev-parse HEAD)
  RELEASE="v2-$(date +%Y%m%d)-$(git rev-parse --short=7 HEAD)"
  PACKAGE_DIR=$(mktemp -d /private/tmp/shanyu-release.XXXXXX)
  mkdir "$PACKAGE_DIR/source"
  git archive --format=tar --output="$PACKAGE_DIR/source.tar" "$COMMIT" shanyu_erp
  tar -xf "$PACKAGE_DIR/source.tar" -C "$PACKAGE_DIR/source"
  docker build --platform linux/amd64 --target api \
    --label "org.opencontainers.image.revision=$COMMIT" \
    -t "shanyu-erp-api:$RELEASE" "$PACKAGE_DIR/source/shanyu_erp"
  docker build --platform linux/amd64 --target web \
    --build-arg NEXT_PUBLIC_API_URL=/api \
    --label "org.opencontainers.image.revision=$COMMIT" \
    -t "shanyu-erp-web:$RELEASE" "$PACKAGE_DIR/source/shanyu_erp"
  docker image inspect "shanyu-erp-api:$RELEASE" "shanyu-erp-web:$RELEASE" \
    --format '{{.Id}} {{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
  docker save -o "$PACKAGE_DIR/$RELEASE-images.tar" \
    "shanyu-erp-api:$RELEASE" "shanyu-erp-web:$RELEASE"
  gzip "$PACKAGE_DIR/$RELEASE-images.tar"
  tar -czf "$PACKAGE_DIR/$RELEASE-config.tar.gz" -C "$PACKAGE_DIR/source/shanyu_erp" \
    compose.prod.yaml Caddyfile scripts/deployment
  shasum -a 256 "$PACKAGE_DIR/$RELEASE-images.tar.gz" "$PACKAGE_DIR/$RELEASE-config.tar.gz"
  printf 'RELEASE=%s\nCOMMIT=%s\nPACKAGE_DIR=%s\n' "$RELEASE" "$COMMIT" "$PACKAGE_DIR"
)
```

这个归档只包含 commit，不带当前工作树的其他未提交内容。提交遗漏文件会在隔离构建中暴露，不能临时拷贝脏文件“补包”。镜像还需隔离迁移到034、文件路径/worker/权限/真实队列验收。

## 3. 交给云端测试任务的指令

将上一步实际 RELEASE、完整 commit、包路径和 SHA-256 一并提供给云端任务，然后复制：

```text
仅准备山屿 ERP 测试环境升级，目标 shanyu-erp-test / 115.159.50.166。
使用我提供的最终 commit、现成镜像包和配置包，遵循
shanyu_erp/docs/operations/guarded-version-upgrade.md。

先检查 0921-local-acceptance.md 的待确认及未覆盖项是否已关闭；未关闭则停止发布。
只读核对服务器身份、当前 RELEASE_VERSION、镜像架构/revision、持久卷、数据库迁移及队列。
根据本次镜像隔离迁移演练和云端现场，准备 release-test.json，固定 machineId、previousRelease、
镜像 ID、库 UUID/业务内容哈希及两类卷。不能将原始 Excel SHA 当业务内容哈希。
特别说明：0920 材料只是候选，不得因代码部署擅自发布候选，不能把0919数据宣称成0920。

先报告目标版本、清单、备份、维护窗口和数据影响，得到我本次明确确认后才执行。
上传并校验包，安全解包到 /srv/shanyu-erp/releases/<本次RELEASE>/；docker load，禁止服务器build/pull。
远端 OCI manifest ID 与本地 config ID 不同时，验证归档映射并报告，不直接绕过校验。
运行受控 server-upgrade.sh：维护停写、前后备份、逐行数据指纹、迁移、安全更新计划、健康检查。
保留全部账号和全部项目，尤其水韵佳苑及嘉善鑫越府复式；不清库、不seed、不restore、
不down -v、不删除卷/备份，不覆盖.env.production，不连正式环境。
失败立即停止并保留报告；不自行回滚数据库、不启动旧镜像或移除维护标记。
验收迁移033/034、API/Web/worker健康、导出卷可写、报价及选材单队列与PDF/XLSX。
没有授权业务会话就报告待人工验收，不重置账号密码。
```

## 4. 清单/包已就绪且本次授权后，执行一条测试升级命令

这里不预填不存在的新版本。输入上一步已审核的 RELEASE；不是旧 c8b5029 或 fa25ec6。

```bash
(
  set -eu
  printf '输入本次已审核且已上传的 RELEASE_VERSION: '
  IFS= read -r RELEASE
  case "$RELEASE" in
    ''|*[!A-Za-z0-9._-]*) echo '版本格式不合法'; exit 1 ;;
  esac
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes shanyu-erp-test \
    "bash /srv/shanyu-erp/releases/$RELEASE/scripts/deployment/server-upgrade.sh /srv/shanyu-erp/releases/$RELEASE/release-test.json test:$RELEASE"
)
```

提交后不能立刻跳到此步；它依赖新镜像、经核验的服务器清单、上传校验和维护窗口批准。正式环境另待独立授权。
