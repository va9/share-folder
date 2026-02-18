/**
 * Site storage and management.
 * Handles storing site files on the filesystem and managing site metadata in SQLite.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface SiteFileInput {
  path: string       // relative path within site (e.g., "subfolder/note.html")
  content: string    // file content (or base64 for binary files)
  filetype: string   // file extension
  base64?: boolean   // true if content is base64-encoded binary
}

export interface SiteRecord {
  id: number
  users_id: number
  slug: string
  title: string
  file_count: number
  created: number
  updated: number
}

export class Site {
  private basePath: string

  constructor (basePath: string) {
    this.basePath = basePath
  }

  /** Get the filesystem path for a site */
  getSitePath (slug: string): string {
    return path.join(this.basePath, 'sites', slug)
  }

  /** Store site files to disk */
  async storeFiles (slug: string, files: SiteFileInput[]): Promise<void> {
    const sitePath = this.getSitePath(slug)

    for (const file of files) {
      const filePath = path.join(sitePath, file.path)
      const dir = path.dirname(filePath)

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Write file
      if (file.base64) {
        fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'))
      } else {
        fs.writeFileSync(filePath, file.content, 'utf-8')
      }
    }
  }

  /** Remove all files for a site */
  async removeSite (slug: string): Promise<void> {
    const sitePath = this.getSitePath(slug)
    if (fs.existsSync(sitePath)) {
      fs.rmSync(sitePath, { recursive: true, force: true })
    }
  }

  /** Read a file from a site */
  readFile (slug: string, filePath: string): Buffer | null {
    const fullPath = path.join(this.getSitePath(slug), filePath)

    // Prevent directory traversal
    const resolved = path.resolve(fullPath)
    if (!resolved.startsWith(path.resolve(this.getSitePath(slug)))) {
      return null
    }

    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved)
    }
    return null
  }

  /** Delete all expired sites from disk and DB */
  cleanupExpired (db: import('better-sqlite3').Database): void {
    const now = Date.now()
    const expired = db.prepare('SELECT id, slug FROM sites WHERE expires_at IS NOT NULL AND expires_at < ?').all(now) as Array<{ id: number; slug: string }>

    for (const site of expired) {
      console.log(`Cleaning up expired site: ${site.slug}`)
      const sitePath = this.getSitePath(site.slug)
      if (fs.existsSync(sitePath)) {
        fs.rmSync(sitePath, { recursive: true, force: true })
      }
      db.prepare('DELETE FROM site_files WHERE sites_id = ?').run(site.id)
      db.prepare('DELETE FROM sites WHERE id = ?').run(site.id)
    }

    if (expired.length > 0) {
      console.log(`Cleaned up ${expired.length} expired site(s)`)
    }
  }

  /** Get the MIME type for a file extension */
  getMimeType (filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
    }
    return mimeTypes[ext] || 'application/octet-stream'
  }
}
