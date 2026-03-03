/**
 * myExtBot – Frontend Application
 *
 * Bridges the Tauri IPC layer (when running inside the desktop app) with the
 * demo page UI.  Falls back to a local mock-data engine when loaded in a
 * plain browser so the page is previewable without the Tauri binary.
 */

// ── Tauri IPC bridge ──────────────────────────────────────────────────────────

const isTauri = typeof window.__TAURI__ !== 'undefined';

async function invoke(cmd, args = {}) {
  if (isTauri) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return MockBackend.invoke(cmd, args);
}

async function listen(event, handler) {
  if (isTauri) {
    return window.__TAURI__.event.listen(event, handler);
  }
  // MockBackend fires fake events via EventEmitter below
  MockEmitter.on(event, handler);
}

// ── Simple event emitter (browser-only) ───────────────────────────────────────

const MockEmitter = {
  _handlers: {},
  on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); },
  emit(event, payload) { (this._handlers[event] || []).forEach(fn => fn({ payload })); },
};

// ── Mock back-end data store ───────────────────────────────────────────────────

const MockBackend = (() => {
  const TEAM_ID = 'team-alpha';

  // Seeded agents
  const agents = [
    { id: 'a1', name: 'Alice-bot', role: 'pm',      team_id: TEAM_ID, is_local: true,  last_seen: ts(-5),  endpoint: null },
    { id: 'b1', name: 'Bob-bot',   role: 'backend',  team_id: TEAM_ID, is_local: false, last_seen: ts(-2),  endpoint: 'ws://localhost:8765' },
    { id: 'c1', name: 'Carol-bot', role: 'frontend', team_id: TEAM_ID, is_local: false, last_seen: ts(-60), endpoint: 'ws://localhost:8766' },
  ];

  // Seeded tasks
  const tasks = [
    { id: 't1', title: 'Add unit tests for auth module',   description: 'Cover login, logout, token refresh', status: 'done',        assigned_to: 'b1', delegated_by: 'a1', created_at: ts(-120), updated_at: ts(-30), result: JSON.stringify({coverage: '94%'}) },
    { id: 't2', title: 'Fix navbar collapse on mobile',    description: null,                                  status: 'in_progress', assigned_to: 'c1', delegated_by: 'a1', created_at: ts(-90),  updated_at: ts(-15), result: null },
    { id: 't3', title: 'Write API documentation',          description: 'OpenAPI 3 spec for /users endpoints', status: 'pending',     assigned_to: 'b1', delegated_by: 'a1', created_at: ts(-45),  updated_at: ts(-45), result: null },
    { id: 't4', title: 'Set up CI/CD pipeline',            description: null,                                  status: 'pending',     assigned_to: null, delegated_by: 'a1', created_at: ts(-20),  updated_at: ts(-20), result: null },
    { id: 't5', title: 'Performance audit – bundle size',  description: 'Target < 200 KB gzipped',            status: 'in_progress', assigned_to: 'c1', delegated_by: 'a1', created_at: ts(-10),  updated_at: ts(-3),  result: null },
  ];

  // Seeded collab messages
  const collabMessages = [
    { id: 'm1', from_agent: 'a1', to_agent: 'b1', task_id: 't1', msg_type: 'task_assigned',  payload: { title: 'Add unit tests for auth module' },  timestamp: ts(-120) },
    { id: 'm2', from_agent: 'b1', to_agent: 'a1', task_id: 't1', msg_type: 'task_update',    payload: { status: 'in_progress' },                      timestamp: ts(-60) },
    { id: 'm3', from_agent: 'b1', to_agent: 'a1', task_id: 't1', msg_type: 'task_result',    payload: { status: 'done', result: { coverage:'94%' } }, timestamp: ts(-30) },
    { id: 'm4', from_agent: 'a1', to_agent: 'c1', task_id: 't2', msg_type: 'task_assigned',  payload: { title: 'Fix navbar collapse on mobile' },     timestamp: ts(-90) },
    { id: 'm5', from_agent: 'c1', to_agent: 'a1', task_id: 't2', msg_type: 'task_update',    payload: { status: 'in_progress' },                      timestamp: ts(-15) },
    { id: 'm6', from_agent: 'a1', to_agent: 'b1', task_id: 't3', msg_type: 'task_assigned',  payload: { title: 'Write API documentation' },           timestamp: ts(-45) },
    { id: 'm7', from_agent: 'a1', to_agent: 'b1', task_id: null, msg_type: 'ping',           payload: {},                                             timestamp: ts(-5) },
  ];

  // Seeded audit logs
  const auditLogs = [
    { id: 7, timestamp: ts(-1),   event_type: 'permission_check', details: { action: 'emergency_stop', resource: '*',          decision: 'blocked_by_guardrail', reason: 'user triggered emergency stop' } },
    { id: 6, timestamp: ts(-2),   event_type: 'tool_call',        details: { tool: 'cmd.run',          arguments: {cmd:'ls'},  success: false, duration_ms: 3,    error: 'denied by user' } },
    { id: 5, timestamp: ts(-3),   event_type: 'permission_check', details: { action: 'tool_call',      resource: 'cmd.run',    decision: 'denied',               reason: 'call-id-002' } },
    { id: 4, timestamp: ts(-8),   event_type: 'tool_call',        details: { tool: 'fs.readFile',      arguments: {path:'/home/user/notes.txt'}, success: true, duration_ms: 42, error: null } },
    { id: 3, timestamp: ts(-8),   event_type: 'permission_check', details: { action: 'tool_call',      resource: 'fs.readFile', decision: 'approved',            reason: 'call-id-001' } },
    { id: 2, timestamp: ts(-10),  event_type: 'model_usage',      details: { model: 'gpt-4o',          prompt_tokens: 312,      completion_tokens: 187,           duration_ms: 1840 } },
    { id: 1, timestamp: ts(-120), event_type: 'model_usage',      details: { model: 'gpt-4o',          prompt_tokens: 0,        completion_tokens: 0,             duration_ms: 0 } },
  ];

  let nextTaskId = 10;
  let nextMsgId  = 20;

  function ts(minutesAgo) {
    return new Date(Date.now() + minutesAgo * 60_000).toISOString();
  }

  return {
    invoke(cmd, args) {
      switch (cmd) {
        case 'get_team_agents':
          return Promise.resolve(agents.filter(a => a.team_id === args.team_id));

        case 'get_tasks':
          return Promise.resolve([...tasks].reverse().slice(args.offset || 0, (args.offset || 0) + (args.limit || 50)));

        case 'get_collab_messages':
          return Promise.resolve([...collabMessages].reverse().slice(0, args.limit || 50));

        case 'get_audit_logs':
          return Promise.resolve(auditLogs.slice(0, args.limit || 50));

        case 'register_agent': {
          const idx = agents.findIndex(a => a.id === args.id);
          if (idx >= 0) Object.assign(agents[idx], args);
          else agents.push({ ...args, last_seen: new Date().toISOString() });
          return Promise.resolve();
        }

        case 'delegate_task': {
          const id = `t${nextTaskId++}`;
          const now = new Date().toISOString();
          const task = {
            id, title: args.title, description: args.description || null,
            status: 'pending', assigned_to: args.assigned_to || null,
            delegated_by: args.delegated_by, created_at: now, updated_at: now, result: null,
          };
          tasks.push(task);
          if (args.assigned_to) {
            const from = agents.find(a => a.id === args.delegated_by);
            const to   = agents.find(a => a.id === args.assigned_to);
            const msg = { id: `m${nextMsgId++}`, from_agent: args.delegated_by, to_agent: args.assigned_to, task_id: id, msg_type: 'task_assigned', payload: { title: args.title }, timestamp: now };
            collabMessages.push(msg);
            MockEmitter.emit('collab-message', msg);
          }
          return Promise.resolve({ id, title: args.title, status: 'pending', assigned_to: args.assigned_to, delegated_by: args.delegated_by, created_at: now });
        }

        case 'update_task_status': {
          const task = tasks.find(t => t.id === args.task_id);
          if (task) { task.status = args.status; task.updated_at = new Date().toISOString(); if (args.result) task.result = JSON.stringify(args.result); }
          const now = new Date().toISOString();
          const isFinal = ['done','failed','cancelled'].includes(args.status);
          const msg = { id: `m${nextMsgId++}`, from_agent: args.from_agent, to_agent: args.to_agent, task_id: args.task_id, msg_type: isFinal ? 'task_result' : 'task_update', payload: { status: args.status }, timestamp: now };
          collabMessages.push(msg);
          MockEmitter.emit('collab-message', msg);
          return Promise.resolve();
        }

        case 'send_message': {
          // Simulate bot reply after short delay
          setTimeout(() => {
            const reply = makeBotReply(args.content);
            MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'Thinking' });
            setTimeout(() => {
              MockEmitter.emit('agent-event', { type: 'ChatMessage', message: { id: uid(), role: 'assistant', content: reply.text, html: reply.html || null, timestamp: new Date().toISOString() } });
              if (reply.toolCall) {
                setTimeout(() => {
                  MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'WaitingApproval' });
                  MockEmitter.emit('agent-event', { type: 'ToolCallRequest', request: reply.toolCall });
                }, 800);
              } else {
                MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'Idle' });
              }
            }, 1200);
          }, 300);
          return Promise.resolve();
        }

        case 'emergency_stop':
          MockEmitter.emit('agent-event', { type: 'EmergencyStop' });
          MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'Stopped' });
          return Promise.resolve();

        case 'approve_tool_call': {
          setTimeout(() => {
            MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'RunningTool' });
            setTimeout(() => {
              MockEmitter.emit('agent-event', { type: 'ToolCallResult', result: { id: args.call_id, tool: args.tool, success: true, output: { content: 'File read successfully.\n\n# Notes\n- Meeting at 10am\n- Deploy v2.1 today' }, error: null, duration_ms: 38, timestamp: new Date().toISOString() } });
              MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'Completed' });
            }, 900);
          }, 200);
          return Promise.resolve();
        }

        case 'deny_tool_call':
          MockEmitter.emit('agent-event', { type: 'StatusChanged', status: 'Idle' });
          return Promise.resolve();

        default:
          return Promise.resolve();
      }
    }
  };

})();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Agents last seen within this window are shown as "Online". */
const ONLINE_THRESHOLD_MS = 10 * 60_000; // 10 minutes

