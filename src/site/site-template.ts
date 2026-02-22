import { NavItem } from './nav-builder'

export interface SiteBacklink {
  sourcePath: string
  displayText: string
  slug?: string
}

export interface SitePageData {
  siteTitle: string
  pageTitle: string
  content: string
  css: string
  currentSlug: string
  navTree: NavItem
  backlinks: SiteBacklink[]
  pathToRoot: string
  tags: string[]
  encrypted?: boolean
  siteBaseUrl?: string  // e.g. "https://opennotes.io/vanity/folder" — for OG tags
}

export class SiteTemplate {
  /**
   * Wrap a rendered note page in the full site layout.
   */
  render (data: SitePageData): string {
    const backlinkHtml = this.renderBacklinks(data.backlinks, data.currentSlug, data.pathToRoot)
    const tagHtml = this.renderTags(data.tags, data.pathToRoot)
    const navHtml = this.renderNavTree(data.navTree, data.currentSlug, data.pathToRoot)

    return `<!DOCTYPE html>
<html data-theme="light" prefix="og: http://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escapeHtml(data.pageTitle)} - ${this.escapeHtml(data.siteTitle)}</title>
  <meta property="og:title" content="${this.escapeHtml(data.pageTitle)} - ${this.escapeHtml(data.siteTitle)}">
  <meta property="og:description" content="${this.escapeHtml(data.siteTitle)}">
  <meta property="og:site_name" content="${this.escapeHtml(data.siteTitle)}">
  <meta property="og:type" content="website">${data.siteBaseUrl ? `
  <meta property="og:url" content="${this.escapeHtml(data.siteBaseUrl)}/${data.currentSlug}.html">` : ''}
  <script>(function(){var t=localStorage.getItem('site-theme');if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t)document.documentElement.setAttribute('data-theme',t)})()</script>
  <style>${data.css}</style>
  <link rel="stylesheet" href="${data.pathToRoot}assets/site.css">
  <style>
    body.site-page, body.site-page *, body.site-page *::before, body.site-page *::after {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    body.site-page .nav-folder-title { user-select: none !important; -webkit-user-select: none !important; }
    body.site-page { overflow: auto !important; contain: none !important; }
    body.site-page ::selection { background-color: Highlight !important; color: HighlightText !important; }
    body.site-page ::-moz-selection { background-color: Highlight !important; color: HighlightText !important; }
  </style>
</head>
<body class="site-page">
  <div class="site-layout">
    <button class="sidebar-toggle" aria-label="Toggle navigation">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>

    <nav class="site-sidebar" id="site-sidebar">
      <div class="sidebar-header">
        <a href="${data.pathToRoot}index.html" class="site-title">${this.escapeHtml(data.siteTitle)}</a>
        <button class="search-trigger" id="search-trigger" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span class="search-shortcut">Ctrl+K</span>
        </button>
      </div>
      <div class="nav-tree" id="nav-tree">${navHtml}</div>
    </nav>

    <main class="site-content">${data.encrypted
      ? `\n      ${data.content}`
      : `\n      <article class="page-content markdown-preview-view">
        ${data.content}
      </article>
      ${tagHtml}
      ${backlinkHtml}`}
    </main>
  </div>

  <div class="search-overlay" id="search-overlay" style="display:none">
    <div class="search-modal">
      <input type="text" class="search-input" id="search-input" placeholder="Search pages..." autocomplete="off">
      <div class="search-results" id="search-results"></div>
    </div>
  </div>

  <div class="theme-toggle" id="theme-toggle" title="Toggle dark/light mode">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
  </div>

  <script>window.__PATH_TO_ROOT__ = ${JSON.stringify(data.pathToRoot)};${data.encrypted ? ' window.__ENCRYPTED__ = true;' : ''}</script>
  <script src="${data.pathToRoot}assets/search-index.js"></script>${data.encrypted ? `
  <script src="${data.pathToRoot}assets/decrypt.js"></script>` : ''}
  <script src="${data.pathToRoot}assets/router.js"></script>
  <script src="${data.pathToRoot}assets/sidebar.js"></script>
  <script src="${data.pathToRoot}assets/search.js"></script>
  <script src="${data.pathToRoot}assets/theme-toggle.js"></script>
</body>
</html>`
  }

