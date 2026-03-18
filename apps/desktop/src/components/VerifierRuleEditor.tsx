import { useState } from "react";

export interface VerifierRuleForm {
  id?: string;
  name: string;
  when: string;
  assertMode: "all" | "any";
  checks: CheckItem[];
  onFail: string[];
  scope: string;
}

interface CheckItem {
  id: string;
  type: "screen_changed" | "ocr_contains";
  threshold?: number;
  text?: string;
  region?: string;
}

interface Props {
  initial?: Partial<VerifierRuleForm>;
  onSave: (rule: VerifierRuleForm) => void;
  onCancel: () => void;
}

const TOOL_OPTIONS = [
  "desktop.clickRectCenter",
  "desktop.typeText",
  "desktop.screenshot",
  "cmd.run",
  "*",
];

function newCheckId(): string {
  return Math.random().toString(36).slice(2);
}

export default function VerifierRuleEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [when, setWhen] = useState(initial?.when ?? "desktop.clickRectCenter");
  const [assertMode, setAssertMode] = useState<"all" | "any">(initial?.assertMode ?? "all");
  const [checks, setChecks] = useState<CheckItem[]>(
    initial?.checks ?? [{ id: newCheckId(), type: "screen_changed", threshold: 0.05 }]
  );
  const [onFail, setOnFail] = useState<string[]>(initial?.onFail ?? ["ask_user"]);
  const [scope, setScope] = useState(initial?.scope ?? "task");

  const addCheck = () =>
    setChecks((prev) => [...prev, { id: newCheckId(), type: "screen_changed", threshold: 0.05 }]);

  const removeCheck = (id: string) =>
    setChecks((prev) => prev.filter((c) => c.id !== id));

  const updateCheck = (id: string, patch: Partial<CheckItem>) =>
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ id: initial?.id, name, when, assertMode, checks, onFail, scope });
  };

  return (
    <div className="verifier-rule-editor">
      <h3 className="editor-title">验证规则编辑器</h3>

      <label className="field-label">名称</label>
      <input
        className="field-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-rule"
      />

      <label className="field-label">触发工具 (when)</label>
      <select className="field-select" value={when} onChange={(e) => setWhen(e.target.value)}>
        {TOOL_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <label className="field-label">作用域 (scope)</label>
      <select className="field-select" value={scope} onChange={(e) => setScope(e.target.value)}>
        <option value="task">task（默认）</option>
        <option value="session">session</option>
        <option value="global">global</option>
      </select>

      <label className="field-label">断言模式</label>
      <div className="radio-group">
        {(["all", "any"] as const).map((m) => (
          <label key={m} className="radio-label">
            <input
              type="radio"
              value={m}
              checked={assertMode === m}
              onChange={() => setAssertMode(m)}
            />
            {m === "all" ? "所有检查通过" : "任一检查通过"}
          </label>
        ))}
      </div>

      <label className="field-label">检查项</label>
      {checks.map((check) => (
        <div key={check.id} className="check-item">
          <select
            className="field-select check-type"
            value={check.type}
            onChange={(e) =>
              updateCheck(check.id, { type: e.target.value as CheckItem["type"] })
            }
          >
            <option value="screen_changed">screen_changed（截图差异）</option>
            <option value="ocr_contains">ocr_contains（OCR 文字）</option>
          </select>

          {check.type === "screen_changed" && (
            <label className="inline-label">
              阈值
              <input
                type="number"
                className="field-input-sm"
                step="0.01"
                min="0"
                max="1"
                value={check.threshold ?? 0.05}
                onChange={(e) =>
                  updateCheck(check.id, { threshold: parseFloat(e.target.value) })
                }
              />
            </label>
          )}

          {check.type === "ocr_contains" && (
            <>
              <label className="inline-label">
                文字
                <input
                  className="field-input-sm"
                  value={check.text ?? ""}
                  onChange={(e) => updateCheck(check.id, { text: e.target.value })}
                  placeholder="需要包含的文字"
                />
              </label>
              <label className="inline-label">
                区域 (必填)
                <input
                  className="field-input-sm"
                  value={check.region ?? ""}
                  onChange={(e) => updateCheck(check.id, { region: e.target.value })}
                  placeholder='{"x":0,"y":0,"w":100,"h":50}'
                />
              </label>
            </>
          )}

          <button className="btn-remove" onClick={() => removeCheck(check.id)}>✕</button>
        </div>
      ))}
      <button className="btn-add-check" onClick={addCheck}>+ 添加检查项</button>

      <label className="field-label">失败处理建议 (on_fail)</label>
      <div className="checkbox-group">
        {["retry", "ask_user", "abort", "log_only"].map((opt) => (
          <label key={opt} className="checkbox-label">
            <input
              type="checkbox"
              checked={onFail.includes(opt)}
              onChange={(e) =>
                setOnFail((prev) =>
                  e.target.checked ? [...prev, opt] : prev.filter((v) => v !== opt)
                )
              }
            />
            {opt}
          </label>
        ))}
      </div>

      <div className="editor-actions">
        <button className="btn-save" onClick={handleSave} disabled={!name.trim()}>
          保存规则
        </button>
        <button className="btn-cancel" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
