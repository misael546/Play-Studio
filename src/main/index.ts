import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

protocol.registerSchemesAsPrivileged([{ scheme: "media", privileges: { standard: true, supportFetchAPI: true, stream: true, secure: true } }]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1050, minHeight: 680,
    backgroundColor: "#111318",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  protocol.handle("media", async (request) => {
    const encoded = new URL(request.url).pathname.slice(1);
    const filePath = Buffer.from(encoded, "base64url").toString("utf8");
    return net.fetch(pathToFileURL(filePath).toString());
  });
  ipcMain.handle("media:open", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [
      { name: "Medios compatibles", extensions: ["mp4","mov","mkv","avi","webm","m4v","mp3","wav","aac","m4a","flac","ogg","wma"] },
      { name: "Todos los archivos", extensions: ["*"] }
    ]});
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async (filePath) => {
      const stat = await import("node:fs/promises").then(fs => fs.stat(filePath));
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const audio = ["mp3","wav","aac","m4a","flac","ogg","wma"].includes(ext);
      return { id: crypto.randomUUID(), name, path: filePath, url: "media://local/" + Buffer.from(filePath).toString("base64url"), kind: audio ? "audio" : "video", size: stat.size };
    }));
  });
  ipcMain.handle("project:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: "Mi proyecto.playstudio", filters: [{ name: "Proyecto Play Studio", extensions: ["playstudio"] }] });
    if (result.canceled || !result.filePath) return false;
    const fs = await import("node:fs/promises");
    await fs.writeFile(result.filePath, data, "utf8");
    return true;
  });
  ipcMain.handle("project:load", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Proyecto Play Studio", extensions: ["playstudio"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return readFile(result.filePaths[0], "utf8");
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
