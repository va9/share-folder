# Share Folder

An Obsidian plugin that turns any folder into a live website. Right-click a folder, hit share, and get a URL. Your notes become a static site with sidebar navigation, backlinks, search, tags, and dark mode — all generated from your existing vault structure.

![](https://img.shields.io/github/v/release/va9/share-folder) ![](https://img.shields.io/github/license/va9/share-folder)

## Features

### Publishing
- **One-click sharing** — right-click any folder or use the command palette
- **Per-folder settings** — each folder gets its own title, encryption, and expiry configuration
- **Pre-publish modal** — review and adjust settings before every share
- **Local HTML export** — generate a static site to disk, no server needed
- **Batch upload** — files are uploaded in batches of 20 for reliability

### Generated Site
- **Sidebar navigation** mirroring your vault folder structure, with collapsible sections
- **Backlinks** between pages, rendered at the bottom of each note
- **Full-text search** across all pages (Ctrl/Cmd+K)
- **Tag pages** — automatic tag index and per-tag listing pages
- **Dark/light theme** toggle with system preference detection
- **SPA router** — instant page transitions without full reloads
- **Mobile responsive** — sidebar collapses on small screens
- **Code block copy buttons** on all fenced code blocks
- **Image compression** — images over 100KB are automatically compressed (max 1400px, quality 0.6)
- **Open Graph tags** — shared links show title and description in messengers

### Security & Privacy
- **Zero-knowledge encryption** — AES-256-GCM, client-side only. The server never sees your content. The decryption key lives in the URL `#fragment`, which browsers never send to the server.
- **Expiring shares** — auto-delete after 1, 7, 30, or 90 days. Re-sharing resets the timer.
- **Vanity URLs** — claim a short slug (e.g., `yourname/notes/`) so your shares are easy to remember
- **HMAC authentication** — API keys are never sent in plaintext; only SHA-256 hashes of nonce+key

### Frontmatter
- Set `publish: false` in any note's frontmatter to exclude it from the shared site
- Set `title` in frontmatter to override the filename as page title

## Installation

### From GitHub (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repo URL in BRAT settings: `va9/share-folder`
3. Enable "Share Folder" in Community Plugins

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Create a folder: `<your-vault>/.obsidian/plugins/share-folder/`
3. Place all three files in that folder
4. Enable "Share Folder" in Obsidian settings → Community Plugins

## Usage

### Share to web

1. **Right-click** any folder in the file explorer → **Share folder to web**
2. Adjust title, encryption, and expiry in the modal
3. Click **Publish** — your folder is live

Or use the command palette: `Share Folder: Share folder to web`

Or click the globe icon in the left ribbon.

### Share to local HTML

1. **Right-click** a folder → **Share folder to local HTML**
2. Adjust settings, then choose an output directory
3. Open the generated `index.html` in any browser

### Re-share with different settings

Right-click a previously shared folder → **See settings and re-publish**. The modal pre-fills with your saved per-folder settings.

### Context menu actions

For shared folders, the context menu also shows:
- **Open shared folder** — opens the live URL in your browser
- **Copy URL** — copies the share link to clipboard
- **Delete shared folder** — removes the site from the server

## Settings

### Per-folder settings (pre-publish modal)

Each folder can have its own configuration, saved automatically when you publish:

| Setting | Description |
|---------|-------------|
| **Title** | Display name for the site. Defaults to folder name if empty. |
| **Encryption** | Encrypt page content with AES-256-GCM. Key is appended as URL `#fragment`. Titles and navigation remain visible. |
| **Expiry** | Auto-delete after 1 day, 7 days, 30 days, or 90 days. Never by default. |

### Global defaults (settings tab)

These apply to folders that don't have saved per-folder settings:

| Setting | Description |
|---------|-------------|
| **Default folder** | Skip the folder picker and always share this folder |
| **Title** | Default site title for new shares |
| **Vanity URL** | Short URL prefix for all your shares (e.g., `yourname`) |
| **Encryption** | Default encryption toggle for new shares |
| **Expiry** | Default expiry for new shares |

The **Shared folders** section lists all your published folders with buttons to open, copy URL, edit settings, or delete.

## URL structure

| Type | URL |
|------|-----|
| Default | `https://opennotes.io/<prefix>/<folder>/` |
| Vanity | `https://opennotes.io/<vanity>/<folder>/` |
| Encrypted | `https://opennotes.io/<vanity>/<folder>/#<key>` |

- `<prefix>` is the first 8 hex characters of your user ID (auto-generated)
- `<vanity>` is your chosen slug (3–32 chars, alphanumeric + hyphens)
- Visiting a `<prefix>` URL when you have a vanity slug automatically 302 redirects to the vanity URL

## Encryption

When encryption is enabled:

1. The plugin generates an AES-256-GCM key (stored locally in your vault settings)
2. All page content, tags, backlinks, and the search index are encrypted client-side before upload
3. Images are embedded as data URIs inside the encrypted content
4. The key is appended to the URL as a `#fragment` — browsers never send this to the server
5. Visitors with the full URL (including `#key`) can decrypt in-browser via Web Crypto API
6. Visitors without the key see a "This content is encrypted" prompt

**What's encrypted:** page body, tags, backlinks, search index, embedded images

**What's NOT encrypted:** page titles, site title, navigation structure (folder/file names), URL paths

## Hosting

By default, the plugin publishes to [opennotes.io](https://opennotes.io), a free community server. The code is open source — you can self-host if you prefer full control.

### Limits (opennotes.io)

| Limit | Value |
|-------|-------|
| Shares per account | 100 |
| Files per share | 5,000 |
| Max file size | 10 MB |

### Self-hosting

The server is a Node.js app using [Hono](https://hono.dev) and SQLite (via better-sqlite3).

```bash
cd app
npm install
npm run build
node dist/index.js
```

Or with Docker:

```bash
cd app
docker build -t share-folder .
docker run -p 3000:3000 -v /path/to/data:/data share-folder
```

Then set the **Server** URL in the plugin settings to your server's address.

#### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `/data` | Directory for SQLite database and site files |

#### Deploying to Fly.io

```bash
cd app
fly launch
fly deploy
```

The included `fly.toml` and `Dockerfile` handle the rest.

## How it works

1. **Collect** — recursively gather all `.md` files in the folder (respecting `publish: false`)
2. **Render** — open each note in Obsidian's preview mode and extract the rendered HTML
3. **Compress** — shrink images over 100KB (max 1400px, JPEG fallback if smaller)
4. **Rewrite** — convert `[[wikilinks]]` and image paths to site-relative URLs
5. **Analyze** — build backlink graph and tag index from metadata cache
6. **Build** — generate navigation tree, search index, tag pages, and index page
7. **Encrypt** (optional) — AES-256-GCM encrypt page content and search index
8. **Template** — wrap everything in the site template with sidebar, search, and theme toggle
9. **Upload** — batch-upload files to the server (or write to disk for local export)

## Project structure

```
share-folder/
├── src/                          # Obsidian plugin (TypeScript)
│   ├── main.ts                   # Entry point, commands, context menus
│   ├── settings.ts               # Settings tab, interfaces
│   ├── crypto.ts                 # AES-256-GCM encryption
│   ├── api.ts                    # Server API client
│   └── site/
│       ├── site-publisher.ts     # Build pipeline & upload
│       ├── site-template.ts      # HTML template generation
│       ├── nav-builder.ts        # Sidebar navigation tree
│       ├── search-builder.ts     # Full-text search index
│       ├── link-analyzer.ts      # Backlink extraction
│       ├── tag-analyzer.ts       # Tag indexing & tag pages
│       ├── link-rewriter.ts      # Internal link rewriting
│       └── ui/
│           ├── publish-settings-modal.ts  # Pre-publish settings
│           ├── publish-progress.ts        # Upload progress
│           ├── folder-picker.ts           # Folder selection
│           └── output-path-modal.ts       # Local export path
├── app/                          # Server (Hono + SQLite)
│   └── src/
│       ├── index.ts              # Server entry point
│       ├── db.ts                 # Database setup & migrations
│       ├── auth.ts               # HMAC authentication
│       └── v1/routes/
│           ├── site.ts           # Publish & serve routes
│           └── account.ts        # Account management
├── manifest.json
├── package.json
└── styles.css
```

## Building from source

```bash
# Plugin
npm install
npm run build        # production build → main.js
npm run dev          # watch mode for development

# Server
cd app
npm install
npm run build        # TypeScript → dist/
```

## Credits

This plugin builds on the excellent [Share Note](https://github.com/alangrainger/share-note) by Alan Grainger. The original encryption implementation, API authentication, and plugin architecture were invaluable starting points. Thank you Alan for open-sourcing your work.

## License

MIT