function uid() { return Math.random().toString(36).slice(2); }

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60_000)         return 'just now';
  if (diffMs < 3_600_000)      return `${Math.floor(diffMs/60_000)}m ago`;
  if (diffMs < 86_400_000)     return `${Math.floor(diffMs/3_600_000)}h ago`;
  if (diffMs < 604_800_000)    return `${Math.floor(diffMs/86_400_000)}d ago`;
  return d.toLocaleDateString();
}

function fmtTimeFull(iso) {
  return new Date(iso).toLocaleString();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function makeBotReply(content) {
  const lower = content.toLowerCase();
  if (lower.includes('analyze this intelligence signal') || lower.includes('intelligence signal') ||
      lower.includes('strategic implication') || lower.includes('trend driver')) {
    const isMilitary = lower.includes('pentagon') || lower.includes('nato') || lower.includes('military') ||
      lower.includes('pla') || lower.includes('hypersonic') || lower.includes('space force') ||
      lower.includes('drone') || lower.includes('idf') || lower.includes('battlefield');
    // Extract signal title from between the first pair of double-quotes in the message
    const titleMatch = content.match(/"([^"]{3,})"/);
    const signalTitle = titleMatch ? titleMatch[1] : (isMilitary ? 'Military intelligence signal' : 'AI technology signal');
    const domainKey = isMilitary ? 'military' : 'ai_tech';
    return { text: '', html: makeIntelAnalysisHtml(domainKey, signalTitle), toolCall: null };
  }
  if (lower.includes('military') || lower.includes('defense') || lower.includes('weapon') || lower.includes('warfare')) {
    return { text: "🎖 For military intelligence analysis, head to the **Intel** tab → filter by 🎖 Military to see all tracked signals. You can click **🤖 Ask Bot** on any signal for a contextual deep-dive.", toolCall: null };
  }
  if (lower.includes('ai tech') || lower.includes('ai technology') || lower.includes('llm') || lower.includes('large language')) {
    return { text: "🤖 For AI Technology trend analysis, head to the **Intel** tab → filter by 🤖 AI Technology. The domain card shows 12-week momentum and sub-topic coverage. Use **🤖 Ask Bot** on any signal for strategic implications.", toolCall: null };
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('notes')) {
    return {
      text: "Sure! I'll read the file for you. I need your permission to access the filesystem.",
      toolCall: {
        id: uid(), tool: 'fs.readFile',
        params: { path: '/home/user/notes.txt', encoding: 'utf-8' },
        risk: 'low',
        description: 'Read the contents of /home/user/notes.txt',
        timestamp: new Date().toISOString(),
      },
    };
  }
  if (lower.includes('run') || lower.includes('exec') || lower.includes('command') || lower.includes('shell')) {
    return {
      text: "I can run that command. This requires elevated permission — please review the command before approving.",
      toolCall: {
        id: uid(), tool: 'cmd.run',
        params: { command: 'ls -la /home/user', timeout_ms: 5000 },
        risk: 'high',
        description: 'Execute: ls -la /home/user',
        timestamp: new Date().toISOString(),
      },
    };
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return { text: "Hello! 👋 I'm your digital-twin bot. I can help you manage files, run commands, browse the web, and coordinate with your teammates. What would you like to do?", toolCall: null };
  }
  if (lower.includes('team') || lower.includes('task') || lower.includes('delegate')) {
    return { text: "Great idea! Head over to the **Team** tab to see your teammates and delegate tasks to them. Each bot in your team can take on work independently and report back when done.", toolCall: null };
  }
  if (lower.includes('audit') || lower.includes('log')) {
    return { text: "You can view the full audit trail in the **Audit** tab. Every model call, tool execution, and permission decision is recorded with timestamps.", toolCall: null };
  }
  return { text: "I'm on it! Let me think about the best approach for that request. In a real deployment I'd be calling the LLM API here — for the demo, try asking me to **read a file**, **run a command**, or check the **team** tab.", toolCall: null };
}

