/**
 * Site publishing and serving routes.
 *
 * POST /v1/site/publish  — Receive site files and store them
 * GET  /s/:slug/*         — Serve site pages
 * GET  /s/:slug           — Redirect to index.html
 */

import { Hono, Context } from 'hono'
import { Site, SiteFileInput } from '../Site'
import { getDb } from '../../db'
import { authMiddleware, AuthEnv } from '../../auth'

export interface PublishSiteRequest {
  slug: string
  title: string
  siteFiles: SiteFileInput[]
  batchIndex: number
  isFirstBatch: boolean
  isLastBatch: boolean
  totalFiles: number
  prefix?: string
  vanitySlug?: string
  encrypted?: boolean
  expiryDuration?: string
}

export interface PublishSiteResponse {
  success: boolean
  url?: string
  error?: string
}

/**
 * Handle site publish request.
 * Called by the Obsidian plugin's API.publishSite() method.
 */
/** Duration string → milliseconds mapping */
const EXPIRY_DURATIONS: Record<string, number> = {
  '1d': 86400000,
  '7d': 604800000,
  '30d': 2592000000,
  '90d': 7776000000
}

/** Validate vanity slug format: 3-32 chars, alphanumeric + hyphens, NOT exactly 8 hex chars */
function isValidVanitySlug (slug: string): boolean {
  if (slug.length < 3 || slug.length > 32) return false
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false
  if (/^[0-9a-f]{8}$/.test(slug)) return false // would collide with prefix routing
  return true
}

