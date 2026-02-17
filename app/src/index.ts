import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { logger } from 'hono/logger'
import { getDb } from './db'
import account from './v1/routes/account'
import { publishRouter, serveRouter } from './v1/routes/site'
import { Site } from './v1/Site'

const DATA_DIR = process.env.DATA_DIR || '/data'

const app = new Hono()

// Middleware
app.use('*', logger())

// Health check
app.get('/health', (c) => c.json({ ok: true }))

// Routes
app.route('/v1/account', account)
app.route('/v1/site', publishRouter)
app.route('/s', serveRouter)

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
