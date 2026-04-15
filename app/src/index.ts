import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import { getDb } from './db'
import account from './v1/routes/account'
import { publishRouter, serveRouter } from './v1/routes/site'
import google from './v1/routes/google'
import pages from './v1/routes/pages'
import admin, { abuseRouter } from './v1/routes/admin'
import { Site } from './v1/Site'

const DATA_DIR = process.env.DATA_DIR || '/data'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('/v1/*', bodyLimit({ maxSize: 64 * 1024 * 1024 })) // 64 MB max (20 files × 2 MB × base64 overhead)

// Health check
app.get('/health', (c) => c.json({ ok: true }))

// Homepage → GitHub repo
app.get('/', (c) => c.redirect('https://github.com/va9/share-folder'))

// Admin UI shortcut
app.get('/admin', (c) => c.redirect('/v1/admin/ui'))

// Obsidian URI redirector — turns HTTPS links into obsidian:// URIs
// so that obsidian:// links work from apps that strip non-HTTP schemes (Telegram, etc.)
app.get('/open-in-app', (c) => {
  const raw = c.req.query('url')

  if (!raw) {
    c.status(400)
    return c.text(
      'Obsidian URI Redirector\n\n' +
      'Usage: https://opennotes.io/open-in-app?url=obsidian%3A%2F%2Fopen%3Fvault%3DMy%2520Vault%26file%3Dpath%2Fto%2Fnote.md\n\n' +
      'Error: Missing or invalid URL. Only obsidian:// URIs are accepted.'
    )
  }

  // Decode and validate scheme
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    c.status(400)
    return c.text(
      'Obsidian URI Redirector\n\n' +
      'Usage: https://opennotes.io/open-in-app?url=obsidian%3A%2F%2Fopen%3Fvault%3DMy%2520Vault%26file%3Dpath%2Fto%2Fnote.md\n\n' +
      'Error: Missing or invalid URL. Only obsidian:// URIs are accepted.'
    )
  }

  if (!decoded.startsWith('obsidian://')) {
    c.status(400)
    return c.text(
      'Obsidian URI Redirector\n\n' +
      'Usage: https://opennotes.io/open-in-app?url=obsidian%3A%2F%2Fopen%3Fvault%3DMy%2520Vault%26file%3Dpath%2Fto%2Fnote.md\n\n' +
      'Error: Missing or invalid URL. Only obsidian:// URIs are accepted.'
    )
  }

  // Reject URIs containing HTML/JS injection attempts
  if (/[<>"']/.test(decoded)) {
    c.status(400)
    return c.text(
      'Obsidian URI Redirector\n\n' +
      'Usage: https://opennotes.io/open-in-app?url=obsidian%3A%2F%2Fopen%3Fvault%3DMy%2520Vault%26file%3Dpath%2Fto%2Fnote.md\n\n' +
      'Error: Missing or invalid URL. Only obsidian:// URIs are accepted.'
    )
  }

  // JSON.stringify handles JS string escaping (quotes, backslashes, etc.)
  // and is the correct way to embed a value inside a <script> tag
  const safe = JSON.stringify(decoded)

  return c.html(
    '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>Opening in Obsidian…</title></head>' +
    '<body><p>Opening in Obsidian…</p>' +
    `<script>window.location.href=${safe};</script>` +
    '</body></html>'
  )
})

// Routes
app.route('/v1/account', account)
app.route('/v1/site', publishRouter)
app.route('/v1/google', google)
app.route('/v1/admin', admin)
app.route('/v1/abuse', abuseRouter)
app.route('/', pages)
app.route('/', serveRouter)

// Initialize DB on startup
const db = getDb()

// Clean up expired sites on startup and hourly
const siteManager = new Site(DATA_DIR)
siteManager.cleanupExpired(db)
setInterval(() => {
  siteManager.cleanupExpired(getDb())
}, 3600000) // 1 hour

const port = parseInt(process.env.PORT || '3000')
console.log(`Server starting on port ${port}`)

serve({ fetch: app.fetch, port })