// ── Intel Watch — domain definitions ─────────────────────────────────────────

const INTEL_DOMAINS = {
  military: {
    key: 'military',
    label: '🎖 Military',
    color: '#4f5bd5',
    weeklySignals: [38, 42, 35, 48, 55, 51, 60, 63, 58, 72, 78, 74],
    prev30d: 182,
    curr30d: 226,
    subTopics: ['Autonomous weapons', 'Cyber warfare', 'Space military', 'AI command systems', 'Defense procurement'],
    trackingSince: '2024-03-01',
  },
  ai_tech: {
    key: 'ai_tech',
    label: '🤖 AI Technology',
    color: '#6d5ef3',
    weeklySignals: [58, 52, 68, 74, 82, 90, 78, 105, 98, 118, 135, 142],
    prev30d: 311,
    curr30d: 520,
    subTopics: ['Large language models', 'Autonomous agents', 'AI regulation', 'AI safety', 'Hardware / chips'],
    trackingSince: '2024-01-15',
  },
};

/** Returns ISO timestamp offset by `hoursAgo` hours from now. */
function tsAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

const INTEL_SIGNALS = [
  /* ── AI Technology ─────────────────────────────────────────────────────── */
  { id:'is1',  domain:'ai_tech',  significance:'critical',
    title:'DeepMind releases world model with autonomous multi-step planning',
    summary:'Demonstrates unprecedented long-horizon task completion in open-ended environments without human-defined reward functions. Benchmark results exceed all prior published systems.',
    keywords:['world model','autonomous planning','DeepMind'], source:'Nature', timestamp: tsAgo(2) },
  { id:'is2',  domain:'ai_tech',  significance:'critical',
    title:'GPT-5 achieves top-1% on SWE-bench with autonomous tool orchestration',
    summary:'Full autonomous software-engineering capability now demonstrated. Implications for knowledge-work automation are significant; paired with code execution gives agent near-complete dev-loop closure.',
    keywords:['GPT-5','SWE-bench','code generation','OpenAI'], source:'OpenAI Blog', timestamp: tsAgo(6) },
  { id:'is3',  domain:'ai_tech',  significance:'high',
    title:"Anthropic Claude 4 reaches 98.3% on MMLU — surpasses human expert baseline",
    summary:'Sets a new record across 57 academic disciplines. Constitutional AI v3 training shows measurable alignment improvement alongside capability gains.',
    keywords:['Anthropic','Claude 4','MMLU','alignment'], source:'Anthropic Research', timestamp: tsAgo(12) },
  { id:'is4',  domain:'ai_tech',  significance:'high',
    title:'EU AI Act enforcement phase 1 begins — 47 foundation model providers file compliance reports',
    summary:'Compliance costs estimated at €12–18M average per provider. Open-source exemptions still under legal debate; SME impact assessment ongoing.',
    keywords:['EU AI Act','regulation','compliance','GPAI'], source:'EU Commission', timestamp: tsAgo(30) },
  { id:'is5',  domain:'ai_tech',  significance:'medium',
    title:'Stanford AI Index 2025: inference compute cost drops 68% year-over-year',
    summary:'Rapidly falling costs accelerate deployment across healthcare, legal, and education. Regulatory readiness gap widens as capabilities expand faster than governance frameworks.',
    keywords:['compute cost','inference','Stanford AI Index','trends'], source:'Stanford HAI', timestamp: tsAgo(48) },
  { id:'is6',  domain:'ai_tech',  significance:'medium',
    title:'Google integrates Gemini Ultra into Android — 1.2 B device rollout begins',
    summary:'On-device 7B parameter inference with privacy-preserving local context; first at-scale deployment of multimodal AI in consumer OS.',
    keywords:['Gemini','Android','on-device','Google'], source:'Google Blog', timestamp: tsAgo(96) },
  { id:'is7',  domain:'ai_tech',  significance:'low',
    title:'Hugging Face passes 1 million public model repositories',
    summary:'Open-source AI ecosystem growth accelerates; average model download rate up 340% vs 2023. Consolidation visible — top 50 repos account for 78% of downloads.',
    keywords:['Hugging Face','open source','model hub','ecosystem'], source:'Hugging Face Blog', timestamp: tsAgo(120) },

  /* ── Military ──────────────────────────────────────────────────────────── */
  { id:'is8',  domain:'military', significance:'critical',
    title:'Pentagon releases doctrine for AI-assisted autonomous battlefield decisions',
    summary:'First formal US military doctrine authorising AI systems to recommend fire solutions in low-latency contested environments. Allies briefed; international law community divided.',
    keywords:['Pentagon','autonomous weapons','AI doctrine','DoD'], source:'DoD Press', timestamp: tsAgo(1) },
  { id:'is9',  domain:'military', significance:'high',
    title:'NATO Project Diana selects 12 dual-use AI startups for battlefield integration pilots',
    summary:'Selected companies focus on ISR data fusion, logistics optimisation, and AI-driven comms resilience across degraded-spectrum environments.',
    keywords:['NATO','dual-use AI','battlefield','Project Diana'], source:'NATO HQ', timestamp: tsAgo(4) },
  { id:'is10', domain:'military', significance:'high',
    title:'China unveils AI-guided counter-hypersonic intercept layer in PLA Air Defense',
    summary:'Satellite imagery and official statements confirm deployment of AI targeting in next-gen surface-to-air systems. Intercept window reportedly cut from 9s to 4s.',
    keywords:['China','PLA','hypersonic','AI air defense'], source:'SCMP', timestamp: tsAgo(8) },
  { id:'is11', domain:'military', significance:'medium',
    title:'US Space Force awards $2.1B contract for AI-enhanced orbital surveillance mesh',
    summary:'System integrates ML anomaly detection across 4,000+ tracked objects to provide real-time debris and threat assessment. Launch window: 18 months.',
    keywords:['Space Force','orbital surveillance','AI','satellite'], source:'Defense News', timestamp: tsAgo(50) },
  { id:'is12', domain:'military', significance:'medium',
    title:'South Korea deploys AI border patrol drones along DMZ — autonomous mode pending approval',
    summary:'Drones use computer vision and acoustic sensors. Human-in-the-loop approval still required for any kinetic action; OSCE observers on-site.',
    keywords:['South Korea','DMZ','autonomous drones','border'], source:'Reuters', timestamp: tsAgo(72) },
  { id:'is13', domain:'military', significance:'low',
    title:'Israel trials AI-powered logistics optimisation in IDF supply chain',
    summary:'Pilot reduces supply-chain latency by 31% and human coordination errors by 44% in controlled trials. Full deployment decision expected Q3.',
    keywords:['IDF','logistics AI','supply chain','Israel'], source:'Haaretz', timestamp: tsAgo(144) },
];

// ── Intel Watch — rendering ───────────────────────────────────────────────────

