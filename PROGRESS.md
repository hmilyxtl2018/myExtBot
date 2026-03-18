# myExtBot — 完成状态 / Progress

> 最后更新：2026-03-10

---

## 总览 / Summary

| 功能区域 | 状态 |
|---------|------|
| 项目脚手架 (Tauri 2 + React + Vite) | ✅ 完成 |
| Agent FSM（9 个状态） | ✅ 完成 |
| LLM 客户端（OpenAI 兼容） | ✅ 完成 |
| Planner（用户意图 → AgentPlan） | ✅ 完成 |
| Executor（AgentPlan → 工具调用） | ✅ 完成 |
| 计划审批 UI（PlanApprovalModal） | ✅ 完成 |
| 工具调用审批 UI（ApprovalModal） | ✅ 完成 |
| 审计数据库（8 张表 + LLM 调用日志 + Blob 存储设计） | ✅ 完成 |
| `fs.readFile` 工具实现 | ✅ 完成 |
| `cmd.run` 工具实现 | ✅ 完成 |
| `fs.applyPatch` | 🔶 占位符 |
| `net.fetch` | 🔶 占位符 |
| `desktop.*`（截图/OCR/点击） | 🔶 占位符 |
| 静态许可名单（config.toml 读取） | ⬜ 未接入 |
| Playwright 浏览器侧进程 | 🔶 脚手架仅含协议定义 |
| 凭证保险库（Credential Vault） | ⬜ 未开始 |
| 流式 LLM 输出 | ⬜ 未开始 |
| 持久化审计数据库（落盘） | ⬜ 当前仅内存 |
| `PlanUpdated` 执行进度事件 | ⬜ Executor 尚未发出 |

---

## 详细状态 / Detailed Status

### Rust 后端

#### `events.rs` ✅
- `AgentStatus`: 9 个状态（Idle / Planning / WaitingPlanApproval / Thinking / WaitingApproval / RunningTool / Stopped / Completed / Failed）
- `AgentEvent`: 9 个事件变体，统一通过 `"agent-event"` 频道广播
- `AgentPlan` / `AgentPlanStep` / `RiskLevel`：结构化计划类型，完全序列化
- `ToolCallRequest` / `ToolCallResult` / `ChatMessage` / `PlanStep` / `AuditEntry`

#### `agent.rs` ✅
- `AgentState` 持有 AppHandle、状态锁、会话 ID
- `plan_approval_tx` / `tool_approval_tx`：独立的 oneshot 通道，用于挂起等待前端审批
- `register_plan_approval()` / `resolve_plan_approval()` / `register_tool_approval()` / `resolve_tool_approval()`
- `emergency_stop()` 取消 cancel token 并清空两路审批通道
- `app_handle()` / `tool_approval_arc()`：闭包安全句柄（无 unsafe 指针）

#### `llm.rs` ✅
- `LlmClient` + `LlmConfig`（base_url / model / max_tokens）
- `ApiKey(String)` — 实现 `Zeroize + ZeroizeOnDrop`，落地时清零内存
- `chat_completion(messages, tools)` — 返回 `ThinkResult::Reply(String)` 或 `ThinkResult::ToolCalls(Vec<ToolCall>)`
- `LlmError` 四种变体：`NoApiKey / Network / ApiError{status,body} / Parse`
- `tools_schema(registry)` — 把 `ToolRegistry` 转成 OpenAI function-calling 格式
- `client_from_env()` — 读取 `MYEXTBOT_LLM_API_KEY / _BASE_URL / _MODEL`
- **未设置 API Key 时优雅降级**：返回 `LlmError::NoApiKey`，不 panic
- 单元测试 × 2

#### `planner.rs` ✅
- `run_planner(user_prompt, tools, llm) → Result<AgentPlan>`
- System prompt 动态注入可用工具列表（从 ToolRegistry 生成）
- 支持 markdown 代码块剥离（模型可能忽视 JSON-only 指令）
- JSON 解析失败时返回 `Err`，上层转换到 `Failed` 状态
- 自动为缺失 UUID 字段生成 id（防止模型遗漏）
- 单元测试 × 6（strip_fence、minimal、with_steps、invalid_json、code_fence、depends_on）

