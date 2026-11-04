import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

protocol.registerSchemesAsPrivileged([{ scheme: "media", privileges: { standard: true, supportFetchAPI: true, stream: true, secure: true } }]);
let mainWindow: BrowserWindow | null = null;

type ExportClip = { path: string; kind: "video" | "audio"; start: number; sourceStart: number; duration: number; volume?: number };
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1050, minHeight: 680,
    backgroundColor: "#111318",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
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
      const info = await stat(filePath);
      const name = filePath.split(/[\\\\/]/).pop() ?? filePath;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const audio = ["mp3","wav","aac","m4a","flac","ogg","wma"].includes(ext);
      return { id: crypto.randomUUID(), name, path: filePath, url: "media://local/" + Buffer.from(filePath).toString("base64url"), kind: audio ? "audio" : "video", size: info.size };
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
  ipcMain.handle("export:render", async (event, clips: ExportClip[]) => {
    const ffmpegExecutable = ffmpegPath;
    if (!ffmpegExecutable) throw new Error("No se encontró el motor FFmpeg incluido.");
    if (!Array.isArray(clips) || clips.length === 0) throw new Error("Agrega al menos un clip a la línea de tiempo.");
    const safeClips: ExportClip[] = [];
    for (const clip of clips) {
      if (!clip.path || !Number.isFinite(clip.start) || !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.start < 0 || clip.sourceStart < 0) continue;
      await stat(clip.path);
      safeClips.push(clip);
    }
    if (!safeClips.length) throw new Error("No hay clips válidos para exportar.");
    const totalDuration = Math.max(...safeClips.map(c => c.start + c.duration));
    const target = await dialog.showSaveDialog({ defaultPath: "Video terminado.mp4", filters: [{ name: "Video MP4", extensions: ["mp4"] }] });
    if (target.canceled || !target.filePath) return { canceled: true };
    const videos = safeClips.filter(c => c.kind === "video");
    const audios = safeClips.filter(c => c.kind === "audio");
    const args: string[] = ["-y"];
    safeClips.forEach(c => args.push("-i", c.path));
    const filters: string[] = [];
    filters.push("color=c=black:s=1920x1080:r=30:d=" + totalDuration.toFixed(3) + "[base0]");
    let base = "base0";
    videos.forEach((clip, index) => {
      const inputIndex = safeClips.indexOf(clip);
      const label = "v" + index;
      const next = "base" + (index + 1);
      filters.push("[" + inputIndex + ":v:0]trim=start=" + clip.sourceStart.toFixed(3) + ":duration=" + clip.duration.toFixed(3) + ",setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS+" + clip.start.toFixed(3) + "/TB[" + label + "]");
      filters.push("[" + base + "][" + label + "]overlay=eof_action=pass:enable='between(t," + clip.start.toFixed(3) + "," + (clip.start + clip.duration).toFixed(3) + ")'[" + next + "]");
      base = next;
    });
    filters.push("[" + base + "]format=yuv420p[vout]");
    if (audios.length) {
      audios.forEach((clip, index) => {
        const inputIndex = safeClips.indexOf(clip);
        const delay = Math.max(0, Math.round(clip.start * 1000));
        filters.push("[" + inputIndex + ":a:0]atrim=start=" + clip.sourceStart.toFixed(3) + ":duration=" + clip.duration.toFixed(3) + ",asetpts=PTS-STARTPTS,volume=" + Math.max(0, Math.min(2, clip.volume ?? 1)).toFixed(2) + ",adelay=" + delay + "|" + delay + "[a" + index + "]");
      });
      filters.push(audios.map((_,i)=>"[a"+i+"]").join("") + "amix=inputs=" + audios.length + ":duration=longest:dropout_transition=0,atrim=duration=" + totalDuration.toFixed(3) + "[aout]");
    } else {
      filters.push("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=" + totalDuration.toFixed(3) + "[aout]");
    }
    args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", totalDuration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", target.filePath);
    const executable = app.isPackaged ? ffmpegExecutable.replace("app.asar", "app.asar.unpacked") : ffmpegExecutable;
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let errorText = "";
      child.stderr.on("data", chunk => { errorText += chunk.toString(); if (errorText.length > 12000) errorText = errorText.slice(-12000); });
      child.stdout.on("data", chunk => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^out_time_ms=(\d+)/);
          if (match && mainWindow && !mainWindow.isDestroyed()) {
            const seconds = Number(match[1]) / 1000000;
            event.sender.send("export:progress", Math.min(99, Math.round(seconds / totalDuration * 100)));
          }
        }
      });
      child.on("error", reject);
      child.on("close", code => {
        if (code === 0) { event.sender.send("export:progress", 100); resolve({ canceled: false, path: target.filePath }); }
        else reject(new Error("FFmpeg no pudo completar la exportación. " + errorText.slice(-1800)));
      });
    });
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
