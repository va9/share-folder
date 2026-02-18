/**
 * Rewrites internal links in rendered HTML to point to relative site URLs
 * instead of Obsidian vault paths.
 */
export class LinkRewriter {
  /** Map from vault file path -> site slug (relative path without extension) */
  private pathToSlug: Map<string, string>

  constructor (pathToSlug: Map<string, string>) {
    this.pathToSlug = pathToSlug
  }

  /**
   * Rewrite links in an HTML string.
   * @param html The rendered HTML content
   * @param currentSlug The slug of the page being processed (for relative path computation)
   * @returns Rewritten HTML
   */
  rewrite (html: string, currentSlug: string): string {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Rewrite internal links (a.internal-link)
    for (const el of doc.querySelectorAll<HTMLAnchorElement>('a.internal-link')) {
      this.rewriteInternalLink(el, currentSlug)
    }

    // Rewrite any remaining links with data-href pointing to internal notes
    for (const el of doc.querySelectorAll<HTMLAnchorElement>('a[data-href]')) {
      if (!el.classList.contains('internal-link')) {
        this.rewriteDataHrefLink(el, currentSlug)
      }
    }

    // Rewrite inline tag links: Obsidian renders #tag as <a href="#tagname" class="tag">
    for (const el of doc.querySelectorAll<HTMLAnchorElement>('a.tag')) {
      this.rewriteTagLink(el, currentSlug)
    }

    return doc.body.innerHTML
  }

  private rewriteInternalLink (el: HTMLAnchorElement, currentSlug: string) {
    const href = el.getAttribute('href') || ''
    const dataHref = el.getAttribute('data-href') || ''
    const linkTarget = dataHref || href

    if (!linkTarget) {
      // No target, replace with plain text
      el.replaceWith(el.textContent || '')
      return
    }

    // Check for anchor-only links (same page headings)
    if (linkTarget.startsWith('#')) {
      const headingId = this.slugifyHeading(linkTarget.slice(1))
      el.setAttribute('href', '#' + headingId)
      el.removeAttribute('data-href')
      el.removeAttribute('target')
      return
    }

    // Split into path and heading parts
    const [pathPart, ...headingParts] = linkTarget.split('#')
    const heading = headingParts.length > 0 ? headingParts.join('#') : null

    // Try to find the target in our published files
    const targetSlug = this.findTargetSlug(pathPart)

    if (targetSlug) {
      // Build relative URL from current page to target
      const relativeUrl = this.buildRelativeUrl(currentSlug, targetSlug)
      let finalUrl = relativeUrl + '.html'
      if (heading) {
        finalUrl += '#' + this.slugifyHeading(heading)
      }
      el.setAttribute('href', finalUrl)
      el.removeAttribute('data-href')
      el.removeAttribute('target')
      el.classList.remove('is-unresolved')
    } else {
      // Target not in published site — remove link, keep text
      el.replaceWith(el.textContent || '')
    }
  }

  private rewriteDataHrefLink (el: HTMLAnchorElement, currentSlug: string) {
    const dataHref = el.getAttribute('data-href') || ''
    if (!dataHref) return

    const [pathPart] = dataHref.split('#')
    const targetSlug = this.findTargetSlug(pathPart)

    if (targetSlug) {
      const relativeUrl = this.buildRelativeUrl(currentSlug, targetSlug)
      el.setAttribute('href', relativeUrl + '.html')
      el.removeAttribute('data-href')
      el.removeAttribute('target')
    }
  }

  private rewriteTagLink (el: HTMLAnchorElement, currentSlug: string) {
    const href = el.getAttribute('href') || ''
    // Obsidian renders inline tags as <a href="#tagname" class="tag">#tagname</a>
    if (href.startsWith('#')) {
      const tagName = href.slice(1).toLowerCase()
      if (tagName) {
        const depth = currentSlug.split('/').length - 1
        const pathToRoot = depth > 0 ? '../'.repeat(depth) : ''
        el.setAttribute('href', pathToRoot + 'tags/' + encodeURIComponent(tagName) + '.html')
        el.removeAttribute('target')
        el.removeAttribute('rel')
      }
    }
  }

  private findTargetSlug (linkPath: string): string | null {
    // Try exact match first
    for (const [filePath, slug] of this.pathToSlug.entries()) {
      // Match by filename (without extension)
      const basename = filePath.replace(/\.md$/, '')
      if (basename === linkPath || filePath === linkPath) {
        return slug
      }
      // Match by basename only (for [[NoteName]] style links)
      const fileBasename = basename.split('/').pop()
      if (fileBasename === linkPath) {
        return slug
      }
    }
    // Try with .md extension
    for (const [filePath, slug] of this.pathToSlug.entries()) {
      if (filePath === linkPath + '.md') {
        return slug
      }
    }
    return null
  }

  /**
   * Build a relative URL from one slug to another.
   * E.g., from "subfolder/page-a" to "other/page-b" -> "../other/page-b"
   */
  private buildRelativeUrl (fromSlug: string, toSlug: string): string {
    const fromParts = fromSlug.split('/')
    const toParts = toSlug.split('/')

    // Remove the filename part from "from"
    fromParts.pop()

    // Find common prefix
    let commonLen = 0
    while (commonLen < fromParts.length && commonLen < toParts.length - 1 && fromParts[commonLen] === toParts[commonLen]) {
      commonLen++
    }

    // Go up from current location
    const ups = fromParts.length - commonLen
    const upParts = Array(ups).fill('..')

    // Go down to target
    const downParts = toParts.slice(commonLen)

    const parts = [...upParts, ...downParts]
    return parts.length > 0 ? parts.join('/') : toParts[toParts.length - 1]
  }

  /** Convert a heading text to a URL-safe anchor ID */
  private slugifyHeading (heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }
}
