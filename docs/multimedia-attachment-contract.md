# Multimedia Attachment architecture contract（S0 proposal）

此文档定义后续实现契约，不表示已经支持二进制上传、对象存储、OCR、音视频解析或模型文件执行。当前 [Message](../packages/domain/src/conversation.ts) 只有 text content；provider submissions 的 material reference 只保存在 append-only import manifest，服务器不 dereference，只有 text 变成 Message evidence。不得把现有 provider URI 当成可下载 Attachment。

## Evidence and ownership

```text
Project -> Conversation -> Message（原始 text/actor/sequence 不变）
                             -> immutable MessageAttachment link -> Attachment
                                                                    -> derived preview/evidence
ContextItemVersion -> ContextCommit -> provenance(Message IDs + actor)
                                      -> linked Attachment / derivation lineage
```

- 每个 Attachment 归属一个 Project；最终 evidence binding 指向该 project 内同一个 Conversation 的一个 Message。本版不做跨项目/跨会话共享附件；复用字节不能复用授权。上传暂存资源没有 evidence 身份，也不能被 extraction 消费。
- MessageAttachment link 包含 projectId/conversationId/messageId/attachmentId、ordinal、linkedBy、linkedAt；复合外键和 application 校验共同保证所有对象同 scope。每个 Attachment 最多一个原始 message binding，多个 preview/derivation 可关联它。
- 推荐“先完成上传验证，再创建含 links 的 Message”，在同一 DB transaction 写 message、links、audit，并锁定 pending attachment binding。对既有 message 补附件必须新增一条 message/link 来表达追加证据，禁止修改旧 message content 或向既有语义快照追补隐形证据。
- server 由认证用户生成 uploader/linkedBy 和 project scope；不信任 browser/model 给出的 actor、scan verdict、verified hash、storage key。模型派生证据记录独立 model actor/run，不能冒充原作者。
- ContextItem 仍通过 `commitId` 和 provenance 中的 project/conversation/messageIds/actor 追溯；附件 ID 不能替代 messageIds。保留上传者、原 message author、派生工具/model actor、最终 authorized human committer 的不同责任。

## Immutable metadata contract

| 字段                                     | 约束与信任来源                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `schemaVersion`, `projectId`       | server 分配 ID、明确版本；项目授权后才创建                                                                                                                                                                                  |
| `uploadedBy`, `uploadedAt`, `verifiedAt` | server actor/clock；raw evidence metadata 封存后不可覆盖                                                                                                                                                                    |
| `originalFilename`                       | 保留原提交名称为 untrusted display metadata，限制长度；另生成安全下载名，去路径/控制字符；不能用作 storage path、HTML 或 shell 参数                                                                                         |
| `declaredMimeType`, `detectedMimeType`   | 分开保存声明与服务端检测；声明不决定可执行/内联权限；不一致按 allowlist 拒绝/隔离                                                                                                                                           |
| `mediaKind`                              | server 从检测 MIME 和策略归一为 image/audio/video/document/text/binary；unknown 默认为不可 preview/download-inline 的 binary；不代表任意类型已获准上传                                                                      |
| `byteSize`                               | 流式计数所得非负整数；与 intent 限额/实际对象长度核对；client 声明仅用于提前拒绝                                                                                                                                            |
| `checksum`                               | `{ algorithm: "sha256", value: hex }`，server 针对原始 bytes 计算；client checksum 仅预期值；不对其他项目暴露去重命中或按 hash 授权                                                                                         |
| `storageKey`, `storageVersion`           | server 生成的不可覆盖 object identity，内部可见；与 immutable checksum/size 绑定；public DTO 不返回 bucket/key/credential                                                                                                   |
| `metadata`                               | 有 schema 的有界 JSON，限制总 bytes/深度/键数；不能塞入秘密或执行指令；EXIF 等敏感 metadata 只在明确策略下展示                                                                                                              |
| `sourceReference`                        | 可选 import ID / 原 provider material locator 原样保留，并标为未验证外部引用；不自动抓 URL，不将上传物与外部引用混为同一事实                                                                                                |
| `previews`                               | 单独 immutable derivative records：previewId、sourceAttachmentId/hash、kind/MIME、size/checksum、dimensions/duration/pages（适用才填）、processor/version/options、createdAt/actor、internal storage identity；预览不是原件 |

