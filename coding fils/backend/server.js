// Auto Ticket Classification - zero-dependency Node backend (Node 18+)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');

// ---- config (.env optional) ----
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  });
} catch {}
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data'), FE = path.join(__dirname, '..', 'frontend');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const save = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2));
const snOn = () => !!(process.env.SN_INSTANCE && process.env.SN_USER && process.env.SN_PASSWORD);

// ---- classification engine (same logic as the Flow Designer flow) ----
function classify(text) {
  text = (text || '').toLowerCase();
  const hits = read('rules.json', []).filter(r => r.active && text.includes(r.keyword.toLowerCase()));
  if (!hits.length) return { matched: [], category: 'General', subcategory: 'Other', priority: 4, group: 'Service Desk', manual: true };
  hits.sort((a, b) => a.priority - b.priority || b.keyword.length - a.keyword.length);
  const t = hits[0];
  return { matched: hits.map(h => h.keyword), category: t.category, subcategory: t.subcategory, priority: t.priority, group: t.group, manual: false };
}

// ---- optional ServiceNow push (Table API) ----
function snPush(t) {
  if (!snOn()) return Promise.resolve(null);
  const { SN_INSTANCE: inst, SN_USER: user, SN_PASSWORD: pass } = process.env;
  const body = { short_description: t.short_description, description: t.description, urgency: { high: 1, medium: 2, low: 3 }[t.urgency] || 3 };
  if (process.env.SN_PUSH_CLASSIFIED !== 'false') {
    body.category = t.category.toLowerCase();
    body.assignment_group = t.group;
    body.work_notes = `Auto-classified: ${t.category} / ${t.subcategory} (matched: ${t.matched.join(', ') || 'none'})`;
  }
  return new Promise(resolve => {
    const rq = https.request({
      host: inst.replace(/^https?:\/\//, ''), path: '/api/now/table/incident?sysparm_input_display_value=true', method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') }
    }, r => {
      let s = ''; r.on('data', c => s += c);
      r.on('end', () => { try { const j = JSON.parse(s).result; resolve(j && j.number ? { number: j.number, sys_id: j.sys_id } : { error: s.slice(0, 160) }); } catch { resolve({ error: 'Bad ServiceNow response' }); } });
    });
    rq.on('error', e => resolve({ error: e.message }));
    rq.setTimeout(15000, () => rq.destroy(new Error('ServiceNow timeout')));
    rq.end(JSON.stringify(body));
  });
}

// ---- http helpers ----
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

async function api(req, res, p) {
  const m = req.method;
  if (p === '/api/classify' && m === 'POST') { const b = await readBody(req); return send(res, 200, classify(`${b.short_description || ''} ${b.description || ''}`)); }
  if (p === '/api/tickets' && m === 'GET') return send(res, 200, read('tickets.json', []).slice().reverse());
  if (p === '/api/tickets' && m === 'POST') {
    const b = await readBody(req);
    if (!b.short_description || !b.short_description.trim()) return send(res, 400, { error: 'Short description is required.' });
    const tickets = read('tickets.json', []);
    const c = classify(`${b.short_description} ${b.description || ''}`);
    const urgency = ['low', 'medium', 'high'].includes(b.urgency) ? b.urgency : 'medium';
    if (urgency === 'high') c.priority = Math.max(1, c.priority - 1);
    const t = { number: 'INC' + String(1001 + tickets.length).padStart(7, '0'), caller: (b.caller || 'Anonymous').trim(), short_description: b.short_description.trim(), description: (b.description || '').trim(), urgency, ...c, state: 'New', created: new Date().toISOString() };
    t.servicenow = await snPush(t);
    tickets.push(t); save('tickets.json', tickets);
    return send(res, 201, t);
  }
  if (p === '/api/rules' && m === 'GET') return send(res, 200, read('rules.json', []));
  if (p === '/api/rules' && m === 'POST') {
    const b = await readBody(req);
    if (!b.keyword || !b.category || !b.group) return send(res, 400, { error: 'Keyword, category and group are required.' });
    const rules = read('rules.json', []);
    const r = { id: Math.max(0, ...rules.map(x => x.id)) + 1, keyword: b.keyword.trim(), category: b.category.trim(), subcategory: (b.subcategory || 'General').trim(), priority: Math.min(4, Math.max(1, +b.priority || 3)), group: b.group.trim(), active: true };
    rules.push(r); save('rules.json', rules); return send(res, 201, r);
  }
  const rm = p.match(/^\/api\/rules\/(\d+)$/);
  if (rm && m === 'PUT') { const rules = read('rules.json', []), r = rules.find(x => x.id == rm[1]); if (!r) return send(res, 404, { error: 'Not found' }); r.active = !r.active; save('rules.json', rules); return send(res, 200, r); }
  if (rm && m === 'DELETE') { save('rules.json', read('rules.json', []).filter(x => x.id != rm[1])); return send(res, 200, { ok: true }); }
  if (p === '/api/stats' && m === 'GET') {
    const t = read('tickets.json', []), count = (arr) => arr.reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {});
    return send(res, 200, { total: t.length, auto: t.filter(x => !x.manual).length, manual: t.filter(x => x.manual).length, byCategory: count(t.map(x => x.category)), byPriority: count(t.map(x => 'P' + x.priority)), topKeywords: count(t.flatMap(x => x.matched)), servicenow: snOn() });
  }
  send(res, 404, { error: 'Unknown endpoint' });
}

http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/api/')) return await api(req, res, p);
    const file = path.normalize(path.join(FE, p === '/' ? 'index.html' : p));
    if (!file.startsWith(FE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`AutoTicket running -> http://localhost:${PORT}  (ServiceNow: ${snOn() ? 'connected mode' : 'standalone mode'})`));
