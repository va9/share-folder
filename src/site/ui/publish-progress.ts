import { App, Modal } from 'obsidian'

export class PublishProgressModal extends Modal {
  private stageEl: HTMLElement
  private progressEl: HTMLElement
  private detailEl: HTMLElement
  private barFill: HTMLElement
  private resultEl: HTMLElement

  constructor (app: App) {
    super(app)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: 'Publishing folder...' })

    this.stageEl = contentEl.createEl('div', { cls: 'publish-stage' })
    this.stageEl.setText('Preparing...')

    const barContainer = contentEl.createEl('div', { cls: 'publish-progress-bar' })
    this.barFill = barContainer.createEl('div', { cls: 'publish-progress-fill' })
    this.barFill.style.width = '0%'

    this.progressEl = contentEl.createEl('div', { cls: 'publish-progress-text' })
    this.detailEl = contentEl.createEl('div', { cls: 'publish-detail' })
    this.resultEl = contentEl.createEl('div', { cls: 'publish-result' })

    // Add styles
    const style = contentEl.createEl('style')
    style.textContent = `
      .publish-stage { font-weight: 600; margin-bottom: 8px; }
      .publish-progress-bar { width: 100%; height: 8px; background: var(--background-modifier-border); border-radius: 4px; margin: 8px 0; overflow: hidden; }
      .publish-progress-fill { height: 100%; background: var(--interactive-accent); border-radius: 4px; transition: width 0.3s ease; }
      .publish-progress-text { font-size: 0.85em; color: var(--text-muted); margin-bottom: 4px; }
      .publish-detail { font-size: 0.8em; color: var(--text-faint); }
      .publish-result { margin-top: 16px; }
      .publish-result button { background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 8px 20px; font-size: 1em; cursor: pointer; font-weight: 500; }
      .publish-result button:hover { opacity: 0.9; }
      .publish-error-details { margin-top: 8px; }
      .publish-error-details summary { cursor: pointer; font-size: 0.85em; color: var(--text-muted); }
      .publish-error-details summary:hover { color: var(--text-normal); }
      .publish-error-log { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 12px; font-size: 0.8em; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; margin-top: 8px; }
      .publish-error-copy { margin-top: 8px; font-size: 0.85em !important; padding: 4px 12px !important; }
    `
  }

  setStage (stage: string) {
    if (this.stageEl) this.stageEl.setText(stage)
  }

  setProgress (current: number, total: number) {
    if (this.progressEl) this.progressEl.setText(`${current} / ${total}`)
    if (this.barFill) {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0
      this.barFill.style.width = pct + '%'
    }
  }

  setDetail (detail: string) {
    if (this.detailEl) this.detailEl.setText(detail)
  }

  setResult (url: string) {
    if (this.resultEl) {
      this.resultEl.empty()
      const heading = this.contentEl.querySelector('h2')
      if (heading) heading.setText('Published!')
      this.stageEl.setText('Your site is live')
      this.barFill.style.width = '100%'
      this.progressEl.setText('')
      this.detailEl.setText('')

      const btn = this.resultEl.createEl('button', { text: 'Open Site' })
      btn.addEventListener('click', () => {
        // @ts-ignore
        const { shell } = require('electron')
        if (url.startsWith('file://')) {
          shell.openPath(url.replace('file://', ''))
        } else {
          shell.openExternal(url)
        }
      })
    }
  }

  setError (message: string, error?: any) {
    if (this.resultEl) {
      this.resultEl.empty()
      const heading = this.contentEl.querySelector('h2')
      if (heading) heading.setText('Publishing failed')
      this.stageEl.setText(message)
      this.stageEl.style.color = 'var(--text-error)'
      this.barFill.style.background = 'var(--text-error)'

      // Build error log string
      const errorLog = this.buildErrorLog(message, error)

      // Expandable error details
      const details = this.resultEl.createEl('details', { cls: 'publish-error-details' })
      details.createEl('summary', { text: 'Show error log' })
      const pre = details.createEl('pre', { cls: 'publish-error-log', text: errorLog })

      // Copy button
      const copyBtn = this.resultEl.createEl('button', { text: 'Copy error log', cls: 'publish-error-copy' })
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(errorLog).then(() => {
          copyBtn.setText('Copied!')
          setTimeout(() => copyBtn.setText('Copy error log'), 2000)
        })
      })
    }
  }

  private buildErrorLog (message: string, error?: any): string {
    const lines: string[] = [
      `Error: ${message}`,
      `Time: ${new Date().toISOString()}`,
    ]
    if (error) {
      if (error instanceof Error) {
        lines.push(`Message: ${error.message}`)
        if (error.stack) lines.push(`Stack:\n${error.stack}`)
      } else {
        lines.push(`Details: ${JSON.stringify(error, null, 2)}`)
      }
    }
    return lines.join('\n')
  }
}
