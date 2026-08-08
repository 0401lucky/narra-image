# 引入 Go 生成网关并清理旧实现

## Goal

在契约和运行保障稳定后，让 Go 承接外部 /v1 网关；验证通过后移除无生产引用的旧 Node 生成器。

## Requirements

- 仅迁移外部生成 API（images、edits、responses、chat 及 generation 查询），Next 页面/BFF、管理和鉴权边界继续保留。
- 当前阶段由 Next 薄代理继续完成 API Key、限流、积分扣减和入口 SSRF/输入校验；Go 接收带版本/签名的内部 envelope 并做防御性校验。
- 迁移必须支持灰度开关、回滚和旧入口并行验证；不得把公开 Go ingress 或用户域迁移偷偷并入本子任务。
- Go 网关不得绕过已认证请求的计费结果、媒体大小和渠道/模型契约。
- 提供 OpenAI 兼容 JSON/SSE、错误码、超时/取消和查询语义的跨实现回归测试。
- 只有新网关稳定且生产引用为零，才删除 `src/lib/providers/generate-images.ts` 等旧直连实现及仅为其保留的兼容代码。

## Dependencies

- 必须先完成 `worker-contracts` 和 `release-hardening`。
- `media-sync-boundary` 的 URL/存储契约完成后再切换 b64/url 响应路径。

## Acceptance Criteria

- [ ] Go 网关在灰度和回滚开关下与现有 Next 入口逐接口行为一致。
- [ ] Next→Go 内部 envelope 的版本、签名、认证结果、计费结果和拒绝路径测试全部通过。
- [ ] 明确列出的客户端矩阵覆盖 images/edits/responses/chat 的 JSON 与流式响应、超时、查询和回滚。
- [ ] 旧 Node 生成器无生产引用、无必要测试依赖后被安全删除，构建和全量测试通过。

## Out of Scope

- 不把 OAuth、Turnstile、用户资料、积分管理后台和页面渲染迁到 Go。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