/**
 * Generates an inline SVG area-line sparkline.
 * Uses a fixed viewBox + width="100%" so it scales to any container width.
 * @param {number[]} data   Array of numeric values (≥ 2 elements)
 * @param {number}   height SVG height in px
 * @param {string}   color  Stroke / fill colour
 */
function svgSparkline(data, height, color) {
  const W = 300; // logical viewBox width (scales to container via CSS)
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step  = W / (data.length - 1);
  const pts   = data.map((v, i) => {
    const x = +(i * step).toFixed(1);
    const y = +(height - 4 - ((v - min) / range) * (height - 8)).toFixed(1);
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  const area = `0,${height} ${line} ${W},${height}`;
  return `<svg width="100%" height="${height}" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
    `<polygon points="${area}" fill="${color}" fill-opacity="0.14"/>` +
    `<polyline points="${line}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `</svg>`;
}

/** Concise trend narratives keyed by domain. */
const INTEL_NARRATIVES = {
  military: 'Signal velocity has climbed 24% MoM, driven by a cluster of AI-autonomy doctrine announcements. Watch China PLA procurement and NATO standardisation decisions as lead indicators for the next acceleration phase.',
  ai_tech:  'AI Technology is in a hyper-acceleration phase (+67% MoM). Capability-cost compression is outpacing regulatory response. Critical signals are concentrated around agentic/autonomous systems — the highest-risk inflection zone.',
};

/**
 * Builds a rich HTML intel analysis card for embedding in a chat message bubble.
 * Includes an inline sparkline chart, a 30-day stats grid, a horizontal significance
 * breakdown bar chart, strategic driver cards, and a trend assessment box.
 *
 * @param {'military'|'ai_tech'} domainKey
 * @param {string} signalTitle  The specific signal title being analyzed
 * @returns {string} Safe HTML string (all user-supplied strings are escaped)
 */
function makeIntelAnalysisHtml(domainKey, signalTitle) {
  const d = INTEL_DOMAINS[domainKey];
  if (!d) return '';

  const pct      = d.prev30d > 0 ? Math.round((d.curr30d / d.prev30d - 1) * 100) : 0;
  const dir      = pct >= 5 ? '↑' : pct <= -5 ? '↓' : '→';
  const trendCls = pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'flat';
  const velocity = (d.curr30d / 30).toFixed(1);

  // Signal breakdown by significance
  const domainSigs = INTEL_SIGNALS.filter(s => s.domain === domainKey);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  domainSigs.forEach(s => { if (s.significance in counts) counts[s.significance]++; });
  const total = domainSigs.length || 1;

  // Inline sparkline — 44px height matches the stats grid row height
  const sparkSvg = svgSparkline(d.weeklySignals, 44, d.color);

  // Significance breakdown bar rows
  const sigRows = [
    { key: 'critical', label: '🔴 Critical', color: 'var(--red)' },
    { key: 'high',     label: '🟠 High',     color: 'var(--orange)' },
    { key: 'medium',   label: '🟡 Medium',   color: 'var(--yellow)' },
    { key: 'low',      label: '🔵 Low',      color: 'var(--blue)' },
  ].map(({ key, label, color }) => {
    const pctBar = Math.round((counts[key] / total) * 100);
    return `<div class="ibar-row">
      <span class="ibar-label">${label}</span>
      <div class="ibar-track"><div class="ibar-fill" style="width:${pctBar}%;background:${color}"></div></div>
      <span class="ibar-val">${counts[key]}</span>
    </div>`;
  }).join('');

  // Strategic driver cards
  const isMilitary = domainKey === 'military';
  const drivers = isMilitary ? [
    { icon: '⚡', title: 'Speed asymmetry',
      body: 'AI targeting/command loops operate in milliseconds vs. human reaction times of seconds — shifting the OODA loop advantage toward the technologically superior actor.' },
    { icon: '⚖️', title: 'Deterrence dynamics',
      body: 'Autonomous weapons challenge traditional escalation ladders; attribution ambiguity between AI-assisted and fully autonomous actions raises miscalculation risk between peer powers.' },
    { icon: '🤝', title: 'Alliance strain',
      body: 'NATO member divergence on human-in-the-loop requirements may create doctrine, capability, and legal incompatibilities at the point of combined-arms integration.' },
  ] : [
    { icon: '💸', title: 'Capability-cost compression',
      body: 'Inference costs falling ~68% YoY dramatically lowers the economic barrier to large-scale deployment, accelerating adoption curves across all sectors simultaneously.' },
    { icon: '⏱', title: 'Regulatory lag',
      body: 'Governance frameworks (EU AI Act, US EO) trail capability curves by 18–24 months, creating a structural grey zone that concentrates liability and reputational risk on deployers.' },
    { icon: '🏭', title: 'Concentration risk',
      body: 'A small number of frontier labs control access to transformative models; geopolitical decoupling of advanced chip supply chains adds systemic fragility to the entire capability stack.' },
  ];

  const driverCards = drivers.map(dr =>
    `<div class="ia-driver">
      <span class="ia-driver-icon">${dr.icon}</span>
      <div class="ia-driver-body">
        <div class="ia-driver-title">${escHtml(dr.title)}</div>
        <div class="ia-driver-text">${escHtml(dr.body)}</div>
      </div>
    </div>`
  ).join('');

  const trendText = isMilitary
    ? `The 12-week Military signal index shows a ${dir}${Math.abs(pct)}% MoM acceleration, consistent with early-majority doctrine adoption. Monitor China PLA procurement and NATO standardisation cycles as leading indicators for the next phase.`
    : `AI Tech signal velocity is ${velocity} signals/day and accelerating ${dir}${Math.abs(pct)}% MoM. We are likely past the inflection point on AGI-precursor systems. Watch frontier lab safety publication cadence as a leading indicator of capability-alignment gaps.`;

  return `<div class="intel-analysis-card">
  <div class="ia-domain-hdr">
    <span class="ia-domain-lbl">${d.label}</span>
    <span class="ia-trend-badge ia-trend-${trendCls}">${dir}&thinsp;${Math.abs(pct)}%&thinsp;MoM</span>
  </div>
  <div class="ia-section-lbl">Analyzed signal</div>
  <div class="ia-sig-ref">&ldquo;${escHtml(signalTitle)}&rdquo;</div>
  <div class="ia-two-col">
    <div>
      <div class="ia-section-lbl">12-week signal trend</div>
      <div class="ia-sparkwrap">${sparkSvg}</div>
      <div class="ia-spark-caption">weekly signal count</div>
    </div>
    <div>
      <div class="ia-section-lbl">30-day statistics</div>
      <div class="ia-stats-grid">
        <div class="ia-stat"><span class="ia-stat-val">${d.curr30d}</span><span class="ia-stat-key">signals</span></div>
        <div class="ia-stat"><span class="ia-stat-val">${velocity}</span><span class="ia-stat-key">/ day</span></div>
        <div class="ia-stat"><span class="ia-stat-val" style="color:var(--red)">${counts.critical}</span><span class="ia-stat-key">critical</span></div>
        <div class="ia-stat"><span class="ia-stat-val" style="color:var(--orange)">${counts.high}</span><span class="ia-stat-key">high</span></div>
      </div>
    </div>
  </div>
  <div class="ia-section-lbl">Signal significance breakdown</div>
  <div class="ia-bar-chart">${sigRows}</div>
  <div class="ia-section-lbl">Key strategic drivers</div>
  <div class="ia-drivers">${driverCards}</div>
  <div class="ia-trend-box">
    <div class="ia-trend-box-lbl">📈 Long-term trend assessment</div>
    <div class="ia-trend-box-txt">${escHtml(trendText)}</div>
  </div>
</div>`;
}

function renderDomainCards() {
  const idMap = { military: 'domain-card-military', ai_tech: 'domain-card-ai-tech' };
  Object.values(INTEL_DOMAINS).forEach(d => {
    const el = $(`#${idMap[d.key]}`);
    if (!el) return;
    const pct      = Math.round((d.curr30d / d.prev30d - 1) * 100);
    const dir      = pct >= 5 ? '↑' : pct <= -5 ? '↓' : '→';
    const trendCls = pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'flat';
    const sparkSvg = svgSparkline(d.weeklySignals, 46, d.color);
    const critCount = INTEL_SIGNALS.filter(s => s.domain === d.key && s.significance === 'critical').length;
    const highCount = INTEL_SIGNALS.filter(s => s.domain === d.key && s.significance === 'high').length;
    const velocity  = (d.curr30d / 30).toFixed(1);
    const since     = new Date(d.trackingSince).toLocaleDateString(undefined, { year:'numeric', month:'short' });
    const narrative = INTEL_NARRATIVES[d.key] || '';
    el.innerHTML = `
      <div class="domain-card-header domain-card-filter-btn" data-domain="${d.key}" title="Click to filter signals to this domain" role="button" tabindex="0">
        <span class="domain-label">${d.label}</span>
        <span class="domain-trend ${trendCls}">${dir} ${Math.abs(pct)}%</span>
      </div>
      <div class="domain-sparkline">${sparkSvg}
        <div class="domain-sparkline-caption">12-week signal trend</div>
      </div>
      <div class="domain-stats">
        <div class="domain-stat">
          <span class="domain-stat-val">${d.curr30d}</span>
          <span class="domain-stat-key">signals (30d)</span>
        </div>
        <div class="domain-stat">
          <span class="domain-stat-val">${velocity}</span>
          <span class="domain-stat-key">signals / day</span>
        </div>
        <div class="domain-stat">
          <span class="domain-stat-val" style="color:var(--red)">${critCount}</span>
          <span class="domain-stat-key">critical</span>
        </div>
        <div class="domain-stat">
          <span class="domain-stat-val" style="color:var(--orange)">${highCount}</span>
          <span class="domain-stat-key">high</span>
        </div>
      </div>
      <div class="domain-subtopics">${d.subTopics.map(t => `<span class="domain-topic-pill">${escHtml(t)}</span>`).join('')}</div>
      ${narrative ? `<div class="domain-narrative">${escHtml(narrative)}</div>` : ''}
      <div class="domain-tracking-since">🗓 Tracking since ${since}</div>`;
  });
}

function renderSignalFeed(domainFilter, sigFilter, sortOrder) {
  const list = $('#intel-signal-list');
  if (!list) return;
  domainFilter = domainFilter || 'all';
  sigFilter    = sigFilter    || 'all';
  sortOrder    = sortOrder    || 'newest';

  let signals = INTEL_SIGNALS.slice(); // copy
  if (domainFilter !== 'all') signals = signals.filter(s => s.domain === domainFilter);
  if (sigFilter    !== 'all') signals = signals.filter(s => s.significance === sigFilter);

  // Sort
  const sigOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  if (sortOrder === 'newest')     signals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  else if (sortOrder === 'oldest') signals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  else if (sortOrder === 'significance') signals.sort((a, b) => (sigOrder[a.significance]||9) - (sigOrder[b.significance]||9));

  // Update count badge
  const countEl = $('#intel-signal-count');
  const total   = INTEL_SIGNALS.length;
  const showing = signals.length;
  if (countEl) {
    countEl.textContent = showing === total ? `${total} signals` : `${showing} / ${total}`;
    countEl.classList.toggle('filtered', showing !== total);
  }

  if (!signals.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><p>No signals match the current filters.</p></div>';
    return;
  }

  const domLbl = { military:'🎖 Military', ai_tech:'🤖 AI Tech' };
  const sigCfg = {
    critical: { cls:'critical', badge:'🔴 CRITICAL' },
    high:     { cls:'high',     badge:'🟠 HIGH' },
    medium:   { cls:'medium',   badge:'🟡 MEDIUM' },
    low:      { cls:'low',      badge:'🔵 LOW' },
  };

  list.innerHTML = signals.map(s => {
    const sc  = sigCfg[s.significance] || sigCfg.low;
    const kws = s.keywords.map(k => `<span class="signal-kw">${escHtml(k)}</span>`).join('');
    return `<div class="signal-card sig-${sc.cls}">
      <div class="signal-card-header">
        <span class="sig-badge sig-badge-${sc.cls}">${sc.badge}</span>
        <span class="sig-domain">${domLbl[s.domain] || s.domain}</span>
        <span class="sig-source">${escHtml(s.source)}</span>
        <span class="sig-time">${fmtTime(s.timestamp)}</span>
      </div>
      <div class="signal-title">${escHtml(s.title)}</div>
      <div class="signal-summary">${escHtml(s.summary)}</div>
      <div class="signal-footer">
        <div class="signal-keywords">${kws}</div>
        <button class="btn-analyze-signal" data-signal-title="${escHtml(s.title)}">🤖 Ask Bot</button>
      </div>
    </div>`;
  }).join('');
}

/** Tracks when the intel view was last loaded (for the live scan chip). */
let _intelLastRefresh = null;
let _intelScanTimer   = null;

function updateScanChip() {
  if (!_intelLastRefresh) return;
  const chipEl    = $('#intel-scan-chip-text');
  const nextEl    = $('#intel-next-scan');
  const INTERVAL  = 30 * 60; // 30-min scan interval in seconds
  const elapsed   = Math.round((Date.now() - _intelLastRefresh) / 1000);
  const remaining = Math.max(0, INTERVAL - elapsed);
  const elapsedStr  = elapsed  < 60 ? `${elapsed}s ago`  : `${Math.floor(elapsed/60)}m ago`;
  const remainStr   = remaining < 60 ? `${remaining}s`    : `${Math.ceil(remaining/60)}m`;
  if (chipEl) chipEl.textContent = `Tracking 2 domains · Last scan: ${elapsedStr}`;
  if (nextEl) nextEl.textContent = `Next scan in ${remainStr}`;
}

function loadIntelView() {
  _intelLastRefresh = Date.now();
  // Restart the live chip timer
  if (_intelScanTimer) clearInterval(_intelScanTimer);
  _intelScanTimer = setInterval(updateScanChip, 10_000);
  updateScanChip();

  renderDomainCards();

  // Wire domain-card click-to-filter (event delegation on the cards container)
  const cardsEl = $('#intel-domains-container');
  if (cardsEl && !cardsEl._filterBound) {
    cardsEl._filterBound = true;
    cardsEl.addEventListener('click', e => {
      const btn = e.target.closest('.domain-card-filter-btn');
      if (!btn) return;
      const domain = btn.dataset.domain;
      const domSel = $('#intel-domain-filter');
      if (domSel && domain) {
        domSel.value = domain;
        renderSignalFeed(domSel.value, $('#intel-sig-filter')?.value, $('#intel-sort-select')?.value);
      }
    });
    cardsEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const btn = e.target.closest('.domain-card-filter-btn');
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });
  }

  renderSignalFeed(
    $('#intel-domain-filter')?.value || 'all',
    $('#intel-sig-filter')?.value    || 'all',
    $('#intel-sort-select')?.value   || 'newest'
  );
}

