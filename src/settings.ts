import { App, PluginSettingTab, Setting, TFolder, TextComponent } from 'obsidian'
import SharePlugin from './main'
import { PublishSettingsModal } from './site/ui/publish-settings-modal'

export interface FolderSiteSettings {
  title: string        // '' = use folder name
  encrypted: boolean
  expiry: string       // '' | '1 day' | '7 days' | '30 days' | '90 days'
}

export interface PublishedSite {
  slug: string;
  url: string;
  title: string;
  updatedAt: number;
  encrypted: boolean;
}

export interface ShareSettings {
  server: string;
  uid: string;
  apiKey: string;
  // Site publishing settings
  siteDefaultFolder: string;
  siteTitle: string;
  siteVanitySlug: string;
  siteEncrypted: boolean;
  siteEncryptionKeys: Record<string, string>;
  siteExpiry: string;
  // Per-folder settings: folder.path → settings
  folderSettings: Record<string, FolderSiteSettings>;
  // Published sites: folder path → site info
  publishedSites: Record<string, PublishedSite>;
}

export const DEFAULT_SETTINGS: ShareSettings = {
  server: 'https://opennotes.io',
  uid: '',
  apiKey: '',
  siteDefaultFolder: '',
  siteTitle: '',
  siteVanitySlug: '',
  siteEncrypted: false,
  siteEncryptionKeys: {},
  siteExpiry: '',
  folderSettings: {},
  publishedSites: {}
}

export class ShareSettingsTab extends PluginSettingTab {
  plugin: SharePlugin
  apikeyEl: TextComponent

  constructor (app: App, plugin: SharePlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display (): void {
    const { containerEl } = this

    containerEl.empty()

    // API key
    new Setting(containerEl)
      .setName('API key')
      .setDesc('Click the button to request a new API key')
      .addButton(btn => btn
        .setButtonText('Connect plugin')
        .setCta()
        .onClick(() => {
          window.open(this.plugin.settings.server + '/v1/account/get-key?id=' + this.plugin.settings.uid)
        }))
      .addText(inputEl => {
        this.apikeyEl = inputEl
        inputEl
          .setPlaceholder('API key')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value
            await this.plugin.saveSettings()
          })
      })

    // Site publishing section
    new Setting(containerEl)
      .setName('Default settings for new shares')
      .setHeading()

    new Setting(containerEl)
      .setName('Default folder')
      .setDesc('The default folder to share. Leave empty to choose each time.')
      .addText(text => text
        .setPlaceholder('e.g., publish')
        .setValue(this.plugin.settings.siteDefaultFolder)
        .onChange(async (value) => {
          this.plugin.settings.siteDefaultFolder = value
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Title')
      .setDesc('The title for your shared folder. Defaults to the folder name if empty.')
      .addText(text => text
        .setPlaceholder('My Knowledge Base')
        .setValue(this.plugin.settings.siteTitle)
        .onChange(async (value) => {
          this.plugin.settings.siteTitle = value
          await this.plugin.saveSettings()
        }))

    const prefix = this.plugin.settings.uid ? this.plugin.settings.uid.slice(0, 8) : '????????'
    const vanitySetting = new Setting(containerEl)
      .setName('Vanity URL')
      .setDesc(`Your shares are at /${prefix}/<folder>/. Set a vanity slug to use /<vanity>/<folder>/ instead.`)

    let vanityCheckTimeout: ReturnType<typeof setTimeout> | null = null
    vanitySetting.addText(text => text
      .setPlaceholder('my-name')
      .setValue(this.plugin.settings.siteVanitySlug)
      .onChange(async (value) => {
        const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
        this.plugin.settings.siteVanitySlug = cleaned
        await this.plugin.saveSettings()

        // Debounced availability check
        if (vanityCheckTimeout) clearTimeout(vanityCheckTimeout)
        if (!cleaned) {
          vanitySetting.setDesc(`Your shares are at /${prefix}/<folder>/. Set a vanity slug to use /<vanity>/<folder>/ instead.`)
          return
        }
        vanityCheckTimeout = setTimeout(async () => {
          try {
            const result = await this.plugin.api.checkVanitySlug(cleaned)
            if (result.available) {
              vanitySetting.setDesc(`Your shares will be at /${cleaned}/<folder>/`)
            } else {
              vanitySetting.setDesc(result.error || 'This vanity slug is already taken.')
            }
          } catch {
            vanitySetting.setDesc('Could not check availability.')
          }
        }, 500)
      }))

    new Setting(containerEl)
      .setName('Encryption')
      .setDesc('Encrypt content when sharing. Does not apply to local HTML export. The decryption key is included in the URL fragment. Only page content is encrypted. Titles and navigation structure remain visible.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.siteEncrypted)
        .onChange(async (value) => {
          this.plugin.settings.siteEncrypted = value
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Expiry')
      .setDesc('Automatically delete the shared folder after this duration. Re-sharing resets the timer.')
      .addDropdown(dropdown => dropdown
        .addOption('', 'Never')
        .addOption('1 day', '1 day')
        .addOption('7 days', '7 days')
        .addOption('30 days', '30 days')
        .addOption('90 days', '90 days')
        .setValue(this.plugin.settings.siteExpiry)
        .onChange(async (value) => {
          this.plugin.settings.siteExpiry = value
          await this.plugin.saveSettings()
        }))

    // Published sites section
    const sites = this.plugin.settings.publishedSites
    if (Object.keys(sites).length > 0) {
      new Setting(containerEl)
        .setName('Shared folders')
        .setHeading()

      for (const [folderPath, site] of Object.entries(sites)) {
        new Setting(containerEl)
          .setName(site.title || folderPath)
          .setDesc(site.url)
          .addButton(btn => btn
            .setButtonText('Settings')
            .onClick(() => {
              const folder = this.app.vault.getAbstractFileByPath(folderPath)
              if (folder instanceof TFolder) {
                new PublishSettingsModal(this.app, this.plugin, folder, async (fs) => {
                  // Save settings only, no publish
                  this.plugin.settings.folderSettings[folderPath] = fs
                  await this.plugin.saveSettings()
                  this.display()
                }).open()
              }
            }))
          .addButton(btn => btn
            .setButtonText('Open')
            .onClick(() => {
              // @ts-ignore
              require('electron').shell.openExternal(site.url)
            }))
          .addButton(btn => btn
            .setButtonText('Copy URL')
            .onClick(async () => {
              await navigator.clipboard.writeText(site.url)
            }))
          .addButton(btn => btn
            .setButtonText('Delete')
            .setWarning()
            .onClick(async () => {
              try {
                await this.plugin.api.deleteSite(site.slug)
                delete this.plugin.settings.publishedSites[folderPath]
                await this.plugin.saveSettings()
                this.display() // refresh UI
              } catch (e) {
                console.error('Failed to delete site:', e)
              }
            }))
      }
    }
  }
}
