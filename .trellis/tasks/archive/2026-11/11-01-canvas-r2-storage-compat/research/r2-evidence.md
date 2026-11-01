# R2 兼容性证据

- 官方兼容表：https://developers.cloudflare.com/r2/api/s3/api/ （读取于 2026-11-01，页面更新于 2026-10-14）。`HeadBucket` 已实现；`GetBucketVersioning` / `PutBucketVersioning` 未实现。
- 官方端点与地域：https://developers.cloudflare.com/r2/reference/data-location/ （读取于 2026-11-01）。支持默认账户端点与 `eu`、`fedramp`、`us` 地域账户端点。
- 原会话后续只读探测：现网 `narra-app` healthy、readiness 200；R2 同一配置下 HeadBucket 200、GetBucketVersioning 403；Canvas migration 已完成，功能开关未设置。
- 实现位置：Node `src/lib/canvas/storage.ts:createCanvasStorageAdapter` / `verifyCanvasStorageCapability`；Go `worker/internal/worker/canvas_gc_storage.go:Verify`；启用态 readiness 两边均要求成功的存储证明。
- 原错误不证明凭据失效，也不能通过把任意 AccessDenied 当作无版本来修复。官方端点范围 + 认证目标 bucket HEAD 成功构成新的 R2 专用证明；普通 S3 保留原始 XML 证明。
- 初始用户文件哈希：`.gitignore` = `CCE51018CC0C483C78C950E4F7057A98CEBA29FAA3C4508C779694743BDFA95F`；`.serena/project.yml` = `EEE6A3F00746F9E747AC3BB3376D145FB4E12BF5F8B4D5A2DAF903BB08A41638`。
