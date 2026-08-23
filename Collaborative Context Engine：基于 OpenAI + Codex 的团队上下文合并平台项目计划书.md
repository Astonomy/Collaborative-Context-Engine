# Collaborative Context Engine

## 基于开源 AI 平台与 Codex 兼容工具链的团队上下文合并平台项目计划书

## 1. 项目概述

### 1.1 项目名称

暂定：

**Collaborative Context Engine（CCE）**

产品层名称可后续调整为：

- ContextHub
- MergeContext
- TeamContext
- ContextOS
- BranchAI

技术核心名称建议长期保留：

**Semantic Context Merge Engine**

---

## 1.2 项目目标

项目解决的问题不是：

> 如何把两个聊天记录简单拼起来。

而是：

> 当多个团队成员分别与 AI 工作时，如何将他们产生的事实、决策、需求、任务、假设和成果持续合并为一个一致、可审计、可继续被 AI 使用的项目上下文。

最终系统应支持：

```text
Multiple Humans
      +
Multiple Conversations
      +
Multiple Models
      +
Multiple Agents
      ↓
Versioned Shared Project Context
```

系统演进路线：

```text
开源 AI Web Chat / ChatGPT Shared Project
        ↓
自建 Web Chat
        ↓
Conversation Branch
        ↓
Context Delta
        ↓
Semantic Merge
        ↓
Multi-model
        ↓
Context Router
        ↓
Manager Agent
        ↓
Specialist Agents
```

---

# 2. AI 平台选择

## 2.1 推荐平台：以 Qwen 为主的开源模型平台

考虑开源程度、社区资源、中文生态和后续可替换性，第一阶段不再以 OpenAI 作为唯一平台，而建议采用：

```text
Qwen 开源模型
+
Hugging Face Transformers
+
vLLM
+
ModelScope
+
OpenAI-compatible API
```

其中：

- **Qwen** 作为首选模型家族；
- **Hugging Face Transformers** 作为通用模型加载与训练生态；
- **vLLM** 作为高性能推理服务；
- **ModelScope 魔搭社区** 作为中文社区和国内模型资源入口；
- **OpenAI-compatible API** 作为统一调用协议；
- **LangChain / LlamaIndex / Dify / FastGPT** 作为可选的社区集成层，而不是核心数据层。

推荐架构：

```text
Qwen Open Models
        ↓
Transformers / ModelScope
        ↓
vLLM Inference Server
        ↓
OpenAI-compatible API
        ↓
CCE Model Adapter
        ↓
Context Engine
```

选择 Qwen 的主要原因：

1. **开源程度较高**\
   Qwen 系列模型提供开放权重，并拥有较完整的模型卡、推理方式和部署文档，适合自托管、私有化部署和二次开发。

2. **中文能力和中文社区资源较强**\
   Qwen 在中文理解、中文生成、代码和多语言任务方面具有较好的综合表现；ModelScope、GitHub、知乎、掘金、CSDN、B 站和国内开发者社区中都有较多实践资料。

3. **部署工具成熟**\
   Qwen 可以通过 Transformers、vLLM、SGLang、Ollama、llama.cpp 等多种工具运行，便于从本地开发逐步扩展到 GPU 服务。

4. **兼容 OpenAI API 风格**\
   通过 vLLM 等推理服务可以提供 OpenAI-compatible API，因此 CCE 不需要把业务逻辑绑定到某一家商业 API。

5. **适合中文团队和私有数据场景**\
   项目中的聊天记录、决策、需求和内部文档可能包含敏感信息。自托管模型可以减少数据离开团队基础设施的情况。

6. **便于构建多模型路由**\
   可以根据任务选择不同规模的 Qwen 模型，也可以在后续接入 DeepSeek、GLM、InternLM、Llama、Mistral 等模型。

---

## 2.2 不建议第一阶段绑定单一商业平台

第一阶段不建议直接构建：

```text
OpenAI-only architecture
```

也不建议一开始同时深度绑定：

```text
OpenAI
Anthropic
Google
```

更合理的方式是：

```text
OpenAI-compatible Model Adapter
```

第一阶段可以使用：

```text
Qwen 本地模型
Qwen 云端服务
OpenAI-compatible hosted model
```

随后通过 Provider Adapter 扩展：

```text
OpenAI
Anthropic
Gemini
DeepSeek
智谱 GLM
InternLM
Llama
Mistral
```

核心原则是：

```text
CCE Context Engine
不依赖任何单一模型供应商
```

---

## 2.3 推荐的开源 AI 技术链

```text
Model Layer
Qwen / DeepSeek / GLM / InternLM / Llama

Model Runtime
Transformers
vLLM
SGLang
Ollama
llama.cpp

Model Registry
Hugging Face
ModelScope

Application Framework
Next.js
TypeScript
OpenAI-compatible SDK

Agent Framework
LangGraph
LlamaIndex Workflows
AutoGen
CrewAI
或自建 Agent Runtime

Data Layer
PostgreSQL
JSONB
pgvector
```

第一阶段不需要同时引入所有框架。

推荐最小组合：

```text
Qwen
+
vLLM
+
OpenAI-compatible API
+
Next.js
+
TypeScript
+
PostgreSQL
+
pgvector
```

