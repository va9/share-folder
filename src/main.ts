import { Plugin, TFolder } from 'obsidian'
import { DEFAULT_SETTINGS, FolderSiteSettings, ShareSettings, ShareSettingsTab } from './settings'
import API from './api'
import StatusMessage, { StatusType } from './StatusMessage'
import { shortHash, sha256 } from './crypto'
import { FolderPickerModal } from './site/ui/folder-picker'
import { SitePublisher } from './site/site-publisher'
import { OutputPathModal } from './site/ui/output-path-modal'
import { PublishSettingsModal } from './site/ui/publish-settings-modal'

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
    this.settingsPage = new ShareSettingsTab(this.app, this)
    this.addSettingTab(this.settingsPage)

    this.api = new API(this)

    // API key callback via obsidian:// protocol handler
    this.registerObsidianProtocolHandler('share-folder', async (data) => {
      if (data.key) {
        this.settings.apiKey = data.key
        await this.saveSettings()
        if (this.settingsPage?.apikeyEl) {
          this.settingsPage.apikeyEl.setValue(data.key)
        }
        new StatusMessage('Plugin connected successfully!', StatusType.Success, 6000)
      }
    })

    // Command — Share folder to web
    this.addCommand({
      id: 'share-folder-to-web',
      name: 'Share folder to web',
      callback: () => {
        new FolderPickerModal(this.app, (folder) => {
          new PublishSettingsModal(this.app, this, folder, async (folderSettings) => {
            const publisher = new SitePublisher(this, folder)
            await publisher.publish(folderSettings)
          }).open()
        }).open()
      }
    })

    // Command — Share folder to local HTML
    this.addCommand({
      id: 'share-folder-to-disk',
      name: 'Share folder to local HTML',
      callback: () => {
        new FolderPickerModal(this.app, (folder) => {
          new PublishSettingsModal(this.app, this, folder, (folderSettings) => {
            // @ts-ignore - app.vault.adapter.basePath is available on desktop
            const vaultPath = this.app.vault.adapter.basePath || ''
            const defaultDir = vaultPath
              ? require('path').join(vaultPath, '_site')
              : ''
            new OutputPathModal(this.app, defaultDir, async (outputDir) => {
              const publisher = new SitePublisher(this, folder)
              await publisher.publishToDisk(outputDir, folderSettings)
            }).open()
          }).open()
        }).open()
      }
    })

    // Ribbon icon
    this.addRibbonIcon('globe', 'Share folder to web', () => {
      new FolderPickerModal(this.app, (folder) => {
        new PublishSettingsModal(this.app, this, folder, async (folderSettings) => {
          const publisher = new SitePublisher(this, folder)
          await publisher.publish(folderSettings)
        }).open()
      }).open()
    })

    // Folder context menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          const published = this.settings.publishedSites[file.path]

          menu.addItem((item) => {
            item.setIcon('globe')
            item.setTitle(published ? 'See settings and re-publish' : 'Share folder to web')
            item.onClick(() => {
              new PublishSettingsModal(this.app, this, file, async (folderSettings) => {
                const publisher = new SitePublisher(this, file)
                await publisher.publish(folderSettings)
              }).open()
            })
          })

          if (published) {
            menu.addItem((item) => {
              item.setIcon('external-link')
              item.setTitle('Open shared folder')
              item.onClick(() => {
                // @ts-ignore
                require('electron').shell.openExternal(published.url)
              })
            })
            menu.addItem((item) => {
              item.setIcon('copy')
              item.setTitle('Copy URL')
              item.onClick(async () => {
                await navigator.clipboard.writeText(published.url)
                new StatusMessage('URL copied to clipboard', StatusType.Success)
              })
            })
            menu.addItem((item) => {
              item.setIcon('trash-2')
              item.setTitle('Delete shared folder')
              item.onClick(async () => {
                try {
                  await this.api.deleteSite(published.slug)
                  delete this.settings.publishedSites[file.path]
                  await this.saveSettings()
                  new StatusMessage('Shared folder deleted', StatusType.Info)
                } catch (e) {
                  new StatusMessage('Failed to delete shared folder', StatusType.Error)
                }
              })
            })
          }

          menu.addItem((item) => {
            item.setIcon('hard-drive-download')
            item.setTitle('Share folder to local HTML')
            item.onClick(() => {
              new PublishSettingsModal(this.app, this, file, (folderSettings) => {
                // @ts-ignore
                const vaultPath = this.app.vault.adapter.basePath || ''
                const defaultDir = vaultPath
                  ? require('path').join(vaultPath, '_site')
                  : ''
                new OutputPathModal(this.app, defaultDir, async (outputDir) => {
                  const publisher = new SitePublisher(this, file)
                  await publisher.publishToDisk(outputDir, folderSettings)
                }).open()
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
