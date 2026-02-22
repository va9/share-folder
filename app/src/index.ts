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