---

## 2.4 Agent 框架选择

由于项目强调开源程度和中文社区资源，Agent 层不建议第一阶段绑定某个商业平台专属 SDK。

推荐优先评估：

### LangGraph

适合：

```text
状态机
工作流
人工审批
可恢复执行
多 Agent 协作
```

### LlamaIndex Workflows

适合：

```text
文档处理
检索
知识库
事件驱动工作流
```

### AutoGen

适合：

```text
多 Agent 对话
角色协作
实验性 Agent 编排
```

### Dify / FastGPT

适合：

```text
快速验证产品交互
中文社区部署
低代码工作流
```

但 Dify 和 FastGPT 不应直接成为 CCE 的核心领域模型。它们可以作为：

```text
Prototype UI
Workflow Integration
Community Reference
```

而 CCE 的核心仍然必须由自己的：

```text
Context Engine
Context Commit
Semantic Merge
Audit Layer
```

负责。

推荐第一阶段：

```text
自建 Context Engine
+
自建简单 Agent Workflow
```

第二阶段再根据实际需求引入：

```text
LangGraph
或
LlamaIndex Workflows
```

---

## 2.5 模型平台抽象

CCE 不应直接依赖 Qwen 的具体调用方式。

统一抽象为：

```typescript
interface ModelProvider {
  createResponse(input: ModelInput): Promise<ModelResponse>;

  continueConversation(
    conversationId: string,
    input: ModelInput
  ): Promise<ModelResponse>;

  streamResponse(
    input: ModelInput
  ): AsyncIterable<ModelEvent>;

  createEmbedding(
    input: EmbeddingInput
  ): Promise<EmbeddingResponse>;
}
```

实现：

```text
QwenVllmProvider
QwenModelScopeProvider
OpenAICompatibleProvider
DeepSeekProvider
GLMProvider
AnthropicProvider
```

其中：

```text
QwenVllmProvider
```

是第一阶段默认实现。

---

## 2.6 推荐模型配置

Qwen 模型应根据实际显存、延迟和任务复杂度选择，不应把模型名称硬编码到业务逻辑中。

推荐抽象为：

```text
small
medium
large
```

例如：

```text
small:
Qwen 小参数模型
用于分类、去重、简单抽取

medium:
Qwen 中等参数模型
用于普通聊天、上下文抽取、任务规划

large:
Qwen 大参数模型
用于复杂冲突分析、架构评审、复杂规划
```

如果使用云端模型，也可以配置：

```text
fast
balanced
reasoning
```

推荐路由：

### User Chat

```text
balanced
```

### Context Extractor

```text
balanced
Structured Output
```

### Dedup / Simple Classification

```text
small
```

### Complex Conflict Resolver

```text
large
```

### Manager Agent

```text
balanced
```

复杂 Project：

```text
large
```

形成：

```text
small
cheap processing
       │
medium
normal reasoning
       │
large
escalation
```

而不是所有请求都使用最大模型。

---

## 2.7 中文社区资源策略

为了获得更广泛的中文社区资源，项目应优先关注以下生态：

```text
ModelScope 魔搭社区
Hugging Face 中文用户社区
Qwen GitHub 社区
DeepSeek 开发者社区
智谱 GLM 开发者社区
InternLM 社区
OpenMMLab 社区
Dify 社区
FastGPT 社区
LangChain 中文社区
LlamaIndex 中文社区
```

文档和工程实践应同时维护：

```text
docs/zh-CN/
docs/en/
```

第一阶段至少提供：

```text
中文 README
中文部署文档
中文模型配置说明
中文故障排查文档
中文 Eval 数据说明
```

---

## 2.8 平台角色划分

需要避免一个常见架构错误：

> 把模型服务的 Conversation 当成项目数据库。

本系统必须规定：

```text
CCE PostgreSQL
=
Source of Truth
```

模型服务中的会话状态：

```text
=
Model Runtime State
```

即：

```text
Project State
      ↓
CCE Database
      ↓
Context Builder
      ↓
Model Provider
      ↓
Qwen / Other Model
```

而不是：

```text
Model Conversation
      ↓
决定项目状态
```

这样未来：

```text
Qwen
DeepSeek
GLM
OpenAI
Anthropic
Gemini
Local LLM
```

都可以替换，而项目历史不会丢失。

---

# 3. 产品的核心抽象

项目一开始就定义以下六个核心对象：

```text
Project
Conversation
Branch
ContextItem
ContextCommit
MergeConflict
```

这是整个系统最重要的设计。

---

# 4. Project

Project 表示团队共同工作的逻辑空间。

例如：

```json
{
  "id": "proj_01",
  "name": "CCE",
  "goal": "Build collaborative AI context engine",
  "context_head": "commit_038"
}
```

一个 Project 包含：

```text
Project
├── Members
├── Conversations
├── Branches
├── Context Items
├── Context Commits
├── Files
├── Tasks
├── Agents
└── Audit Events
```

---

# 5. Conversation

Conversation 仍然保存完整聊天。

```text
Conversation A
User
Assistant
User
Assistant
...
```

但 Conversation **不是项目知识本身**。

它属于：

