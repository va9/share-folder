import { Plugin, TFolder } from 'obsidian'
import { DEFAULT_SETTINGS, ShareSettings, ShareSettingsTab } from './settings'
import API from './api'
import StatusMessage, { StatusType } from './StatusMessage'
import { shortHash, sha256 } from './crypto'
import { FolderPickerModal } from './site/ui/folder-picker'
import { SitePublisher } from './site/site-publisher'
import { OutputPathModal } from './site/ui/output-path-modal'

export default class SharePlugin extends Plugin {
  settings: ShareSettings
  api: API
  settingsPage: ShareSettingsTab

  // Expose some tools in the plugin object
  hash = shortHash
  sha256 = sha256

  async onload () {
    await this.loadSettings()
    if (!this.settings.uid) {
      this.settings.uid = await shortHash('' + Date.now() + Math.random())
      await this.saveSettings()
    }
    // Migrate users from the original Share Note plugin
    if (this.settings.server === 'https://api.obsidianshare.com' || this.settings.server === 'https://api.note.sx') {
      this.settings.server = 'https://obsidian-publish.fly.dev'
      this.settings.apiKey = ''
      await this.saveSettings()
    }
    this.settingsPage = new ShareSettingsTab(this.app, this)
    this.addSettingTab(this.settingsPage)

    this.api = new API(this)

    // API key callback via obsidian:// protocol handler
    this.registerObsidianProtocolHandler('publish-folder', async (data) => {
      if (data.key) {
        this.settings.apiKey = data.key
        await this.saveSettings()
        if (this.settingsPage?.apikeyEl) {
          this.settingsPage.apikeyEl.setValue(data.key)
        }
        new StatusMessage('Plugin connected successfully!', StatusType.Success, 6000)
      }
    })

    // Command - Publish Folder
    this.addCommand({
      id: 'publish-folder',
      name: 'Publish folder as website',
      callback: () => {
        new FolderPickerModal(this.app, async (folder) => {
          const publisher = new SitePublisher(this, folder)
          await publisher.publish()
        }).open()
      }
    })

    // Command - Publish Folder to Disk
    this.addCommand({
      id: 'publish-folder-to-disk',
      name: 'Publish folder to disk (local HTML)',
      callback: () => {
        new FolderPickerModal(this.app, (folder) => {
          // @ts-ignore - app.vault.adapter.basePath is available on desktop
          const vaultPath = this.app.vault.adapter.basePath || ''
          const defaultDir = vaultPath
            ? require('path').join(vaultPath, '_site')
            : ''
          new OutputPathModal(this.app, defaultDir, async (outputDir) => {
            const publisher = new SitePublisher(this, folder)
            await publisher.publishToDisk(outputDir)
          }).open()
        }).open()
      }
    })

    // Ribbon icon
    this.addRibbonIcon('globe', 'Publish folder as website', () => {
      new FolderPickerModal(this.app, async (folder) => {
        const publisher = new SitePublisher(this, folder)
        await publisher.publish()
      }).open()
    })

    // Folder context menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          const published = this.settings.publishedSites[file.path]

          menu.addItem((item) => {
            item.setIcon('globe')
            item.setTitle(published ? 'Re-publish folder' : 'Publish folder as website')
            item.onClick(async () => {
              const publisher = new SitePublisher(this, file)
              await publisher.publish()
            })
          })

          if (published) {
            menu.addItem((item) => {
              item.setIcon('external-link')
              item.setTitle('Open published site')
              item.onClick(() => {
                // @ts-ignore
                require('electron').shell.openExternal(published.url)
              })
            })
            menu.addItem((item) => {
              item.setIcon('copy')
              item.setTitle('Copy site URL')
              item.onClick(async () => {
                await navigator.clipboard.writeText(published.url)
                new StatusMessage('Site URL copied to clipboard', StatusType.Success)
              })
            })
            menu.addItem((item) => {
              item.setIcon('trash-2')
              item.setTitle('Delete published site')
              item.onClick(async () => {
                try {
                  await this.api.deleteSite(published.slug)
                  delete this.settings.publishedSites[file.path]
                  await this.saveSettings()
                  new StatusMessage('Site deleted', StatusType.Info)
                } catch (e) {
                  new StatusMessage('Failed to delete site', StatusType.Error)
                }
              })
            })
          }

          menu.addItem((item) => {
            item.setIcon('hard-drive-download')
            item.setTitle('Publish folder to disk (local HTML)')
            item.onClick(() => {
              // @ts-ignore
              const vaultPath = this.app.vault.adapter.basePath || ''
              const defaultDir = vaultPath
                ? require('path').join(vaultPath, '_site')
                : ''
              new OutputPathModal(this.app, defaultDir, async (outputDir) => {
                const publisher = new SitePublisher(this, file)
                await publisher.publishToDisk(outputDir)
              }).open()
            })
          })
        }
      })
    )
  }

  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }
}
