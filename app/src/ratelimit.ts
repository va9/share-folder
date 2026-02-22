import { createMiddleware } from 'hono/factory'

interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * Simple in-memory rate limiter.
 * Uses IP address as the key. Resets after the window expires.
 */
export function rateLimit (opts: { windowMs: number; max: number; message?: string }) {
  const store = new Map<string, RateLimitEntry>()

  // Periodically clean up expired entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, 60000)

  return createMiddleware(async (c, next) => {
    const ip = c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown'

    const now = Date.now()
    let entry = store.get(ip)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      store.set(ip, entry)
    }

    entry.count++

    if (entry.count > opts.max) {
      return c.json(
        { error: opts.message || 'Too many requests. Please try again later.' },
        429
      )
    }

    await next()
  })
}