```text
raw evidence
```

Conversation 的作用主要是：

1. 保留原始信息；
2. 保留 provenance；
3. 允许继续聊天；
4. 为 Context Extractor 提供输入；
5. 发生争议时回到原始记录。

---

# 6. Branch

每次新的聊天实际上视为一个：

```text
Context Branch
```

例如：

```text
Project Context V12
        │
 ┌──────┼──────────┐
 │      │          │
Alice  Bob       Carol
 │      │          │
Chat A Chat B    Chat C
```

三个人都基于：

```text
Context V12
```

开始工作。

最后分别得到：

```text
Delta A
Delta B
Delta C
```

---

# 7. ContextItem

这是整个项目最重要的数据结构。

不要只保存：

```text
summary: string
```

而要结构化表示。

推荐类型：

```text
fact
decision
requirement
assumption
constraint
task
question
risk
artifact
preference
rejected_option
```

示例：

```json
{
  "id": "ctx_123",
  "project_id": "proj_01",

  "type": "decision",

  "key": "database.primary",

  "value": {
    "technology": "PostgreSQL"
  },

  "status": "accepted",

  "confidence": 0.96,

  "created_by": "user_01",

  "source": {
    "conversation_id": "conv_12",
    "message_ids": ["msg_31", "msg_32"]
  },

  "supersedes": null
}
```

---

# 8. ContextCommit

ContextCommit 相当于 Git commit。

例如：

```text
Context Commit C038

Author:
Alice

Conversation:
Database Design Chat

Changes:

+ database.primary = PostgreSQL
+ database.vector = pgvector

? Redis 是否必要
```

结构：

```json
{
  "id": "commit_038",
  "project_id": "proj_01",
  "parent_id": "commit_037",
  "author_id": "user_01",
  "changes": [],
  "created_at": "..."
}
```

---

# 9. Context Delta

每个聊天结束后不要重新总结整个 Project。

只生成：

```text
Context Delta
```

Schema：

```json
{
  "base_context_version": "commit_037",

  "added": [],

  "modified": [],

  "deprecated": [],

  "open_questions": [],

  "tasks": []
}
```

例如：

```json
{
  "added": [
    {
      "type": "decision",
      "key": "database.primary",
      "value": "PostgreSQL"
    }
  ],

  "open_questions": [
    {
      "key": "database.vector",
      "value": "Evaluate pgvector"
    }
  ]
}
```

---

# 10. Semantic Three-Way Merge

本项目真正的核心算法应该是：

**Semantic Three-Way Merge**

借鉴 Git：

```text
              Base
             V12
             / \
            /   \
       Branch A Branch B
          ↓        ↓
        Delta A  Delta B
            \    /
             Merge
               ↓
             V13
```

输入：

```text
Base Context
Current Context
Branch Delta
```

输出：

```text
Clean Changes
Conflicts
Warnings
```

---

# 11. 冲突分类

不能只判断：

```text
key 相同 = conflict
```

至少区分：

### C0：No Conflict

```text
A:
database = PostgreSQL

B:
deployment = Docker
```

直接合并。

---

### C1：Compatible Expansion

```text
A:
database = PostgreSQL

B:
database extension = pgvector
```

通常可以自动合并。

---

### C2：Potential Conflict

```text
A:
deployment = Docker Compose

B:
deployment = Kubernetes
```

需要 AI 判断两者是不是：

```text
development vs production
```

还是直接冲突。

---

### C3：Direct Conflict

```text
A:
database = PostgreSQL

B:
database = MySQL
```

必须进入 Merge Review。

---

### C4：Temporal Supersession

```text
2026-08-01
database = PostgreSQL

2026-08-20
migrated database = CockroachDB
```

不是冲突，而是：

```text
PostgreSQL
   ↓ superseded_by
CockroachDB
```

---

# 12. Merge Review UI

Web MVP 最核心的 UI 不是聊天框。

而是：

```text
Merge Request
```

例如：

```text
┌──────────────────────────────────────────┐
│ Context Merge #42                        │
├──────────────────────────────────────────┤

Current

database.primary
PostgreSQL

Proposed

database.primary
MySQL

Source
Alice / Database Discussion / Message 32

AI Analysis

These two values represent competing
primary database choices.

[ Keep Current ]

[ Accept Proposed ]

[ Keep as Alternatives ]

[ Edit Manually ]
```

这个页面才是产品区别于普通 AI Chat 的核心。

---

# 13. Web MVP 架构

推荐统一使用：

**TypeScript**

而不是：

```text
React + Python + another agent language
```

原因：

- 前端 TypeScript；
- OpenAI-compatible Node SDK；
- LangGraph 或自建 Agent Workflow；
- Zod schema；
- 前后端共享类型；
- Codex 修改代码时跨语言上下文更少；
- 更容易接入 Qwen、DeepSeek、GLM 等兼容 OpenAI API 的模型服务。

架构：

```text
Browser
   │
   ▼
Next.js Web
   │
   ├── Chat UI
   ├── Project UI
   ├── Context UI
   ├── Merge Review
   └── Agent Runs
   │
   ▼
Application Services
   │
   ├── ConversationService
   ├── ContextService
   ├── MergeService
   ├── ModelService
   └── AgentService
   │
   ▼
PostgreSQL
```

