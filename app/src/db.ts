import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/data'
const DB_PATH = path.join(DATA_DIR, 'publish.db')
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql')

let db: Database.Database

function runMigrations (db: Database.Database): void {
  // Check which columns exist on the sites table
  const columns = db.prepare("PRAGMA table_info(sites)").all() as Array<{ name: string }>
  const colNames = new Set(columns.map(c => c.name))

  if (!colNames.has('user_prefix')) {
    db.exec('ALTER TABLE sites ADD COLUMN user_prefix TEXT')
  }
  if (!colNames.has('vanity_slug')) {
    db.exec('ALTER TABLE sites ADD COLUMN vanity_slug TEXT')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_vanity_slug ON sites(vanity_slug)')
  }
  if (!colNames.has('encrypted')) {
    db.exec('ALTER TABLE sites ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0')
  }
  if (!colNames.has('expires_at')) {
    db.exec('ALTER TABLE sites ADD COLUMN expires_at INTEGER')
  }

  // Backfill existing sites: set user_prefix from users table
  db.exec(`
    UPDATE sites SET user_prefix = (
      SELECT SUBSTR(u.uid, 1, 8) FROM users u WHERE u.id = sites.users_id
    ) WHERE user_prefix IS NULL AND users_id IS NOT NULL
  `)

  // Backfill: set vanity_slug to current slug (preserves old URLs)
  // Use OR IGNORE to skip rows where the slug already exists as another row's vanity_slug
  db.exec(`UPDATE OR IGNORE sites SET vanity_slug = slug WHERE vanity_slug IS NULL`)

  // Backfill: prefix existing slugs so they match new format
  // Use OR IGNORE to skip rows where the prefixed slug already exists (from a prior migration run)
  db.exec(`
    UPDATE OR IGNORE sites SET slug = user_prefix || '/' || slug
    WHERE user_prefix IS NOT NULL AND slug NOT LIKE '%/%'
  `)

  // Clean up any orphaned unprefixed rows that couldn't be updated (duplicate of an already-prefixed row)
  db.exec(`
    DELETE FROM sites WHERE user_prefix IS NOT NULL AND slug NOT LIKE '%/%'
    AND EXISTS (
      SELECT 1 FROM sites s2 WHERE s2.slug = sites.user_prefix || '/' || sites.slug
    )
  `)

  // Google tokens table for OAuth
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      users_id INTEGER UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      FOREIGN KEY (users_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
}

export function getDb (): Database.Database {
  if (!db) {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Run schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
    db.exec(schema)

    // Run migrations
    runMigrations(db)
  }

  return db
}
