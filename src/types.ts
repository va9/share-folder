import { View } from 'obsidian'

export enum InternalLinkMethod {
  ANCHOR,
  ONCLICK
}

export interface PreviewSection {
  el: HTMLElement
}

export interface Renderer {
  parsing: boolean,
  pusherEl: HTMLElement,
  previewEl: HTMLElement,
  sections: PreviewSection[]
}

export interface ViewModes extends View {
  getViewType: any,
  getDisplayText: any,
  modes: {
    preview: {
      renderer: Renderer
    }
  }
}
