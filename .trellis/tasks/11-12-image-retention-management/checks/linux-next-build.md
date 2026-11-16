# C2 Linux 完整 Next 构建辅助器

`linux-next-build.mjs` 只能在 `isolated.py` 所有的冻结 `app` 里执行。主会话负责将本文件纳入快照和 `source-manifest.json`，随后在 `isolated.py` 的固定命令表加入：

```python
"linux-next-build": (
    [str(NODE), str(workspace / ".trellis/tasks/11-12-image-retention-management/checks/linux-next-build.mjs")],
    1560,
),
```

该命令使用现有 `fixed_stage` 的 `test` 环境即可；Linux 的构建环境来自原 Dockerfile。主会话通过同一个 `isolated.py run --workspace <冻结 app> --stage linux-next-build` 执行。辅助器本身不刷新快照，不安装宿主依赖，不替换已有 `.next`。实现阶段未执行构建或测试。

## 输入与执行边界

- 检查真实 ROOT/cwd、父 owner kind/token、固定 Node 24.22.1、所有 manifest 文件的大小和 SHA256、当前辅助器已纳入 manifest，以及隔离 HOME/USERPROFILE/APPDATA/LOCALAPPDATA。源文件在构建后和导出后再次核验。
- 只使用隔离 launcher 给出的 local unix/npipe `DOCKER_HOST`，不读取用户 Docker config、context 或 registry 凭据。基础镜像必须已安装；两个 ID 分别来自 `node:24.22.1-alpine` 与 `golang:1.25-alpine` 的本机 inspect。
- 基础镜像预检之后才创建 owner-marked Docker scratch 和空 auth config。临时 context 复制 manifest 内的源文件，`.trellis/` 按真实 `.dockerignore` 排除。私有 dotenv/package 凭据不允许进入源清单；公开 `.env.example` 保持原字节，并在 Linux 内核对其副本。
- 保留完整原 Dockerfile 的 `--target builder`，唯一文本变更为将 `RUN pnpm build` 加上 `CIRCLE_NODE_TOTAL=2`、`NODE_OPTIONS="--max-old-space-size=1536 --max-semi-space-size=8"`。原 `prisma generate && next build`、类型检查、页面收集和静态生成全部执行；不更换 bundler，不更改产品配置或依赖。
- 使用本机 classic builder、固定 base ID、`--pull=false --force-rm`；单 RUN 最多 3 GiB、2 CPU。依赖安装仍按原 Dockerfile 访问公开包源，不提供用户 registry 凭据。工作阶段总截止 1320 秒、build 子命令 1080 秒、清理 90 秒，末尾源哈希复核最多 60 秒；外层 1560 秒截止覆盖全部步骤。

## 输出与清理

输出位于父 owner 的 `temp/narra-c2-next-*/` 独立目录。每次使用新目录和 `owner.json`，包含：

- `.next/`：通过真实 Docker cp 导出的运行产物；只排除 `.next/cache`，包含原 BUILD_ID、server/static bundles 及全部运行期 manifests。
- `artifact-manifest.json`：Linux 内实际文件清单、逐文件字节数/SHA256/原始 mtimeNs、Node/Next 版本、BUILD_ID、类型检查和 CPU 设置、原始源输入核验结果。
- `artifact-export-manifest.json`：宿主导出文件的实际字节数/SHA256/mtimeNs，以及逐文件时间精度比较结果。
- `context-manifest.json` 与 `Dockerfile.build`：确切构建输入及唯一资源参数变化。
- `result.json`：source manifest/hash、base image IDs、builder image ID、真实 build exit/duration、导出树 hash、逐项清理结果。外层日志也输出同一小报告。

宿主逐文件严格核对导出物与 Linux 原件的 hash，同时比较两侧实际 mtimeNs。时间允许明确记录的 100ns、1ms 或 1s 截断/取整精度损失，以覆盖文件系统和 Docker tar 的精度；不假定毫秒/纳秒完全保留。helper 不修改编译文件，不 touch BUILD_ID；报告独立列出 BUILD_ID 的两侧真实时间。缓存命中时，该时间可能早于冻结快照的新捕获时间。主会话应使用明确的源/构建/产物 hash 绑定证据，不用人为改时间满足旧 mtime 门禁。大清单响应使用有界 stdout/stderr 收集并等进程 close 后解析，不在 exit 时提前截断输出。

导出容器只执行读取和哈希，使用 `--network=none --read-only`，无挂载和宿主端口。清理前核对确切 ID、完整名称、owner/source labels、image ID 与本机 daemon 身份；按已核验的完整 image ID 删除，不加 force，额外 tag/引用冲突会失败。不移除 volume，不按前缀清理，不 prune 未知缓存层。无法确认删除的 owned 资源会令 helper 非零退出。产物目录明确保留供主会话复核，不计作待删除的 scratch。若产物 owner 失效，则拒绝写入该目录，仍在 stdout 输出失败回执。

可选参数 `--keep-builder` 会在成功导出后明确保留 builder image。报告将其标作 `explicitly-retained-for-linux-runtime` 并记录完整 name/ID/owner/endpoint；默认删除。后续清理该镜像仍需核对这些值，不可直接按名称或前缀删除。

## Windows 运行期交接

主会话应先核验 `result.complete`、真实 build exit 0、前后源 hash、artifact owner 和逐文件 hash，再自行安装导出的 `.next`。保留冻结 workspace 自己的 Windows `node_modules`、Prisma Client 和原 `public`，不复制 Linux node_modules 或 `.next/cache`。

Linux 生成的 JS/静态产物是否能在当前 Windows 运行环境下工作，必须由后续真实 HTTP、Next optimizer/Sharp 和 LOCAL 读写验证确认；本 helper 报告为 `windowsRuntime: not-verified`。若出现编译产物的路径或原生平台兼容问题，主会话可用 `--keep-builder` 重建并复用原缓存，在该 Linux image 内运行真实 Next 与隔离 DB/Worker/媒体 fixture。不要修改编译文件来迁就宿主路径，也不要把构建成功当作运行期验收。
