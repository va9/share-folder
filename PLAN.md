# Obsidian Folder → Web Publisher (Fork of Share Note)

## Context
Build an Obsidian plugin that publishes an entire folder as a navigable website. Instead of building from scratch, we fork [share-note](https://github.com/alangrainger/share-note) and extend it with multi-page site publishing capabilities.

## What We Reuse from Share Note
- **Rendering pipeline** (`src/note.ts`): switches to preview mode, waits for Obsidian to render, extracts `innerHTML` — callouts, math, Mermaid, code highlighting, dataview all work for free
- **CSS extraction** (`processCss()`): captures all stylesheets + fonts/SVGs from user's theme
- **Image processing** (`processMedia()` + `Compressor.ts`): reads from vault, compresses, hash-deduplicates
- **Server** (`app/`): Hono + SQLite + filesystem, authentication, file storage, note serving
- **Encryption** (`src/crypto.ts`): AES-256-GCM with key in URL fragment
- **API client** (`src/api.ts`): auth headers, upload queue, batch dedup

## What We Add
1. **"Publish Folder" command** — select a folder, publish all notes in it as a connected site
2. **Site template** — wraps each page in a layout with sidebar navigation, backlinks panel, search
3. **Link analyzer** — scan all notes for `[[links]]`, build backlinks map
4. **Sidebar navigation** — folder tree generated from vault structure
5. **Client-side search** — flexsearch index built at publish time
6. **Tag pages** — auto-generated `/tags/{tag}.html` pages
7. **Index page** — browsable home page for the site
8. **Server extension** — new endpoint to create/serve multi-page sites (not just single notes)

## Architecture

### Publishing Flow
```
User picks folder
  → Collect all .md files + assets in folder
  → Analyze: extract [[links]] from all files, build backlinks map, collect tags
  → For each .md file:
      → Use existing Share Note rendering (preview mode → extract HTML)
      → Use existing image processing + CSS extraction
      → Post-process: rewrite [[links]] to relative site URLs (not share.note.sx URLs)
  → Generate site assets:
      → sidebar nav JSON (folder tree)
      → backlinks JSON (reverse link map)
      → search index JSON (flexsearch)
      → tag pages HTML
      → index.html (home page)
  → Upload entire site bundle to server
  → Server stores as a site (not individual notes)
  → User gets URL: {slug}.{domain}
```

### Key Difference from Share Note's Single-Note Flow
Share Note renders one note → uploads one HTML file → done.
We render N notes → wrap each in a site template → upload as a bundle → serve as a navigable site.

The rendering per-note is identical. The new work is: bulk orchestration, link rewriting for inter-page navigation, site template, and the server-side site serving.

## Project Structure
```
obsidian-publish/                    # Forked from share-note
├── src/                             # Plugin source (extends share-note)
│   ├── main.ts                      # Extended: add "Publish Folder" command
│   ├── note.ts                      # REUSE AS-IS: single-note rendering pipeline
│   ├── api.ts                       # REUSE + EXTEND: add site upload endpoint
│   ├── crypto.ts                    # REUSE AS-IS
│   ├── Compressor.ts                # REUSE AS-IS
│   ├── NoteTemplate.ts             # REUSE AS-IS for per-page data
│   ├── settings.ts                  # EXTEND: add site-level settings
│   ├── StatusMessage.ts             # REUSE AS-IS
│   ├── UI.ts                        # REUSE AS-IS
│   ├── types.ts                     # EXTEND: add site types
│   │
│   ├── site/                        # NEW: all site publishing logic
│   │   ├── site-publisher.ts        # Orchestrator: folder → rendered site bundle
│   │   ├── link-analyzer.ts         # Parse all files for [[links]], build backlinks map
│   │   ├── link-rewriter.ts         # Rewrite wiki-links to relative site URLs
│   │   ├── tag-analyzer.ts          # Collect tags, generate tag pages
│   │   ├── search-builder.ts        # Build flexsearch index JSON
│   │   ├── nav-builder.ts           # Generate sidebar folder tree JSON
│   │   └── site-template.ts         # Wrap pages in site layout (sidebar, backlinks, search)
│   │
│   └── site/ui/                     # NEW: site publishing UI
│       ├── folder-picker.ts         # Modal: choose folder to publish
│       └── publish-progress.ts      # Modal: show progress for bulk publish
│
├── app/                             # Server (extends share-note server)
│   ├── src/
│   │   ├── index.ts                 # EXTEND: add site serving routes
│   │   └── v1/
│   │       ├── File.ts              # REUSE AS-IS
│   │       ├── WebNote.ts           # REUSE for single notes
│   │       ├── Site.ts              # NEW: site storage + serving logic
│   │       ├── routes/
│   │       │   ├── file.ts          # REUSE AS-IS
│   │       │   └── site.ts          # NEW: site upload/serve endpoints
│   │       └── templates/
│   │           ├── note.html        # REUSE for single notes
│   │           └── site-page.html   # NEW: site page template (sidebar, backlinks, search)
│   └── schema.sql                   # EXTEND: add sites table
│
├── template/                        # NEW: site theme assets
│   ├── site-page.html               # Page layout: sidebar + content + backlinks
│   ├── css/
│   │   └── site.css                 # Site-specific styles (sidebar, nav, backlinks, search, dark mode)
│   └── js/
│       ├── search.js                # Client-side flexsearch
│       ├── sidebar.js               # Folder tree expand/collapse
│       └── theme-toggle.js          # Dark/light mode
│
├── manifest.json
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

## Implementation Steps

### Step 1: Fork + setup
- Clone share-note repo into obsidian-publish/
- Verify build works (`npm run build`)
- Install in Obsidian dev vault, confirm existing share-note functionality works
- Rename plugin ID/name in manifest.json

### Step 2: Folder picker + "Publish Folder" command
- `src/site/ui/folder-picker.ts`: `FuzzySuggestModal` listing all vault folders
- `src/main.ts`: register new command "Publish Folder" that opens folder picker
- On folder select → hand off to site-publisher

### Step 3: Link analyzer + backlinks
- `src/site/link-analyzer.ts`:
  - For each .md in folder: regex extract all `[[wiki-links]]` (handle `[[page]]`, `[[page|alias]]`, `[[page#heading]]`)
  - Build forward map: `Map<sourcePath, targetPath[]>`
  - Invert to backlinks map: `Map<targetPath, {sourcePath, displayText}[]>`
- `src/site/tag-analyzer.ts`:
  - Extract `#tags` from content + frontmatter
  - Build `Map<tag, filePath[]>`

### Step 4: Bulk rendering
- `src/site/site-publisher.ts`:
  - Collect all .md files in selected folder (recursive)
  - Filter: skip files with `publish: false` in frontmatter
  - For each file: use existing `note.ts` rendering pipeline to get HTML
  - Key modification: instead of uploading each note individually, collect all rendered HTML in memory
  - Reuse existing CSS extraction (once for the site, not per-note)
  - Reuse existing image processing (batch all images across all notes)

### Step 5: Link rewriter
- `src/site/link-rewriter.ts`:
  - After rendering, walk each page's HTML
  - Find internal links (elements with `data-href` or `href` pointing to vault paths)
  - If target is in our published folder → rewrite to relative URL (e.g., `../subfolder/note.html`)
  - If target is NOT in folder → make it plain text (or link to share.note.sx if individually shared)
  - Handle heading anchors: `[[page#heading]]` → `page.html#heading`

### Step 6: Site template
- `template/site-page.html`: HTML layout with placeholders:
  - `{{SIDEBAR}}` — folder tree navigation
  - `{{CONTENT}}` — rendered note HTML
  - `{{BACKLINKS}}` — list of pages linking here
  - `{{PAGE_TITLE}}`, `{{SITE_TITLE}}`
  - Includes site.css + JS files
- `template/css/site.css`:
  - Sidebar: fixed left panel, collapsible on mobile
  - Content area: readable width, inherits Obsidian theme styles
  - Backlinks panel: bottom of content
  - Dark/light mode via CSS custom properties
  - Responsive: sidebar becomes hamburger menu on mobile
- `src/site/site-template.ts`:
  - Takes rendered page HTML + backlinks + nav tree
  - Injects into template placeholders
  - Returns complete page HTML

### Step 7: Navigation + search + tags
- `src/site/nav-builder.ts`:
  - Build folder tree from file paths
  - Output as nested JSON for sidebar.js to render
- `src/site/search-builder.ts`:
  - Extract plain text from each rendered page (strip HTML tags)
  - Build flexsearch index
  - Serialize to JSON for client-side loading
- `src/site/tag-analyzer.ts`:
  - Generate tag index page (list all tags)
  - Generate per-tag pages (list all notes with that tag)

### Step 8: Site upload + server changes
- `app/schema.sql`: add `sites` table:
  ```sql
  CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    users_id INTEGER,
    slug TEXT UNIQUE,
    title TEXT,
    file_count INTEGER,
    created INTEGER,
    updated INTEGER
  );
  CREATE TABLE site_files (
    id INTEGER PRIMARY KEY,
    sites_id INTEGER,
    path TEXT,
    filename TEXT,
    filetype TEXT,
    hash TEXT
  );
  ```
- `app/src/v1/routes/site.ts`: new endpoints:
  - `POST /v1/site/publish` — receive site manifest + files
  - `GET /s/{slug}/*` — serve site pages from filesystem
- `app/src/v1/Site.ts`: store site files in `userfiles/sites/{slug}/` directory structure
- `src/api.ts`: extend with `publishSite(slug, files[])` method

### Step 9: Client-side JS
- `template/js/sidebar.js`: render nav tree, expand/collapse folders, highlight current page, persist state to localStorage
- `template/js/search.js`: load search-index.json, init flexsearch, Cmd+K to open, instant results
- `template/js/theme-toggle.js`: toggle `[data-theme]`, persist to localStorage, respect `prefers-color-scheme`

### Step 10: Progress UI + polish
- `src/site/ui/publish-progress.ts`: modal showing:
  - "Rendering notes... (12/47)"
  - "Processing images... (5/23)"
  - "Uploading..."
  - "Done! Your site: https://slug.domain.com"
- Settings additions: default folder, site title, slug preference
- Ribbon icon for quick publish

## Verification
1. Clone share-note, apply our changes
2. Build plugin, install in Obsidian
3. Create test vault with: nested folders, wiki-links between notes, images, callouts, code blocks, math, Mermaid, tags, frontmatter with `publish: false`
4. Run "Publish Folder" on a folder
5. Verify in browser:
   - All pages render (callouts, math, mermaid, code all work via Obsidian's renderer)
   - Sidebar shows folder tree, navigation works
   - Wiki-links between pages work as relative links
   - Backlinks panel shows correct incoming links
   - Search finds content across all pages
   - Tag pages list correct notes
   - Dark mode toggles
   - Mobile responsive (sidebar collapses)
   - Images load correctly
   - Notes with `publish: false` are excluded

## Phase 2 (Future)
- Custom domains
- Incremental publish (only re-upload changed notes)
- Graph visualization
- Password-protected sites
- Analytics
- Custom CSS overrides per site
