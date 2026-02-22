import { App, Modal, Setting } from 'obsidian'

export class OutputPathModal extends Modal {
  private onSubmit: (outputDir: string) => void
  private outputDir: string

  constructor (app: App, defaultDir: string, onSubmit: (outputDir: string) => void) {
    super(app)
    this.outputDir = defaultDir
    this.onSubmit = onSubmit
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()

    contentEl.createEl('h2', { text: 'Share folder to local HTML' })
    contentEl.createEl('p', {
      text: 'Choose an output directory. The site will be written as static HTML files you can open in a browser.',
      cls: 'setting-item-description'
    })

    new Setting(contentEl)
      .setName('Output directory')
      .setDesc('Absolute path on your filesystem')
      .addText(text => {
        text
          .setPlaceholder('/Users/you/Desktop/my-site')
          .setValue(this.outputDir)
          .onChange(value => {
            this.outputDir = value
          })
        text.inputEl.style.width = '100%'
        text.inputEl.style.minWidth = '300px'
      })

    new Setting(contentEl)
      .addButton(btn => {
        btn
          .setButtonText('Publish to disk')
          .setCta()
          .onClick(() => {
            if (this.outputDir.trim()) {
              this.close()
              this.onSubmit(this.outputDir.trim())
            }
          })
      })
      .addButton(btn => {
        btn
          .setButtonText('Cancel')
          .onClick(() => this.close())
      })
  }

  onClose () {
    this.contentEl.empty()
  }
}
