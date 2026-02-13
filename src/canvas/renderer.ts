export function renderCanvasHTML(sessionId: string, wsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Iris Canvas</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; height: 100vh; }
  #sidebar { width: 400px; border-right: 1px solid #30363d; display: flex; flex-direction: column; }
  #main { flex: 1; padding: 24px; overflow-y: auto; }
  #messages { flex: 1; overflow-y: auto; padding: 12px; }
  .msg { margin: 8px 0; padding: 10px 14px; border-radius: 12px; max-width: 85%; word-wrap: break-word; }
  .msg.user { background: #1f6feb; color: #fff; margin-left: auto; }
  .msg.assistant { background: #21262d; border: 1px solid #30363d; }
  #input-area { padding: 12px; border-top: 1px solid #30363d; display: flex; gap: 8px; }
  #input-area input { flex: 1; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
  #input-area button { background: #238636; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  #input-area button:hover { background: #2ea043; }
  .component { margin: 16px 0; padding: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 12px; }
  .component h3 { color: #58a6ff; margin-bottom: 8px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; }
  th { color: #58a6ff; }
  pre { background: #0d1117; padding: 16px; border-radius: 8px; overflow-x: auto; }
  code { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
  .progress-bar { background: #30363d; border-radius: 4px; height: 24px; overflow: hidden; }
  .progress-fill { background: #238636; height: 100%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; font-size: 12px; }
  .btn-action { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
  .btn-action:hover { border-color: #58a6ff; }
  .form-field { margin: 8px 0; }
  .form-field label { display: block; margin-bottom: 4px; color: #8b949e; font-size: 13px; }
  .form-field input, .form-field select, .form-field textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px; border-radius: 6px; }
  #status { padding: 8px 12px; font-size: 12px; color: #8b949e; border-bottom: 1px solid #30363d; }
  .connected { color: #3fb950 !important; }
  .disconnected { color: #f85149 !important; }
</style>
</head>
<body>
<div id="sidebar">
  <div id="status" class="disconnected">Disconnected</div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="msg-input" placeholder="Type a message..." autocomplete="off" />
    <button onclick="sendMessage()">Send</button>
  </div>
</div>
<div id="main">
  <h2 style="color:#58a6ff;margin-bottom:16px">Canvas</h2>
  <div id="components"></div>
</div>
<script>
const SESSION_ID = ${JSON.stringify(sessionId)};
const WS_URL = ${JSON.stringify(wsUrl)};
let ws;

function connect() {
  ws = new WebSocket(WS_URL);
  const status = document.getElementById('status');

  ws.onopen = () => {
    status.textContent = 'Connected';
    status.className = 'connected';
  };

  ws.onclose = () => {
    status.textContent = 'Disconnected — reconnecting...';
    status.className = 'disconnected';
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    switch (data.type) {
      case 'state':
        renderComponents(data.components || []);
        renderMessages(data.messages || []);
        break;
      case 'component.update':
        updateComponent(data.component);
        break;
      case 'component.remove':
        removeComponent(data.id);
        break;
      case 'component.clear':
        document.getElementById('components').innerHTML = '';
        break;
      case 'message':
        appendMessage(data.message);
        break;
    }
  };
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'message', text }));
  input.value = '';
}

document.getElementById('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function renderMessages(msgs) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  msgs.forEach(appendMessage);
}

function appendMessage(msg) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + msg.role;
  div.textContent = msg.text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderComponents(components) {
  const container = document.getElementById('components');
  container.innerHTML = '';
  components.forEach(c => updateComponent(c));
}

function updateComponent(comp) {
  const container = document.getElementById('components');
  let el = document.getElementById('comp-' + comp.id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'comp-' + comp.id;
    el.className = 'component';
    container.appendChild(el);
  }
  el.innerHTML = renderComponent(comp);
  if (comp.type === 'chart') renderChart(comp, el);
}

function removeComponent(id) {
  const el = document.getElementById('comp-' + id);
  if (el) el.remove();
}

function renderComponent(c) {
  switch (c.type) {
    case 'text': return '<p>' + escHtml(c.content) + '</p>';
    case 'markdown': return typeof marked !== 'undefined' ? marked.parse(c.content) : '<pre>' + escHtml(c.content) + '</pre>';
    case 'code': return '<pre><code class="language-' + c.language + '">' + escHtml(c.content) + '</code></pre>';
    case 'table': return renderTable(c);
    case 'image': return '<img src="' + escHtml(c.url) + '" alt="' + escHtml(c.alt || '') + '" style="max-width:100%;border-radius:8px" />';
    case 'progress': return renderProgress(c);
    case 'button': return '<button class="btn-action" onclick="sendAction(\\'' + escHtml(c.action) + '\\')">' + escHtml(c.label) + '</button>';
    case 'form': return renderForm(c);
    case 'chart': return '<canvas id="chart-' + c.id + '" height="200"></canvas>';
    default: return '<pre>' + JSON.stringify(c, null, 2) + '</pre>';
  }
}

function renderTable(c) {
  let html = '<table><thead><tr>';
  c.headers.forEach(h => html += '<th>' + escHtml(h) + '</th>');
  html += '</tr></thead><tbody>';
  c.rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => html += '<td>' + escHtml(cell) + '</td>');
    html += '</tr>';
  });
  return html + '</tbody></table>';
}

function renderProgress(c) {
  const pct = Math.round((c.value / c.max) * 100);
  return '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%">' + pct + '%</div></div>' + (c.label ? '<small style="color:#8b949e">' + escHtml(c.label) + '</small>' : '');
}

function renderForm(c) {
  let html = '<form onsubmit="submitForm(event, \\'' + c.id + '\\')">';
  c.fields.forEach(f => {
    html += '<div class="form-field"><label>' + escHtml(f.label) + '</label>';
    if (f.type === 'select' && f.options) {
      html += '<select name="' + f.name + '">';
      f.options.forEach(o => html += '<option>' + escHtml(o) + '</option>');
      html += '</select>';
    } else if (f.type === 'textarea') {
      html += '<textarea name="' + f.name + '" rows="3"></textarea>';
    } else if (f.type === 'checkbox') {
      html += '<input type="checkbox" name="' + f.name + '" />';
    } else {
      html += '<input type="' + f.type + '" name="' + f.name + '" />';
    }
    html += '</div>';
  });
  html += '<button type="submit" class="btn-action" style="margin-top:8px">Submit</button></form>';
  return html;
}

function renderChart(comp, el) {
  setTimeout(() => {
    const canvas = el.querySelector('canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    new Chart(canvas, {
      type: comp.chartType,
      data: {
        labels: comp.data.labels,
        datasets: comp.data.datasets.map(ds => ({
          label: ds.label, data: ds.data,
          backgroundColor: ds.color || '#58a6ff',
          borderColor: ds.color || '#58a6ff',
        })),
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#c9d1d9' } } }, scales: { x: { ticks: { color: '#8b949e' } }, y: { ticks: { color: '#8b949e' } } } },
    });
  }, 50);
}

function sendAction(action) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'user_action', action }));
}

function submitForm(e, formId) {
  e.preventDefault();
  const form = e.target;
  const data = {};
  new FormData(form).forEach((v, k) => data[k] = v);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'form_submit', formId, data }));
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

connect();
<\/script>
</body>
</html>`;
}