  /** Generate the index/home page */
  renderIndex (data: {
    siteTitle: string
    css: string
    navTree: NavItem
    pages: Array<{ slug: string; title: string }>
    encrypted?: boolean
    siteBaseUrl?: string
  }): string {
    const navHtml = this.renderNavTree(data.navTree, 'index', '')

    let pageListHtml = '<div class="index-page"><h1>' + this.escapeHtml(data.siteTitle) + '</h1>'
    pageListHtml += '<ul class="page-list">'
    for (const page of data.pages) {
      pageListHtml += `<li><a href="${page.slug}.html">${this.escapeHtml(page.title)}</a></li>`
    }
    pageListHtml += '</ul></div>'

    return `<!DOCTYPE html>
<html data-theme="light" prefix="og: http://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escapeHtml(data.siteTitle)}</title>
  <meta property="og:title" content="${this.escapeHtml(data.siteTitle)}">
  <meta property="og:description" content="${this.escapeHtml(data.siteTitle)}">
  <meta property="og:site_name" content="${this.escapeHtml(data.siteTitle)}">
  <meta property="og:type" content="website">${data.siteBaseUrl ? `
  <meta property="og:url" content="${this.escapeHtml(data.siteBaseUrl)}/">` : ''}
  <script>(function(){var t=localStorage.getItem('site-theme');if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t)document.documentElement.setAttribute('data-theme',t)})()</script>
  <style>${data.css}</style>
  <link rel="stylesheet" href="assets/site.css">
  <style>
    body.site-page, body.site-page *, body.site-page *::before, body.site-page *::after {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    body.site-page .nav-folder-title { user-select: none !important; -webkit-user-select: none !important; }
    body.site-page { overflow: auto !important; contain: none !important; }
    body.site-page ::selection { background-color: Highlight !important; color: HighlightText !important; }
    body.site-page ::-moz-selection { background-color: Highlight !important; color: HighlightText !important; }
  </style>
</head>
<body class="site-page">
  <div class="site-layout">
    <button class="sidebar-toggle" aria-label="Toggle navigation">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>

    <nav class="site-sidebar" id="site-sidebar">
      <div class="sidebar-header">
        <a href="index.html" class="site-title">${this.escapeHtml(data.siteTitle)}</a>
        <button class="search-trigger" id="search-trigger" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span class="search-shortcut">Ctrl+K</span>
        </button>
      </div>
      <div class="nav-tree" id="nav-tree">${navHtml}</div>
    </nav>

    <main class="site-content">
      <article class="page-content markdown-preview-view">
        ${pageListHtml}
      </article>
    </main>
  </div>

  <div class="search-overlay" id="search-overlay" style="display:none">
    <div class="search-modal">
      <input type="text" class="search-input" id="search-input" placeholder="Search pages..." autocomplete="off">
      <div class="search-results" id="search-results"></div>
    </div>
  </div>

  <div class="theme-toggle" id="theme-toggle" title="Toggle dark/light mode">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
  </div>

  <script>window.__PATH_TO_ROOT__ = "";${data.encrypted ? ' window.__ENCRYPTED__ = true;' : ''}</script>
  <script src="assets/search-index.js"></script>${data.encrypted ? `
  <script src="assets/decrypt.js"></script>` : ''}
  <script src="assets/router.js"></script>
  <script src="assets/sidebar.js"></script>
  <script src="assets/search.js"></script>
  <script src="assets/theme-toggle.js"></script>
</body>
</html>`
  }

  /** Pre-render the nav tree as static HTML */
  private renderNavTree (node: NavItem, currentSlug: string, pathToRoot: string, depth = 0): string {
    if (node.slug !== null) {
      // File node
      const activeClass = node.slug === currentSlug ? ' is-active' : ''
      return `<div class="nav-file"><a href="${pathToRoot}${node.slug}.html" class="${activeClass}">${this.escapeHtml(node.name)}</a></div>`
    }

    if (depth > 0) {
      // Folder node
      let childrenHtml = ''
      for (const child of node.children) {
        childrenHtml += this.renderNavTree(child, currentSlug, pathToRoot, depth + 1)
      }
      return `<div class="nav-folder"><div class="nav-folder-title" data-folder="${this.escapeHtml(node.name)}"><span class="collapse-icon">&#9660;</span>${this.escapeHtml(node.name)}</div><div class="nav-folder-children">${childrenHtml}</div></div>`
    }

    // Root: just render children
    let html = ''
    for (const child of node.children) {
      html += this.renderNavTree(child, currentSlug, pathToRoot, depth + 1)
    }
    return html
  }

  renderBacklinks (backlinks: SiteBacklink[], currentSlug: string, pathToRoot: string): string {
    if (!backlinks || backlinks.length === 0) return ''

    let html = '<div class="backlinks-panel"><h3>Backlinks</h3><ul>'
    for (const bl of backlinks) {
      if (bl.slug) {
        html += `<li><a class="backlink-item" href="${pathToRoot}${bl.slug}.html">${this.escapeHtml(bl.displayText)}</a></li>`
      } else {
        html += `<li><span class="backlink-item">${this.escapeHtml(bl.displayText)}</span></li>`
      }
    }
    html += '</ul></div>'
    return html
  }

  renderTags (tags: string[], pathToRoot: string): string {
    if (!tags || tags.length === 0) return ''

    let html = '<div class="page-tags">'
    for (const tag of tags) {
      html += `<a href="${pathToRoot}tags/${encodeURIComponent(tag)}.html" class="page-tag">#${this.escapeHtml(tag)}</a>`
    }
    html += '</div>'
    return html
  }

  private escapeHtml (text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
