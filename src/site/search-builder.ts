export interface SearchEntry {
  slug: string
  title: string
  content: string  // plain text (HTML stripped)
  tags: string[]
}

export class SearchBuilder {
  private entries: SearchEntry[] = []

  addPage (slug: string, title: string, html: string, tags: string[]) {
    const content = this.stripHtml(html)
    this.entries.push({ slug, title, content, tags })
  }

  /** Build the search index as a JS script that sets window.__SEARCH_DATA__ */
  buildIndex (): string {
    const index = this.buildRawIndex()
    return 'window.__SEARCH_DATA__ = ' + JSON.stringify(index) + ';'
  }

  /** Build the raw search index array (for encryption or direct use) */
  buildRawIndex (): Array<{ s: string; t: string; c: string; g: string[] }> {
    return this.entries.map(e => ({
      s: e.slug,
      t: e.title,
      c: this.truncateContent(e.content, 5000),
      g: e.tags
    }))
  }

  private stripHtml (html: string): string {
    // Remove HTML tags
    let text = html.replace(/<[^>]+>/g, ' ')
    // Decode HTML entities
    text = text.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim()
    return text
  }

  private truncateContent (text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen)
  }
}