public metadata 返回 attachmentId、scope/message linkage、受控 display filename、检测 MIME/mediaKind、size、checksum（仅 authorized project 内）、available preview IDs、当前可用性。下载地址短时按请求获取，不存永久 signed URL。宽高、duration、页数均来自隔离验证；不能把 client 提供的值当作资源预算保证。

## Lifecycle and consistency

将可变 upload operation 与 immutable evidence 分开：

```text
upload intent: pending -> uploading -> validating -> verified -> bound
                  \          \            \-> rejected/quarantined
                   +----------+-------------> expired (未绑定)
verified Attachment + immutable link -> available evidence
derived job: pending -> processing -> succeeded / failed（重试新增 attempt）
```

upload intent/processing projection 可变，状态变化写 append-only audit/events。Attachment 原始 bytes、封存 metadata、link、derivation 成功记录不可覆写；可用性/隔离/停用用 append-only lifecycle events 表示，读模型可更新，历史仍可解释。失败 preview 可重试但不能改变 source checksum；新版 preview 用新 ID，旧派生记录保留。

object store 与 PostgreSQL 没有原子跨库事务：先写不可覆盖临时对象，验证 hash/size/MIME 后准备 immutable object，DB transaction 再绑定 evidence。complete 使用 project+actor scoped idempotency key，重复相同输入返回同一结果，不同 hash/length/binding 冲突。事务失败对象成为 orphan，不得向用户返回“已提交”；清理任务只清理过期且未被 DB evidence 引用的 staging/orphan，处理在途 lease/race。若对象暂时不可读，保留 evidence 并返回明确 unavailable，不能伪造空附件。

归档项目/会话禁止新上传、complete/bind 和 processing 新请求；读取遵循现有 project:read 权限。撤销可用性不删除历史。任何真实原件删除/法规保留策略另需 ADR，不能用 cleanup 绕过 append-only。备份恢复必须核对 DB references 与 object versions/checksums。

## Authorization and API boundary

以下路由是拟议 contract，不是当前 endpoint。最终命名沿现有 `/api/projects/{projectId}/...` 风格，REST 不增加另一应用 API 范式。

| 操作            | 拟议边界                                                                            | 必须验证                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 创建上传 intent | `POST /api/projects/{p}/conversations/{c}/attachment-uploads`                       | 已认证、project membership、conversation 属于 p 且 active、Editor/Owner conversation:write；filename/type/declared size/count/quota；actor 由 server 决定          |
| 上传 bytes      | `PUT .../attachment-uploads/{uploadId}/content`                                     | 默认 server 代理流式上传；每次校验 project/conversation/upload owner、expiry、byte cap；不复用当前 JSON-only parseBody 或将大文件 base64 塞进 JSON                 |
| complete/验证   | `POST .../attachment-uploads/{uploadId}/complete`                                   | 再授权与归档状态；服务端读取实际对象并校验 bytes/MIME/hash/扫描；验证完成才可绑定；异步返回 processing，不能提前 ready                                             |
| 创建消息并绑定  | 既有 messages POST 的后续兼容扩展 `attachmentIds`                                   | message/link/audit 同事务；全部附件 verified、同 project/conversation/uploader、未绑定；idempotency 比较 content + ordered attachment IDs；不改变旧 text-only 请求 |
| 查询 metadata   | `GET /api/projects/{p}/attachments/{a}`                                             | project:read + a 属于 p + link scope；未绑定 intent 只对 uploader/受权运维可见；不存在与无权按既有 API 策略处理                                                    |
| 下载/preview    | `GET /api/projects/{p}/attachments/{a}/content`、`.../previews/{previewId}/content` | 每次/每个 Range 请求再检查 object-level scope、availability；preview 必须属于 a；私有缓存策略、nosniff、安全 Content-Disposition                                   |

