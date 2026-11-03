import { contextBridge, ipcRenderer } from "electron";
export type MediaItem = { id: string; name: string; path: string; url: string; kind: "video" | "audio"; size: number };
contextBridge.exposeInMainWorld("playStudio", {
  openMedia: (): Promise<MediaItem[]> => ipcRenderer.invoke("media:open"),
  saveProject: (data: string): Promise<boolean> => ipcRenderer.invoke("project:save", data),
  loadProject: (): Promise<string | null> => ipcRenderer.invoke("project:load")
});
