import { App, CachedMetadata, TFile } from 'obsidian'

export class TagAnalyzer {
  private app: App
  private files: TFile[]

  /** tag -> list of file paths that have this tag */
  tags: Map<string, string[]> = new Map()

  constructor (app: App, files: TFile[]) {
    this.app = app
    this.files = files
  }

  analyze () {
    for (const file of this.files) {
      const meta: CachedMetadata | null = this.app.metadataCache.getFileCache(file)
      const fileTags = new Set<string>()

      // Tags from content (#tag)
      if (meta?.tags) {
        for (const tagRef of meta.tags) {
          fileTags.add(this.normalizeTag(tagRef.tag))
        }
      }

      // Tags from frontmatter
      if (meta?.frontmatter?.tags) {
        const fmTags = meta.frontmatter.tags
        if (Array.isArray(fmTags)) {
          for (const t of fmTags) {
            fileTags.add(this.normalizeTag(String(t)))
          }
        } else if (typeof fmTags === 'string') {
          fileTags.add(this.normalizeTag(fmTags))
        }
      }

      for (const tag of fileTags) {
        if (!this.tags.has(tag)) {
          this.tags.set(tag, [])
        }
        this.tags.get(tag)!.push(file.path)
      }
    }
  }

  private normalizeTag (tag: string): string {
    // Remove leading # if present, lowercase
    return tag.replace(/^#/, '').toLowerCase()
  }

  /** Generate HTML for a tag index page */
  generateTagIndexHtml (pathToRoot: string): string {
    const sortedTags = Array.from(this.tags.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))

    let html = '<div class="tag-index"><h1>Tags</h1><ul class="tag-list">'
    for (const [tag, files] of sortedTags) {
      html += `<li><a href="${pathToRoot}tags/${encodeURIComponent(tag)}.html">#${this.escapeHtml(tag)}</a> <span class="tag-count">(${files.length})</span></li>`
    }
    html += '</ul></div>'
    return html
  }

  /** Generate HTML for a single tag page */
  generateTagPageHtml (tag: string, pathToRoot: string, filePathToSlug: (path: string) => string, filePathToTitle: (path: string) => string): string {
    const files = this.tags.get(tag) || []
    let html = `<div class="tag-page"><h1>Pages tagged #${this.escapeHtml(tag)}</h1><ul class="tag-page-list">`
    for (const filePath of files) {
      const slug = filePathToSlug(filePath)
      const title = filePathToTitle(filePath)
      html += `<li><a href="${pathToRoot}${slug}.html">${this.escapeHtml(title)}</a></li>`
    }
    html += '</ul></div>'
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
