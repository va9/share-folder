import { requestUrl } from 'obsidian'
import SharePlugin from './main'
import StatusMessage, { StatusType } from './StatusMessage'
import { sha256 } from './crypto'

const pluginVersion = require('../manifest.json').version

export interface SiteFileUpload {
  path: string
  content: string
  filetype: string
  base64?: boolean
}

export interface PublishSiteResult {
  success: boolean
  url: string
}

export default class API {
  plugin: SharePlugin

  constructor (plugin: SharePlugin) {
    this.plugin = plugin
  }

  async authHeaders () {
    const nonce = Date.now().toString()
    return {
      'x-sharenote-id': this.plugin.settings.uid,
      'x-sharenote-key': await sha256(nonce + this.plugin.settings.apiKey),
      'x-sharenote-nonce': nonce,
      'x-sharenote-version': pluginVersion
    }
  }

  async post (endpoint: string, data?: any, retries = 1) {
    const headers: HeadersInit = {
      ...(await this.authHeaders()),
      'Content-Type': 'application/json'
    }

    while (retries > 0) {
      try {
        const res = await requestUrl({
          url: this.plugin.settings.server + endpoint,
          method: 'POST',
          headers,
          body: JSON.stringify(data)
        })
        return res.json
      } catch (error) {
        if (error.status < 500 || retries <= 1) {
          const message = error.headers?.message
          if (message) {
            new StatusMessage(message, StatusType.Error)
            throw new Error('Known error')
          }
          throw new Error('Unknown error')
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
      retries--
    }
  }

  /**
   * Publish a complete site (folder) to the server.
   * Uploads files in batches to avoid oversized requests.
   */
  async checkVanitySlug (vanitySlug: string): Promise<{ available: boolean; error?: string }> {
    return await this.post('/v1/site/check-vanity', { vanitySlug })
  }

  async deleteSite (slug: string): Promise<void> {
    await this.post('/v1/site/delete', { slug })
  }

  async publishSite (
    slug: string,
    title: string,
    files: SiteFileUpload[],
    options?: {
      prefix?: string
      vanitySlug?: string
      encrypted?: boolean
      expiryDuration?: string
    },
    onProgress?: (current: number, total: number) => void
  ): Promise<PublishSiteResult | undefined> {
    const batchSize = 20
    const totalFiles = files.length

    for (let i = 0; i < totalFiles; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const isFirst = i === 0
      const isLast = i + batchSize >= totalFiles

      const res = await this.post('/v1/site/publish', {
        slug,
        title,
        siteFiles: batch,
        batchIndex: Math.floor(i / batchSize),
        isFirstBatch: isFirst,
        isLastBatch: isLast,
        totalFiles,
        prefix: options?.prefix,
        vanitySlug: options?.vanitySlug || undefined,
        encrypted: options?.encrypted || false,
        expiryDuration: options?.expiryDuration || ''
      }, 3)

      if (onProgress) {
        onProgress(Math.min(i + batchSize, totalFiles), totalFiles)
      }

      if (isLast && res) {
        return res as PublishSiteResult
      }
    }
  }
}
