import { contextBridge, ipcRenderer } from "electron";
export type MediaItem = { id: string; name: string; path: string; url: string; kind: "video" | "audio"; size: number };
export type ExportClip = { path: string; kind: "video" | "audio"; start: number; sourceStart: number; duration: number; trackOrder?: number; volume?: number; fadeIn?: number; fadeOut?: number; brightness?: number; contrast?: number; saturation?: number; title?: string; titleSize?: number; titlePosition?: "top" | "center" | "bottom" };
export type ExportRequest = { clips: ExportClip[]; resolution: "720p" | "1080p" | "4k"; fps: 24 | 30 | 60 };
contextBridge.exposeInMainWorld("playStudio", {
  openMedia: (): Promise<MediaItem[]> => ipcRenderer.invoke("media:open"),
  relinkMedia: (kind: "video" | "audio"): Promise<MediaItem | null> => ipcRenderer.invoke("media:relink", kind),
  getWaveform: (filePath: string, duration: number): Promise<number[]> => ipcRenderer.invoke("media:waveform", filePath, duration),
  getThumbnail: (filePath: string, timestamp: number): Promise<string | null> => ipcRenderer.invoke("media:thumbnail", filePath, timestamp),
  getMediaDuration: (filePath: string): Promise<number> => ipcRenderer.invoke("media:duration", filePath),
  saveProject: (data: string, saveAs = false): Promise<boolean> => ipcRenderer.invoke("project:save", data, saveAs),
  autosaveProject: (data: string): Promise<boolean> => ipcRenderer.invoke("project:autosave", data),
  readAutosaveProject: (): Promise<string | null> => ipcRenderer.invoke("project:read-autosave"),
  clearAutosaveProject: (): Promise<boolean> => ipcRenderer.invoke("project:clear-autosave"),
  resetProjectPath: (): Promise<boolean> => ipcRenderer.invoke("project:reset-path"),
  acceptLoadedProject: (): Promise<boolean> => ipcRenderer.invoke("project:accept-load"),
  loadProject: (): Promise<string | null> => ipcRenderer.invoke("project:load"),
  exportVideo: (request: ExportRequest): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke("export:render", request),
  cancelExport: (): Promise<boolean> => ipcRenderer.invoke("export:cancel"),
  onExportProgress: (callback: (progress: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
  }
});
