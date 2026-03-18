import { useMemo } from "react";
import type { AgentEvent } from "../models/events";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolStat {
  name: string;
  count: number;
  successRate: number;
  totalMs: number;
}

interface DayActivity {
  label: string;    // e.g. "周一"
  tasks: number;
  level: 0 | 1 | 2 | 3;  // heat level
}

// ── Stub profile used in dev/browser mode ─────────────────────────────────────

const STUB_IDENTITY = {
  name: "myExtBot",
  created: "2025-01-15",
  version: "v0.1.0",
  description: "你的智能数字分身，自动规划任务、调用工具并生成摘要回复。",
  tags: ["天气查询", "网络搜索", "屏幕操作", "信息分析", "任务规划"],
};

const STUB_STATS = {
  totalTasks: 42,
  successRate: 95,
  totalToolCalls: 118,
  avgResponseSec: 1.2,
  verifierPassRate: 88,
};

const STUB_TOOL_STATS: ToolStat[] = [
  { name: "fetch_weather",   count: 38, successRate: 100, totalMs: 680 },
  { name: "web_search",      count: 29, successRate:  97, totalMs: 820 },
  { name: "desktop.screenshot", count: 21, successRate: 100, totalMs: 240 },
  { name: "verify.screen_changed", count: 19, successRate: 89, totalMs: 310 },
  { name: "desktop.typeText", count: 11, successRate: 91, totalMs: 150 },
];

const STUB_ACTIVITY: DayActivity[] = [
  { label: "周一", tasks: 8,  level: 3 },
  { label: "周二", tasks: 5,  level: 2 },
  { label: "周三", tasks: 0,  level: 0 },
  { label: "周四", tasks: 12, level: 3 },
  { label: "周五", tasks: 7,  level: 2 },
  { label: "周六", tasks: 3,  level: 1 },
  { label: "周日", tasks: 7,  level: 2 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="profile-stat-card">
      <div className="profile-stat-value">{value}</div>
      <div className="profile-stat-label">{label}</div>
      {sub && <div className="profile-stat-sub">{sub}</div>}
    </div>
  );
}

function ToolBar({ tool, maxCount }: { tool: ToolStat; maxCount: number }) {
  const widthPct = Math.round((tool.count / Math.max(1, maxCount)) * 100);
  const avgMs = tool.count > 0 ? Math.round(tool.totalMs / tool.count) : 0;
  return (
    <div className="profile-tool-row">
      <span className="profile-tool-name">{tool.name}</span>
      <div className="profile-tool-track">
        <div className="profile-tool-fill" style={{ width: `${widthPct}%` }} />
      </div>
      <span className="profile-tool-count">{tool.count}次</span>
      <span className="profile-tool-rate">{tool.successRate}% / {avgMs}ms</span>
    </div>
  );
}

