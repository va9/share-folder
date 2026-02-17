import { App, CachedMetadata, TFile, TFolder, normalizePath } from 'obsidian'
import SharePlugin from '../main'
import { LinkAnalyzer } from './link-analyzer'
import { TagAnalyzer } from './tag-analyzer'
import { LinkRewriter } from './link-rewriter'
import { NavBuilder, NavItem } from './nav-builder'
import { SearchBuilder } from './search-builder'
import { SiteTemplate, SiteBacklink } from './site-template'
import { PublishProgressModal } from './ui/publish-progress'
import { ViewModes } from '../types'
import { sha1, encryptString } from '../crypto'
import { minify } from 'csso'

import imageCompression from 'browser-image-compression'

// Node.js fs — available in Obsidian desktop
import * as fs from 'fs'
import * as path from 'path'

function arrayBufferToBase64 (buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

const COMPRESSIBLE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/jpeg'
}

async function compressImage (data: ArrayBuffer, filetype: string): Promise<{ data: ArrayBuffer; filetype: string }> {
  const mimeType = COMPRESSIBLE_TYPES[filetype.toLowerCase()]
  if (!mimeType || data.byteLength <= 100 * 1024) {
    return { data, filetype }
  }

  const options = {
    maxSizeMB: 0.7,
    maxWidthOrHeight: 1400,
    preserveExif: false,
    initialQuality: 0.6,
    fileType: mimeType
  }

  const file = new File([data], 'image.' + filetype, { type: mimeType })
  const compressed = await imageCompression(file, options)
  let result = await compressed.arrayBuffer()

  // If still >200KB, try JPEG and keep whichever is smaller
  if (result.byteLength > 200 * 1024 && mimeType !== 'image/jpeg') {
    const jpegFile = new File([data], 'image.jpg', { type: mimeType })
    const jpegBlob = await imageCompression(jpegFile, { ...options, fileType: 'image/jpeg' })
    const jpegResult = await jpegBlob.arrayBuffer()
    if (jpegResult.byteLength < result.byteLength) {
      return { data: jpegResult, filetype: 'jpg' }
    }
  }

  // Keep original if compression made it bigger
  if (result.byteLength >= data.byteLength) {
    return { data, filetype }
  }

  return { data: result, filetype }
}

export interface SiteFile {
  path: string       // relative path within site (e.g., "subfolder/note.html")
  content: string    // file content (HTML, CSS, JS, JSON, or base64 for binary)
  filetype: string   // file extension
  base64?: boolean   // true if content is base64-encoded binary
}

export interface RenderedPage {
  file: TFile
  slug: string       // relative path without .md extension
  title: string
  html: string       // rendered body HTML (before template wrapping)
  tags: string[]
}

export class SitePublisher {
  private plugin: SharePlugin
  private app: App
  private folder: TFolder
  private progress: PublishProgressModal

  constructor (plugin: SharePlugin, folder: TFolder) {
    this.plugin = plugin
    this.app = plugin.app
    this.folder = folder
  }

