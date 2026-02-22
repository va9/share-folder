import { Hono } from 'hono'
import { html } from 'hono/html'
import { randomBytes, createHash } from 'crypto'
import { getDb } from '../../db'
import { Site } from '../Site'
import { rateLimit } from '../../ratelimit'

const DATA_DIR = process.env.DATA_DIR || '/data'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const site = new Site(DATA_DIR)

/** Clean up expired admin sessions periodically */
setInterval(() => {
  const db = getDb()
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now())
}, 60000)

/** Check if request has valid admin auth (session token or legacy ADMIN_KEY) */
function requireAdmin (c: any) {
  const token = c.req.header('x-admin-key')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  // Check DB session tokens first
  const db = getDb()
  const session = db.prepare('SELECT email FROM admin_sessions WHERE token = ? AND type = ? AND expires_at > ?').get(token, 'session', Date.now()) as { email: string } | undefined
  if (session) return null

  // Fall back to static ADMIN_KEY
  if (ADMIN_KEY && token === ADMIN_KEY) return null

  return c.json({ error: 'Unauthorized' }, 401)
}

const admin = new Hono()

// --- Auth endpoints ---

/** POST /v1/admin/auth — request a login code */
admin.post('/auth', rateLimit({ windowMs: 3600000, max: 10 }), async (c) => {
  const { email } = await c.req.json() as { email: string }
  if (!email) return c.json({ error: 'Email required' }, 400)

  if (!ADMIN_EMAIL) {
    return c.json({ error: 'Admin email not configured on server' }, 503)
  }

  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    // Don't reveal whether the email is correct — just say "sent"
    return c.json({ success: true })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO admin_sessions (token, email, type, expires_at) VALUES (?, ?, ?, ?)').run(code, email.toLowerCase(), 'code', Date.now() + 600000)

  // Log the code to server console (visible via `fly logs`)
  console.log(`[ADMIN AUTH] Code for ${email}: ${code}`)

  return c.json({ success: true })
})

/** POST /v1/admin/verify — exchange code for session token */
admin.post('/verify', rateLimit({ windowMs: 3600000, max: 20 }), async (c) => {
  const { email, code } = await c.req.json() as { email: string; code: string }
  if (!email || !code) return c.json({ error: 'Email and code required' }, 400)

  const db = getDb()
  const entry = db.prepare('SELECT email, expires_at FROM admin_sessions WHERE token = ? AND type = ?').get(code, 'code') as { email: string; expires_at: number } | undefined
  if (!entry || entry.email !== email.toLowerCase() || Date.now() > entry.expires_at) {
    return c.json({ error: 'Invalid or expired code' }, 401)
  }

  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(code)
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO admin_sessions (token, email, type, expires_at) VALUES (?, ?, ?, ?)').run(token, email.toLowerCase(), 'session', Date.now() + 86400000)

  return c.json({ success: true, token })
})

// --- Data endpoints ---

admin.get('/sites', (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const db = getDb()
  const sites = db.prepare(`
    SELECT s.id, s.slug, s.title, s.vanity_slug, s.user_prefix, s.encrypted, s.file_count,
           s.created, s.updated, s.expires_at, u.uid
    FROM sites s
    JOIN users u ON u.id = s.users_id
    ORDER BY s.updated DESC
    LIMIT 200
  `).all()
  return c.json(sites)
})

admin.delete('/site', async (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const slug = c.req.query('slug')
  if (!slug) return c.json({ error: 'Missing slug' }, 400)

  const db = getDb()
  let record = db.prepare('SELECT id, slug FROM sites WHERE slug = ?').get(slug) as { id: number; slug: string } | undefined
  if (!record) {
    record = db.prepare('SELECT id, slug FROM sites WHERE vanity_slug = ?').get(slug) as { id: number; slug: string } | undefined
  }
  if (!record) return c.json({ error: 'Site not found' }, 404)

  await site.removeSite(record.slug)
  db.prepare('DELETE FROM site_files WHERE sites_id = ?').run(record.id)
  db.prepare('DELETE FROM sites WHERE id = ?').run(record.id)
  return c.json({ success: true, deleted: record.slug })
})

