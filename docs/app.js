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
              MockEmitter.emit('agent-event', { type: 'ChatMessage', message: { id: uid(), role: 'assistant', content: reply.text, timestamp: new Date().toISOString() } });
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
  if (diffMs < 60_000)    return 'just now';
  if (diffMs < 3600_000)  return `${Math.floor(diffMs/60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs/3600_000)}h ago`;
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

function appendMessage(role, content, id) {
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
    el.innerHTML = `
      <div class="msg-avatar">${avatarEmoji}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name">${name}</span>
          <span class="msg-time">${fmtTime(new Date().toISOString())}</span>
        </div>
        <div class="msg-bubble">${escHtml(content)}</div>
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
          appendMessage(payload.message.role, payload.message.content, payload.message.id);
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
