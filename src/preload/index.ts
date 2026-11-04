import { contextBridge, ipcRenderer } from "electron";
export type MediaItem = { id: string; name: string; path: string; url: string; kind: "video" | "audio"; size: number };
export type ExportClip = { path: string; kind: "video" | "audio"; start: number; sourceStart: number; duration: number; volume?: number };
contextBridge.exposeInMainWorld("playStudio", {
  openMedia: (): Promise<MediaItem[]> => ipcRenderer.invoke("media:open"),
  saveProject: (data: string): Promise<boolean> => ipcRenderer.invoke("project:save", data),
  loadProject: (): Promise<string | null> => ipcRenderer.invoke("project:load"),
  exportVideo: (clips: ExportClip[]): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke("export:render", clips),
  onExportProgress: (callback: (progress: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
  }
});