默认选择授权后的 server proxy 下载以支持及时撤权。将来 presigned upload/download 必须单独记录安全取舍：限定一个 object/method/expiry/size/checksum（按 storage 能力），不授予 bucket/list 权限；URL 是短期 capability，已经发出的 URL 无法保证立即撤权。它不等于 storage secret，但不能宣称仅有 TTL 即实现实时授权。任何方案 browser 都不持有持久 storage secret。

每个 read/write/preview/download/processing 调用都需 object-level authorization，知道 UUID/storage key/checksum 不等于有权限。Viewer 仅 authorized read；Editor/Owner 上传证据不意味着有高风险 semantic commit 权限。权限、角色、配额不能依赖 UI 隐藏按钮、prompt 或 MIME 声明。保留同源 cookie/Origin 防护和 server-issued actor。

## Preview and model processing boundary

- Browser 只能使用受限原生 image/audio/video 展示或获取经过处理的 preview；不得 import Node-only parser/codec，不执行任何上传模型、脚本、宏、HTML/SVG active content。未知/主动内容默认附件下载而非同源执行。
- parser/codec 在 server 侧隔离处理器执行，有 CPU/memory/time/output bytes、像素/页数/duration 上限，拒绝超限/压缩炸弹/不支持格式；禁任意 URL fetch 与脚本执行；对象访问最小授权。原文件不作为 shell command 或可加载代码。
- 任意用户上传模型权重不是 ModelProvider 配置。Python 如需用于模型推理，仅置于外部 model-runtime API 后，所有远程模型请求通过 ModelProvider；domain/context-engine 不引入 provider 或 codec SDK。
- preview derivative 不自动成为事实；OCR/transcript/描述若供 extraction，必须持久化一条可追溯的 derived Message evidence 或另行评审的等价 evidence entity。本契约优先新增 derived Message，记录 source message/attachment/hash、processor/model run/version、页码/时间段 locator、生成时间与 actor，原 message 不改写。
- extraction 只消费显式选择、已验证且在 `throughMessageSequence` 内的 Message evidence；处理完成后出现的新 derived Message 需要新 extraction run/delta。提交后不能用最新 OCR 结果替换旧 commit 的证据。attachment upload、scan、preview、OCR 均不移动 HEAD；Delta/review/finalize 和高风险 human approval 语义保持现状。
- Message schema/API/domain provenance 若需扩展，由 A1/A2 单独版本化并做 runtime schema、PG composite FK、迁移与 round-trip 测试；不能在 strict schema 中偷偷加字段。

## Contract acceptance cases and owners

A1（domain/application/database/security）覆盖跨 project/conversation IDOR、别人的 upload ID、伪造 MIME/hash/actor、大小超限、过期/重复 complete、并发 bind、archive/revocation race、DB rollback/object orphan、追加原始 evidence 不变。空 PostgreSQL migrations 与 append-only/composite FK 测试不可用 SQLite 替代。

A2（infrastructure/model-runtime/security）覆盖 processor timeout/资源上限、恶意 active file、不可读 object、preview checksum/lineage、重试新 attempt、禁止 remote reference fetch、derived evidence 不改变旧 HEAD/commit/extraction cut。

A3（frontend/QA）覆盖上传进度/取消/重试、pending/quarantine/failed/unavailable 状态、下载/Range 撤权、键盘与可访问性、项目切换后不显示旧附件，以及 client graph 无 Node/storage/model SDK。实际限额、allowlist、storage provider 和部署资源由 A1/A2 在实现前配置化定稿，未定项不能默认无限制。
