//! Multi-agent collaboration layer.
//!
//! # Conceptual model
//!
//! When every team member has their own myExtBot digital-twin, a **team** is a
//! logical group whose bots need to:
//!
//! 1. **Know each other** – [`AgentIdentity`] + [`TeamRegistry::register_agent`]
//! 2. **Delegate work** – [`Task`] assigned from one agent to another
//! 3. **Communicate** – [`CollabMessage`] envelopes routed through [`CollabBus`]
//! 4. **Track progress** – task status transitions persisted in SQLite
//!
//! The central types are:
//!
//! | Type | Role |
//! |------|------|
//! | [`AgentIdentity`] | Who a bot is (id, name, role, endpoint, team) |
//! | [`Task`]          | A unit of work – can be delegated to any team agent |
//! | [`TaskStatus`]    | Lifecycle: Pending → InProgress → Done / Failed / Cancelled |
//! | [`CollabMessage`] | Typed envelope exchanged between agents |
//! | [`CollabBus`]     | In-process broadcast channel (Tauri event bridge) |
//! | [`TeamRegistry`]  | SQLite-backed CRUD for agents, tasks, and messages |

pub mod bus;
pub mod registry;
pub mod types;

pub use bus::CollabBus;
pub use registry::TeamRegistry;
pub use types::{AgentIdentity, CollabMessage, MsgType, Task, TaskStatus};