  /** Build the full site and return all generated files */
  async buildSite (encrypt?: boolean): Promise<SiteFile[]> {
    // 1. Collect all .md files
    this.progress.setStage('Collecting files...')
    const files = this.collectFiles(this.folder)
    if (files.length === 0) {
      throw new Error('No markdown files found in folder.')
    }
    this.progress.setDetail(`Found ${files.length} markdown files`)

    // 2. Filter by frontmatter (skip publish: false)
    const publishableFiles = files.filter(f => {
      const meta = this.app.metadataCache.getFileCache(f)
      return meta?.frontmatter?.publish !== false
    })
    this.progress.setDetail(`${publishableFiles.length} files to publish`)

    // 3. Collect embedded assets (images, etc.)
    this.progress.setStage('Collecting assets...')
    const { assetFiles, assetPathMap } = this.collectAssets(publishableFiles)
    this.progress.setDetail(`Found ${assetFiles.size} assets`)

    // 4. Analyze links and tags
    this.progress.setStage('Analyzing links and tags...')
    const linkAnalyzer = new LinkAnalyzer(this.app, this.folder.path, publishableFiles)
    linkAnalyzer.analyze()

    const tagAnalyzer = new TagAnalyzer(this.app, publishableFiles)
    tagAnalyzer.analyze()

    // 5. Build path-to-slug mapping
    const pathToSlug = new Map<string, string>()
    for (const file of publishableFiles) {
      const slug = this.fileToSlug(file)
      pathToSlug.set(file.path, slug)
    }

    // 6. Render all notes
    this.progress.setStage('Rendering notes...')
    const renderedPages: RenderedPage[] = []

    for (let i = 0; i < publishableFiles.length; i++) {
      const file = publishableFiles[i]
      this.progress.setProgress(i + 1, publishableFiles.length)
      this.progress.setDetail(file.basename)

      const html = await this.renderNote(file)
      const meta = this.app.metadataCache.getFileCache(file)
      const title = this.getTitle(file, meta)
      const tags = this.getTags(meta)

      renderedPages.push({
        file,
        slug: pathToSlug.get(file.path)!,
        title,
        html,
        tags
      })
    }

    // 7. Extract and process CSS (once for the whole site)
    this.progress.setStage('Processing CSS...')
    const css = this.extractCss()
    const minifiedCss = minify(css).css

    // 7b. Compress images (before HTML rewriting so paths are finalized)
    this.progress.setStage('Compressing images...')
    const processedAssets: Array<{ sitePath: string; base64: string; filetype: string }> = []
    let assetIdx = 0
    for (const [vaultPath, assetFile] of assetFiles) {
      assetIdx++
      let sitePath = assetPathMap.get(vaultPath)
      if (!sitePath) continue
      this.progress.setProgress(assetIdx, assetFiles.size)
      this.progress.setDetail(assetFile.name)

      let binary = await this.app.vault.readBinary(assetFile)
      let ext = assetFile.extension

      const compressed = await compressImage(binary, ext)
      binary = compressed.data
      if (compressed.filetype !== ext) {
        ext = compressed.filetype
        sitePath = sitePath.replace(/\.[^.]+$/, '.' + ext)
        assetPathMap.set(vaultPath, sitePath)
      }

      processedAssets.push({
        sitePath,
        base64: arrayBufferToBase64(binary),
        filetype: ext
      })
    }

    // 8. Rewrite links, rewrite image paths, and clean HTML
    this.progress.setStage('Rewriting links...')
    const isEncrypted = encrypt ?? false
    const linkRewriter = new LinkRewriter(pathToSlug)

    // For encrypted sites, build a data URI map from processed assets
    const dataUriMap = new Map<string, string>()
    if (isEncrypted) {
      for (const asset of processedAssets) {
        const mimeType = COMPRESSIBLE_TYPES[asset.filetype.toLowerCase()] || 'application/octet-stream'
        dataUriMap.set(asset.sitePath, `data:${mimeType};base64,${asset.base64}`)
      }
    }

    for (const page of renderedPages) {
      page.html = linkRewriter.rewrite(page.html, page.slug)
      if (isEncrypted) {
        page.html = this.embedImagesAsDataUri(page.html, assetPathMap, dataUriMap, page.slug)
      } else {
        page.html = this.rewriteImagePaths(page.html, assetPathMap, page.slug)
      }
      page.html = this.cleanHtml(page.html)
    }

    // 9. Build navigation tree
    this.progress.setStage('Building navigation...')
    const navBuilder = new NavBuilder()
    const navTree = navBuilder.buildTree(
      renderedPages.map(p => ({ slug: p.slug, title: p.title, path: p.file.path })),
      this.folder.path
    )

    // 9b. Build search index
    this.progress.setStage('Building search index...')
    const searchBuilder = new SearchBuilder()
    for (const page of renderedPages) {
      searchBuilder.addPage(page.slug, page.title, page.html, page.tags)
    }

    // Get or create encryption key for this site
    let encryptionKey: string | undefined
    if (isEncrypted) {
      if (!this.plugin.settings.siteEncryptionKeys) {
        this.plugin.settings.siteEncryptionKeys = {}
      }
      encryptionKey = this.plugin.settings.siteEncryptionKeys[this.folder.path]
      if (!encryptionKey) {
        // Generate a new key by encrypting a dummy string (we just need the key)
        const { key } = await encryptString('init')
        encryptionKey = key
        this.plugin.settings.siteEncryptionKeys[this.folder.path] = key
        await this.plugin.saveSettings()
      }
    }

    // Build search index — either plaintext or encrypted
    let searchIndexJs: string
    if (isEncrypted && encryptionKey) {
      const rawIndex = searchBuilder.buildRawIndex()
      const searchJson = JSON.stringify(rawIndex)
      const encrypted = await encryptString(searchJson, encryptionKey)
      searchIndexJs = 'window.__ENCRYPTED_SEARCH__ = ' + JSON.stringify(encrypted.ciphertext) + ';'
    } else {
      searchIndexJs = searchBuilder.buildIndex()
    }

    // 10. Wrap pages in site template
    this.progress.setStage('Generating site pages...')
    const siteTemplate = new SiteTemplate()
    const siteFiles: SiteFile[] = []

    for (const page of renderedPages) {
      const depth = page.slug.split('/').length - 1
      const pathToRoot = depth > 0 ? '../'.repeat(depth) : ''
      const backlinks = linkAnalyzer.backlinks.get(page.file.path) || []

      // Convert backlinks to include slugs for linking
      const backlinksWithSlugs: SiteBacklink[] = backlinks.map(bl => ({
        ...bl,
        slug: pathToSlug.get(bl.sourcePath)
      }))

      // Build the inner <main> content (article + tags + backlinks)
      let mainInnerHtml = `<article class="page-content markdown-preview-view">\n        ${page.html}\n      </article>`
      if (page.tags.length > 0) {
        mainInnerHtml += '\n      ' + siteTemplate.renderTags(page.tags, pathToRoot)
      }
      if (backlinksWithSlugs.length > 0) {
        mainInnerHtml += '\n      ' + siteTemplate.renderBacklinks(backlinksWithSlugs, page.slug, pathToRoot)
      }

      // If encrypted, encrypt the main content and replace with encrypted blob + decrypt prompt
      let templateContent: string
      if (isEncrypted && encryptionKey) {
        const encrypted = await encryptString(mainInnerHtml, encryptionKey)
        const encryptedJson = JSON.stringify(encrypted.ciphertext)
        templateContent = `<script type="application/json" id="encrypted-content">${encryptedJson}</script>
      <div class="decrypt-prompt">
        <p>This content is encrypted.</p>
        <input id="key-input" type="text" placeholder="Paste decryption key...">
        <button id="decrypt-btn">Decrypt</button>
      </div>`
      } else {
        templateContent = mainInnerHtml
      }

      const pageHtml = siteTemplate.render({
        siteTitle: this.getSiteTitle(),
        pageTitle: page.title,
        content: templateContent,
        css: minifiedCss,
        currentSlug: page.slug,
        navTree,
        backlinks: [], // backlinks are already in the content (encrypted or not)
        pathToRoot,
        tags: [],      // tags are already in the content (encrypted or not)
        encrypted: isEncrypted
      })

      siteFiles.push({
        path: page.slug + '.html',
        content: pageHtml,
        filetype: 'html'
      })
    }

    // 11. Generate index page
    let indexContent: string
    if (isEncrypted && encryptionKey) {
      let pageListHtml = '<div class="index-page"><h1>' + this.escapeHtmlStatic(this.getSiteTitle()) + '</h1>'
      pageListHtml += '<ul class="page-list">'
      for (const page of renderedPages) {
        pageListHtml += `<li><a href="${page.slug}.html">${this.escapeHtmlStatic(page.title)}</a></li>`
      }
      pageListHtml += '</ul></div>'
      const encrypted = await encryptString(pageListHtml, encryptionKey)
      indexContent = `<script type="application/json" id="encrypted-content">${JSON.stringify(encrypted.ciphertext)}</script>
      <div class="decrypt-prompt">
        <p>This content is encrypted.</p>
        <input id="key-input" type="text" placeholder="Paste decryption key...">
        <button id="decrypt-btn">Decrypt</button>
      </div>`
    } else {
      indexContent = ''
    }

    const indexHtml = isEncrypted
      ? siteTemplate.render({
          siteTitle: this.getSiteTitle(),
          pageTitle: this.getSiteTitle(),
          content: indexContent,
          css: minifiedCss,
          currentSlug: 'index',
          navTree,
          backlinks: [],
          pathToRoot: '',
          tags: [],
          encrypted: true
        })
      : siteTemplate.renderIndex({
          siteTitle: this.getSiteTitle(),
          css: minifiedCss,
          navTree,
          pages: renderedPages.map(p => ({ slug: p.slug, title: p.title }))
        })
    siteFiles.push({ path: 'index.html', content: indexHtml, filetype: 'html' })

    // 12. Generate tag pages
    this.progress.setStage('Generating tag pages...')
    const pathToTitle = new Map<string, string>()
    for (const page of renderedPages) {
      pathToTitle.set(page.file.path, page.title)
    }

    for (const [tag] of tagAnalyzer.tags) {
      const tagPageHtml = tagAnalyzer.generateTagPageHtml(
        tag,
        '../',
        (p) => pathToSlug.get(p) || '',
        (p) => pathToTitle.get(p) || ''
      )

      let tagContent: string
      if (isEncrypted && encryptionKey) {
        const encrypted = await encryptString(tagPageHtml, encryptionKey)
        tagContent = `<script type="application/json" id="encrypted-content">${JSON.stringify(encrypted.ciphertext)}</script>
      <div class="decrypt-prompt">
        <p>This content is encrypted.</p>
        <input id="key-input" type="text" placeholder="Paste decryption key...">
        <button id="decrypt-btn">Decrypt</button>
      </div>`
      } else {
        tagContent = tagPageHtml
      }

      const tagFullHtml = siteTemplate.render({
        siteTitle: this.getSiteTitle(),
        pageTitle: `#${tag}`,
        content: tagContent,
        css: minifiedCss,
        currentSlug: `tags/${tag}`,
        navTree,
        backlinks: [],
        pathToRoot: '../',
        tags: [],
        encrypted: isEncrypted
      })
      siteFiles.push({
        path: `tags/${tag}.html`,
        content: tagFullHtml,
        filetype: 'html'
      })
    }

    // Tag index page
    if (tagAnalyzer.tags.size > 0) {
      const tagIndexContent = tagAnalyzer.generateTagIndexHtml('../')

      let finalTagIndexContent: string
      if (isEncrypted && encryptionKey) {
        const encrypted = await encryptString(tagIndexContent, encryptionKey)
        finalTagIndexContent = `<script type="application/json" id="encrypted-content">${JSON.stringify(encrypted.ciphertext)}</script>
      <div class="decrypt-prompt">
        <p>This content is encrypted.</p>
        <input id="key-input" type="text" placeholder="Paste decryption key...">
        <button id="decrypt-btn">Decrypt</button>
      </div>`
      } else {
        finalTagIndexContent = tagIndexContent
      }

      const tagIndexHtml = siteTemplate.render({
        siteTitle: this.getSiteTitle(),
        pageTitle: 'Tags',
        content: finalTagIndexContent,
        css: minifiedCss,
        currentSlug: 'tags/index',
        navTree,
        backlinks: [],
        pathToRoot: '../',
        tags: [],
        encrypted: isEncrypted
      })
      siteFiles.push({ path: 'tags/index.html', content: tagIndexHtml, filetype: 'html' })
    }

    // 13. Add processed binary assets (skip for encrypted — images are embedded as data URIs)
    if (!isEncrypted) {
      for (const asset of processedAssets) {
        siteFiles.push({
          path: asset.sitePath,
          content: asset.base64,
          filetype: asset.filetype,
          base64: true
        })
      }
    }

    // 14. Add static assets
    siteFiles.push({ path: 'assets/search-index.js', content: searchIndexJs, filetype: 'js' })
    siteFiles.push({ path: 'assets/site.css', content: SITE_CSS, filetype: 'css' })
    siteFiles.push({ path: 'assets/sidebar.js', content: SIDEBAR_JS, filetype: 'js' })
    siteFiles.push({ path: 'assets/search.js', content: SEARCH_JS, filetype: 'js' })
    siteFiles.push({ path: 'assets/theme-toggle.js', content: THEME_TOGGLE_JS, filetype: 'js' })
    siteFiles.push({ path: 'assets/router.js', content: ROUTER_JS, filetype: 'js' })
    if (isEncrypted) {
      siteFiles.push({ path: 'assets/decrypt.js', content: DECRYPT_JS, filetype: 'js' })
    }

    return siteFiles
  }

