# GHCR 镜像发布契约

## 1. 适用范围

- 修改 `.github/workflows/verify.yml` 的发布 job、`scripts/publish-images.mjs`、
  `scripts/lib/image-release.mjs`、镜像版 Compose 或更新说明时必读。
- 与 [Release Hardening](./release-hardening.md) 一起使用。CI/发布只操作构建和
  registry，不自动连接生产服务器、执行真实迁移或升级运行容器。
- 本地 mock、类型/构建通过不证明已发布；真实 Actions、认证 registry、匿名公开访问
  和部署验收分别记录。首次发布可能需要包所有者设置 Public。

## 2. 签名与入口

```text
node scripts/publish-images.mjs prepare
node scripts/publish-images.mjs finish

ghcr.io/0401lucky/narra-image-app:sha-<40位小写commit SHA>
ghcr.io/0401lucky/narra-image-worker:sha-<同一个SHA>
ghcr.io/0401lucky/<image>@sha256:<64位小写hex>
```

```js
assertReleaseContext({ repository, eventName, ref, sha, gates }); // {sha,tag}
prepareRelease(context, registry); // {sha,tag,images:{app,worker}}
finishRelease(context, { registry, anonymous, expected, mainSha, report });
new GhcrRegistry({ actor, token, fetcher }); // 不传凭据即匿名client
registry.resolve(image, sha, { missing: false }); // identity/manifest，缺失也抛错
registry.resolve(image, sha, { missing: true }); // 仅明确registry 404缺失时返回null
registry.promote(verifiedImage); // 写入相同manifest bytes，不重建
currentMainSha(jobToken, fetcher);
```

- `prepare` 只在有效 job 上运行，写入 `GITHUB_OUTPUT` 的 source_tag、各 image、
  build boolean 与已有 digest。已有且身份正确的 SHA tag 不覆盖、不重新构建。
- `finish` 接收 build action 输出或 prepare 复用的两个 expected digest；回调输出
  source SHA、tag、image references、anonymousAccess、promoted 列表和状态。
- 成功为 `published`；已过期 main 是 `stale-main-skipped`；异常为 `failed` 并非零
  退出。失败保留固定 tag 和部分状态；不能自动 DELETE 或回写旧 alias。

## 3. 工作流、凭据与内容契约

- 唯一 publisher 附加在现有 verify workflow，`needs` 必须是 verify-ci、
  verify-migrations、verify-e2e；GitHub 默认 success 门禁和 helper 内三项 result
  都需成功。只允许原仓库、push、refs/heads/main 与完整 SHA。
- 默认仅 contents:read；只有 publish-images job 授予 packages:write。
  PR/fork/其他ref/失败或跳过的检查不得到达登录或发布，不使用 pull_request_target、
  workflow_run 执行不可信产物、always() 或 continue-on-error 绕过。
- 发布 checkout 明确 github.sha，persist-credentials:false。Docker actions 固定
  官方 commit；只有 linux/amd64，两种镜像独立 cache scope；不改变 Node/Go 基础版本。
- job concurrency 是仓库级且 cancel-in-progress:false。排队顺序不作保证；alias
  更新前及每个包写入前重新检查当前 main，旧任务不能覆盖较新已发布的版本。
- 身份白名单限定两个镜像；SHA/digest 严格校验。实际 manifest/config bytes 的
  SHA256 必须匹配引用/响应 digest。OCI source/revision/licenses 分别匹配仓库URL、
  source SHA、AGPL-3.0-only，config必须 linux/amd64。
- 支持单manifest，或一个amd64 runtime加有限unknown-platform attestation的index；
  不能因为index标签就接受其他架构。当前 build action 关闭 provenance/sbom，不能
  宣称生成供应链证明。LICENSE/THIRD_PARTY_NOTICES 同时复制到两个最终运行镜像。
- registry使用固定 ghcr.io/token/v2；认证 client Basic 换取仓库 pull,push bearer，
  匿名client只请求pull且不接收GitHub凭据。禁止读取Docker登录缓存冒充匿名校验。
- metadata请求30s，最大2MiB；只对blob允许HTTPS到固定
  pkg-containers.githubusercontent.com跳转且移除Authorization。其他跳转拒绝；
  错误只报稳定错误码/状态，不能带token、签名URL或registry响应正文。
- 首先确认两个固定镜像存在且expected digest匹配，再独立校验匿名相同内容，最后
  才更新latest。Buildx/GHCR首次包创建、token权限仍需实际运行验收，mock不能代替。
- registry的两次latest写入不是事务，中间故障可能只完成一个。运维选同一成功摘要
  的SHA pair或两个digest，不把两次独立latest pull当原子版本选择。

### CI 与部署配置

