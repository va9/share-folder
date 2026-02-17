export interface NavItem {
  name: string
  path: string | null   // null for folders
  slug: string | null    // null for folders
  children: NavItem[]
}

export class NavBuilder {
  /**
   * Build a folder tree from a list of file slugs and their display titles.
   * @param files Array of { slug, title, path } for each published page
   * @param folderPath The root folder being published (to strip from display)
   */
  buildTree (files: Array<{ slug: string; title: string; path: string }>, folderPath: string): NavItem {
    const root: NavItem = {
      name: folderPath.split('/').pop() || 'Site',
      path: null,
      slug: null,
      children: []
    }

    for (const file of files) {
      // Get the relative path within the published folder
      const relativePath = file.path.startsWith(folderPath + '/')
        ? file.path.slice(folderPath.length + 1)
        : file.path
      const parts = relativePath.replace(/\.md$/, '').split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isFile = i === parts.length - 1

        if (isFile) {
          current.children.push({
            name: file.title,
            path: file.path,
            slug: file.slug,
            children: []
          })
        } else {
          let folder = current.children.find(c => c.path === null && c.name === part)
          if (!folder) {
            folder = {
              name: part,
              path: null,
              slug: null,
              children: []
            }
            current.children.push(folder)
          }
          current = folder
        }
      }
    }

    // Sort: folders first, then files, each alphabetically
    this.sortTree(root)

    return root
  }

  private sortTree (node: NavItem) {
    node.children.sort((a, b) => {
      const aIsFolder = a.path === null
      const bIsFolder = b.path === null
      if (aIsFolder && !bIsFolder) return -1
      if (!aIsFolder && bIsFolder) return 1
      return a.name.localeCompare(b.name)
    })
    for (const child of node.children) {
      if (child.children.length > 0) {
        this.sortTree(child)
      }
    }
  }

  /** Serialize tree to JSON string for embedding in the page */
  toJson (tree: NavItem): string {
    return JSON.stringify(tree)
  }
}