  /** Build and upload site to the server */
  async publish () {
    // Auto-connect if no API key
    if (!this.plugin.settings.apiKey) {
      const connected = await this.waitForApiKey()
      if (!connected) return
    }

    this.progress = new PublishProgressModal(this.app)
    this.progress.open()

    try {
      const siteFiles = await this.buildSite(this.plugin.settings.siteEncrypted)
      await this.uploadSite(siteFiles)
    } catch (e) {
      console.error('Site publishing error:', e)
      this.progress.setError('Publishing failed', e)
    }
  }

  private async uploadSite (siteFiles: SiteFile[], isRetry = false): Promise<void> {
    this.progress.setStage('Uploading site...')
    this.progress.setProgress(0, siteFiles.length)

    const prefix = this.plugin.settings.uid.slice(0, 8)
    const folderSlug = this.resolveSlug()
    const slug = `${prefix}/${folderSlug}`

    // Expiry: map display labels to duration codes
    const expiryMap: Record<string, string> = {
      '1 day': '1d', '7 days': '7d', '30 days': '30d', '90 days': '90d'
    }
    const expiryDuration = expiryMap[this.plugin.settings.siteExpiry] || ''

    try {
      const result = await this.plugin.api.publishSite(
        slug,
        this.getSiteTitle(),
        siteFiles,
        {
          prefix,
          vanitySlug: this.plugin.settings.siteVanitySlug || undefined,
          encrypted: this.plugin.settings.siteEncrypted || false,
          expiryDuration
        },
        (current, total) => {
          this.progress.setProgress(current, total)
        }
      )

      if (result?.url) {
        let url = result.url
        // Append encryption key fragment if encrypted
        if (this.plugin.settings.siteEncrypted) {
          const key = this.plugin.settings.siteEncryptionKeys?.[this.folder.path]
          if (key) {
            url += '#' + key
          }
        }

        // Track the published site
        this.plugin.settings.publishedSites[this.folder.path] = {
          slug,
          url,
          title: this.getSiteTitle(),
          updatedAt: Date.now(),
          encrypted: this.plugin.settings.siteEncrypted || false
        }
        await this.plugin.saveSettings()
        this.progress.setResult(url)
      } else {
        this.progress.setError('Upload failed. Please check your connection and try again.')
      }
    } catch (e) {
      // If auth failed (462) and we haven't retried yet, re-connect and retry
      if (!isRetry && e.message === 'Known error') {
        this.progress.setStage('Reconnecting...')
        this.plugin.settings.apiKey = ''
        await this.plugin.saveSettings()
        const connected = await this.waitForApiKey()
        if (connected) {
          return this.uploadSite(siteFiles, true)
        }
      }
      throw e
    }
  }