admin.get('/reports', (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS abuse_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, email TEXT,
    reason TEXT NOT NULL, created INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER
  )`)
  const reports = db.prepare('SELECT * FROM abuse_reports ORDER BY created DESC LIMIT 100').all()
  return c.json(reports)
})

admin.post('/reports/:id/resolve', (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const id = c.req.param('id')
  const db = getDb()
  db.prepare('UPDATE abuse_reports SET resolved = 1, resolved_at = ? WHERE id = ?').run(Date.now(), id)
  return c.json({ success: true })
})

admin.get('/user', (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const uid = c.req.query('uid')
  if (!uid) return c.json({ error: 'Missing uid' }, 400)

  const db = getDb()
  const user = db.prepare('SELECT id, uid, created FROM users WHERE uid = ?').get(uid) as { id: number; uid: string; created: number } | undefined
  if (!user) return c.json({ error: 'User not found' }, 404)

  const sites = db.prepare('SELECT id, slug, title, vanity_slug, encrypted, file_count, created, updated FROM sites WHERE users_id = ?').all(user.id)
  return c.json({ user, sites })
})

admin.delete('/user', async (c) => {
  const denied = requireAdmin(c)
  if (denied) return denied

  const uid = c.req.query('uid')
  if (!uid) return c.json({ error: 'Missing uid' }, 400)

  const db = getDb()
  const user = db.prepare('SELECT id FROM users WHERE uid = ?').get(uid) as { id: number } | undefined
  if (!user) return c.json({ error: 'User not found' }, 404)

  const userSites = db.prepare('SELECT id, slug FROM sites WHERE users_id = ?').all(user.id) as { id: number; slug: string }[]
  for (const s of userSites) {
    await site.removeSite(s.slug)
    db.prepare('DELETE FROM site_files WHERE sites_id = ?').run(s.id)
  }
  db.prepare('DELETE FROM sites WHERE users_id = ?').run(user.id)
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
  return c.json({ success: true, sitesDeleted: userSites.length })
})

// --- Admin UI ---

admin.get('/ui', (c) => {
  return c.html(adminPage())
})

function adminPage () {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>admin — opennotes.io</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body {
      font-family: 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', monospace;
      background: #fdfdfd;
      color: #1a1a1a;
      min-height: 100vh;
      padding: 2rem 1.5rem;
      line-height: 1.6;
    }
    .wrap { max-width: 900px; margin: 0 auto; }

    /* --- Auth screen --- */
    #auth {
      max-width: 360px;
      margin: 15vh auto 0;
    }
    #auth h1 {
      font-size: 0.9rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }
    #auth .sub {
      font-size: 0.75rem;
      color: #999;
      margin-bottom: 1.5rem;
    }
    .field {
      margin-bottom: 0.75rem;
    }
    .field label {
      display: block;
      font-size: 0.7rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.2rem;
    }
    .field input {
      width: 100%;
      padding: 0.45rem 0.5rem;
      border: 1px solid #ddd;
      background: #fff;
      color: #1a1a1a;
      font-family: inherit;
      font-size: 0.85rem;
      outline: none;
    }
    .field input:focus { border-color: #1a1a1a; }
    .field input::placeholder { color: #ccc; }
    button, .btn {
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.4rem 1.2rem;
      border: 1px solid #1a1a1a;
      background: #1a1a1a;
      color: #fff;
      cursor: pointer;
      letter-spacing: 0.02em;
    }
    button:hover { background: #333; }
    button:disabled { opacity: 0.4; cursor: default; }
    .msg {
      font-size: 0.75rem;
      margin-top: 0.5rem;
      min-height: 1em;
    }
    .msg.ok { color: #2d7d46; }
    .msg.err { color: #c0392b; }

    /* --- Dashboard --- */
    #dash { display: none; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #ddd;
      padding-bottom: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .topbar h1 {
      font-size: 0.85rem;
      font-weight: 700;
    }
    .topbar .who {
      font-size: 0.7rem;
      color: #999;
    }
    .topbar button {
      font-size: 0.7rem;
      background: none;
      color: #c0392b;
      border-color: #c0392b;
      padding: 0.25rem 0.6rem;
    }
    .topbar button:hover { background: #c0392b; color: #fff; }

    /* --- Tabs --- */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #ddd;
      margin-bottom: 1.5rem;
    }
    .tab {
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.5rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #888;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tab:hover { color: #1a1a1a; }
    .tab.on {
      color: #1a1a1a;
      border-bottom-color: #1a1a1a;
    }
    .panel { display: none; }
    .panel.on { display: block; }

    /* --- Tables --- */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    th {
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      padding: 0.4rem 0.5rem;
      border-bottom: 2px solid #ddd;
      white-space: nowrap;
    }
    td {
      padding: 0.4rem 0.5rem;
      border-bottom: 1px solid #eee;
      vertical-align: top;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr:hover td { background: #f8f8f8; }
    .del {
      font-family: inherit;
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      background: none;
      border: 1px solid #ddd;
      color: #c0392b;
      cursor: pointer;
    }
    .del:hover { background: #c0392b; color: #fff; border-color: #c0392b; }
    .resolve-btn {
      font-family: inherit;
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      background: none;
      border: 1px solid #ddd;
      color: #2d7d46;
      cursor: pointer;
      margin-right: 0.25rem;
    }
    .resolve-btn:hover { background: #2d7d46; color: #fff; border-color: #2d7d46; }
    .resolved { color: #999; font-style: italic; }
    .tag {
      display: inline-block;
      font-size: 0.65rem;
      padding: 0.1rem 0.35rem;
      border: 1px solid #ddd;
      color: #888;
    }
    .tag.enc { border-color: #e8b33a; color: #b8860b; }
    .empty {
      text-align: center;
      color: #ccc;
      padding: 2rem;
      font-size: 0.8rem;
    }

    /* --- User lookup --- */
    .lookup {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .lookup input {
      flex: 1;
      padding: 0.4rem 0.5rem;
      border: 1px solid #ddd;
      font-family: inherit;
      font-size: 0.8rem;
      outline: none;
    }
    .lookup input:focus { border-color: #1a1a1a; }
    #user-result { margin-top: 0.5rem; }
    .user-card {
      border: 1px solid #ddd;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    .user-card .uid {
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .user-card .info {
      font-size: 0.7rem;
      color: #888;
    }
    .nuke {
      font-family: inherit;
      font-size: 0.7rem;
      padding: 0.3rem 0.8rem;
      background: #c0392b;
      border: 1px solid #c0392b;
      color: #fff;
      cursor: pointer;
      margin-top: 0.5rem;
    }
    .nuke:hover { background: #a93226; }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid #ddd;
      border-top-color: #1a1a1a;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 0.3rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wrap">

    <!-- Auth -->
    <div id="auth">
      <h1>opennotes admin</h1>
      <p class="sub">enter your admin email to receive a login code</p>

      <div id="step1">
        <div class="field">
          <label>Email</label>
          <input type="email" id="email" placeholder="admin@example.com" autofocus>
        </div>
        <button onclick="sendCode()">Send code</button>
        <div class="msg" id="msg1"></div>
      </div>

      <div id="step2" style="display:none">
        <div class="field">
          <label>6-digit code</label>
          <input type="text" id="code" placeholder="000000" maxlength="6" autocomplete="one-time-code">
        </div>
        <button onclick="verifyCode()">Verify</button>
        <div class="msg" id="msg2"></div>
      </div>
    </div>

    <!-- Dashboard -->
    <div id="dash">
      <div class="topbar">
        <h1>opennotes admin</h1>
        <div>
          <span class="who" id="who"></span>
          <button onclick="logout()">logout</button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab on" data-tab="sites" onclick="showTab('sites')">Sites</button>
        <button class="tab" data-tab="reports" onclick="showTab('reports')">Reports</button>
        <button class="tab" data-tab="users" onclick="showTab('users')">Users</button>
      </div>

      <div class="panel on" id="p-sites">
        <div id="sites-table"><div class="empty"><span class="spinner"></span> loading...</div></div>
      </div>

      <div class="panel" id="p-reports">
        <div id="reports-table"></div>
      </div>

      <div class="panel" id="p-users">
        <div class="lookup">
          <input type="text" id="uid-input" placeholder="paste user uid...">
          <button onclick="lookupUser()">Look up</button>
        </div>
        <div id="user-result"></div>
      </div>
    </div>

  </div>

  <script>
    var TOKEN = sessionStorage.getItem('admin_token') || '';
    var EMAIL = sessionStorage.getItem('admin_email') || '';

    if (TOKEN) enterDash();

    function api(method, path, body) {
      var opts = {
        method: method,
        headers: { 'x-admin-key': TOKEN, 'Content-Type': 'application/json' }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/v1/admin' + path, opts).then(function(r) { return r.json(); });
    }

    // --- Auth ---

    function sendCode() {
      var email = document.getElementById('email').value.trim();
      if (!email) return;
      var m = document.getElementById('msg1');
      var btn = document.querySelector('#step1 button');
      btn.disabled = true;
      btn.textContent = 'sending...';
      m.textContent = '';
      m.className = 'msg';
      fetch('/v1/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          EMAIL = email;
          document.getElementById('step1').style.display = 'none';
          document.getElementById('step2').style.display = 'block';
          document.getElementById('msg2').textContent = 'Code sent. Check server logs (fly logs).';
          document.getElementById('msg2').className = 'msg ok';
          document.getElementById('code').focus();
        } else {
          m.textContent = d.error || 'failed';
          m.className = 'msg err';
          btn.disabled = false;
          btn.textContent = 'Send code';
        }
      }).catch(function(err) {
        m.textContent = 'Error: ' + err.message;
        m.className = 'msg err';
        btn.disabled = false;
        btn.textContent = 'Send code';
      });
    }

    function verifyCode() {
      var code = document.getElementById('code').value.trim();
      if (!code) return;
      var m = document.getElementById('msg2');
      var btn = document.querySelector('#step2 button');
      btn.disabled = true;
      btn.textContent = 'verifying...';
      m.textContent = '';
      m.className = 'msg';
      fetch('/v1/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, code: code })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.token) {
          TOKEN = d.token;
          sessionStorage.setItem('admin_token', TOKEN);
          sessionStorage.setItem('admin_email', EMAIL);
          enterDash();
        } else {
          m.textContent = d.error || 'invalid code';
          m.className = 'msg err';
          btn.disabled = false;
          btn.textContent = 'Verify';
        }
      }).catch(function(err) {
        m.textContent = 'Error: ' + err.message;
        m.className = 'msg err';
        btn.disabled = false;
        btn.textContent = 'Verify';
      });
    }

    function logout() {
      TOKEN = '';
      EMAIL = '';
      sessionStorage.removeItem('admin_token');
      sessionStorage.removeItem('admin_email');
      document.getElementById('auth').style.display = 'block';
      document.getElementById('dash').style.display = 'none';
      document.getElementById('step1').style.display = 'block';
      document.getElementById('step2').style.display = 'none';
    }

    function enterDash() {
      document.getElementById('auth').style.display = 'none';
      document.getElementById('dash').style.display = 'block';
      document.getElementById('who').textContent = EMAIL || '';
      loadSites();
    }

    // --- Tabs ---

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('on', t.dataset.tab === name); });
      document.querySelectorAll('.panel').forEach(function(p) { p.classList.toggle('on', p.id === 'p-' + name); });
      if (name === 'sites') loadSites();
      if (name === 'reports') loadReports();
    }

    // --- Sites ---

    function loadSites() {
      api('GET', '/sites').then(function(sites) {
        if (!Array.isArray(sites)) {
          if (sites.error === 'Unauthorized') { logout(); return; }
          document.getElementById('sites-table').innerHTML = '<div class="empty">' + (sites.error || 'error') + '</div>';
          return;
        }
        if (sites.length === 0) {
          document.getElementById('sites-table').innerHTML = '<div class="empty">no sites yet</div>';
          return;
        }
        var h = '<table><tr><th>slug</th><th>title</th><th>vanity</th><th>files</th><th>flags</th><th>updated</th><th></th></tr>';
        sites.forEach(function(s) {
          var flags = '';
          if (s.encrypted) flags += '<span class="tag enc">encrypted</span> ';
          if (s.expires_at) flags += '<span class="tag">expires</span> ';
          h += '<tr>'
            + '<td title="' + esc(s.slug) + '">' + esc(s.slug) + '</td>'
            + '<td>' + esc(s.title || '') + '</td>'
            + '<td>' + esc(s.vanity_slug || '—') + '</td>'
            + '<td>' + (s.file_count || 0) + '</td>'
            + '<td>' + flags + '</td>'
            + '<td>' + ago(s.updated) + '</td>'
            + '<td><button class="del" onclick="delSite(\'' + esc(s.slug) + '\')">delete</button></td>'
            + '</tr>';
        });
        h += '</table>';
        document.getElementById('sites-table').innerHTML = h;
      });
    }

    function delSite(slug) {
      if (!confirm('Delete site ' + slug + '? This cannot be undone.')) return;
      api('DELETE', '/site?slug=' + encodeURIComponent(slug)).then(function(d) {
        if (d.success) loadSites();
        else alert(d.error || 'failed');
      });
    }

    // --- Reports ---

    function loadReports() {
      api('GET', '/reports').then(function(reports) {
        if (!Array.isArray(reports)) {
          document.getElementById('reports-table').innerHTML = '<div class="empty">' + (reports.error || 'error') + '</div>';
          return;
        }
        if (reports.length === 0) {
          document.getElementById('reports-table').innerHTML = '<div class="empty">no reports</div>';
          return;
        }
        var h = '<table><tr><th>url</th><th>reason</th><th>email</th><th>date</th><th>status</th><th></th></tr>';
        reports.forEach(function(r) {
          var status = r.resolved ? '<span class="resolved">resolved</span>' : '<span style="color:#c0392b">open</span>';
          var actions = '';
          if (!r.resolved) {
            actions = '<button class="resolve-btn" onclick="resolveReport(' + r.id + ')">resolve</button>';
          }
          h += '<tr>'
            + '<td title="' + esc(r.url) + '"><a href="' + esc(r.url) + '" target="_blank">' + esc(r.url).substring(0, 40) + '</a></td>'
            + '<td title="' + esc(r.reason) + '">' + esc(r.reason).substring(0, 60) + '</td>'
            + '<td>' + esc(r.email || '—') + '</td>'
            + '<td>' + ago(r.created) + '</td>'
            + '<td>' + status + '</td>'
            + '<td>' + actions + '</td>'
            + '</tr>';
        });
        h += '</table>';
        document.getElementById('reports-table').innerHTML = h;
      });
    }

    function resolveReport(id) {
      api('POST', '/reports/' + id + '/resolve').then(function() { loadReports(); });
    }

    // --- Users ---

    function lookupUser() {
      var uid = document.getElementById('uid-input').value.trim();
      if (!uid) return;
      var el = document.getElementById('user-result');
      el.innerHTML = '<span class="spinner"></span> looking up...';
      api('GET', '/user?uid=' + encodeURIComponent(uid)).then(function(d) {
        if (d.error) {
          el.innerHTML = '<div class="msg err">' + esc(d.error) + '</div>';
          return;
        }
        var h = '<div class="user-card">';
        h += '<div class="uid">' + esc(d.user.uid) + '</div>';
        h += '<div class="info">created ' + ago(d.user.created) + ' · ' + d.sites.length + ' site(s)</div>';
        h += '<button class="nuke" onclick="nukeUser(\'' + esc(d.user.uid) + '\')">Delete user &amp; all sites</button>';
        h += '</div>';
        if (d.sites.length > 0) {
          h += '<table><tr><th>slug</th><th>title</th><th>files</th><th></th></tr>';
          d.sites.forEach(function(s) {
            h += '<tr><td>' + esc(s.slug) + '</td><td>' + esc(s.title || '') + '</td><td>' + (s.file_count || 0) + '</td>'
              + '<td><button class="del" onclick="delSite(\'' + esc(s.slug) + '\'); lookupUser();">delete</button></td></tr>';
          });
          h += '</table>';
        }
        el.innerHTML = h;
      });
    }

    function nukeUser(uid) {
      if (!confirm('Delete user ' + uid + ' and ALL their sites? This cannot be undone.')) return;
      api('DELETE', '/user?uid=' + encodeURIComponent(uid)).then(function(d) {
        if (d.success) {
          document.getElementById('user-result').innerHTML = '<div class="msg ok">Deleted. ' + d.sitesDeleted + ' site(s) removed.</div>';
        } else {
          alert(d.error || 'failed');
        }
      });
    }

    // --- Util ---

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    function ago(ts) {
      if (!ts) return '—';
      var d = Date.now() - ts;
      if (d < 60000) return 'just now';
      if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
      if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
      return Math.floor(d / 86400000) + 'd ago';
    }

    // Enter to submit
    document.getElementById('email').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendCode(); });
    document.getElementById('code').addEventListener('keydown', function(e) { if (e.key === 'Enter') verifyCode(); });
    document.getElementById('uid-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') lookupUser(); });
  </script>
</body>
</html>`
}

// --- Public abuse reporting endpoint ---

export const abuseRouter = new Hono()

abuseRouter.use('/report', rateLimit({ windowMs: 3600000, max: 5, message: 'Too many reports. Try again later.' }))

abuseRouter.post('/report', async (c) => {
  const { url, email, reason } = await c.req.json() as { url: string; email?: string; reason: string }

  if (!url || !reason) {
    return c.json({ error: 'URL and reason are required' }, 400)
  }

  const db = getDb()

  db.exec(`CREATE TABLE IF NOT EXISTS abuse_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, email TEXT,
    reason TEXT NOT NULL, created INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER
  )`)

  db.prepare('INSERT INTO abuse_reports (url, email, reason, created) VALUES (?, ?, ?, ?)').run(url, email || null, reason, Date.now())

  return c.json({ success: true })
})

export default admin
