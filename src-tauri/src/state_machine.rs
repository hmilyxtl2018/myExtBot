use serde::{Deserialize, Serialize};
use std::fmt;

/// Represents the complete lifecycle state of the Agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Idle,
    Thinking,
    WaitingApproval,
    RunningTool,
    Completed,
    Failed,
}

impl fmt::Display for AgentState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            AgentState::Idle => "idle",
            AgentState::Thinking => "thinking",
            AgentState::WaitingApproval => "waiting_approval",
            AgentState::RunningTool => "running_tool",
            AgentState::Completed => "completed",
            AgentState::Failed => "failed",
        };
        write!(f, "{}", s)
    }
}

/// Errors that can arise from an invalid state transition.
#[derive(Debug, PartialEq)]
pub struct TransitionError {
    pub from: AgentState,
    pub to: AgentState,
}

impl fmt::Display for TransitionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Invalid transition: {} -> {}",
            self.from, self.to
        )
    }
}

/// Validates whether a transition between two `AgentState` values is allowed.
///
/// Allowed transitions:
///   Idle            -> Thinking
///   Thinking        -> WaitingApproval | RunningTool | Completed | Failed
///   WaitingApproval -> RunningTool | Failed
///   RunningTool     -> Thinking | Completed | Failed
///   Completed       -> Idle
///   Failed          -> Idle
pub fn validate_transition(from: &AgentState, to: &AgentState) -> Result<(), TransitionError> {
    let allowed = match from {
        AgentState::Idle => matches!(to, AgentState::Thinking),
        AgentState::Thinking => matches!(
            to,
            AgentState::WaitingApproval
                | AgentState::RunningTool
                | AgentState::Completed
                | AgentState::Failed
        ),
        AgentState::WaitingApproval => {
            matches!(to, AgentState::RunningTool | AgentState::Failed)
        }
        AgentState::RunningTool => matches!(
            to,
            AgentState::Thinking | AgentState::Completed | AgentState::Failed
        ),
        AgentState::Completed => matches!(to, AgentState::Idle),
        AgentState::Failed => matches!(to, AgentState::Idle),
    };

    if allowed {
        Ok(())
    } else {
        Err(TransitionError {
            from: from.clone(),
            to: to.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_to_thinking_is_valid() {
        assert!(validate_transition(&AgentState::Idle, &AgentState::Thinking).is_ok());
    }

    #[test]
    fn idle_to_running_tool_is_blocked() {
        assert_eq!(
            validate_transition(&AgentState::Idle, &AgentState::RunningTool),
            Err(TransitionError {
                from: AgentState::Idle,
                to: AgentState::RunningTool
            })
        );
    }

    #[test]
    fn idle_to_completed_is_blocked() {
        assert_eq!(
            validate_transition(&AgentState::Idle, &AgentState::Completed),
            Err(TransitionError {
                from: AgentState::Idle,
                to: AgentState::Completed
            })
        );
    }

    #[test]
    fn thinking_can_go_to_waiting_approval() {
        assert!(
            validate_transition(&AgentState::Thinking, &AgentState::WaitingApproval).is_ok()
        );
    }

    #[test]
    fn thinking_can_go_to_running_tool() {
        assert!(validate_transition(&AgentState::Thinking, &AgentState::RunningTool).is_ok());
    }

    #[test]
    fn thinking_can_go_to_completed() {
        assert!(validate_transition(&AgentState::Thinking, &AgentState::Completed).is_ok());
    }

    #[test]
    fn thinking_can_go_to_failed() {
        assert!(validate_transition(&AgentState::Thinking, &AgentState::Failed).is_ok());
    }

    #[test]
    fn thinking_cannot_go_to_idle() {
        assert_eq!(
            validate_transition(&AgentState::Thinking, &AgentState::Idle),
            Err(TransitionError {
                from: AgentState::Thinking,
                to: AgentState::Idle
            })
        );
    }

    #[test]
    fn waiting_approval_can_go_to_running_tool() {
        assert!(
            validate_transition(&AgentState::WaitingApproval, &AgentState::RunningTool).is_ok()
        );
    }

    #[test]
    fn waiting_approval_can_go_to_failed() {
        assert!(
            validate_transition(&AgentState::WaitingApproval, &AgentState::Failed).is_ok()
        );
    }

    #[test]
    fn waiting_approval_cannot_go_to_thinking() {
        assert_eq!(
            validate_transition(&AgentState::WaitingApproval, &AgentState::Thinking),
            Err(TransitionError {
                from: AgentState::WaitingApproval,
                to: AgentState::Thinking
            })
        );
    }

    #[test]
    fn running_tool_can_return_to_thinking() {
        assert!(validate_transition(&AgentState::RunningTool, &AgentState::Thinking).is_ok());
    }

    #[test]
    fn running_tool_can_go_to_completed() {
        assert!(validate_transition(&AgentState::RunningTool, &AgentState::Completed).is_ok());
    }

    #[test]
    fn running_tool_can_go_to_failed() {
        assert!(validate_transition(&AgentState::RunningTool, &AgentState::Failed).is_ok());
    }

    #[test]
    fn completed_can_return_to_idle() {
        assert!(validate_transition(&AgentState::Completed, &AgentState::Idle).is_ok());
    }

    #[test]
    fn completed_cannot_go_to_thinking() {
        assert_eq!(
            validate_transition(&AgentState::Completed, &AgentState::Thinking),
            Err(TransitionError {
                from: AgentState::Completed,
                to: AgentState::Thinking
            })
        );
    }

    #[test]
    fn failed_can_return_to_idle() {
        assert!(validate_transition(&AgentState::Failed, &AgentState::Idle).is_ok());
    }

    #[test]
    fn failed_cannot_go_to_running_tool() {
        assert_eq!(
            validate_transition(&AgentState::Failed, &AgentState::RunningTool),
            Err(TransitionError {
                from: AgentState::Failed,
                to: AgentState::RunningTool
            })
        );
    }
}
