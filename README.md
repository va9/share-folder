# Publish Folder

An Obsidian plugin that publishes an entire folder as a navigable website. Your notes become a static site with sidebar navigation, backlinks, full-text search, and tag pages.

## Features

- **Folder-to-website** publishing with a single command
- **Sidebar navigation** that mirrors your vault folder structure
- **Backlinks** between pages, just like in Obsidian
- **Full-text search** across all published pages
- **Tag pages** with automatic indexing
- **Dark/light theme** toggle
- **SPA router** for instant page transitions
- **Zero-knowledge encryption** -- content is encrypted client-side with AES-256-GCM; the server never sees your data. Decryption key lives in the URL fragment (`#key`), which is never sent to the server.
- **Vanity URLs** -- claim a short slug (e.g., `/s/yourname/notes/`)
- **Expiring sites** -- auto-delete after 1, 7, 30, or 90 days
- **Local HTML export** -- publish to a folder on disk, no server needed

## Installation

### From GitHub (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add this repo URL in BRAT settings
3. Enable "Publish Folder" in Community Plugins

### Manual

1. Download `main.js` and `manifest.json` from the [latest release](../../releases/latest)
2. Create a folder: `<your-vault>/.obsidian/plugins/obsidian-publish-folder/`
3. Place both files in that folder
4. Enable "Publish Folder" in Obsidian settings under Community Plugins

## Usage

1. Open the command palette and run **Publish Folder: Publish to server** or **Publish Folder: Publish to local HTML**
2. Select the folder you want to publish
3. Your site is live

### Settings

| Setting | Description |
|---------|-------------|
| **Default folder** | Skip the folder picker and always publish this folder |
| **Vanity URL** | Claim a short URL prefix (e.g., `yourname`) so your sites are at `/s/yourname/<folder>/` |
| **Encryption** | Encrypt content before uploading. The key is appended to the URL as a `#fragment`. |
| **Expiry** | Auto-delete the site after a set duration. Re-publishing resets the timer. |

### URL structure

| Type | URL |
|------|-----|
| Default | `/s/<prefix>/<folder>/` |
| Vanity | `/s/<vanity>/<folder>/` |
| Encrypted | `/s/<vanity>/<folder>/#<key>` |

Where `<prefix>` is the first 8 characters of your user ID, and `<folder>` is the folder name.

## Self-hosting

The server is a Node.js app using Hono and SQLite. See `app/` for the source and Dockerfile.

```bash
cd app
npm install
npm run build
node dist/index.js
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `/data` | Directory for SQLite database and site files |

## License

MIT