---

# 14. 推荐技术栈

## Frontend

```text
Next.js
TypeScript
React
Tailwind CSS
```

---

## Backend

MVP 可以直接：

```text
Next.js Server
```

而不是一开始单独拆 microservices。

内部模块化即可：

```text
src/server/
```

未来性能需要再拆。

---

## Database

```text
PostgreSQL
```

原因：

Context Item 本质是高度结构化数据。

推荐：

```text
PostgreSQL
+
JSONB
+
pgvector
```

不要第一版引入独立 Vector DB。

---

## Object Storage

文件后续使用：

```text
S3 compatible storage
```

MVP 可先本地/托管对象存储。

---

## AI Runtime

推荐默认使用：

```text
Qwen
+
vLLM
+
OpenAI-compatible API
```

本地开发可以使用：

```text
Ollama
```

国内或中文团队部署可以优先评估：

```text
ModelScope
+
vLLM
```

如果暂时没有 GPU，也可以通过兼容接口接入：

```text
Qwen 云端服务
DeepSeek
GLM
OpenAI
Anthropic
Gemini
```

但所有调用都必须经过：

```text
ModelProvider
```

---

# 15. 模型配置

模型名称不应直接散落在业务代码中。

推荐配置：

```text
MODEL_PROVIDER=qwen-vllm
MODEL_CHAT_MODEL=qwen-medium
MODEL_EXTRACTOR_MODEL=qwen-medium
MODEL_CLASSIFIER_MODEL=qwen-small
MODEL_RESOLVER_MODEL=qwen-large
MODEL_EMBEDDING_MODEL=embedding-model
```

### User Chat

```text
default:
qwen-medium
```

### Context Extractor

```text
qwen-medium
Structured Output
```

### Dedup / Simple Classification

```text
qwen-small
```

### Complex Conflict Resolver

```text
qwen-large
```

### Manager Agent

初期：

```text
qwen-medium
```

复杂 Project：

```text
qwen-large
```

这样形成：

```text
small
cheap processing
       │
medium
normal reasoning
       │
large
escalation
```

而不是所有请求都用最大模型。

---

# 16. 第一阶段不要做 RAG

前几个版本的数据量不大。

优先实现：

```text
Structured Context
+
Recent Messages
```

即：

```text
Model Context =
Project Context
+
Branch Context
+
Recent Conversation
```

当项目增长以后再加入：

```text
semantic retrieval
```

---

# 17. Context Builder

推荐实现：

```text
ContextBuilder
```

输入：

```typescript
buildContext({
  projectId,
  branchId,
  conversationId,
  task
})
```

输出：

```text
ContextPack
```

ContextPack：

```json
{
  "project": {},
  "decisions": [],
  "requirements": [],
  "constraints": [],
  "openQuestions": [],
  "relevantArtifacts": [],
  "recentMessages": []
}
```

最终提供给模型。

---

# 18. Context Router

进入 Agent 阶段后增加：

```text
Context Router
```

不要让所有 Agent 获得完整上下文。

例如：

```text
                 Project Context
                        │
                 Context Router
            ┌───────────┼───────────┐
            ↓           ↓           ↓

      Coding Pack  Research Pack  Review Pack
            │           │           │
         Coding      Research      Review
          Agent        Agent        Agent
```

Coding Agent 只需要：

```text
architecture
API contracts
code-related decisions
requirements
files
```

而不需要全部市场讨论。

---

# 19. Agent 层设计

第一版 Agent 不采用完全 autonomous swarm。

采用：

**Manager + Agents as Tools**

第一阶段可以使用：

```text
自建 Manager Workflow
```

或者：

```text
LangGraph
```

原因是项目需要：

- 明确的状态流转；
- 可恢复执行；
- 人工审批；
- 工具调用审计；
- Context Delta 输出；
- Merge Review；
- 高风险操作拦截。

结构：

```text
                   Manager Agent
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼

     Research Agent  Coding Agent  Review Agent

          │              │              │
          └──────────────┼──────────────┘
                         ▼
                   Context Delta
                         │
                         ▼
                     Merge Agent
```

---

# 20. Agent 权限模型

Agent 不能直接随便修改 Project Context。

定义三档权限。

## Low Risk

例如：

```text
note
citation
new observation
```

允许：

```text
auto commit
```

---

## Medium Risk

例如：

```text
new requirement
new assumption
new task
```

允许：

```text
AI proposal
+
human approval
```

---

## High Risk

例如：

```text
change accepted decision
delete requirement
change architecture
mark task complete
```

必须：

```text
Human Approval
```

Agent Workflow 必须支持：

```text
pause
persist state
request approval
resume
```

---

# 21. 数据库核心表

MVP 至少建立：

```text
users
projects
project_members

conversations
branches
messages

context_items
context_commits
context_commit_changes

merge_requests
merge_conflicts

artifacts

model_runs
agent_runs

audit_events
```

---

# 22. 推荐关系

```text
projects
   │
   ├── project_members
   │
   ├── conversations
   │       │
   │       ├── branches
   │       └── messages
   │
   ├── context_items
   │
   ├── context_commits
   │       │
   │       └── context_commit_changes
   │
   ├── merge_requests
   │       │
   │       └── merge_conflicts
   │
   └── artifacts
```

