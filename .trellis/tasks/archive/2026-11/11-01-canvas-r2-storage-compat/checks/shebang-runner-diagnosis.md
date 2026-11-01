# Windows shebang / Vite SSR 失败诊断

## 结论

集成验证中的 5 个 suite 加载失败来自 Vite 8.0.9 对 CRLF shebang 的转换问题，不是 R2 存储逻辑回归。三个被导入的 `.mjs` 在 Git 中为 LF，本地 Windows checkout 为 CRLF；原始 CRLF 字节直接通过 Node 24.22.1 语法检查。

## 原因与对照

Vite 的 `getFileStartIndex` 使用 `/^#!.*\n/`。正则中的 `.` 不匹配 `\r`，因此 CRLF shebang 未被识别，导出绑定被插入到文件开头、shebang 之前。后续只有首字符为 `#` 时才移除 shebang；CRLF 转换结果的 `#!` 留在代码中部，Vitest 将代码放入 async 包装后抛出 `SyntaxError: Invalid or unexpected token`。

对同一最小模块只替换行尾，调用当前安装版本的真实 `moduleRunnerTransform`，再按运行器规则编译：

| 行尾 | fileStartIndex | 运行器编译 |
|---|---:|---|
| LF | 20 | 通过 |
| CRLF | 0 | 同样的 SyntaxError |

转换前缀与结果保存在 `shebang-transform-20261101.stdout.log`。三个真实脚本的 CRLF 原字节均通过 Node `--input-type=module --check`，见 `shebang-node-check.json`。

## 修复范围

`.gitattributes` 只为三个已确认的入口增加：

```gitattributes
scripts/verify-canvas-contracts-db.mjs text eol=lf
scripts/verify-e2e.mjs text eol=lf
scripts/fixtures/canvas-object-store.mjs text eol=lf
```

没有全局修改 Git 配置，没有移除 shebang、跳过测试或改写断言。主会话已规范化根目录三个副本；逐个与 `git show HEAD:<path>` 字节完全一致，因此三个脚本没有源码内容 diff。`git ls-files --eol` 现在均为 `i/lf w/lf attr/text eol=lf`，原有取证与许可文件规则保持不变。

## 验证记录

- 失败回执：`test-20261101T081157236998Z.json`，5 个 suite 加载失败；原始日志保留。
- 隔离 app 只更改三个脚本的行尾后，原失败的 5 个 suite / 110 个测试全部通过：`test-20261101T082031797800Z.json`，exit 0，8.703 秒。
- 精确实验字节与哈希：`shebang-line-ending-before/*.before`、`shebang-line-ending-experiment.json`；根目录归一化证据：`shebang-normalization.json`。
- 修复后的 `.gitattributes` 范围及 `git diff --check` 已复核。隔离 app 保留 LF 副本；主会话重跑完整 suite，最终验收使用该完整回执，不能将先前的部分通过数合并为全量通过。