function HeatCell({ day }: { day: DayActivity }) {
  const cls = [
    "profile-heat-cell",
    `profile-heat-${day.level}`,
  ].join(" ");
  return (
    <div className="profile-heat-col">
      <div className={cls} title={`${day.label}: ${day.tasks} 个任务`} />
      <div className="profile-heat-label">{day.label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  events: AgentEvent[];
}

export default function ProfileDashboard({ events }: Props) {
  // Derive live stats from events when available
  const liveStats = useMemo(() => {
    let toolCallCount = 0;
    let toolCallSuccess = 0;
    const toolMap = new Map<string, { count: number; success: number; totalMs: number }>();

    for (const ev of events) {
      if (ev.type === "ToolCallResult") {
        toolCallCount++;
        if (ev.result.success) toolCallSuccess++;
        const entry = toolMap.get(ev.result.tool) ?? { count: 0, success: 0, totalMs: 0 };
        entry.count++;
        if (ev.result.success) entry.success++;
        entry.totalMs += ev.result.duration_ms;
        toolMap.set(ev.result.tool, entry);
      }
    }

    return { toolCallCount, toolCallSuccess, toolMap };
  }, [events]);

  const hasLiveData = liveStats.toolCallCount > 0;

  const stats = hasLiveData
    ? {
        totalTasks: 1,
        successRate: liveStats.toolCallCount > 0 ? Math.round(liveStats.toolCallSuccess / liveStats.toolCallCount * 100) : 0,
        totalToolCalls: liveStats.toolCallCount,
        avgResponseSec: 0,
        verifierPassRate: 0,
      }
    : STUB_STATS;

  const toolStats: ToolStat[] = hasLiveData
    ? [...liveStats.toolMap.entries()].map(([name, v]) => ({
        name,
        count: v.count,
        successRate: v.count > 0 ? Math.round(v.success / v.count * 100) : 0,
        totalMs: v.totalMs,
      })).sort((a, b) => b.count - a.count)
    : STUB_TOOL_STATS;

  const maxToolCount = toolStats[0]?.count ?? 1;

  return (
    <div className="profile-dashboard">
      {/* ── Identity section ── */}
      <section className="profile-identity">
        <div className="profile-avatar">
          <span className="profile-avatar-icon">🤖</span>
        </div>
        <div className="profile-identity-info">
          <div className="profile-name">{STUB_IDENTITY.name}</div>
          <div className="profile-meta">
            <span>版本 {STUB_IDENTITY.version}</span>
            <span className="profile-meta-sep">·</span>
            <span>创建于 {STUB_IDENTITY.created}</span>
          </div>
          <p className="profile-desc">{STUB_IDENTITY.description}</p>
        </div>
      </section>

      {/* ── Capability tags ── */}
      <section className="profile-section">
        <div className="profile-section-title">能力标签</div>
        <div className="profile-tags">
          {STUB_IDENTITY.tags.map((t) => (
            <span key={t} className="profile-tag">{t}</span>
          ))}
        </div>
      </section>

      {/* ── Stats cards ── */}
      <section className="profile-section">
        <div className="profile-section-title">执行概览</div>
        <div className="profile-stat-grid">
          <StatCard
            value={String(stats.totalTasks)}
            label="完成任务"
            sub="总计"
          />
          <StatCard
            value={`${stats.successRate}%`}
            label="成功率"
            sub="工具调用"
          />
          <StatCard
            value={String(stats.totalToolCalls)}
            label="工具调用"
            sub="总次数"
          />
          <StatCard
            value={hasLiveData ? "—" : `${stats.avgResponseSec}s`}
            label="平均响应"
            sub="每任务"
          />
        </div>
      </section>

      {/* ── Verifier pass rate ── */}
      <section className="profile-section">
        <div className="profile-section-title">验证通过率</div>
        <div className="profile-verifier-row">
          <div className="profile-gauge-track">
            <div
              className="profile-gauge-fill"
              style={{ width: `${hasLiveData ? 0 : stats.verifierPassRate}%` }}
            />
          </div>
          <span className="profile-gauge-label">
            {hasLiveData ? "—" : `${stats.verifierPassRate}%`}
          </span>
        </div>
        <p className="profile-gauge-hint">
          自动验证（截图对比、DOM 检查等）的通过比例，越高表示分身执行越稳健。
        </p>
      </section>

      {/* ── Tool usage distribution ── */}
      {toolStats.length > 0 && (
        <section className="profile-section">
          <div className="profile-section-title">工具使用分布</div>
          <div className="profile-tool-list">
            {toolStats.slice(0, 6).map((t) => (
              <ToolBar key={t.name} tool={t} maxCount={maxToolCount} />
            ))}
          </div>
        </section>
      )}

      {/* ── Weekly activity heatmap ── */}
      <section className="profile-section">
        <div className="profile-section-title">近7天活动</div>
        <div className="profile-heat-row">
          {STUB_ACTIVITY.map((d) => (
            <HeatCell key={d.label} day={d} />
          ))}
        </div>
        <p className="profile-gauge-hint">
          颜色越深代表当天任务量越多。灰色表示无活动。
        </p>
      </section>

      {!hasLiveData && (
        <div className="profile-stub-badge">演示数据</div>
      )}
    </div>
  );
}
