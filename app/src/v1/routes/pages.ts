import { Hono } from 'hono'
import { html, raw } from 'hono/html'

const pages = new Hono()

const SHELL = (title: string, body: string) => html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — opennotes.io</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 15px; }
    body {
      font-family: 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', monospace;
      background: #fdfdfd;
      color: #1a1a1a;
      min-height: 100vh;
      padding: 3rem 1.5rem;
      line-height: 1.75;
    }
    .wrap { max-width: 600px; margin: 0 auto; }
    nav {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 2.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #ddd;
    }
    nav a { color: #1a1a1a; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    nav span { color: #ccc; margin: 0 0.4rem; }
    h1 {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      letter-spacing: -0.01em;
    }
    .meta { font-size: 0.75rem; color: #999; margin-bottom: 2rem; }
    h2 {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
      padding-top: 1rem;
      border-top: 1px solid #eee;
    }
    p { font-size: 0.85rem; color: #444; margin-bottom: 0.75rem; }
    ul { padding-left: 1.25rem; margin-bottom: 0.75rem; }
    li { font-size: 0.85rem; color: #444; margin-bottom: 0.25rem; }
    li::marker { color: #ccc; }
    a { color: #1a1a1a; }
    a:hover { color: #000; }
    code {
      background: #f0f0f0;
      padding: 0.15em 0.35em;
      font-size: 0.9em;
      font-family: inherit;
    }
    strong { font-weight: 700; color: #1a1a1a; }
    .limits {
      font-size: 0.8rem;
      border: 1px solid #ddd;
      margin: 0.75rem 0;
    }
    .limits div {
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid #eee;
    }
    .limits div:last-child { border-bottom: none; }
    .limits .lk { color: #888; }
    .limits .lv { color: #1a1a1a; font-weight: 600; }
    label {
      display: block;
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.25rem;
      margin-top: 1rem;
    }
    input[type="text"], input[type="email"], textarea {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      background: #fff;
      color: #1a1a1a;
      font-family: inherit;
      font-size: 0.85rem;
      outline: none;
    }
    input:focus, textarea:focus { border-color: #1a1a1a; }
    textarea { min-height: 100px; resize: vertical; }
    button {
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.5rem 1.5rem;
      border: 1px solid #1a1a1a;
      background: #1a1a1a;
      color: #fff;
      cursor: pointer;
      margin-top: 1rem;
      letter-spacing: 0.02em;
    }
    button:hover { background: #333; }
    button:disabled { background: #999; border-color: #999; cursor: default; }
    .msg { font-size: 0.8rem; margin-top: 0.75rem; min-height: 1.2em; }
    .msg.ok { color: #2d7d46; }
    .msg.err { color: #c0392b; }
    footer {
      margin-top: 3rem;
      padding-top: 0.75rem;
      border-top: 1px solid #ddd;
      font-size: 0.7rem;
      color: #bbb;
    }
    footer a { color: #999; }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <a href="/">opennotes.io</a>
      <span>/</span>
      <a href="/terms">terms</a>
      <span>/</span>
      <a href="/abuse">abuse</a>
    </nav>
    ${raw(body)}
    <footer>
      <a href="https://github.com/va9/share-folder">source</a>
      <span> · </span>
      <a href="/terms">terms</a>
      <span> · </span>
      <a href="/abuse">report abuse</a>
    </footer>
  </div>
</body>
</html>`

pages.get('/terms', (c) => {
  return c.html(SHELL('Terms of Service', `
    <h1>Terms of Service</h1>
    <div class="meta">Last updated Feb 2026</div>

    <p><a href="https://opennotes.io">opennotes.io</a> is a free hosting service for the <a href="https://github.com/va9/share-folder">Share Folder</a> Obsidian plugin. It turns a folder of notes into a static website. The code is open source. The service is provided as-is by volunteers with no guarantees.</p>

    <h2>Zero-knowledge encryption</h2>
    <p>Users may enable client-side encryption (AES-256-GCM). When enabled, all content is encrypted in Obsidian before upload. The decryption key lives in the URL fragment (<code>#key</code>), which browsers never send to the server.</p>
    <p><strong>We cannot view, decrypt, or moderate encrypted content.</strong> The key is controlled entirely by the person sharing the link.</p>

    <h2>Prohibited use</h2>
    <ul>
      <li>Illegal content under applicable law</li>
      <li>Malware, phishing, or deceptive pages</li>
      <li>Child sexual abuse material (CSAM)</li>
      <li>Harassment, threats, or doxing</li>
      <li>Copyright or trademark infringement</li>
      <li>Automated mass uploads, scraping, or denial of service</li>
    </ul>

    <h2>Content removal</h2>
    <p>We may remove any site at any time, for any reason, without notice. This includes encrypted sites — we delete the files from disk even though we cannot read them.</p>
    <p>If you believe content infringes your rights, file a report at <a href="/abuse">/abuse</a>.</p>

    <h2>No warranty</h2>
    <p>This service is provided "as is" with no warranty. We are not liable for data loss, downtime, or damages. Sites may be deleted due to expiry, abuse reports, or infrastructure changes. Do not rely on this service as your only copy of anything.</p>

    <h2>Accounts &amp; privacy</h2>
    <p>Accounts are random IDs generated by the plugin. We do not collect names, emails, or passwords. API keys can be rotated at any time. We log request metadata (timestamps, IPs) for abuse prevention.</p>

    <h2>Limits</h2>
    <div class="limits">
      <div><span class="lk">sites per account</span><span class="lv">100</span></div>
      <div><span class="lk">files per site</span><span class="lv">5,000</span></div>
      <div><span class="lk">max file size</span><span class="lv">10 MB</span></div>
    </div>
    <p>These may change. Abuse may result in account restrictions.</p>

    <h2>Changes</h2>
    <p>We may update these terms. Continued use means acceptance.</p>
  `))
})

pages.get('/abuse', (c) => {
  return c.html(SHELL('Report Abuse', `
    <h1>Report Abuse</h1>
    <div class="meta">See also: <a href="/terms">Terms of Service</a></div>

    <p>Found something on opennotes.io that shouldn't be here? Report it below. We review all reports and act on them.</p>
    <p>For encrypted sites, we cannot view the content — but we can and will delete the site files from our servers in response to valid reports.</p>

    <form id="f" onsubmit="go(event)">
      <label for="url">URL</label>
      <input type="text" id="url" name="url" placeholder="https://opennotes.io/..." required>

      <label for="email">Your email <span style="color:#ccc">(optional, for follow-up)</span></label>
      <input type="email" id="email" name="email" placeholder="you@example.com">

      <label for="reason">What's the problem?</label>
      <textarea id="reason" name="reason" placeholder="Describe the issue. For DMCA: include the original work URL and your contact information." required></textarea>

      <button type="submit" id="btn">Submit report</button>
      <div class="msg" id="msg"></div>
    </form>

    <script>
      async function go(e) {
        e.preventDefault();
        var m = document.getElementById('msg');
        var b = document.getElementById('btn');
        b.disabled = true;
        b.textContent = 'sending...';
        m.textContent = '';
        m.className = 'msg';
        try {
          var r = await fetch('/v1/abuse/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: document.getElementById('url').value,
              email: document.getElementById('email').value,
              reason: document.getElementById('reason').value
            })
          });
          var d = await r.json();
          if (d.success) {
            m.textContent = 'Report received. Thank you.';
            m.className = 'msg ok';
            b.textContent = 'sent';
          } else { throw new Error(d.error || 'failed'); }
        } catch (err) {
          m.textContent = 'Error: ' + err.message;
          m.className = 'msg err';
          b.disabled = false;
          b.textContent = 'Submit report';
        }
      }
    </script>
  `))
})

export default pages