---

# 23. API 设计

推荐从 REST 开始。

例如：

```text
POST   /api/projects
GET    /api/projects/:id

POST   /api/projects/:id/conversations
POST   /api/conversations/:id/messages

POST   /api/conversations/:id/extract
POST   /api/branches/:id/merge

GET    /api/projects/:id/context

GET    /api/merge-requests/:id
POST   /api/merge-requests/:id/resolve

POST   /api/projects/:id/agents/run
```

第一版没有必要 GraphQL。

---

# 24. Model Adapter

第一版默认使用 Qwen + vLLM，但必须从第一天加这一层：

```typescript
interface ModelProvider {
  createResponse(...): Promise<ModelResponse>;

  continueConversation(...): Promise<ModelResponse>;

  streamResponse(...): AsyncIterable<ModelEvent>;

  createEmbedding(...): Promise<EmbeddingResponse>;
}
```

实现：

```text
QwenVllmProvider
```

兼容实现：

```text
OpenAICompatibleProvider
DeepSeekProvider
GLMProvider
AnthropicProvider
GeminiProvider
```

不需要修改 Context Engine。

---

# 25. Conversation State 原则

模型服务中的 Conversation 只用于：

```text
model runtime state
```

因此保存：

```text
provider_conversation_id
```

但同时必须保存：

```text
CCE messages
```

形成：

```text
CCE Conversation
        │
        └── providerConversationId
```

而不能只保存模型服务返回的会话 ID。

---

# 26. Codex 仓库设计

推荐 monorepo：

```text
collaborative-context-engine/
│
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
│
├── docs/
│   ├── architecture.md
│   ├── domain-model.md
│   ├── merge-semantics.md
│   ├── model-platform.md
│   ├── api-contracts.md
│   ├── security.md
│   ├── zh-CN/
│   └── adr/
│
├── apps/
│   └── web/
│       ├── AGENTS.md
│       └── src/
│
├── packages/
│   │
│   ├── domain/
│   │   ├── AGENTS.md
│   │   └── src/
│   │
│   ├── database/
│   ├── context-engine/
│   │   ├── AGENTS.md
│   │   └── src/
│   │
│   ├── model-provider/
│   ├── agents/
│   └── shared/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── evals/
│
└── scripts/
```

---

# 27. 为什么必须认真写 AGENTS.md

Codex 在开始工作之前会读取 `AGENTS.md`，并且可以从 repo root 到子目录形成分层指令；更靠近工作目录的规则可以覆盖上层规则。

因此不要把所有规则都塞到一个 Prompt。

Root：

```text
AGENTS.md
```

负责：

```text
architecture
global constraints
testing
coding standards
dependency rules
model provider rules
```

例如：

```markdown
# Project principles

The PostgreSQL database is the source of truth.

Never use model provider conversation state as project state.

All context modifications must create a ContextCommit.

No high-risk ContextItem may be automatically overwritten.

Do not introduce a new production dependency without justification.

Model access must go through ModelProvider.

The core domain must not depend on a specific model vendor.

Run typecheck, lint and affected tests before finishing.
```

---

# 28. Context Engine 独立 AGENTS.md

例如：

```text
packages/context-engine/AGENTS.md
```

内容：

```markdown
# Context Engine Rules

Context merge must be deterministic whenever no LLM judgment is needed.

LLMs may classify semantic relationships but must not directly mutate persisted state.

Every merge result must preserve provenance.

A ContextItem may only be:
- added
- updated
- superseded
- deprecated

Never hard-delete semantic history.

All conflict decisions must be auditable.

The context engine must not import provider-specific SDKs.
```

这对 Codex 非常重要。

---

# 29. Model Provider AGENTS.md

```text
packages/model-provider/AGENTS.md
```

规定：

```text
all model calls go through provider interfaces

provider-specific options must remain inside provider implementations

OpenAI-compatible APIs must not be assumed to have identical behavior

structured output failures must be handled explicitly

model name and endpoint must come from configuration

provider errors must be normalized

all model runs must be logged
```

---

# 30. Database AGENTS.md

```text
packages/database/AGENTS.md
```

规定：

```text
all project-scoped tables contain project_id

all mutations use transactions

migrations must be backward-safe

no destructive migration without explicit approval

all foreign keys explicit
```

---

# 31. Codex 的工作方式

不要给 Codex 一个指令：

> “把整个项目做完。”

应该采用：

```text
Spec
 ↓
Epic
 ↓
Task
 ↓
Implementation
 ↓
Tests
 ↓
Review
```

每个 Codex Task 限制为：

```text
1 clearly bounded feature
+
explicit acceptance criteria
+
allowed files
+
required tests
```

---

# 32. Codex Task Prompt 模板

推荐每个任务都使用：

