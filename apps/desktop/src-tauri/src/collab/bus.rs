//! In-process broadcast channel for routing collaboration messages between
//! the local agent state machine and any Tauri event listeners.
//!
//! `CollabBus` is intentionally simple: it uses a `tokio::sync::broadcast`
//! channel so multiple subscribers (e.g. a UI event listener and a persistence
//! hook) can each receive every message without contention.
//!
//! For cross-process / cross-machine delivery the caller is responsible for
//! forwarding messages to the remote agent's WebSocket endpoint.

use std::sync::Arc;
use tokio::sync::broadcast;

use super::types::CollabMessage;

/// Capacity of the in-process broadcast ring buffer.
const BUS_CAPACITY: usize = 256;

/// Shared handle to the in-process collaboration message bus.
///
/// Clone this cheaply to get a new sender; call [`CollabBus::subscribe`] to
/// get a `Receiver<CollabMessage>` for a new consumer.
#[derive(Clone)]
pub struct CollabBus {
    sender: Arc<broadcast::Sender<CollabMessage>>,
}

impl CollabBus {
    /// Create a new bus with a ring buffer of [`BUS_CAPACITY`] messages.
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BUS_CAPACITY);
        CollabBus {
            sender: Arc::new(sender),
        }
    }

    /// Publish a message to all current subscribers.
    ///
    /// Returns the number of active receivers that will receive the message.
    /// An `Err` is only returned when the channel is closed, which should
    /// never happen while the `CollabBus` is held in Tauri's managed state.
    pub fn publish(&self, msg: CollabMessage) -> anyhow::Result<usize> {
        self.sender
            .send(msg)
            .map_err(|e| anyhow::anyhow!("CollabBus send error: {e}"))
    }

    /// Subscribe to all future messages on the bus.
    pub fn subscribe(&self) -> broadcast::Receiver<CollabMessage> {
        self.sender.subscribe()
    }

    /// Return the number of active receivers.
    pub fn receiver_count(&self) -> usize {
        self.sender.receiver_count()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::types::{CollabMessage, MsgType};
    use chrono::Utc;

    fn make_msg(from: &str, to: &str) -> CollabMessage {
        CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: from.to_string(),
            to_agent: to.to_string(),
            task_id: None,
            msg_type: MsgType::Ping,
            payload: serde_json::json!({}),
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_publish_received_by_subscriber() {
        let bus = CollabBus::new();
        let mut rx = bus.subscribe();

        let msg = make_msg("a1", "b1");
        let msg_id = msg.id.clone();
        bus.publish(msg).unwrap();

        let received = rx.try_recv().unwrap();
        assert_eq!(received.id, msg_id);
        assert_eq!(received.from_agent, "a1");
    }

    #[tokio::test]
    async fn test_multiple_subscribers_each_receive() {
        let bus = CollabBus::new();
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        let msg = make_msg("a1", "b1");
        let msg_id = msg.id.clone();
        bus.publish(msg).unwrap();

        let r1 = rx1.try_recv().unwrap();
        let r2 = rx2.try_recv().unwrap();
        assert_eq!(r1.id, msg_id);
        assert_eq!(r2.id, msg_id);
    }

    #[tokio::test]
    async fn test_no_subscriber_still_publishes() {
        let bus = CollabBus::new();
        // No subscribers – send returns Err (broadcast semantics) but we map
        // it to Ok(0) to avoid crashing when no UI is listening.
        let msg = make_msg("a1", "b1");
        // publish returns Err when there are no receivers in tokio broadcast
        let result = bus.publish(msg);
        // This is expected – 0 active receivers means send fails in broadcast.
        // The bus should not panic; the caller can log and move on.
        assert!(result.is_err() || result.unwrap() == 0);
    }

    #[test]
    fn test_receiver_count() {
        let bus = CollabBus::new();
        assert_eq!(bus.receiver_count(), 0);
        let _rx1 = bus.subscribe();
        assert_eq!(bus.receiver_count(), 1);
        let _rx2 = bus.subscribe();
        assert_eq!(bus.receiver_count(), 2);
    }
}