#### `executor.rs` ✅
- `run_executor(plan, tools, llm, agent, db, approval_gate)`
- `topological_sort(plan)` — Kahn 算法，支持 DAG 依赖，检测环路
- 每步独立构建 context（system + 步骤意图 + 前序摘要，截断至 300 字符）
- LLM 调用失败时记录错误并继续后续无依赖步骤
- `ApprovalGate` 类型：`Box<dyn Fn(ToolCallRequest) → Pin<Box<dyn Future<bool>>>>`
- 每步后写入 `audit.db`（`log_llm_call` + `update_tool_call_result`）
- `dispatch_tool()` — 按工具名分发至各实现函数

#### `commands.rs` ✅
- `send_message` — 完整流水线：记录消息 → Planning → Planner → WaitingPlanApproval → 审批 → Thinking → Executor → Completed/Failed
- `approve_plan` / `deny_plan` — 通过 `resolve_plan_approval()` 解除等待
- `approve_tool_call` — 写审计 + 调用 `resolve_tool_approval(true)` 解除 Executor 等待
- `deny_tool_call` — 写审计 + 调用 `resolve_tool_approval(false)`
- `emergency_stop` — 清 session 缓存 + 调用 `agent.emergency_stop()`
- `get_audit_log` — 查询最近 N 条 tool_calls 记录

#### `audit.rs` ✅
- 8 张表（来自合并后的完整 schema）：sessions / messages / tool_calls / artifacts / llm_calls / run_nodes / run_edges / claims
- `log_session_start`, `log_message`, `log_tool_call`, `update_tool_call_result`, `log_llm_call`, `recent_entries`
- 存储分层设计（docs/audit.md）：Tier 1 SQLite + Tier 2 文件系统 Blob
- 所有 migration 语句都是 `CREATE TABLE IF NOT EXISTS`（幂等）
- ⚠️ 当前使用 `open_in_memory()`，应用退出后数据丢失；run_nodes/run_edges/claims 等新表在 Rust 实现中尚未使用

#### `permissions.rs` 🔶
- `PermissionManager` 持有 `session_tool_permits: HashSet<String>`
- `grant_session(tool)` / `is_permitted_session(tool)` / `clear_session()`
- ⚠️ `executor.rs` / `commands.rs` 目前未调用 `is_permitted_session`；allowlist 检查未接入

#### `tools/` ✅（框架）/ 🔶（实现）

| 工具 | 实现状态 |
|------|---------|
| `fs.readFile` | ✅ `tokio::fs::read_to_string` |
| `fs.applyPatch` | 🔶 `Err("not yet implemented")` |
| `cmd.run` | ✅ `tokio::process::Command`（无 allowlist 检查） |
| `net.fetch` | 🔶 `Err("not yet implemented")`（reqwest 已在 Cargo.toml） |
| `desktop.screenshot` | 🔶 `Err("not yet implemented")` |
| `desktop.getActiveWindowInfo` | 🔶 `Err("not yet implemented")` |
| `desktop.clickRectCenter` | 🔶 `Err("not yet implemented")` |
| `desktop.ocrCloud` | 🔶 `Err("not yet implemented")` |

---

### React 前端