```text
Goal

Implement ContextCommit creation.

Background

Read:
- docs/domain-model.md
- docs/merge-semantics.md

Scope

Modify only:
- packages/domain
- packages/database

Requirements

1. Create ContextCommit entity.
2. A commit must reference parent commit.
3. Changes must preserve ContextItem provenance.
4. Commit creation must be transactional.

Out of scope

- AI extraction
- Merge UI
- Agents

Validation

Run:
pnpm typecheck
pnpm test
pnpm lint

Deliverables

1. implementation
2. tests
3. migration
4. short architecture note if assumptions changed
```

这种输入对 Codex 的效率远高于自然语言大任务。

---

# 33. Codex 并行策略

Codex 支持 subagent 工作流，可以让多个 agent 并行执行探索、测试、日志分析等任务；对于同时修改代码的 write-heavy 并行工作要更谨慎，因为容易产生冲突。

因此：

适合 parallel：

```text
architecture inspection
test generation analysis
security review
API review
documentation review
benchmark analysis
model evaluation analysis
```

不建议多个 Agent 同时：

```text
修改 context-engine 核心代码
```

---

# 34. Write-heavy 并行使用 Worktree

Codex 已支持为不同工作创建独立 Git worktrees。

因此可以：

```text
main

├── worktree/frontend
├── worktree/database
├── worktree/model-provider
└── worktree/evals
```

分别交给不同 Codex agent。

避免：

```text
Agent A
Agent B
Agent C

同时修改 main checkout
```

---

# 35. 项目阶段规划

建议按照 **8 个 Sprint** 实现。

这里的 Sprint 表示依赖阶段，不要求机械对应固定天数。

---

# Sprint 0：Architecture Baseline

目标：

建立 Codex 能长期稳定工作的工程环境。

实现：

```text
repository
Next.js
TypeScript
PostgreSQL
ORM
test framework
CI
AGENTS.md
docs/
ModelProvider interface
Qwen/vLLM development configuration
```

完成：

```text
Project
User
ProjectMember
```

同时写完：

```text
architecture.md
domain-model.md
merge-semantics.md
model-platform.md
```

### 验收

```text
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

全部通过。

---

# Sprint 1：Web Conversation MVP

实现：

```text
Project creation
Conversation creation
Chat UI
Qwen-compatible API
Streaming response
Message persistence
```

数据流：

```text
Browser
   ↓
CCE
   ↓
ContextBuilder
   ↓
ModelProvider
   ↓
Qwen / vLLM
   ↓
stream
   ↓
Browser
```

### 验收

用户可以：

```text
创建 Project
↓
创建多个 Chat
↓
分别聊天
↓
聊天历史持久化
```

---

# Sprint 2：Context Extraction

加入：

```text
Extract Context
```

Chat：

```text
raw messages
    ↓
Context Extractor
    ↓
ContextDelta
```

输出必须使用严格 Structured Output。

第一版 Extractor 只处理：

```text
fact
decision
requirement
assumption
task
question
```

### 验收

准备 30\~50 组人工标注 conversation。

检查：

```text
漏提取率
错误提取率
类型分类准确率
source message 是否正确
```

---

# Sprint 3：Manual Context Commit

实现：

```text
Context Delta Review
```

用户选择：

```text
Accept
Reject
Edit
```

然后生成：

```text
ContextCommit
```

此阶段先不要自动 merge。

### 验收

任何 ContextItem 都能反向追踪：

```text
Context Item
↓
Commit
↓
Conversation
↓
Message
```

---

# Sprint 4：Semantic Merge

加入：

```text
Three-Way Merge
```

实现：

```text
Base
Current
Proposed
```

先执行 deterministic rules。

只有无法判断的 semantic case 才调用模型。

Pipeline：

```text
Schema match
    ↓
Exact match
    ↓
Semantic dedup
    ↓
Temporal check
    ↓
Model conflict classifier
```

### 验收

建立：

```text
tests/fixtures/merge/
```

至少覆盖：

```text
no conflict
compatible expansion
direct conflict
temporal supersession
duplicate information
uncertain conflict
```

---

# Sprint 5：Team Collaboration

加入：

```text
Owner
Editor
Viewer
```

以及：

```text
author
branch
merge request
audit log
```

形成真正 teamwork。

### 验收

两个成员基于同一 Context Vn：

```text
Alice → branch A
Bob → branch B

      ↓

Merge Request
```

能够得到一致的 Vn+1。

---

# Sprint 6：Multi-Model + Context Router

此时引入：

```text
small
medium
large
```

以及多个 Provider：

```text
QwenVllmProvider
OpenAICompatibleProvider
```

加入：

```text
ModelRouter
ContextRouter
TokenBudget
```

例如：

```text
simple extraction
→ small

normal chat
→ medium

ambiguous conflict
→ large

complex planning
→ large
```

### 验收

记录：

```text
provider
model
input tokens
cached tokens
output tokens
latency
cost
```

能够比较不同 routing 策略。

---

# Sprint 7：Agent Platform

加入 Agent Workflow。

优先实现：

```text
ManagerAgent
ContextExtractorAgent
ResearchAgent
ReviewAgent
MergeAgent
```

第一版不要 Coding Agent。

先验证：

```text
multi-agent
+
shared context
+
human approval
```

架构：

```text
User
 ↓
Manager
 ↓
Context Router
 ↓
Specialist
 ↓
Context Delta
 ↓