  /** Opens the auth flow and waits for the API key callback */
  private waitForApiKey (): Promise<boolean> {
    return new Promise((resolve) => {
      // Open the get-key page in the browser
      window.open(this.plugin.settings.server + '/v1/account/get-key?id=' + this.plugin.settings.uid)

      // Poll for the API key to be set (the protocol handler sets it)
      let elapsed = 0
      const interval = setInterval(() => {
        elapsed += 500
        if (this.plugin.settings.apiKey) {
          clearInterval(interval)
          resolve(true)
        } else if (elapsed > 120000) {
          // 2 minute timeout
          clearInterval(interval)
          resolve(false)
        }
      }, 500)
    })
  }

  /** Build and write site to a local directory on disk */
  async publishToDisk (outputDir: string) {
    this.progress = new PublishProgressModal(this.app)
    this.progress.open()

    try {
      const siteFiles = await this.buildSite()

      // Write files to disk
      this.progress.setStage('Writing files to disk...')
      this.progress.setProgress(0, siteFiles.length)

      for (let i = 0; i < siteFiles.length; i++) {
        const file = siteFiles[i]
        const filePath = path.join(outputDir, file.path)
        const dir = path.dirname(filePath)

        // Ensure directory exists
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // Write the file
        if (file.base64) {
          const binary = atob(file.content)
          const bytes = new Uint8Array(binary.length)
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
          fs.writeFileSync(filePath, bytes)
        } else {
          fs.writeFileSync(filePath, file.content, 'utf-8')
        }
        this.progress.setProgress(i + 1, siteFiles.length)
        this.progress.setDetail(file.path)
      }

      this.progress.setResult('file://' + outputDir + '/index.html')
    } catch (e) {
      console.error('Site publishing error:', e)
      this.progress.setError('Publishing to disk failed', e)
    }
  }