// ── Application state ─────────────────────────────────────────────────────────

const State = {
  activeTab: 'chat',
  agentStatus: 'Idle',
  messages: [],
  planSteps: [],
  pendingToolCall: null,
  agents: [],
  tasks: [],
  collabMessages: [],
  auditLogs: [],
  teamId: 'team-alpha',
  localAgentId: 'a1',
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── Mode switching (Solo Bot ↔ Team) ──────────────────────────────────────────

function switchMode(mode) {
  // Update mode-switch pill buttons
  $$('.mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );

  // Show/hide mode-specific nav-tabs
  $$('.nav-tab[data-mode-only]').forEach(tab => {
    const hidden = tab.dataset.modeOnly !== mode;
    tab.classList.toggle('mode-hidden', hidden);
    if (hidden && tab.classList.contains('active')) {
      tab.classList.remove('active');
    }
  });

  // Jump to the default tab for this mode
  switchTab(mode === 'team' ? 'team' : 'chat');
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  State.activeTab = tab;
  $$('.nav-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${tab}`));
  if (tab === 'team')  loadTeamView();
  if (tab === 'audit') loadAuditView();
  if (tab === 'intel') loadIntelView();
}

// ── Status indicator ──────────────────────────────────────────────────────────

function updateStatusIndicator(status) {
  State.agentStatus = status;
  const dot   = $('#status-dot');
  const label = $('#status-label');
  const map = {
    Idle:            ['idle',      '⬤ Idle'],
    Thinking:        ['thinking',  '⬤ Thinking…'],
    WaitingApproval: ['waiting',   '⬤ Awaiting approval'],
    RunningTool:     ['running',   '⬤ Running tool'],
    Stopped:         ['stopped',   '⬤ Stopped'],
    Completed:       ['idle',      '⬤ Completed'],
    Failed:          ['stopped',   '⬤ Failed'],
  };
  const [cls, text] = map[status] || ['idle', `⬤ ${status}`];
  dot.className = `status-dot ${cls}`;
  label.textContent = text;

  // Also update sidebar status card
  const scDot   = $('#sc-status-dot');
  const scLabel = $('#sc-status-label');
  if (scDot)   scDot.className   = `status-dot ${cls}`;
  if (scLabel) scLabel.textContent = text;

  // Disable send button while busy
  const sendBtn = $('#btn-send');
  const busy = ['Thinking','RunningTool'].includes(status);
  if (sendBtn) sendBtn.disabled = busy;
}

// ── Chat view ──────────────────────────────────────────────────────────────────

function appendMessage(role, content, id, opts = {}) {
  const thread = $('#chat-messages');
  const isUser = role === 'user';
  const isSystem = role === 'system';

  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.dataset.id = id || uid();

  if (isSystem) {
    el.innerHTML = `<div class="msg-bubble">${escHtml(content)}</div>`;
  } else {
    const avatarEmoji = isUser ? '👤' : '🤖';
    const name = isUser ? 'You' : 'Alice-bot';
    const isRich = !isUser && opts.html != null && opts.html !== '';
    if (isRich) el.classList.add('rich');
    const bubbleClass = isRich ? 'msg-bubble msg-bubble-rich' : 'msg-bubble';
    const bubbleContent = isRich ? opts.html : escHtml(content);
    el.innerHTML = `
      <div class="msg-avatar">${avatarEmoji}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name">${name}</span>
          <span class="msg-time">${fmtTime(new Date().toISOString())}</span>
        </div>
        <div class="${bubbleClass}">${bubbleContent}</div>
      </div>`;
  }

  // Remove typing indicator if present
  const typing = $('#typing-indicator');
  if (typing) typing.remove();

  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

function showTyping() {
  const thread = $('#chat-messages');
  if ($('#typing-indicator')) return;
  const el = document.createElement('div');
  el.id = 'typing-indicator';
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function removeTyping() {
  const el = $('#typing-indicator');
  if (el) el.remove();
}

function appendToolResult(result) {
  const thread = $('#chat-messages');
  const el = document.createElement('div');
  el.className = `message tool-result`;
  const cls = result.success ? 'success' : 'failure';
  const icon = result.success ? '✅' : '❌';
  const outputStr = result.output ? JSON.stringify(result.output, null, 2) : result.error || 'no output';
  el.innerHTML = `
    <div class="msg-avatar">🔧</div>
    <div class="tool-result-bubble ${cls}">
      <div class="tool-header">${icon} ${escHtml(result.tool)} <span style="opacity:.6;font-weight:400">${result.duration_ms}ms</span></div>
      <pre>${escHtml(outputStr)}</pre>
    </div>`;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function renderPendingToolCall(request) {
  State.pendingToolCall = request;
  const container = $('#pending-approval');
  if (!container) return;

  const riskCls = (request.risk || 'medium').toLowerCase();
  container.innerHTML = `
    <div class="approval-card">
      <div class="approval-header">
        <span class="risk-badge ${riskCls}">${(request.risk || 'medium').toUpperCase()} RISK</span>
        <span class="approval-tool">🔧 ${escHtml(request.tool)}</span>
      </div>
      <div class="approval-desc">${escHtml(request.description)}</div>
      <div class="approval-params">${escHtml(JSON.stringify(request.params, null, 2))}</div>
      <label class="cache-row">
        <input type="checkbox" id="cache-session"> Remember for this session
      </label>
      <div class="approval-actions">
        <button class="btn-approve" id="btn-approve">✓ Approve</button>
        <button class="btn-deny"    id="btn-deny">✗ Deny</button>
      </div>
    </div>`;

  $('#btn-approve').onclick = () => approveTool(request);
  $('#btn-deny').onclick    = () => denyTool(request);
}

function clearPendingToolCall() {
  State.pendingToolCall = null;
  const container = $('#pending-approval');
  if (container) container.innerHTML = '';
}

async function sendMessage() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  appendMessage('user', text);
  showTyping();
  updateStatusIndicator('Thinking');

  try {
    await invoke('send_message', { content: text });
  } catch (e) {
    removeTyping();
    appendMessage('system', `Error: ${e}`);
    updateStatusIndicator('Idle');
  }
}

async function approveTool(request) {
  const cacheSession = $('#cache-session')?.checked || false;
  clearPendingToolCall();
  try {
    await invoke('approve_tool_call', { call_id: request.id, cache_session: cacheSession, tool: request.tool, params: request.params });
  } catch(e) { showToast(`Error approving: ${e}`, 'error'); }
}

async function denyTool(request) {
  clearPendingToolCall();
  try {
    await invoke('deny_tool_call', { call_id: request.id, tool: request.tool, params: request.params });
    appendMessage('system', `Tool call "${request.tool}" was denied.`);
  } catch(e) { showToast(`Error denying: ${e}`, 'error'); }
}

function renderPlanSteps(steps) {
  const container = $('#plan-steps');
  if (!container) return;
  if (!steps.length) { container.innerHTML = ''; return; }
  container.innerHTML = steps.map(s => {
    const icons = { done: '✅', running: '🔄', pending: '⬜', failed: '❌', skipped: '⏭' };
    return `<div class="plan-step ${s.status}">
      <span class="plan-step-icon">${icons[s.status] || '⬜'}</span>
      <span class="plan-step-text">${escHtml(s.description)}</span>
    </div>`;
  }).join('');
}

// ── Team view ─────────────────────────────────────────────────────────────────

const AGENT_COLORS = ['#7c6af5','#60a5fa','#4ade80','#fb923c','#f472b6','#a78bfa'];

function agentColor(id) {
  let h = 0;
  for (let i=0; i<id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

function agentInitial(name) { return (name || '?')[0].toUpperCase(); }

async function loadTeamView() {
  try {
    State.agents = await invoke('get_team_agents', { team_id: State.teamId });
    State.tasks  = await invoke('get_tasks',        { limit: 50, offset: 0 });
    State.collabMessages = await invoke('get_collab_messages', { limit: 30, offset: 0 });
  } catch(e) { console.error(e); }

  renderAgentChips();
  renderTaskBoard();
  renderCollabMessages();
  populateAssigneeSelect();
}

function renderAgentChips() {
  const bar = $('#agent-chips');
  if (!bar) return;
  bar.innerHTML = State.agents.map(a => {
    const color = agentColor(a.id);
    const isRecent = (Date.now() - new Date(a.last_seen)) < ONLINE_THRESHOLD_MS;
    return `<div class="agent-chip ${a.is_local ? 'local' : ''}">
      <div class="agent-avatar" style="background:${color}">${agentInitial(a.name)}</div>
      <div>
        <div class="agent-name">${escHtml(a.name)} ${a.is_local ? '<span style="font-size:9px;color:var(--accent)">(you)</span>' : ''}</div>
        <div class="agent-role">${escHtml(a.role || 'no role')}</div>
      </div>
      <div class="agent-online-dot ${isRecent ? '' : 'away'}" title="${isRecent ? 'Online' : 'Away'}"></div>
    </div>`;
  }).join('');
}

function renderTaskBoard() {
  const statuses = ['pending','in_progress','done'];
  const labels   = { pending: 'Pending', in_progress: 'In Progress', done: 'Done' };

  statuses.forEach(s => {
    const col   = $(`#col-${s.replace('_','-')}`);
    const count = $(`#col-count-${s.replace('_','-')}`);
    if (!col) return;

    const tasksForCol = State.tasks.filter(t => t.status === s);
    if (count) count.textContent = tasksForCol.length;

    if (!tasksForCol.length) {
      col.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>No tasks</p></div>';
      return;
    }

    col.innerHTML = tasksForCol.map(t => {
      const assignee = State.agents.find(a => a.id === t.assigned_to);
      const color = assignee ? agentColor(assignee.id) : '#8b8fa8';
      const initials = assignee ? agentInitial(assignee.name) : '?';
      const name     = assignee ? assignee.name : 'Unassigned';
      return `<div class="task-card" data-id="${t.id}">
        <div class="task-card-title">${escHtml(t.title)}</div>
        <div class="task-card-meta">
          <div class="task-assignee">
            <div class="task-assignee-dot" style="background:${color}">${initials}</div>
            ${escHtml(name)}
          </div>
          <span class="task-status-pill ${t.status}">${labels[t.status]||t.status}</span>
        </div>
      </div>`;
    }).join('');
  });
}

function renderCollabMessages() {
  const list = $('#collab-message-list');
  if (!list) return;

  if (!State.collabMessages.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">💬</span><p>No messages yet</p></div>';
    return;
  }

  const agentName = id => (State.agents.find(a => a.id === id) || {}).name || id;

  list.innerHTML = State.collabMessages.slice(0, 15).map(m => `
    <div class="collab-msg">
      <div class="collab-msg-header">
        <span class="collab-msg-from">${escHtml(agentName(m.from_agent))}</span>
        <span class="collab-msg-arrow">→</span>
        <span class="collab-msg-to">${escHtml(agentName(m.to_agent))}</span>
        <span class="collab-msg-type ${m.msg_type}">${m.msg_type.replace('_',' ')}</span>
      </div>
      ${m.task_id ? `<div class="collab-msg-text">Task: ${escHtml(m.task_id)}</div>` : ''}
      <div class="collab-msg-time">${fmtTime(m.timestamp)}</div>
    </div>`).join('');
}

function populateAssigneeSelect() {
  const sel = $('#task-assignee-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">— Unassigned —</option>` +
    State.agents.map(a => `<option value="${a.id}">${escHtml(a.name)} (${escHtml(a.role||'?')})</option>`).join('');
}

async function delegateTask() {
  const title = $('#task-title-input').value.trim();
  const desc  = $('#task-desc-input').value.trim() || null;
  const assignedTo = $('#task-assignee-select').value || null;

  if (!title) { showToast('Please enter a task title.', 'error'); return; }

  try {
    await invoke('delegate_task', {
      title, description: desc, assigned_to: assignedTo,
      delegated_by: State.localAgentId,
    });
    closeNewTaskModal();
    showToast('Task created!', 'success');
    await loadTeamView();
  } catch(e) { showToast(`Error: ${e}`, 'error'); }
}

function openNewTaskModal()  { $('#modal-new-task').classList.remove('hidden'); }
function closeNewTaskModal() {
  $('#modal-new-task').classList.add('hidden');
  $('#task-title-input').value = '';
  $('#task-desc-input').value  = '';
  $('#task-assignee-select').value = '';
}

// ── Audit view ─────────────────────────────────────────────────────────────────

async function loadAuditView() {
  try {
    State.auditLogs = await invoke('get_audit_logs', { limit: 50, offset: 0 });
  } catch(e) { console.error(e); }
  renderAuditLogs();
}

function renderAuditLogs(filter = 'all') {
  const list = $('#audit-list');
  if (!list) return;

  const logs = filter === 'all' ? State.auditLogs : State.auditLogs.filter(l => l.event_type === filter);
  if (!logs.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><p>No audit entries</p></div>';
    return;
  }

  const icons = { model_usage: '🧠', tool_call: '🔧', permission_check: '🔐' };

  list.innerHTML = logs.map(entry => {
    const d = entry.details || {};
    let row2 = '';
    if (entry.event_type === 'model_usage') {
      row2 = `Model: <b>${escHtml(d.model||'')}</b> — ${d.prompt_tokens||0} prompt + ${d.completion_tokens||0} completion tokens — ${d.duration_ms||0}ms`;
    } else if (entry.event_type === 'tool_call') {
      const ok = d.success ? '<span style="color:var(--green)">✓ success</span>' : '<span style="color:var(--red)">✗ failed</span>';
      row2 = `Tool: <b>${escHtml(d.tool||'')}</b> — ${ok} — ${d.duration_ms||0}ms${d.error ? ` — ${escHtml(d.error)}` : ''}`;
    } else if (entry.event_type === 'permission_check') {
      const dec = `<span class="audit-decision ${escHtml(d.decision||'')}">${escHtml(d.decision||'')}</span>`;
      row2 = `Action: ${escHtml(d.action||'')} on <b>${escHtml(d.resource||'')}</b> — ${dec}`;
    }

    return `<div class="audit-entry">
      <div class="audit-icon ${entry.event_type}">${icons[entry.event_type]||'📋'}</div>
      <div class="audit-body">
        <div class="audit-row1">
          <span class="audit-type ${entry.event_type}">${entry.event_type.replace('_',' ')}</span>
          <span class="audit-resource">#${entry.id}</span>
        </div>
        <div class="audit-row2">${row2}</div>
      </div>
      <div class="audit-time">${fmtTimeFull(entry.timestamp)}</div>
    </div>`;
  }).join('');
}

// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Event handlers (Tauri events) ─────────────────────────────────────────────

function setupEventListeners() {
  listen('agent-event', ({ payload }) => {
    if (!payload) return;
    switch (payload.type) {
      case 'StatusChanged':
        updateStatusIndicator(payload.status);
        if (payload.status === 'Thinking') showTyping();
        else removeTyping();
        break;

      case 'ChatMessage':
        removeTyping();
        if (payload.message.role !== 'user') {
          appendMessage(payload.message.role, payload.message.content, payload.message.id,
            payload.message.html ? { html: payload.message.html } : {});
        }
        break;

      case 'PlanUpdated':
        renderPlanSteps(payload.steps || []);
        break;

      case 'ToolCallRequest':
        removeTyping();
        renderPendingToolCall(payload.request);
        break;

      case 'ToolCallResult':
        appendToolResult(payload.result);
        clearPendingToolCall();
        break;

      case 'EmergencyStop':
        clearPendingToolCall();
        removeTyping();
        appendMessage('system', '⛔ Emergency stop triggered. All operations halted.');
        showToast('Emergency stop activated', 'error');
        break;
    }
  });

  listen('collab-message', ({ payload }) => {
    if (State.activeTab === 'team') loadTeamView();
  });
}

// ── Seed initial chat messages ─────────────────────────────────────────────────

function seedChat() {
  const seed = [
    { role: 'system',    content: 'Session started. Agent is ready.' },
    { role: 'user',      content: 'Hello! What can you do?' },
    { role: 'assistant', content: "Hello! 👋 I'm your digital-twin bot. I can help you:\n• Read and write files on your computer\n• Run shell commands (with your approval)\n• Browse the web and fetch data\n• Coordinate work with your teammates via the Team panel\n\nAll actions are logged in the Audit tab for full transparency." },
    { role: 'user',      content: 'Can you read my notes file?' },
    { role: 'assistant', content: "Sure! I'll need to read the file from disk. I'm requesting your permission now — please check the panel on the right." },
  ];
  seed.forEach(m => appendMessage(m.role, m.content));

  // Simulate pending tool call on load
  setTimeout(() => {
    renderPendingToolCall({
      id: uid(), tool: 'fs.readFile',
      params: { path: '/home/user/notes.txt', encoding: 'utf-8' },
      risk: 'low',
      description: 'Read the contents of /home/user/notes.txt',
      timestamp: new Date().toISOString(),
    });
    updateStatusIndicator('WaitingApproval');
  }, 400);

  // Seed plan steps
  renderPlanSteps([
    { id: '1', index: 0, description: 'Understand the request', status: 'done' },
    { id: '2', index: 1, description: 'Read notes.txt',         status: 'running' },
    { id: '3', index: 2, description: 'Summarise key points',   status: 'pending' },
  ]);
}

// ── Initialise ────────────────────────────────────────────────────────────────

async function init() {
  // Wire up mode toggle
  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  // Cross-navigation hints
  $('#btn-goto-team')?.addEventListener('click', () => switchMode('team'));
  $('#btn-goto-solo')?.addEventListener('click', () => switchMode('solo'));

  // Wire up tabs
  $$('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Emergency stop
  $('#btn-stop').addEventListener('click', async () => {
    await invoke('emergency_stop');
  });

  // Chat send button & Enter key
  const input  = $('#chat-input');
  const sendBtn = $('#btn-send');

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  });

  // New task modal
  $('#btn-new-task')?.addEventListener('click', openNewTaskModal);
  $('#btn-cancel-task')?.addEventListener('click', closeNewTaskModal);
  $('#btn-create-task')?.addEventListener('click', delegateTask);
  $('#modal-new-task')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeNewTaskModal(); });

  // Audit filter
  $('#audit-filter-select')?.addEventListener('change', e => renderAuditLogs(e.target.value));

  // Intel Watch filters & refresh
  $('#intel-domain-filter')?.addEventListener('change', () =>
    renderSignalFeed($('#intel-domain-filter').value, $('#intel-sig-filter').value, $('#intel-sort-select')?.value));
  $('#intel-sig-filter')?.addEventListener('change', () =>
    renderSignalFeed($('#intel-domain-filter').value, $('#intel-sig-filter').value, $('#intel-sort-select')?.value));
  $('#intel-sort-select')?.addEventListener('change', () =>
    renderSignalFeed($('#intel-domain-filter').value, $('#intel-sig-filter').value, $('#intel-sort-select').value));
  $('#btn-intel-refresh')?.addEventListener('click', () => {
    loadIntelView();
    showToast('Intelligence feed refreshed', 'success');
  });

  // "Ask Bot" button on signal cards (event delegation)
  $('#intel-signal-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-analyze-signal');
    if (!btn) return;
    const title = btn.dataset.signalTitle;
    switchMode('solo');
    const input = $('#chat-input');
    if (input) {
      input.value = `Analyze this intelligence signal: "${title}". What are the strategic implications and trend drivers?`;
      input.dispatchEvent(new Event('input'));
      input.focus();
    }
  });

  // Setup Tauri/mock event listeners
  setupEventListeners();

  // Seed demo data into chat
  seedChat();

  // Register local agent (no-op in mock)
  invoke('register_agent', {
    id: State.localAgentId, name: 'Alice-bot', role: 'pm',
    endpoint: null, team_id: State.teamId, is_local: true,
  });

  // Activate default mode (Solo Bot → Chat)
  switchMode('solo');
}

document.addEventListener('DOMContentLoaded', init);