Merge Review
```

---

# 36. 第二代 Agent

第一代稳定后再增加：

```text
Coding Agent
Planning Agent
Research Agent
Review Agent
```

其中 Coding Agent 如果真的需要操作代码，可以进一步通过：

```text
Codex
```

或其他开源代码 Agent 工具运行。

于是最终可以：

```text
CCE Manager Agent
        ↓
Coding Tool
        ↓
Codex / Open-source Coding Agent
        ↓
repository
```

也就是说：

**Codex 既可以用于开发 CCE，也可以成为 CCE 的一个 specialist agent；但 CCE 的核心运行时不应依赖 Codex。**

---

# 37. 最终系统

```text
                         TEAM

           Alice        Bob        Carol
             │           │           │
             └───────────┼───────────┘
                         ▼

                    CCE Web App
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼

          Chat       Context       Merge
          View        View         Review
            │            │            │
            └────────────┼────────────┘
                         ▼

                   Project Service
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼

      Conversations  ContextItems   Commits

                         │
                         ▼

                   Context Engine

             ┌───────────┼───────────┐
             ▼           ▼           ▼

          Extractor    Resolver    Router

             │           │           │
             └───────────┼───────────┘
                         ▼

                    Model Router

               ┌─────────┼─────────┐
               ▼         ▼         ▼

             Small     Medium     Large

                         │
                         ▼

                     Manager

           ┌─────────────┼─────────────┐
           ▼             ▼             ▼

       Research       Review        Coding
        Agent          Agent         Agent
                                      │
                                      ▼
                              Codex / Coding Tool
```

---

# 38. Evaluation 体系

这个项目不能只测：

```text
回答看起来好不好
```

真正应该测：

### Context Extraction

```text
Precision
Recall
Type Accuracy
Source Attribution Accuracy
```

### Merge

```text
Conflict Precision
Conflict Recall
False Auto-Merge Rate
```

其中最重要指标：

```text
False Auto-Merge Rate
```

因为漏掉一个潜在冲突，比多要求一次人工确认危险得多。

---

# 39. 推荐安全目标

对于：

```text
decision
requirement
constraint
```

目标：

```text
False automatic overwrite
≈ 0
```

宁愿：

```text
多产生 Merge Conflict
```

也不要：

```text
错误覆盖团队决定
```

---

# 40. Agent Evaluation

记录：

```text
task success
context relevance
token usage
tool calls
latency
cost
merge acceptance rate
human override rate
```

尤其关注：

```text
Agent proposed delta
        ↓
Human accepted?
```

长期可以得到：

```text
Agent trust score
```

---

# 41. 日志与 Observability

至少保存：

```text
model_run_id
project_id
conversation_id
agent_name
provider
model
prompt_version
context_commit
input_token
output_token
latency
tool_calls
result
```

不要把：

```text
prompt
model
context
```

混在不可追踪的代码中。

---

# 42. Prompt Versioning

所有核心 Agent prompt：

```text
extractor
resolver
router
manager
```

必须有：

```text
prompt_id
version
```

例如：

```text
context-extractor:v3
```

否则修改 prompt 后 Eval 无法复现。

---

# 43. Security

第一版必须有：

```text
project isolation
RBAC
audit log
API secret server-side only
```

数据库查询必须始终：

```text
WHERE project_id = authorized_project
```

Agent Tool 调用也必须检查 project scope。

绝不能仅依赖：

```text
prompt:
"You may only access the current project"
```

权限必须在代码层强制。

---

# 44. 数据保留原则

建议建立：

```text
Raw Conversation
→ immutable

Context Commit
→ immutable

Context Item
→ versioned

Audit Event
→ append-only
```

不要真正删除历史语义。

删除应该形成：

```text
deprecated
```

或者：

```text
superseded
```

---

# 45. 首版明确不做的内容

为了让 Codex 快速实现，应明确排除：

```text
× 深度绑定 OpenAI
× 深度绑定 Anthropic
× 深度绑定 Gemini
× 同时维护多个专属 Agent SDK
× browser scraping
× autonomous swarm
× complex knowledge graph
× Neo4j
× custom vector database
× realtime voice
× mobile app
× enterprise SSO
× automatic high-risk merge
```

可以保留：

```text
√ OpenAI-compatible API
√ Qwen 本地或私有化部署
√ ModelScope / Hugging Face 模型加载
√ 后续 Provider Adapter
```

否则项目很快失控。

---

# 46. MVP 定义

真正 MVP 只有：

```text
① 多人 Project

② 多 Conversation

③ Project Context

④ Context Delta extraction

⑤ Context Commit

⑥ Semantic three-way merge

⑦ Merge conflict review

