import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import { randomBytes } from 'crypto'
import { getDb } from '../../db'

const account = new Hono()

/**
 * GET /get-key?id=<uid>
 * Shows a page with a button to generate an API key and redirect back to Obsidian.
 */
account.get('/get-key', (c) => {
  const uid = c.req.query('id')
  if (!uid) {
    return c.text('Missing id parameter', 400)
  }

  return c.html(connectPage(uid))
})

/**
 * POST /get-key
 * Actually generates the key, upserts the user, and redirects to Obsidian.
 */
account.post('/get-key', async (c) => {
  const { id } = await c.req.json() as { id: string }
  if (!id) {
    return c.json({ error: 'Missing id' }, 400)
  }

  const apiKey = randomBytes(32).toString('hex')
  const db = getDb()
  const now = Date.now()

  const existing = db.prepare('SELECT id FROM users WHERE uid = ?').get(id) as { id: number } | undefined
  if (existing) {
    db.prepare('UPDATE users SET api_key = ? WHERE uid = ?').run(apiKey, id)
  } else {
    db.prepare('INSERT INTO users (uid, api_key, created) VALUES (?, ?, ?)').run(id, apiKey, now)
  }

  return c.json({ key: apiKey, redirect: `obsidian://share-folder?action=connect&key=${apiKey}` })
})

function connectPage (uid: string) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to Obsidian</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 48px;
      max-width: 460px;
      width: 90%;
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #7c3aed;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg { width: 32px; height: 32px; }
    h1 {
      font-size: 1.5em;
      font-weight: 700;
      margin-bottom: 12px;
      color: #fff;
    }
    p {
      color: #888;
      line-height: 1.6;
      margin-bottom: 32px;
      font-size: 0.95em;
    }
    .btn {
      display: inline-block;
      background: #7c3aed;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px 36px;
      font-size: 1.05em;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
    }
    .btn:hover { background: #6d28d9; }
    .btn:disabled { background: #333; cursor: default; color: #666; }
    .status {
      margin-top: 20px;
      font-size: 0.9em;
      color: #888;
      min-height: 1.4em;
    }
    .status.success { color: #34d399; }
    .status.error { color: #f87171; }
    .footer {
      margin-top: 32px;
      font-size: 0.8em;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    </div>
    <h1>Connect your plugin</h1>
    <p>Click the button below to generate an API key and link it with your Obsidian plugin. You'll be redirected back to Obsidian automatically.</p>
    <button class="btn" id="connect-btn" onclick="connectPlugin()">Connect &amp; open Obsidian</button>
    <div class="status" id="status"></div>
    <div class="footer">Obsidian Publish</div>
  </div>

  <script>
    var uid = ${raw(JSON.stringify(uid))};

    var didLeave = false;

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) didLeave = true;
    });
    window.addEventListener('blur', function() {
      didLeave = true;
    });

    async function connectPlugin() {
      var btn = document.getElementById('connect-btn');
      var status = document.getElementById('status');
      btn.disabled = true;
      btn.textContent = 'Generating key...';
      status.textContent = '';
      status.className = 'status';
      didLeave = false;

      try {
        var res = await fetch('/v1/account/get-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: uid })
        });
        var data = await res.json();

        if (data.redirect) {
          status.textContent = 'Key generated! Opening Obsidian...';
          status.className = 'status success';
          btn.textContent = 'Opening Obsidian...';
          window.location.href = data.redirect;

          setTimeout(function() {
            if (didLeave) {
              // Obsidian opened — show success
              status.textContent = 'Connected! You can close this tab.';
              status.className = 'status success';
              btn.textContent = 'Done';
            } else {
              // Never left the page — Obsidian probably didn't open
              btn.disabled = false;
              btn.textContent = 'Try again';
              status.textContent = 'Could not open Obsidian. Make sure the app is running, then try again.';
              status.className = 'status error';
            }
          }, 2000);
        } else {
          throw new Error(data.error || 'Unknown error');
        }
      } catch (e) {
        status.textContent = 'Something went wrong: ' + e.message;
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Try again';
      }
    }
  </script>
</body>
</html>`
}

export default account
