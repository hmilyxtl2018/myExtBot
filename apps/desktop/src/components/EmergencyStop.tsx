import Icon from "./Icon";

export default function EmergencyStop() {
  const handleStop = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("emergency_stop");
    } catch {
      // Tauri not available (dev browser mode)
      console.warn("Emergency stop invoked (stub)");
    }
  };

  return (
    <button className="btn btn-emergency" onClick={handleStop} title="Emergency Stop">
      <Icon name="stop" size={14} />
      Stop
    </button>
  );
}
