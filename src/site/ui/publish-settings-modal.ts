import { App, Modal, Setting, TFolder } from 'obsidian'
import SharePlugin from '../../main'
import { FolderSiteSettings } from '../../settings'

export class PublishSettingsModal extends Modal {
  private plugin: SharePlugin
  private folder: TFolder
  private onPublish: (settings: FolderSiteSettings) => void
  private settings: FolderSiteSettings

  constructor (app: App, plugin: SharePlugin, folder: TFolder, onPublish: (settings: FolderSiteSettings) => void) {
    super(app)
    this.plugin = plugin
    this.folder = folder
    this.onPublish = onPublish

    // Pre-fill from saved per-folder settings, else global defaults
    const saved = plugin.settings.folderSettings[folder.path]
    this.settings = saved
      ? { ...saved }
      : {
          title: plugin.settings.siteTitle,
          encrypted: plugin.settings.siteEncrypted,
          expiry: plugin.settings.siteExpiry
        }
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()

    const isPublished = !!this.plugin.settings.publishedSites[this.folder.path]
    contentEl.createEl('h2', { text: isPublished ? 'Folder settings' : 'Share to web' })

    new Setting(contentEl)
      .setName('Title')
      .setDesc('Defaults to the folder name if empty.')
      .addText(text => text
        .setPlaceholder(this.folder.name)
        .setValue(this.settings.title)
        .onChange(value => { this.settings.title = value }))

    new Setting(contentEl)
      .setName('Encryption')
      .setDesc('Encrypt content. The decryption key is included in the URL fragment. Only page content is encrypted. Titles and navigation structure remain visible.')
      .addToggle(toggle => toggle
        .setValue(this.settings.encrypted)
        .onChange(value => { this.settings.encrypted = value }))

    new Setting(contentEl)
      .setName('Expiry')
      .setDesc('Automatically delete the shared folder after this duration. Re-sharing resets the timer.')
      .addDropdown(dropdown => dropdown
        .addOption('', 'Never')
        .addOption('1 day', '1 day')
        .addOption('7 days', '7 days')
        .addOption('30 days', '30 days')
        .addOption('90 days', '90 days')
        .setValue(this.settings.expiry)
        .onChange(value => { this.settings.expiry = value }))

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Publish')
        .setCta()
        .onClick(() => {
          this.plugin.settings.folderSettings[this.folder.path] = { ...this.settings }
          this.plugin.saveSettings()
          this.close()
          this.onPublish({ ...this.settings })
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
  }

  onClose () {
    this.contentEl.empty()
  }
}
