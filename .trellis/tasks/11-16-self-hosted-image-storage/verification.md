# Database Image Storage Verification

## Result

显式数据库存图修复与候选镜像已通过检查；用户已授权先推送 GitHub 再部署，真实生图由用户自行验收。

- 候选 image ID：`sha256:2ad1448481ba67f41447cc0e169aea94c6234200b6bfdb2a8caf6182dd69f4fb`，`linux/amd64`。
- 源码快照：`c8d5df6b289416708f5255c5664b6924c1df72dc36cb861cf904c970bdd4c455`。
- 原生产镜像、容器与配置保持原状；候选构建及测试只使用已有基础镜像、无生产凭据与断网临时容器。

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Go 新增回归在旧存储分支运行 | 预期失败 | `checks/implementation/20261116T014111-opt-in-before.json` |
| Go full Worker tests / vet / build | PASS | `checks/implementation/verification.md` 与独立机器回执 |
| Node 定向 Vitest（8 个文件、50 个测试） | PASS | `deployment/build.log` |
| Linux ESLint | PASS | 同一日志的 Step 6 完成并继续下一步 |
| 完整 Next production build | PASS | 同一日志的完整 route 输出及 Step 14 完成 |
| 独立 `tsc --noEmit` | PASS | 同一日志的 Step 15 完成 |
| Linux Go 存图/规范化/配置（11 个测试函数） | PASS | `deployment/linux-storage-tests.log` |
| 候选三项运行二进制字节身份 | PASS | `deployment/build-result.json` |
| Compose 合并 dry-run | PASS，仅 image 与数据库存图开关有差异 | `deployment/configuration-diff.json` |
| 全范围代码审核 | PASS，无未修复范围内问题 | `checks/review/final-review.json` |

最终 Node 检查使用仓库固定的 TS Worker 契约目标集，直接调用基础镜像内既有匹配版本的 Vitest；Go wrapper 的 vet/test 原始阶段等价命令已执行。没有声称执行新的 GitHub Actions、registry 发布或 disposable DB wrapper。

## Failure and Recheck

首次候选 `edb331209c83` 的 Vitest/ESLint/Next 构建通过，但独立 tsc 发现新负例 `parseEnv` 对象缺少必须的 `NODE_ENV`（TS2345）。添加明确的开发环境字段后，重新绑定源码、重跑定向测试/lint/完整构建/独立 tsc，生成上述最终候选。旧失败回执保存在 `deployment/build-failed-tsc.log`，未替换为成功结论。

日志/回执原始字节哈希见 `deployment/evidence-hashes.json`；Git 中将原始机器日志无损保存为 `.log.gz`，解压后与哈希逐字节一致，避免将工具进度输出的行尾空格改写为作者文本。source/binary manifest 位于 task-local ignored artifacts，12 项相关文件的审核字节身份另存于 `checks/review/source-hashes.json`。

## Limits and Remaining Work

- Windows Docker Linux daemon 不可用；未启动系统服务或拉取新基础镜像。此任务无 schema 变更，使用原有 TEXT/B64 形态；disposable DB wrapper 未执行，真实数据库存图需上线后单独验收。
- 视频、Canvas 原图、历史失败恢复不在范围内。`/v1/images/edits` 的 HTTP(S)-only / 1 MiB 参考图输入限制仍存在；Web 文件参考图经数据库队列可以使用 B64。
- 用户已授权 GitHub 推送及生产部署；等待对应 CI/镜像发布后完成上线与就绪检查。助手不生成真实图片。上线差异及回滚步骤见 `deployment/rollout-plan.md`，提交文件范围见 `commit-plan.md`。
