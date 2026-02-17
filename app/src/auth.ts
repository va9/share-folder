import { createMiddleware } from 'hono/factory'
import { createHash } from 'crypto'
import { getDb } from './db'

export type AuthEnv = {
  Variables: {
    userId: number
  }
}

/**
 * Auth middleware: verifies x-sharenote-* headers.
 * Client sends SHA256(nonce + apiKey), server computes the same and compares.
 * Returns 462 on failure (client expects this exact status code).
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const uid = c.req.header('x-sharenote-id')
  const keyHash = c.req.header('x-sharenote-key')
  const nonce = c.req.header('x-sharenote-nonce')

  if (!uid || !keyHash || !nonce) {
    return new Response(JSON.stringify({ error: 'Missing auth headers' }), { status: 462, headers: { 'Content-Type': 'application/json', message: 'Missing auth headers' } })
  }

  const db = getDb()
  const user = db.prepare('SELECT id, api_key FROM users WHERE uid = ?').get(uid) as { id: number; api_key: string } | undefined

  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 462, headers: { 'Content-Type': 'application/json', message: 'Invalid API key' } })
  }

  // Compute SHA256(nonce + apiKey) — matches client's crypto.ts sha256()
  const expected = createHash('sha256').update(nonce + user.api_key).digest('hex')

  if (expected !== keyHash) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 462, headers: { 'Content-Type': 'application/json', message: 'Invalid API key' } })
  }

  c.set('userId', user.id)
  await next()
})
