import { App, CachedMetadata, TFile } from 'obsidian'

export interface LinkInfo {
  sourcePath: string
  targetPath: string
  displayText: string
  heading?: string
}

export interface BacklinkInfo {
  sourcePath: string
  displayText: string
}

export class LinkAnalyzer {
  private app: App
  private folderPath: string
  private files: TFile[]

  /** sourcePath -> list of links going out */
  forwardLinks: Map<string, LinkInfo[]> = new Map()
  /** targetPath -> list of incoming links */
  backlinks: Map<string, BacklinkInfo[]> = new Map()

  constructor (app: App, folderPath: string, files: TFile[]) {
    this.app = app
    this.folderPath = folderPath
    this.files = files
  }

  analyze () {
    const filePathSet = new Set(this.files.map(f => f.path))

    for (const file of this.files) {
      const meta: CachedMetadata | null = this.app.metadataCache.getFileCache(file)
      const links: LinkInfo[] = []

      // Process wiki-links from metadataCache
      if (meta?.links) {
        for (const link of meta.links) {
          const resolved = this.resolveLink(link.link, file)
          if (resolved && filePathSet.has(resolved.path)) {
            const heading = this.extractHeading(link.link)
            links.push({
              sourcePath: file.path,
              targetPath: resolved.path,
              displayText: link.displayText || resolved.basename,
              heading
            })
          }
        }
      }

      // Process embeds (e.g., ![[note]])
      if (meta?.embeds) {
        for (const embed of meta.embeds) {
          const resolved = this.resolveLink(embed.link, file)
          if (resolved && filePathSet.has(resolved.path) && resolved.extension === 'md') {
            links.push({
              sourcePath: file.path,
              targetPath: resolved.path,
              displayText: embed.displayText || resolved.basename,
            })
          }
        }
      }

      this.forwardLinks.set(file.path, links)

      // Build backlinks
      for (const link of links) {
        if (!this.backlinks.has(link.targetPath)) {
          this.backlinks.set(link.targetPath, [])
        }
        const existing = this.backlinks.get(link.targetPath)!
        // Avoid duplicate backlinks from same source
        if (!existing.find(b => b.sourcePath === file.path)) {
          existing.push({
            sourcePath: file.path,
            displayText: file.basename
          })
        }
      }
    }
  }

  private resolveLink (linkText: string, sourceFile: TFile): TFile | null {
    // Remove heading part (e.g., "Page#Heading" -> "Page")
    const pathPart = linkText.split('#')[0]
    if (!pathPart) return null

    const resolved = this.app.metadataCache.getFirstLinkpathDest(pathPart, sourceFile.path)
    return resolved instanceof TFile ? resolved : null
  }

  private extractHeading (linkText: string): string | undefined {
    const parts = linkText.split('#')
    return parts.length > 1 ? parts.slice(1).join('#') : undefined
  }
}
