-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  api_key TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

-- Tables for site publishing

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  users_id INTEGER,
  slug TEXT UNIQUE NOT NULL,
  title TEXT,
  file_count INTEGER DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sites_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  filetype TEXT NOT NULL,
  hash TEXT,
  FOREIGN KEY (sites_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);
CREATE INDEX IF NOT EXISTS idx_sites_users_id ON sites(users_id);
CREATE INDEX IF NOT EXISTS idx_site_files_sites_id ON site_files(sites_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_files_path ON site_files(sites_id, path);