  /** Collect all .md files in a folder recursively */
  private collectFiles (folder: TFolder): TFile[] {
    const files: TFile[] = []
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.push(child)
      } else if (child instanceof TFolder) {
        files.push(...this.collectFiles(child))
      }
    }
    return files
  }

  /**
   * Collect all assets (images, etc.) referenced by published notes.
   * Returns the asset files and a mapping from vault path → site-relative path.
   */
  private collectAssets (publishableFiles: TFile[]): {
    assetFiles: Map<string, TFile>
    assetPathMap: Map<string, string>
  } {
    const assetFiles = new Map<string, TFile>()
    const assetPathMap = new Map<string, string>()

    // 1. Collect non-md files directly in the published folder
    const folderAssets = this.collectFolderAssets(this.folder)
    for (const file of folderAssets) {
      assetFiles.set(file.path, file)
      // Keep relative path within site
      let relative = file.path
      if (relative.startsWith(this.folder.path + '/')) {
        relative = relative.slice(this.folder.path.length + 1)
      }
      assetPathMap.set(file.path, relative)
    }

    // 2. Collect files referenced as embeds that are outside the folder
    for (const file of publishableFiles) {
      const meta = this.app.metadataCache.getFileCache(file)
      if (!meta?.embeds) continue
      for (const embed of meta.embeds) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(embed.link, file.path)
        if (!resolved || !(resolved instanceof TFile)) continue
        if (resolved.extension === 'md') continue
        if (assetFiles.has(resolved.path)) continue

        assetFiles.set(resolved.path, resolved)
        // Assets from outside the folder go to assets/img/
        if (resolved.path.startsWith(this.folder.path + '/')) {
          let relative = resolved.path.slice(this.folder.path.length + 1)
          assetPathMap.set(resolved.path, relative)
        } else {
          assetPathMap.set(resolved.path, 'assets/img/' + resolved.name)
        }
      }
    }

    return { assetFiles, assetPathMap }
  }

  /** Collect all non-md files in a folder recursively */
  private collectFolderAssets (folder: TFolder): TFile[] {
    const files: TFile[] = []
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension !== 'md') {
        files.push(child)
      } else if (child instanceof TFolder) {
        files.push(...this.collectFolderAssets(child))
      }
    }
    return files
  }

  /** Rewrite image src attributes from Obsidian internal URLs to site-relative paths */
  private rewriteImagePaths (html: string, assetPathMap: Map<string, string>, currentSlug: string): string {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const depth = currentSlug.split('/').length - 1
    const pathToRoot = depth > 0 ? '../'.repeat(depth) : ''

    // Build a lookup by filename for fallback matching
    const byName = new Map<string, string>()
    for (const [vaultPath, sitePath] of assetPathMap) {
      const name = vaultPath.split('/').pop() || ''
      byName.set(name, sitePath)
    }

    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) continue

      let sitePath: string | undefined

      // Try matching via .internal-embed parent's src attribute
      const embedParent = img.closest('.internal-embed')
      if (embedParent) {
        const embedSrc = embedParent.getAttribute('src') || ''
        if (embedSrc) {
          // Try to resolve the embed link to a vault path
          const name = embedSrc.split('/').pop() || embedSrc
          sitePath = byName.get(name)
        }
      }

      // Fallback: extract filename from the img src
      if (!sitePath) {
        // Handle app://local/... or app://obsidian.md/... URLs
        let filename = src
        if (src.includes('/')) {
          filename = src.split('/').pop() || src
        }
        // URL decode the filename
        try { filename = decodeURIComponent(filename) } catch (e) {}
        sitePath = byName.get(filename)
      }

      if (sitePath) {
        img.setAttribute('src', pathToRoot + sitePath)
      }
    }

    return doc.body.innerHTML
  }

  /** Convert a vault file path to a site slug */
  private fileToSlug (file: TFile): string {
    let relative = file.path
    if (relative.startsWith(this.folder.path + '/')) {
      relative = relative.slice(this.folder.path.length + 1)
    }
    // Remove .md extension
    relative = relative.replace(/\.md$/, '')
    // Sanitize for URLs
    return relative
      .split('/')
      .map(part => part
        .replace(/\s+/g, '-')
        .replace(/[^\w\-./]/g, '')
        .toLowerCase()
      )
      .join('/')
  }

  /** Get the title of a note from frontmatter or filename */
  private getTitle (file: TFile, meta: CachedMetadata | null): string {
    if (meta?.frontmatter?.title) return meta.frontmatter.title
    return file.basename
  }

  /** Get tags from a note's metadata */
  private getTags (meta: CachedMetadata | null): string[] {
    const tags: string[] = []
    if (meta?.tags) {
      for (const t of meta.tags) {
        tags.push(t.tag.replace(/^#/, '').toLowerCase())
      }
    }
    if (meta?.frontmatter?.tags) {
      const fmTags = meta.frontmatter.tags
      if (Array.isArray(fmTags)) {
        for (const t of fmTags) {
          tags.push(String(t).replace(/^#/, '').toLowerCase())
        }
      }
    }
    return [...new Set(tags)]
  }

  /** Render a single note using Obsidian's preview mode */
  private async renderNote (file: TFile): Promise<string> {
    // Open the file in preview mode and extract HTML
    const leaf = this.app.workspace.getLeaf(false)
    await leaf.openFile(file)

    // Switch to preview mode
    const viewState = leaf.getViewState()
    if (viewState.state) {
      viewState.state.mode = 'preview'
    }
    await leaf.setViewState(viewState)

    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 800))

    // Scroll to top
    try {
      // @ts-ignore
      leaf.view.previewMode?.applyScroll(0)
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (e) {
      // Ignore scroll errors
    }

    // Extract HTML from preview sections
    try {
      const view = leaf.view as ViewModes
      const renderer = view.modes.preview.renderer
      const html = await this.waitForSections(renderer)
      return html
    } catch (e) {
      console.error(`Failed to render ${file.path}:`, e)
      // Fallback: read raw markdown
      const content = await this.app.vault.read(file)
      return `<div class="render-error"><p>${content}</p></div>`
    }
  }

  /** Wait for preview renderer sections to populate */
  private waitForSections (renderer: any): Promise<string> {
    return new Promise<string>(resolve => {
      let count = 0
      let parsing = 0
      const timer = setInterval(() => {
        try {
          const sections = renderer.sections
          count++
          if (renderer.parsing) parsing++
          if (count > parsing) {
            let rendered = 0
            if (sections.length > 12) {
              sections.slice(sections.length - 7, sections.length - 1).forEach((section: any) => {
                if (section.el.innerHTML) rendered++
              })
              if (rendered > 3) count = 100
            } else {
              count = 100
            }
          }
          if (count > 40) {
            clearInterval(timer)
            const html = sections.reduce((p: string, c: any) => p + c.el.outerHTML, '')
            resolve(html)
          }
        } catch (e) {
          clearInterval(timer)
          resolve('')
        }
      }, 100)
    })
  }

  /** Extract CSS from the current document (all stylesheets) */
  private extractCss (): string {
    // Obsidian app-chrome selectors that should not appear in published pages.
    // These carry user-select:none, overflow:clip, contain:strict, etc.
    const excludePrefixes = [
      '.app-container', '.workspace', '.titlebar', '.status-bar',
      '.side-dock', '.modal', '.menu', '.tooltip', '.prompt',
      '.suggestion', '.vertical-tab', '.horizontal-tab',
      '.nav-header', '.nav-action-button',
      '.is-grabbing', '.is-phone', '.is-tablet',
      '.pdf', '.canvas-wrapper', '.canvas-node',
      '.community-modal', '.setting-item',
      '.cm-editor', '.cm-', '.ͼ', // CodeMirror editor internals
    ]

    const rules: string[] = []
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        Array.from(sheet.cssRules).forEach(rule => {
          // Filter out @media print rules
          if ((rule as CSSMediaRule)?.media?.[0] === 'print') return

          // Filter out Obsidian app-chrome rules by selector
          const styleRule = rule as CSSStyleRule
          if (styleRule.selectorText) {
            const sel = styleRule.selectorText
            if (excludePrefixes.some(p => sel.startsWith(p))) return
          }

          rules.push(rule.cssText)
        })
      } catch (e) {
        // Cross-origin stylesheets will throw
      }
    })

    let css = rules.join('').replace(/\n/g, '')

    // Strip Obsidian app-level properties that break published pages.
    // share-note avoids this by having the server control the template;
    // since we generate static HTML, we strip them from the CSS instead.
    css = css.replace(/user-select:\s*none;?/g, '')
    css = css.replace(/-webkit-user-select:\s*none;?/g, '')
    css = css.replace(/contain:\s*strict;?/g, '')
    css = css.replace(/overflow:\s*clip;?/g, '')
    // Remove ::selection rules that hide selected text
    css = css.replace(/::selection\{[^}]*background[^}]*transparent[^}]*\}/g, '')
    css = css.replace(/::selection\{[^}]*background:\s*0\s*0[^}]*\}/g, '')

    return css
  }

  /** Remove Obsidian editor artifacts from rendered HTML */
  private cleanHtml (html: string): string {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Remove contenteditable attributes (Obsidian editor artifacts)
    for (const el of doc.querySelectorAll('[contenteditable]')) {
      el.removeAttribute('contenteditable')
    }

    // Remove Obsidian metadata/properties UI
    for (const el of doc.querySelectorAll('.metadata-container')) {
      el.remove()
    }

    // Remove Obsidian frontmatter code block (hidden but unnecessary)
    for (const el of doc.querySelectorAll('.mod-frontmatter')) {
      el.remove()
    }

    // Remove Obsidian's embedded backlinks footer (we render our own)
    for (const el of doc.querySelectorAll('.embedded-backlinks')) {
      el.remove()
    }

    // Remove collapse indicators (non-functional in static HTML)
    for (const el of doc.querySelectorAll('.collapse-indicator')) {
      el.remove()
    }

    return doc.body.innerHTML
  }

  /** For encrypted sites: embed images as data URIs directly in HTML */
  private embedImagesAsDataUri (
    html: string,
    assetPathMap: Map<string, string>,
    dataUriMap: Map<string, string>,
    currentSlug: string
  ): string {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const depth = currentSlug.split('/').length - 1
    const pathToRoot = depth > 0 ? '../'.repeat(depth) : ''

    // Build lookup by filename
    const byName = new Map<string, string>()
    for (const [vaultPath, sitePath] of assetPathMap) {
      const name = vaultPath.split('/').pop() || ''
      byName.set(name, sitePath)
    }

    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) continue

      let sitePath: string | undefined

      const embedParent = img.closest('.internal-embed')
      if (embedParent) {
        const embedSrc = embedParent.getAttribute('src') || ''
        if (embedSrc) {
          const name = embedSrc.split('/').pop() || embedSrc
          sitePath = byName.get(name)
        }
      }

      if (!sitePath) {
        let filename = src
        if (src.includes('/')) filename = src.split('/').pop() || src
        try { filename = decodeURIComponent(filename) } catch (e) {}
        sitePath = byName.get(filename)
      }

      if (sitePath) {
        const dataUri = dataUriMap.get(sitePath)
        if (dataUri) {
          img.setAttribute('src', dataUri)
        } else {
          img.setAttribute('src', pathToRoot + sitePath)
        }
      }
    }

    return doc.body.innerHTML
  }

  /** Static HTML escaping (outside of SiteTemplate) */
  private escapeHtmlStatic (text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Get site title from settings or fall back to folder name */
  private getSiteTitle (): string {
    return this.plugin.settings.siteTitle || this.folder.name
  }

  /** Generate a URL-safe slug from a folder name */
  private generateSlug (name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  /**
   * Resolve the folder slug, handling name collisions.
   * If this folder was already published, reuse its slug.
   * If another folder already claimed this name, disambiguate with parent or serial.
   */
  private resolveSlug (): string {
    const baseName = this.generateSlug(this.folder.name)
    const myPath = this.folder.path
    const published = this.plugin.settings.publishedSites

    // If this exact folder was published before, reuse its slug's folder portion
    const existing = published[myPath]
    if (existing) {
      const parts = existing.slug.split('/')
      return parts.length > 1 ? parts.slice(1).join('/') : parts[0]
    }

    // Check if another folder already uses this base name
    const conflict = Object.entries(published).find(
      ([path, site]) => path !== myPath && site.slug.endsWith('/' + baseName)
    )

    if (!conflict) return baseName

    // Disambiguate: try parent-folder/folder-name
    const parentName = this.folder.parent ? this.generateSlug(this.folder.parent.name) : ''
    if (parentName) {
      const withParent = `${parentName}-${baseName}`
      const parentConflict = Object.entries(published).find(
        ([path, site]) => path !== myPath && site.slug.endsWith('/' + withParent)
      )
      if (!parentConflict) return withParent
    }

    // Final fallback: append serial number
    for (let i = 2; i < 100; i++) {
      const candidate = `${baseName}-${i}`
      const serialConflict = Object.entries(published).find(
        ([path, site]) => path !== myPath && site.slug.endsWith('/' + candidate)
      )
      if (!serialConflict) return candidate
    }

    return baseName
  }
}

// =========================================================================
// Inline static assets (these get bundled into the plugin by esbuild)
// =========================================================================

const SITE_CSS = `/* Site layout */
:root {
  --sidebar-width: 280px;
  --content-max-width: 800px;
  --sidebar-bg: #f8f9fa;
  --sidebar-border: #e9ecef;
  --sidebar-text: #495057;
  --sidebar-hover: #e9ecef;
  --sidebar-active: #dee2e6;
  --content-bg: #ffffff;
  --text-color: #212529;
  --text-muted: #6c757d;
  --link-color: #4263eb;
  --border-color: #dee2e6;
  --search-bg: rgba(0,0,0,0.5);
  --search-modal-bg: #ffffff;
  --tag-bg: #e9ecef;
  --tag-color: #495057;
  --backlink-bg: #f8f9fa;
}

[data-theme="dark"] {
  --sidebar-bg: #1a1b1e;
  --sidebar-border: #2c2e33;
  --sidebar-text: #c1c2c5;
  --sidebar-hover: #25262b;
  --sidebar-active: #2c2e33;
  --content-bg: #141517;
  --text-color: #c1c2c5;
  --text-muted: #909296;
  --link-color: #748ffc;
  --border-color: #2c2e33;
  --search-bg: rgba(0,0,0,0.7);
  --search-modal-bg: #1a1b1e;
  --tag-bg: #25262b;
  --tag-color: #c1c2c5;
  --backlink-bg: #1a1b1e;
}

* { box-sizing: border-box; }

body.site-page {
  margin: 0;
  padding: 0;
  background: var(--content-bg);
  color: var(--text-color);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.site-layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
.site-sidebar {
  width: var(--sidebar-width);
  min-height: 100vh;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  overflow-y: auto;
  z-index: 100;
  transition: transform 0.3s ease;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--sidebar-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.site-title {
  font-weight: 700;
  font-size: 1.1em;
  color: var(--text-color);
  text-decoration: none;
}

.site-title:hover { opacity: 0.8; }

.search-trigger {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 0.75em;
}

.search-trigger:hover { background: var(--sidebar-hover); }
.search-shortcut { opacity: 0.6; }

.sidebar-toggle {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 200;
  background: var(--content-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  color: var(--text-color);
}

/* Nav tree */
.nav-tree { padding: 8px; }

.nav-folder { margin-bottom: 2px; }

.nav-folder-title {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  color: var(--sidebar-text);
  font-size: 0.9em;
  font-weight: 500;
  user-select: none;
}

.nav-folder-title:hover { background: var(--sidebar-hover); }

.nav-folder-title .collapse-icon {
  margin-right: 4px;
  transition: transform 0.2s;
  opacity: 0.5;
}

.nav-folder-title.is-collapsed .collapse-icon { transform: rotate(-90deg); }

.nav-folder-children {
  padding-left: 12px;
  overflow: hidden;
}

.nav-folder-children.is-collapsed { display: none; }

.nav-file {
  margin-bottom: 1px;
}

.nav-file a {
  display: block;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--sidebar-text);
  text-decoration: none;
  font-size: 0.85em;
}

.nav-file a:hover { background: var(--sidebar-hover); }
.nav-file a.is-active { background: var(--sidebar-active); font-weight: 600; }

/* Content */
.site-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 40px;
  max-width: calc(var(--content-max-width) + 80px);
}

.page-content { line-height: 1.7; }
.page-content a { color: var(--link-color); }

/* Tags */
.page-tags {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page-tag {
  background: var(--tag-bg);
  color: var(--tag-color);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8em;
  text-decoration: none;
}

.page-tag:hover { opacity: 0.8; }

/* Backlinks */
.backlinks-panel {
  margin-top: 32px;
  padding: 16px;
  background: var(--backlink-bg);
  border-radius: 8px;
}

.backlinks-panel h3 {
  font-size: 0.9em;
  color: var(--text-muted);
  margin: 0 0 8px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.backlinks-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.backlinks-panel li {
  padding: 4px 0;
}

.backlink-item { color: var(--link-color); cursor: default; }

/* Search */
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--search-bg);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.search-modal {
  background: var(--search-modal-bg);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  overflow: hidden;
}

.search-input {
  width: 100%;
  padding: 16px 20px;
  border: none;
  background: transparent;
  font-size: 1.1em;
  color: var(--text-color);
  outline: none;
}

.search-results {
  max-height: 400px;
  overflow-y: auto;
  border-top: 1px solid var(--border-color);
}

.search-result-item {
  padding: 12px 20px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
}

.search-result-item:hover { background: var(--sidebar-hover); }
.search-result-item .result-title { font-weight: 600; margin-bottom: 4px; }
.search-result-item .result-preview { font-size: 0.85em; color: var(--text-muted); }

/* Theme toggle */
.theme-toggle {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 150;
  background: var(--sidebar-bg);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-color);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.theme-toggle:hover { background: var(--sidebar-hover); }

/* Index page */
.index-page h1 { margin-top: 0; }
.page-list { list-style: none; padding: 0; }
.page-list li { padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.page-list a { color: var(--link-color); text-decoration: none; font-size: 1.05em; }
.page-list a:hover { text-decoration: underline; }

/* Tag pages */
.tag-index h1, .tag-page h1 { margin-top: 0; }
.tag-list { list-style: none; padding: 0; }
.tag-list li { padding: 6px 0; }
.tag-list a { color: var(--link-color); text-decoration: none; }
.tag-count { color: var(--text-muted); font-size: 0.85em; }
.tag-page-list { list-style: none; padding: 0; }
.tag-page-list li { padding: 6px 0; }
.tag-page-list a { color: var(--link-color); text-decoration: none; }

/* Decrypt prompt */
.decrypt-prompt {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.decrypt-prompt p {
  margin: 0 0 16px;
  font-size: 1.1em;
}

.decrypt-prompt input {
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--content-bg);
  color: var(--text-color);
  font-size: 0.95em;
  width: 300px;
  max-width: 80%;
  margin-right: 8px;
}

.decrypt-prompt button {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--sidebar-bg);
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.95em;
}

.decrypt-prompt button:hover {
  background: var(--sidebar-hover);
}

/* Responsive */
@media (max-width: 768px) {
  .sidebar-toggle { display: block; }

  .site-sidebar {
    transform: translateX(-100%);
  }

  .site-sidebar.is-open {
    transform: translateX(0);
    box-shadow: 4px 0 20px rgba(0,0,0,0.2);
  }

  .site-content {
    margin-left: 0;
    padding: 60px 20px 20px;
  }
}
`

const SIDEBAR_JS = `(function() {
  // Restore collapsed state from localStorage on pre-rendered nav
  var folders = document.querySelectorAll('.nav-folder-title');
  for (var i = 0; i < folders.length; i++) {
    (function(title) {
      var folderName = title.getAttribute('data-folder');
      var children = title.nextElementSibling;
      if (!folderName || !children) return;

      var storageKey = 'nav-collapsed-' + folderName;
      if (localStorage.getItem(storageKey) === '1') {
        title.classList.add('is-collapsed');
        children.classList.add('is-collapsed');
      }

      title.addEventListener('click', function() {
        var collapsed = children.classList.toggle('is-collapsed');
        title.classList.toggle('is-collapsed');
        localStorage.setItem(storageKey, collapsed ? '1' : '0');
      });
    })(folders[i]);
  }

  // Mobile sidebar toggle
  var toggle = document.querySelector('.sidebar-toggle');
  var sidebar = document.getElementById('site-sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', function() {
      sidebar.classList.toggle('is-open');
    });
    document.querySelector('.site-content').addEventListener('click', function() {
      sidebar.classList.remove('is-open');
    });
  }
})();
`

const SEARCH_JS = `(function() {
  var pathToRoot = window.__PATH_TO_ROOT__;
  var overlay = document.getElementById('search-overlay');
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var trigger = document.getElementById('search-trigger');
  var searchData = window.__SEARCH_DATA__ || null;

  // Listen for decrypted search data (from decrypt.js)
  window.addEventListener('searchDataReady', function(e) {
    searchData = e.detail;
  });

  function openSearch() {
    overlay.style.display = 'flex';
    input.value = '';
    results.innerHTML = '';
    input.focus();
  }

  function closeSearch() {
    overlay.style.display = 'none';
  }

  function doSearch(query) {
    if (!searchData || !query) { results.innerHTML = ''; return; }
    var q = query.toLowerCase();
    var matches = searchData.filter(function(item) {
      return item.t.toLowerCase().indexOf(q) !== -1 ||
             item.c.toLowerCase().indexOf(q) !== -1 ||
             (item.g && item.g.some(function(tag) { return tag.indexOf(q) !== -1; }));
    }).slice(0, 10);

    results.innerHTML = '';
    matches.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'search-result-item';
      var titleDiv = document.createElement('div');
      titleDiv.className = 'result-title';
      titleDiv.textContent = item.t;
      var previewDiv = document.createElement('div');
      previewDiv.className = 'result-preview';
      var idx = item.c.toLowerCase().indexOf(q);
      if (idx !== -1) {
        var start = Math.max(0, idx - 40);
        var end = Math.min(item.c.length, idx + q.length + 60);
        previewDiv.textContent = (start > 0 ? '...' : '') + item.c.slice(start, end) + (end < item.c.length ? '...' : '');
      } else {
        previewDiv.textContent = item.c.slice(0, 100) + (item.c.length > 100 ? '...' : '');
      }
      div.appendChild(titleDiv);
      div.appendChild(previewDiv);
      div.addEventListener('click', function() {
        var href = pathToRoot + item.s + '.html';
        if (window.__siteRouter) window.__siteRouter(href);
        else window.location.href = href;
      });
      results.appendChild(div);
    });
  }

  if (trigger) trigger.addEventListener('click', openSearch);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSearch();
  });

  input.addEventListener('input', function() { doSearch(input.value); });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.style.display === 'flex') closeSearch();
      else openSearch();
    }
    if (e.key === 'Escape') closeSearch();
  });
})();
`

const THEME_TOGGLE_JS = `(function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  btn.addEventListener('click', function() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('site-theme', next);
  });

  // Code block copy buttons
  function initCopyButtons() {
    document.querySelectorAll('button.copy-code-button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pre = btn.closest('pre');
        if (!pre) return;
        var code = pre.querySelector('code');
        if (!code) return;
        var text = code.textContent || '';
        navigator.clipboard.writeText(text).then(function() {
          btn.classList.add('is-copied');
          setTimeout(function() { btn.classList.remove('is-copied'); }, 1500);
        });
      });
    });
  }
  initCopyButtons();
  window.__initCopyButtons = initCopyButtons;
})();
`

const ROUTER_JS = `(function() {
  function navigate(href) {
    // Resolve relative URL to absolute
    var a = document.createElement('a');
    a.href = href;
    var url = a.href;

    // Only handle same-origin .html links
    if (a.origin !== location.origin) return false;
    if (!a.pathname.endsWith('.html')) return false;

    fetch(url).then(function(res) {
      if (!res.ok) { window.location.href = href; return; }
      return res.text();
    }).then(function(html) {
      if (!html) return;

      // Parse the fetched page
      var doc = new DOMParser().parseFromString(html, 'text/html');

      // Swap main content
      var newMain = doc.querySelector('.site-content');
      var oldMain = document.querySelector('.site-content');
      if (newMain && oldMain) {
        oldMain.innerHTML = newMain.innerHTML;

        // If the fetched page has encrypted content, decrypt it
        var encEl = oldMain.querySelector('#encrypted-content');
        if (encEl && window.__decryptMainContent) {
          var key = sessionStorage.getItem('site-decrypt-key') || location.hash.slice(1);
          if (key) {
            window.__decryptMainContent(key);
          }
        }
      }

      // Swap sidebar nav (links have depth-relative paths that must match current URL)
      var newNav = doc.querySelector('.nav-tree');
      var oldNav = document.querySelector('.nav-tree');
      if (newNav && oldNav) {
        oldNav.innerHTML = newNav.innerHTML;
      }

      // Update title
      document.title = doc.title;

      // Update URL — preserve #key hash for encrypted sites
      var hash = location.hash || '';
      history.pushState(null, '', url + hash);

      // Scroll to top
      window.scrollTo(0, 0);

      // Re-init copy buttons for new content
      if (window.__initCopyButtons) window.__initCopyButtons();

      // Close mobile sidebar
      var sidebar = document.getElementById('site-sidebar');
      if (sidebar) sidebar.classList.remove('is-open');
    }).catch(function() {
      window.location.href = href;
    });

    return true;
  }

  // Expose for search
  window.__siteRouter = navigate;

  // Intercept clicks on internal links
  document.addEventListener('click', function(e) {
    // Find closest anchor
    var link = e.target;
    while (link && link.tagName !== 'A') link = link.parentElement;
    if (!link) return;

    // Skip modified clicks (new tab, etc)
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (link.target === '_blank') return;

    var href = link.getAttribute('href');
    if (!href) return;

    // Skip external links, anchors, non-html
    if (href.startsWith('http://') || href.startsWith('https://')) {
      if (new URL(href).origin !== location.origin) return;
    }
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;

    if (navigate(href)) {
      e.preventDefault();
    }
  });

  // Handle back/forward
  window.addEventListener('popstate', function() {
    navigate(location.href);
  });
})();
`

const DECRYPT_JS = `(function() {
  // AES-256-GCM decryption using Web Crypto API
  // Replicates crypto.ts decryptString logic

  function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function indexToIv(index) {
    var iv = new Uint8Array(12);
    for (var i = 0; i < iv.length; i++) {
      iv[i] = index % 256;
      index = Math.floor(index / 256);
    }
    return iv;
  }

  async function importKey(base64Key) {
    var keyBuf = base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  async function decryptChunks(chunks, aesKey) {
    var parts = [];
    for (var i = 0; i < chunks.length; i++) {
      var cipherBuf = base64ToArrayBuffer(chunks[i]);
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: indexToIv(i) }, aesKey, cipherBuf);
      parts.push(new TextDecoder().decode(plain));
    }
    return parts.join('');
  }

  async function decryptMainContent(keyStr) {
    var el = document.getElementById('encrypted-content');
    if (!el) return false;

    try {
      var chunks = JSON.parse(el.textContent);
      var aesKey = await importKey(keyStr);
      var plaintext = await decryptChunks(chunks, aesKey);

      // Replace main content
      var main = document.querySelector('.site-content');
      if (main) main.innerHTML = plaintext;

      // Store key in sessionStorage for SPA navigation
      sessionStorage.setItem('site-decrypt-key', keyStr);

      // Re-init copy buttons
      if (window.__initCopyButtons) window.__initCopyButtons();

      return true;
    } catch (e) {
      console.error('Decryption failed:', e);
      return false;
    }
  }

  // Decrypt search index if available
  async function decryptSearchIndex(keyStr) {
    var encSearch = window.__ENCRYPTED_SEARCH__;
    if (!encSearch) return;

    try {
      var aesKey = await importKey(keyStr);
      var plaintext = await decryptChunks(encSearch, aesKey);
      var searchData = JSON.parse(plaintext);
      window.__SEARCH_DATA__ = searchData;
      window.dispatchEvent(new CustomEvent('searchDataReady', { detail: searchData }));
    } catch (e) {
      console.error('Search index decryption failed:', e);
    }
  }

  // Expose for router
  window.__decryptMainContent = async function(keyStr) {
    var ok = await decryptMainContent(keyStr);
    if (ok) await decryptSearchIndex(keyStr);
    return ok;
  };

  // Auto-decrypt on page load
  (async function() {
    var key = location.hash.slice(1) || sessionStorage.getItem('site-decrypt-key');
    if (key) {
      var ok = await decryptMainContent(key);
      if (ok) {
        await decryptSearchIndex(key);
        return;
      }
    }

    // No key or wrong key — show manual input
    var btn = document.getElementById('decrypt-btn');
    var input = document.getElementById('key-input');
    if (btn && input) {
      btn.addEventListener('click', async function() {
        var k = input.value.trim();
        if (!k) return;
        var ok = await decryptMainContent(k);
        if (ok) {
          await decryptSearchIndex(k);
        } else {
          input.style.borderColor = '#e03131';
          input.setAttribute('placeholder', 'Invalid key — try again');
          input.value = '';
        }
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btn.click();
      });
    }
  })();
})();
`
