# Multi-Agent Team Collaboration

> **问题（Question）**  
> 假定团队中每个成员都有自己的数字分身 bot，他们之间要如何协同？需要哪些概念元素，如何构建？  
> *(If every team member has their own digital-twin bot, how do they collaborate?  
> What conceptual elements are needed, and how do you build it?)*

---

## 1. Why Collaboration Is Hard

Each myExtBot instance today is a **single-user agent**: it knows only one person's tools,
permissions, and context. When Alice's bot asks Bob's bot to "run the tests", there is no
shared vocabulary for:

- *Who* is Alice's bot, and how does Bob's bot trust it?
- *What* work should Bob's bot do, and how does Alice know when it is done?
- *How* do the two bots exchange messages reliably?

The collaboration layer answers each of those questions with a concrete abstraction.

---

## 2. Conceptual Building Blocks

```
┌─────────────────────────────────────────────────────────────────────┐
│  Concept        │  Purpose                                           │
├─────────────────┼────────────────────────────────────────────────────┤
│ AgentIdentity   │  Stable who-am-I record for each bot               │
│ Team            │  Shared team_id that groups all agents together    │
│ Task            │  A unit of delegatable work with lifecycle status  │
│ CollabMessage   │  Typed envelope exchanged between two agents       │
│ CollabBus       │  In-process publish/subscribe channel              │
│ TeamRegistry    │  SQLite-backed store for all of the above          │
└─────────────────┴────────────────────────────────────────────────────┘
```

### 2.1 AgentIdentity – *Who is each bot?*

```
id        stable UUID (written once at first launch)
name      human label, e.g. "Alice-bot"
role      optional tag – "backend", "frontend", "pm" …
endpoint  ws:// or http:// address peer agents use to reach this bot
team_id   logical team identifier shared by all teammates
is_local  true only for the bot running in *this* process
last_seen wall-clock timestamp of the most recent heartbeat
```

Every bot registers its own identity on startup and receives identities of teammates
via presence announcements (Ping messages).  The registry stores them in the `agents`
table so each bot always knows all of its teammates—even across restarts.

### 2.2 Team – *How do bots find each other?*

A **team** is just a string (`team_id`) that all members share in their configuration.
There is no central server required for the MVP: each bot can discover teammates via a
simple peer-to-peer ping over WebSocket.  Future work may add a lightweight rendezvous
service for larger teams.

### 2.3 Task – *What is the unit of delegated work?*

```
Pending → InProgress → Done
                     ↘ Failed
                     ↘ Cancelled
```

| Field        | Meaning                                      |
|--------------|----------------------------------------------|
| id           | Stable UUID                                  |
| title        | Short description, e.g. "Run regression tests" |
| description  | Acceptance criteria / longer context         |
| status       | One of the lifecycle states above            |
| assigned_to  | Agent id of the bot that will execute it     |
| delegated_by | Agent id of the bot that created it          |
| result       | JSON payload delivered on Done / Failed      |

### 2.4 CollabMessage – *How do bots communicate?*

Every message is an immutable envelope stored in the `collab_messages` table:

| msg_type       | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `task_assigned`| "I am giving you this task" (from delegator to assignee)      |
| `task_update`  | "Here is an interim progress report" (from assignee to delegator) |
| `task_result`  | "The task is complete; here is the result" (final message)    |
| `ping`         | Liveness probe / presence heartbeat                           |

### 2.5 CollabBus – *How does routing work inside one process?*

`CollabBus` is a `tokio::sync::broadcast` channel.  Any component in the same process
(e.g. the WebSocket bridge, the UI event emitter, the audit logger) subscribes once and
receives every message without contention.  For remote delivery the WebSocket bridge
reads from the bus and forwards messages to the remote endpoint stored in `AgentIdentity`.

### 2.6 TeamRegistry – *How is state persisted?*

Three SQLite tables (created by `db::run_migrations`):

| Table            | Contents                                           |
|------------------|----------------------------------------------------|
| `agents`         | All known bot identities in the team               |
| `tasks`          | All tasks, delegated or self-assigned              |
| `collab_messages`| Immutable chronological log of all inter-bot messages |

---

## 3. How It All Fits Together

### Sequence: Alice delegates a task to Bob

```
Alice-bot                             Bob-bot
    │                                     │
    │  delegate_task(title, assignee=Bob) │
    │─────────────────────────────────────▶  (1) create Task in SQLite (status=pending)
    │                                     │  (2) emit CollabMessage{task_assigned} on CollabBus
    │                                     │  (3) WS bridge forwards message to Bob's endpoint
    │                                     │
    │                                     │  Bob-bot receives task_assigned
    │                                     │  update_task_status(in_progress)
    │◀─────────────────────────────────────  (4) task_update message back to Alice
    │                                     │
    │                                     │  Bob-bot executes work…
    │                                     │  update_task_status(done, result={...})
    │◀─────────────────────────────────────  (5) task_result message back to Alice
    │                                     │
    │  Alice-bot shows result in UI       │
```

### Tauri IPC surface

| Command                | Who calls it    | What it does                                        |
|------------------------|-----------------|-----------------------------------------------------|
| `register_agent`       | startup / ping  | Upsert a bot identity in the local registry         |
| `get_team_agents`      | UI              | List all teammates                                  |
| `delegate_task`        | user / agent    | Create a task and notify the assignee               |
| `update_task_status`   | assignee bot    | Progress / completion report; notifies delegator    |
| `get_tasks`            | UI              | Paginated task list                                 |
| `get_collab_messages`  | UI / audit      | Paginated inter-agent message log                   |

---

## 4. Security Considerations

* **Trust boundary**: in the MVP every bot that knows the `team_id` is trusted.
  Production deployments should add a shared secret or mTLS between bots.
* **Permission propagation**: when Alice delegates a task, Bob's bot still runs under its
  *own* permission rules; it will not execute a tool that Alice's config allows but Bob's
  config does not.
* **Audit trail**: every `CollabMessage` is persisted in SQLite and also logged via the
  existing `audit.rs` mechanism so all cross-bot communication is fully auditable.

---

## 5. Implementation Files

| File                              | Role                                           |
|-----------------------------------|------------------------------------------------|
| `src/collab/mod.rs`               | Module root; public re-exports                 |
| `src/collab/types.rs`             | `AgentIdentity`, `Task`, `TaskStatus`, `CollabMessage`, `MsgType` |
| `src/collab/registry.rs`          | `TeamRegistry` – SQLite CRUD for agents / tasks / messages |
| `src/collab/bus.rs`               | `CollabBus` – in-process broadcast channel     |
| `src/commands.rs`                 | 6 new Tauri IPC commands                       |
| `src/db.rs`                       | Schema: `agents`, `tasks`, `collab_messages` tables added |
| `src/lib.rs`                      | Wiring: `TeamRegistry` + `CollabBus` managed state |
