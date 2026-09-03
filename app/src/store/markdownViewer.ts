import { create } from "zustand"

export interface MarkdownViewerState {
  open: boolean
  path: string | null
  title: string | null
  projectPath: string | null
  openViewer: (path: string, title?: string, projectPath?: string | null) => void
  closeViewer: () => void
}

export const useMarkdownViewer = create<MarkdownViewerState>((set) => ({
  open: false,
  path: null,
  title: null,
  projectPath: null,
  openViewer: (path, title, projectPath) => {
    const filename = title || path.split("/").pop() || "Documento"
    set({
      open: true,
      path,
      title: filename,
      projectPath: projectPath ?? null,
    })
  },
  closeViewer: () =>
    set({ open: false, path: null, title: null, projectPath: null }),
}))