⑧ Qwen-compatible Web Chat
```

做到这里：

**项目的核心创新已经成立。**

Agent 并不是 MVP 的必要条件。

---

# 47. Codex 第一批任务

不要让 Codex 立即写业务代码。

首先依次执行：

### TASK-001

```text
Initialize monorepo
```

### TASK-002

```text
Write domain entities
```

### TASK-003

```text
Create PostgreSQL schema
```

### TASK-004

```text
Implement Project CRUD
```

### TASK-005

```text
Implement Conversation persistence
```

### TASK-006

```text
Add ModelProvider interface
```

### TASK-007

```text
Add Qwen/vLLM OpenAI-compatible adapter
```

### TASK-008

```text
Implement streaming Chat UI
```

### TASK-009

```text
Define ContextDelta schema
```

### TASK-010

```text
Build extraction pipeline
```

### TASK-011

```text
Implement Context Commit
```

### TASK-012

```text
Build Merge Request UI
```

### TASK-013

```text
Implement deterministic merge
```

### TASK-014

```text
Add semantic conflict resolver
```

### TASK-015

```text
Build merge eval dataset
```

### TASK-016

```text
Add team RBAC
```

只有这些通过之后：

### TASK-020+

再进入 Agent Workflow。

---

# 48. Codex 每个阶段必须执行的检查

规定 Codex 每次任务结束之前：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果数据库变化：

```text
migration validation
```

如果 merge engine 变化：

```text
merge eval suite
```

如果 AI prompt 变化：

```text
AI eval suite
```

如果模型 Provider 变化：

```text
provider contract tests
```

---

# 49. Definition of Done

任何任务只有满足以下条件才算完成：

```text
code implemented
+
unit tests
+
integration tests if applicable
+
typecheck
+
lint
+
architecture unchanged
or
ADR added
+
documentation updated
```

Codex 不允许用：

```text
TODO
placeholder
mock success
```

作为完成状态。

---

# 50. ADR

建立：

```text
docs/adr/
```

例如：

```text
0001-use-postgresql.md
0002-cce-db-is-source-of-truth.md
0003-use-model-provider-abstraction.md
0004-use-qwen-vllm-for-initial-runtime.md
0005-manager-agent-pattern.md
0006-human-review-high-risk-merge.md
0007-support-openai-compatible-api.md
```

这样几个月以后 Codex 仍知道：

> 为什么当初这么设计。

---

# 51. 项目最重要的五条架构原则

最终建议写入根目录 `AGENTS.md` 最顶部。

## Principle 1

**Conversation is evidence, not project state.**

---

## Principle 2

**PostgreSQL project context is the source of truth.**

---

## Principle 3

**Every semantic state change produces a ContextCommit.**

---

## Principle 4

**Every ContextItem must preserve provenance.**

---

## Principle 5

**AI proposes high-risk changes; humans commit them.**

---

# 52. 项目真正的技术创新点

本项目最值得投入的部分并不是：

```text
Chat UI
```

也不是：

```text
Multi-Agent
```

而是：

```text
Conversation
      ↓
Semantic Delta Extraction
      ↓
Versioned Context
      ↓
Semantic Three-Way Merge
      ↓
Conflict Resolution
      ↓
Context Routing
```

即：

# Git-like semantic collaboration for humans and AI agents

最终可以形成：

| Git            | CCE                     |
| -------------- | ----------------------- |
| Repository     | Project                 |
| Branch         | Conversation            |
| Commit         | ContextCommit           |
| Diff           | ContextDelta            |
| Merge          | Semantic Merge          |
| Merge Conflict | ContextConflict         |
| Commit Author  | Human / Agent           |
| History        | Context History         |
| Pull Request   | Merge Request           |
| HEAD           | Current Context Version |

这应该成为整个项目的核心设计语言。

---

# 53. 推荐最终开发路线

```text
                    M0
          开源模型与社区调研
             验证部署路径
                  ↓
                    M1
             CCE Web Chat
                  ↓
                    M2
           Structured Context
                  ↓
                    M3
             Context Commit
                  ↓
                    M4
          Semantic Three-Way
                 Merge
                  ↓
                    M5
              Team RBAC
                  ↓
                    M6
           Multi-model Router
                  ↓
                    M7
            Context Router
                  ↓
                    M8
            Manager Agent
                  ↓
                    M9
          Specialist Agents
                  ↓
                    M10
              Coding Agent
                  ↓
                    M11
        Cross-provider Adapter
```

其中：

**M0～M5 是真正的产品核心。**

**M6～M10 是 Agent 化。**

**M11 才是跨 AI 公司和跨模型平台。**

---

# 54. 第一阶段最终交付标准

第一阶段完成后，应该能够演示下面的完整流程：

```text
Alice 创建 Project

        ↓

Alice 创建 Chat A
讨论数据库

        ↓

Bob 创建 Chat B
讨论部署

        ↓

两个聊天都基于 Context V1

        ↓

AI 从两个 Chat 中提取 Delta

        ↓

Alice Delta:
database = PostgreSQL

Bob Delta:
deployment = Docker

        ↓

生成两个 Context Commit

        ↓

Project Context V2

        ↓

Charlie 创建 Chat C

        ↓

模型自动看到：

database = PostgreSQL
deployment = Docker

        ↓

Charlie 提议：
database = MySQL

        ↓

CCE 检测 conflict

        ↓

Merge Request

PostgreSQL
vs
MySQL

        ↓

Human Review

        ↓

Context V3
```

如果这个流程稳定成立：

**CCE 的核心技术已经被证明。**

随后再接入 Manager Agent、Research Agent、Review Agent 或 Codex，只是在已经可靠的 Context Engine 上增加新的生产者和消费者，而不是重新设计上下文系统。
