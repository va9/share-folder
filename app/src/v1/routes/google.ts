import { Hono } from 'hono'
import { getDb } from '../../db'
import { authMiddleware, AuthEnv } from '../../auth'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const SCOPES = 'https://www.googleapis.com/auth/drive.file'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface GoogleTokenRow {
  id: number
  users_id: number
  access_token: string
  refresh_token: string
  expires_at: number
}

/** Exchange an authorization code for tokens */
async function exchangeCode (code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${text}`)
  }
  return res.json() as Promise<GoogleTokenResponse>
}

/** Refresh an expired access token */
async function refreshAccessToken (refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed: ${text}`)
  }
  return res.json() as Promise<GoogleTokenResponse>
}

/** Get a valid access token for a user, refreshing if expired */
async function getValidToken (userId: number): Promise<string> {
  const db = getDb()
  const row = db.prepare('SELECT * FROM google_tokens WHERE users_id = ?').get(userId) as GoogleTokenRow | undefined
  if (!row) throw new Error('Google not connected')

  // If token expires within 5 minutes, refresh it
  if (Date.now() > row.expires_at - 300000) {
    const refreshed = await refreshAccessToken(row.refresh_token)
    const now = Date.now()
    db.prepare('UPDATE google_tokens SET access_token = ?, expires_at = ?, updated = ? WHERE users_id = ?')
      .run(refreshed.access_token, now + refreshed.expires_in * 1000, now, userId)
    return refreshed.access_token
  }

  return row.access_token
}

/** Upload HTML as a Google Doc via multipart upload, returns the doc URL */
async function uploadToGoogleDocs (accessToken: string, title: string, html: string): Promise<string> {
  const metadata = JSON.stringify({
    name: title,
    mimeType: 'application/vnd.google-apps.document'
  })

  const boundary = '----gdocs_boundary_' + Date.now()
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
    html + '\r\n' +
    `--${boundary}--`

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Drive upload failed: ${text}`)
  }

  const data = await res.json() as { id: string; webViewLink: string }

  // Set sharing: anyone with link can edit
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone'
    })
  })

  return data.webViewLink
}

// --- Routes ---

const google = new Hono<AuthEnv>()

/**
 * GET /auth?id={uid}
 * Redirect to Google OAuth consent screen.
 * The uid is passed as state so the callback can associate tokens with the user.
 */
google.get('/auth', (c) => {
  const uid = c.req.query('id')
  if (!uid) return c.text('Missing id parameter', 400)

  const redirectUri = new URL('/v1/google/callback', c.req.url).toString()
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: uid
  })

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

/**
 * GET /callback?code=...&state={uid}
 * Google redirects here after consent. Exchange code for tokens and redirect to Obsidian.
 */
google.get('/callback', async (c) => {
  const code = c.req.query('code')
  const uid = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.text(`Google OAuth error: ${error}`, 400)
  }
  if (!code || !uid) {
    return c.text('Missing code or state parameter', 400)
  }

  const redirectUri = new URL('/v1/google/callback', c.req.url).toString()

  try {
    const tokens = await exchangeCode(code, redirectUri)
    if (!tokens.refresh_token) {
      return c.text('No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.', 400)
    }

    const db = getDb()
    const user = db.prepare('SELECT id FROM users WHERE uid = ?').get(uid) as { id: number } | undefined
    if (!user) {
      return c.text('Unknown user', 400)
    }

    const now = Date.now()
    const expiresAt = now + tokens.expires_in * 1000

    // Upsert tokens
    const existing = db.prepare('SELECT id FROM google_tokens WHERE users_id = ?').get(user.id) as { id: number } | undefined
    if (existing) {
      db.prepare('UPDATE google_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated = ? WHERE users_id = ?')
        .run(tokens.access_token, tokens.refresh_token, expiresAt, now, user.id)
    } else {
      db.prepare('INSERT INTO google_tokens (users_id, access_token, refresh_token, expires_at, created, updated) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, tokens.access_token, tokens.refresh_token, expiresAt, now, now)
    }

    // Redirect back to Obsidian
    return c.redirect('obsidian://gdocs-export?google=connected')
  } catch (e) {
    console.error('Google OAuth callback error:', e)
    return c.text(`OAuth failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 500)
  }
})

/**
 * POST /export (authed)
 * Receive {title, html}, upload to Google Drive as formatted Doc, return {url}.
 */
google.post('/export', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const { title, html } = await c.req.json() as { title: string; html: string }

  if (!title || !html) {
    return c.json({ error: 'Missing title or html' }, 400)
  }

  try {
    const accessToken = await getValidToken(userId)
    const url = await uploadToGoogleDocs(accessToken, title, html)
    return c.json({ url })
  } catch (e) {
    console.error('Google export error:', e)
    const message = e instanceof Error ? e.message : 'Unknown error'

    // If token is invalid, tell the client to reconnect
    if (message.includes('401') || message.includes('invalid_grant')) {
      const db = getDb()
      db.prepare('DELETE FROM google_tokens WHERE users_id = ?').run(userId)
      return c.json({ error: 'Google token expired. Please reconnect Google in settings.' }, 401)
    }

    return c.json({ error: message }, 500)
  }
})

/**
 * POST /status (authed)
 * Return whether the user has a connected Google account.
 */
google.post('/status', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = getDb()
  const row = db.prepare('SELECT id FROM google_tokens WHERE users_id = ?').get(userId)
  return c.json({ connected: !!row })
})

/**
 * POST /disconnect (authed)
 * Revoke Google token and delete from DB.
 */
google.post('/disconnect', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = getDb()
  const row = db.prepare('SELECT access_token FROM google_tokens WHERE users_id = ?').get(userId) as { access_token: string } | undefined

  if (row) {
    // Best-effort revocation
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${row.access_token}`, { method: 'POST' })
    } catch {
      // Ignore revocation errors
    }
    db.prepare('DELETE FROM google_tokens WHERE users_id = ?').run(userId)
  }

  return c.json({ success: true })
})

export default google