export async function handlePublishSite (
  request: PublishSiteRequest,
  site: Site,
  userId: number,
  db: import('better-sqlite3').Database,
  baseUrl: string
): Promise<PublishSiteResponse> {
  const { slug, title, siteFiles, isFirstBatch, isLastBatch, totalFiles } = request

  try {
    // On first batch, create or update the site record
    if (isFirstBatch) {
      const now = Date.now()

      // Validate and resolve vanity slug (per-user: applies to all their sites)
      const vanitySlug = request.vanitySlug || null
      if (vanitySlug) {
        if (!isValidVanitySlug(vanitySlug)) {
          return { success: false, error: 'Invalid vanity slug. Must be 3-32 chars, alphanumeric + hyphens, and not exactly 8 hex characters.' }
        }
        // Check vanity uniqueness (allow if same user owns it)
        const vanityOwner = db.prepare('SELECT users_id FROM sites WHERE vanity_slug = ? AND users_id != ? LIMIT 1').get(vanitySlug, userId) as { users_id: number } | undefined
        if (vanityOwner) {
          return { success: false, error: 'This vanity slug is already taken' }
        }
        // Set vanity on ALL sites for this user
        db.prepare('UPDATE sites SET vanity_slug = ? WHERE users_id = ?').run(vanitySlug, userId)
      }

      // Compute expiry
      let expiresAt: number | null = null
      if (request.expiryDuration && EXPIRY_DURATIONS[request.expiryDuration]) {
        expiresAt = now + EXPIRY_DURATIONS[request.expiryDuration]
      }

      // Look up by prefixed slug first, then fall back to base slug or vanity (legacy rows)
      const baseSlug = slug.includes('/') ? slug.split('/').slice(1).join('/') : slug
      let existing = db.prepare('SELECT id, users_id, slug FROM sites WHERE slug = ?').get(slug) as { id: number; users_id: number; slug: string } | undefined
      if (!existing) {
        existing = db.prepare('SELECT id, users_id, slug FROM sites WHERE slug = ? OR vanity_slug = ?').get(baseSlug, baseSlug) as { id: number; users_id: number; slug: string } | undefined
      }

      if (existing) {
        // Ownership check — 409 if slug belongs to another user
        if (existing.users_id !== userId) {
          return { success: false, error: 'This slug is already taken' }
        }

        // Update existing site (also migrate slug to new prefixed format)
        db.prepare(`UPDATE sites SET slug = ?, title = ?, file_count = ?, updated = ?,
          user_prefix = ?, vanity_slug = ?, encrypted = ?, expires_at = ? WHERE id = ?`)
          .run(slug, title, totalFiles, now,
            request.prefix || null, vanitySlug,
            request.encrypted ? 1 : 0, expiresAt, existing.id)

        // Clear old file records (we'll re-insert)
        db.prepare('DELETE FROM site_files WHERE sites_id = ?').run(existing.id)

        // Remove old files from disk (use both old and new slug in case they differ)
        await site.removeSite(existing.slug)
        if (existing.slug !== slug) await site.removeSite(slug)
      } else {
        // Clean up any conflicting vanity_slug before insert
        if (vanitySlug) {
          db.prepare('UPDATE sites SET vanity_slug = NULL WHERE vanity_slug = ? AND users_id = ?').run(vanitySlug, userId)
        }

        // Create new site
        db.prepare(`INSERT INTO sites (users_id, slug, title, file_count, created, updated,
          user_prefix, vanity_slug, encrypted, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(userId, slug, title, totalFiles, now, now,
            request.prefix || null, vanitySlug,
            request.encrypted ? 1 : 0, expiresAt)
      }
    }

    // Store files to disk
    await site.storeFiles(slug, siteFiles)

    // Insert file records into DB
    const siteRecord = db.prepare('SELECT id FROM sites WHERE slug = ?').get(slug) as { id: number } | undefined
    if (siteRecord) {
      const insertStmt = db.prepare('INSERT OR REPLACE INTO site_files (sites_id, path, filename, filetype, hash) VALUES (?, ?, ?, ?, ?)')
      for (const file of siteFiles) {
        const filename = file.path.split('/').pop() || file.path
        insertStmt.run(siteRecord.id, file.path, filename, file.filetype, '')
      }
    }

    // On last batch, return the site URL
    if (isLastBatch) {
      const vanity = request.vanitySlug || null
      const folderName = slug.includes('/') ? slug.split('/').slice(1).join('/') : slug
      const displayPath = vanity ? `${vanity}/${folderName}` : slug
      return {
        success: true,
        url: `${baseUrl}/s/${displayPath}/`
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Site publish error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Handle serving a site page.
 * Maps /s/:slug/:path to the stored site files.
 */
export function handleServeSite (
  slug: string,
  filePath: string,
  site: Site
): { content: Buffer; mimeType: string } | null {
  // Default to index.html
  if (!filePath || filePath === '/' || filePath === '') {
    filePath = 'index.html'
  }

  const content = site.readFile(slug, filePath)
  if (content === null) {
    return null
  }

  return {
    content,
    mimeType: site.getMimeType(filePath)
  }
}

// --- Hono route wrappers ---

const DATA_DIR = process.env.DATA_DIR || '/data'
const site = new Site(DATA_DIR)

/** Authenticated publish route */
export const publishRouter = new Hono<AuthEnv>()

publishRouter.post('/publish', authMiddleware, async (c) => {
  const body = await c.req.json() as PublishSiteRequest
  const userId = c.get('userId')
  const db = getDb()

  // Ownership pre-check: if slug exists and belongs to someone else, reject early
  if (body.isFirstBatch) {
    const existing = db.prepare('SELECT users_id FROM sites WHERE slug = ?').get(body.slug) as { users_id: number } | undefined
    if (existing && existing.users_id !== userId) {
      return c.json({ success: false, error: 'This slug is already taken' }, 409)
    }

    // Vanity slug uniqueness pre-check
    if (body.vanitySlug) {
      const vanityOwner = db.prepare('SELECT users_id FROM sites WHERE vanity_slug = ? AND slug != ?').get(body.vanitySlug, body.slug) as { users_id: number } | undefined
      if (vanityOwner && vanityOwner.users_id !== userId) {
        return c.json({ success: false, error: 'This vanity slug is already taken' }, 409)
      }
    }
  }

  const baseUrl = new URL(c.req.url).origin
  const result = await handlePublishSite(body, site, userId, db, baseUrl)

  if (!result.success) {
    return c.json(result, 500)
  }
  return c.json(result)
})

publishRouter.post('/check-vanity', authMiddleware, async (c) => {
  const { vanitySlug } = await c.req.json() as { vanitySlug: string }
  if (!vanitySlug) {
    return c.json({ available: false, error: 'Missing vanity slug' }, 400)
  }

  if (!isValidVanitySlug(vanitySlug)) {
    return c.json({ available: false, error: 'Invalid format. Must be 3-32 chars, alphanumeric + hyphens, and not exactly 8 hex characters.' })
  }

  const userId = c.get('userId')
  const db = getDb()
  const owner = db.prepare('SELECT users_id FROM sites WHERE vanity_slug = ?').get(vanitySlug) as { users_id: number } | undefined

  if (!owner || owner.users_id === userId) {
    return c.json({ available: true })
  }
  return c.json({ available: false, error: 'This vanity slug is already taken' })
})

publishRouter.post('/delete', authMiddleware, async (c) => {
  const { slug } = await c.req.json() as { slug: string }
  if (!slug) {
    return c.json({ success: false, error: 'Missing slug' }, 400)
  }

  const userId = c.get('userId')
  const db = getDb()

  // Look up by slug first, then fall back to vanity_slug (for pre-migration clients)
  let existing = db.prepare('SELECT id, users_id, slug FROM sites WHERE slug = ?').get(slug) as { id: number; users_id: number; slug: string } | undefined
  if (!existing) {
    existing = db.prepare('SELECT id, users_id, slug FROM sites WHERE vanity_slug = ?').get(slug) as { id: number; users_id: number; slug: string } | undefined
  }
  if (!existing) {
    return c.json({ success: false, error: 'Site not found' }, 404)
  }
  if (existing.users_id !== userId) {
    return c.json({ success: false, error: 'Not your site' }, 403)
  }

  // Use the actual slug from DB for disk removal (may differ from what client sent)
  const actualSlug = existing.slug

  // Remove files from disk
  await site.removeSite(actualSlug)

  // Remove DB records
  db.prepare('DELETE FROM site_files WHERE sites_id = ?').run(existing.id)
  db.prepare('DELETE FROM sites WHERE id = ?').run(existing.id)

  return c.json({ success: true })
})

/** Styled 410 Gone page for expired sites */
const EXPIRED_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Expired</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;color:#212529}
.box{text-align:center;padding:40px}.box h1{font-size:2em;margin:0 0 8px}.box p{color:#6c757d;margin:4px 0}</style>
</head><body><div class="box"><h1>410</h1><p>This site has expired and is no longer available.</p></div></body></html>`

/** Check expiry and serve a site, or return 410 if expired */
function serveSiteOrExpired (slug: string, filePath: string, site: Site, c: Context) {
  const db = getDb()
  const siteRecord = db.prepare('SELECT expires_at FROM sites WHERE slug = ?').get(slug) as { expires_at: number | null } | undefined
  if (!siteRecord) return c.notFound()

  if (siteRecord.expires_at && siteRecord.expires_at < Date.now()) {
    return new Response(EXPIRED_PAGE, { status: 410, headers: { 'Content-Type': 'text/html' } })
  }

  const result = handleServeSite(slug, filePath, site)
  if (!result) return c.notFound()
  return new Response(result.content as any, { status: 200, headers: { 'Content-Type': result.mimeType } })
}

/** Public site-serving routes — single catch-all with disambiguation */
export const serveRouter = new Hono()

serveRouter.get('/*', (c) => {
  const fullPath = c.req.path.replace(/^\/s\/?/, '')
  const segments = fullPath.split('/').filter(Boolean)

  if (segments.length === 0) return c.notFound()

  const first = segments[0]
  const isPrefix = /^[0-9a-f]{8}$/.test(first)

  // --- Prefixed route: /s/{prefix}/{slug}/[file] ---
  if (isPrefix && segments.length >= 2) {
    const slug = `${segments[0]}/${segments[1]}`
    const filePath = segments.slice(2).join('/') || ''

    // Redirect /s/prefix/slug → /s/prefix/slug/
    if (segments.length === 2 && !c.req.path.endsWith('/')) {
      return c.redirect(`/s/${slug}/`)
    }

    return serveSiteOrExpired(slug, filePath || 'index.html', site, c)
  }

  // --- Bare prefix without slug segment → 404 ---
  if (isPrefix && segments.length === 1) {
    return c.notFound()
  }

  // --- Vanity route: /s/{vanity}/{folder}/[file] ---
  // Vanity slug maps to a user_prefix. Look up any site with this vanity to get the prefix.
  const vanity = segments[0]
  const db = getDb()
  const vanityRecord = db.prepare('SELECT user_prefix FROM sites WHERE vanity_slug = ? LIMIT 1').get(vanity) as { user_prefix: string } | undefined
  if (!vanityRecord) return c.notFound()

  if (segments.length >= 2) {
    // /s/{vanity}/{folder}/[file] → resolve to prefix/folder
    const slug = `${vanityRecord.user_prefix}/${segments[1]}`
    const filePath = segments.slice(2).join('/') || ''

    // Redirect /s/vanity/folder → /s/vanity/folder/
    if (segments.length === 2 && !c.req.path.endsWith('/')) {
      return c.redirect(`/s/${vanity}/${segments[1]}/`)
    }

    return serveSiteOrExpired(slug, filePath || 'index.html', site, c)
  }

  // /s/{vanity}/ alone — if this user has exactly one site, serve it; otherwise 404
  const singleSite = db.prepare('SELECT slug FROM sites WHERE vanity_slug = ?').all(vanity) as { slug: string }[]
  if (singleSite.length === 1) {
    if (!c.req.path.endsWith('/')) {
      return c.redirect(`/s/${vanity}/`)
    }
    return serveSiteOrExpired(singleSite[0].slug, 'index.html', site, c)
  }

  return c.notFound()
})
