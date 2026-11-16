# LOCAL 图片文件层接口

实现责任：`image_local_io`；集成执行者已确认命名和格式。这里只处理文件，不读取环境、不计算数据库额度，不判断用户或媒体引用。

## 共享格式

- 配置：Node `{rootDirectory, volumeId}`；Go `LocalImageStoreConfig{RootDirectory, VolumeID}`。根目录必须是已存在的绝对目录，不能是符号链接或文件系统根。卷 ID 为规范的小写 UUID。
- 初始化是显式动作，只允许空的未标记目录；已有正确标记可以重开，错误/损坏/符号链接标记拒绝。`verify` 只读，不能创建目录、标记或清理文件。
- 卷标记文件 `.narra-image-volume-v1`，精确 UTF-8 字节为 `narra-image-volume-v1\n<UUID>\n`。位置 ID 为 `local-v1:<UUID>`。
- 逻辑 key 为最多 512 个 ASCII 字节的安全 namespace 段，每段最多 128 字节，以字母或数字开头，后续允许字母、数字、点、下划线或连字符。不允许空段、`.`/`..`、反斜杠、冒号或百分号编码。
- 物理文件名为 `image-<sha256(UTF-8 logical key)>.bin`，直接位于卷根；不把逻辑 key 当磁盘路径。
- 本次写入暂存名为 `.image-<同一 key digest>.writing`。排他创建，写入/校验/fsync 后以不覆盖的硬链接发布最终文件，随后只移除本次拥有的暂存文件。
- 暂存名可由已登记 key 唯一推导。进程崩溃留下它时，read/head/delete 报 `LOCAL_IMAGE_WRITE_PENDING`，不能把最终文件不存在误报成已释放空间。后续协调必须先排除/隔离旧写入者，Verify 不做 sweep。
- open/read/head/delete 对最终文件的缺失观察必须再次核实卷标记、暂存名与取消信号；不能仅凭打开之前的暂存检查返回 NOT_FOUND/missing，因为并发写入者可能在两次文件系统操作之间创建暂存。成功打开后也再次检查暂存，避免 HEAD 与流式读取使用不同的发布边界。
- 图片大小使用共享 `MAX_IMAGE_BYTES` / `ImageMaxBytes`，所有对象操作都要求已登记的 `key, byteLength, sha256`。摘要固定小写 SHA256 十六进制。
- UUID、摘要与 key 段均拒绝末尾换行（包括 CR、LF、U+2028、U+2029）；Node 校验使用绝对字符串结尾，不能依赖 JavaScript `$` 的行尾特例放行 Go 无法接受的身份。

## Node

`createLocalImageStore(config)` 返回 `LocalImageStore`；`initializeLocalImageVolume(config)` 显式初始化。

- `verify(signal?) → {volumeId,locationId}`
- `probeWritable(signal?) → {volumeId,locationId}`：显式创建一个排他的随机零字节 `.narra-image-probe-*` 文件，以 `.linked` 后缀的第二个精确路径验证硬链接发布、同一文件身份和不覆盖已有目标（再次 link 必须报 EEXIST），随后独立尝试关闭和清理这两个已拥有路径；没有目录扫描/重试。探测不属于图片额度，任意链接、清理或描述符错误都会使能力探测失败。可写 readiness 使用此方法，不把只读 Verify 当作写权限证明。
- `put({key,bytes,byteLength,sha256,signal?}) → {byteLength,sha256}`
- `open({key,byteLength,sha256,signal?}) → {stream:Readable,byteLength,sha256,close}`：固定大小 chunk、实际字节数和摘要校验，结束/取消时关闭文件和目录资源。
- `read(input) → Buffer`：使用相同的有界 open/stream 读取并验证，适合必须返回内存图片的 provider 调用。
- `head(input) → {byteLength,sha256}`：安全打开后验证已登记长度；SHA256 来自已登记身份，内容读取时再次核验。
- `delete(input) → "deleted" | "missing"`：精确文件、常规文件类型与内容身份核验后删除；暂存存在/身份异常不删除。

所有错误为 `LocalImageStoreError`，仅暴露稳定 code，不包含服务器路径。每项操作重新验证卷标记；Linux 使用打开的目录描述符固定根，其他平台同时复核根和对象 identity，部署目录必须仅由服务管理。

## Go

`NewLocalImageStore(config) (*LocalImageStore,error)`；`InitializeLocalImageVolume(ctx,config)`。对象参数 `LocalImageObject{Key,ByteLength,SHA256}`，写入参数 `LocalImagePutInput{LocalImageObject,Bytes}`。方法为 `Verify/ProbeWritable/Put/Open/Read/Head/Delete`，均接受 `context.Context`。Open 返回带有元数据的 `LocalImageReader`（实现 `io.ReadCloser`）；Delete 返回明确 deleted/missing outcome。

Go 使用 `os.Root` 约束所有平面文件操作，禁止跟随卷标记/对象符号链接；`Root.Link` 要求 Go 1.25（已与集成执行者协调 go.mod 最低版本）。两个实现共用上述磁盘格式，接受对方初始化和写入的文件。Go 的 ProbeWritable 同样验证两个零字节路径的硬链接、不覆盖与精确清理。

部署文件系统必须支持硬链接、不覆盖目标的 Link 语义和持久化刷新。Node 和 Go 各自在真实运行 UID 下执行可写能力探测；文件权限为 0600，共用卷时两端的 UID/权限必须支持相互读取与删除。已经要求集成执行者检查两端 readiness，不能只用初始化进程/root 的成功结果代替应用 UID 的能力。

## 恢复与边界

PUT、DELETE 出错不等于数据库可以释放预留；调用者依据实际 IO 阶段和 UNKNOWN 契约完成回执。复制/删除的数据库锁、取消令牌、旧写入者 fence 和未知状态协调由统一 repository/executor 负责。文件层不会让过期 lease 自行释放字节，也不接受全目录删除。