- `createCiStages(environment)` 在tsc之前显式生成Prisma；失败停止后续步骤。
  最后Next build才加合成生产APP_URL/AUTH_SECRET/DB/provider占位；不进入先前测试。
  该环境不是生产运行配置，也不授权读取实际dotenv。
- scripts/lib 的 shared disposable DB helper 必须用容器内 `pg_isready --host 127.0.0.1 --port 5432`，
  跳过初始化仅Unix socket的临时服务；保留原20s窗口、1s probe和owner/no-volume清理。
  standalone worker-contracts DB runner 尚有独立socket probe，作为既有问题另行处理，
  不能把shared helper的验证结果宣称为该runner已修复。
- `docker-compose.images.yml` 只覆盖migrate/app的APP_IMAGE、worker的WORKER_IMAGE，
  以!reset null去除继承build。两个selector必须显式设置；Compose2.24.4+实际合并
  后检查无build且其余service/env/volume/dependency/health不变。
- 文档必须先拉固定镜像，保留原project name/.env，备份后graceful stop，再forward
  migration成功才启动worker/app并验ready。不静默升级db镜像、seed/repair、删卷。
  回滚先用当前版本运维binary预检，旧镜像不意味着回退数据库schema。

## 4. 校验与错误矩阵

| 条件 | 必须行为 |
| --- | --- |
| 非原仓库/main push/完整SHA | UNTRUSTED_RELEASE，不访问registry |
| 任一required gate非success | UNVERIFIED_RELEASE，无登录/发布 |
| 已有SHA tag身份一致 | 复用原digest；不可因基础tag变化覆盖它 |
| 明确404且MANIFEST_UNKNOWN/NAME_UNKNOWN | 仅prepare允许判missing并构建 |
| 401/403、网络/超时、泛化404、无效JSON | 非missing失败，禁止覆盖或promote |
| 实际metadata与digest不一致 | REGISTRY_DIGEST_MISMATCH |
| 平台/source/revision/license不符 | INVALID_PLATFORM或IMAGE_IDENTITY_MISMATCH |
| 两个固定镜像未齐或expected非法 | finish失败，latest不更新 |
| 匿名401/403或404 | PUBLIC_ACCESS_REQUIRED，给对应包settings/Public入口 |
| 匿名503或其他非权限错误 | 保留HTTP/network故障，不误导修改可见性 |
| main已经更新 | stale-main-skipped，不移动latest |
| alias写入中途失败/main变化 | failed，记录已promoted列表，不虚报整组成功或删除镜像 |
| 缺APP_IMAGE/WORKER_IMAGE | Compose配置失败，不回退本地构建 |

首次包默认Private。所有者可在包settings切换Public并检查仓库访问授权，再
Re-run failed jobs；不需要新增PAT secret或臆造可见性API。

## 5. Good / Base / Bad

- Good：三项验证成功，同SHA两个镜像/匿名digest检查后promote，部署使用摘要固定配对。
- Base：首次私有包上传保留SHA tags，Public设置完成后重跑复用，不重新覆盖。
- Bad：把denied当不存在、用登录后的pull当公开证明、把旧任务覆盖latest视为正常。
- Bad：跳过红色migration、靠固定sleep掩盖ready race、向生产服务器自动运行更新脚本。

## 6. 必需测试

- `scripts/tests/ci-prerequisites.test.mjs`：generate在tsc前，失败停止，build env不泄漏；
  init socket可用/TCP未ready负例、原截止和异常传播。
- `scripts/tests/image-release.test.mjs`：PR/fork/ref/gates否决、首次missing/auth拒绝、
  固定tag复用、metadata/platform/digest校验、匿名/认证隔离、redirect凭据移除、
  超体积、503与Public区分、过期main/部分promote、CLI输出接线和job最小权限。
- 实际clean-client副本：先tsc复现缺client，generate再tsc成功；无DB/auth/APP_URL也
  能生成。不要只用已有生成client通过来证明干净CI修复。
- 实际Compose解析与缺selector负例；实际owned DB启动后立即建库查询，无sleep，
  清理只涉及该轮精确资源。Windows/Linux/远程证据分别报告。
- 本地非DB全量/类型/lint/build与首次授权GitHub Actions/GHCR验证分开；公开成功需
  no-login manifest/平台/digest证据，生产运行另行验收。

## 7. 错误与正确示例

```js
// Wrong: auth failure is not permission to rebuild an immutable tag.
try { return await lookup(tag); } catch { return buildAndPush(tag); }

// Correct: only explicit registry not-found permits missing-source build.
const existing = await registry.resolve(image, sha, { missing: true });
if (existing) return existing.digest;
// A separate build action creates only the missing fixed tag.
```

```text
Wrong: push App latest -> build Worker -> ignore red migration -> pull latest twice
Correct: all gates -> both fixed SHA images -> anonymous matching digests
         -> current-main fence -> aliases; deployment uses one fixed digest pair
```