| 文件 | 状态 | 说明 |
|------|------|------|
| `models/events.ts` | ✅ | 镜像所有 Rust 类型；含 `AgentPlan` / `AgentPlanStep` |
| `hooks/useEventStream.ts` | ✅ | 订阅 `agent-event`；支持 `onToolCallRequest` / `onPlanReady` 回调；dev 模式内置 stub 序列 |
| `App.tsx` | ✅ | 处理 `PlanReady` 事件，展示 `PlanApprovalModal`；Planning/WaitingPlanApproval 期间禁用输入框 |
| `ChatPanel.tsx` | ✅ | 聊天消息展示；`extraDisabled` prop 用于规划期间锁定输入 |
| `PlanPanel.tsx` | ✅ | 展示 `PlanUpdated` 事件中的步骤进度条 |
| `ApprovalModal.tsx` | ✅ | 工具调用审批弹窗（工具名 + 风险 + 参数） |
| `PlanApprovalModal.tsx` | ✅ | 计划审批弹窗（目标 + 步骤列表含风险颜色 + 凭证提示） |
| `AuditTimeline.tsx` | ✅ | 实时审计事件流 |
| `AgentLogPanel.tsx` | ✅ | Agent 思考过程 + 工具调用结果 |
| `EmergencyStop.tsx` | ✅ | 一键急停按钮 |

---

### Playwright 侧进程

`services/playwright-sidecar/src/index.ts` 包含：
- WebSocket JSON-RPC 2.0 服务端框架（端口 9001）
- 方法路由骨架

**尚未实现**：
- `browser.navigate` / `browser.click` / `browser.screenshot` 等具体 RPC 方法
- Tauri 后端与侧进程的 WebSocket 连接逻辑（后端目前未调用侧进程）

---

## 已知缺口 / Known Gaps

| # | 缺口 | 优先级 | 建议下一步 |
|---|------|-------|-----------|
| 1 | `net.fetch` 未实现 | 高 | 使用已有 `reqwest` 接入 + URL allowlist |
| 2 | `desktop.*` 工具全是占位符 | 高 | Windows DXGI 截图 + WinAPI GetForegroundWindow + SendInput |
| 3 | allowlist 未接入工具调用链 | 高 | 在 `executor.dispatch_tool()` 前调用 `PermissionManager` |
| 4 | 审计 DB 仅内存 | 中 | 迁移到 `tauri::api::path::app_data_dir()` 路径 |
| 5 | `PlanUpdated` 执行进度未更新 | 中 | Executor 每步后发出 `AgentEvent::PlanUpdated` |
| 6 | Planning 阶段 token 统计为 0 | 低 | `run_planner` 返回 `LlmResult` 并在 `commands.rs` 中记录 |
| 7 | FSM 非法转换无守卫 | 低 | 在 `transition()` 中增加 `validate_transition()` 并补充单元测试 |
| 8 | Playwright 侧进程未接入 | 低 | 完成 RPC 方法实现后在后端添加 WebSocket 客户端 |
| 9 | 凭证保险库 | 低 | 设计安全存储（Windows DPAPI / macOS Keychain） |
| 10 | 流式输出 | 低 | `reqwest` stream + SSE 转发到前端 |
| 11 | 多轮对话历史 | 低 | Planner/Executor 目前每次独立构建 messages，不保留跨轮上下文 |
| 12 | `config.toml` 解析 | 低 | 实现 `config.rs` 读取 allowlists 并注入 `PermissionManager` |

---

## 下一个 PR 建议 / Suggested Next PRs

1. **`net.fetch` 实现** + URL allowlist 接入 `config.toml`
2. **allowlist 守卫** 在 `executor.rs` 分发前检查 `PermissionManager`
3. **审计 DB 持久化** 至应用数据目录
4. **`PlanUpdated` 进度更新**：Executor 每步后发出状态变化
5. **Windows 截图**（`desktop.screenshot`）— DXGI/GDI 实现
6. **Playwright 侧进程 RPC 方法** + Tauri WebSocket 客户端接入

---

## 测试状态 / Test Status

| 测试套件 | 状态 |
|---------|------|
| `llm::tests` (×2) | ✅ 通过 |
| `planner::tests` (×6) | ✅ 通过 |
| FSM 状态转换单元测试 | ⬜ 缺失 |
| 工具调用集成测试 | ⬜ 缺失 |
| React 组件测试 | ⬜ 缺失 |

运行所有 Rust 测试：

```powershell
cd apps/desktop/src-tauri
cargo test --no-default-features
```
