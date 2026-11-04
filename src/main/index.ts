import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

protocol.registerSchemesAsPrivileged([{ scheme: "media", privileges: { standard: true, supportFetchAPI: true, stream: true, secure: true } }]);
let mainWindow: BrowserWindow | null = null;
let exportProcess: ReturnType<typeof spawn> | null = null;
let exportCanceled = false;
let currentProjectPath: string | null = null;
let pendingProjectPath: string | null = null;

type ExportClip = { path: string; kind: "video" | "audio"; start: number; sourceStart: number; duration: number; trackOrder?: number; volume?: number; fadeIn?: number; fadeOut?: number; brightness?: number; contrast?: number; saturation?: number; title?: string; titleSize?: number; titlePosition?: "top" | "center" | "bottom" };
const boundedNumber = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const escapeFilterText = (value: string) => value.replace(/\\/g,"\\\\").replace(/:/g,"\\:").replace(/;/g,"\\;").replace(/\r?\n/g," ").replace(/'/g,"\\'").replace(/%/g,"\\%").replace(/,/g,"\\,").replace(/\[/g,"\\[").replace(/\]/g,"\\]");
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 760, minWidth: 1050, minHeight: 680,
    backgroundColor: "#111318",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => { mainWindow = null; if (exportProcess) { exportCanceled = true; exportProcess.kill(); } });
}

app.whenReady().then(() => {
  protocol.handle("media", async (request) => {
    const encoded = new URL(request.url).pathname.slice(1);
    const filePath = Buffer.from(encoded, "base64url").toString("utf8");
    return net.fetch(pathToFileURL(filePath).toString());
  });
  ipcMain.handle("media:open", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [
      { name: "Medios compatibles", extensions: ["mp4","mov","mkv","avi","webm","m4v","3gp","mpg","mpeg","ts","mts","m2ts","flv","ogv","wmv","asf","vob","mp3","wav","aac","m4a","flac","ogg","wma","opus","aiff","aif","amr","ape"] },
      { name: "Todos los archivos", extensions: ["*"] }
    ]});
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async (filePath) => {
      const info = await stat(filePath);
      const name = filePath.split(/[\\\\/]/).pop() ?? filePath;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const audio = ["mp3","wav","aac","m4a","flac","ogg","wma","opus","aiff","aif","amr","ape"].includes(ext);
      return { id: crypto.randomUUID(), name, path: filePath, url: "media://local/" + Buffer.from(filePath).toString("base64url"), kind: audio ? "audio" : "video", size: info.size };
    }));
  });
  ipcMain.handle("media:relink", async (_event, kind: "video" | "audio") => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [
      { name: kind === "audio" ? "Archivos de audio" : "Archivos de video", extensions: kind === "audio" ? ["mp3","wav","aac","m4a","flac","ogg","wma","opus","aiff","aif","amr","ape"] : ["mp4","mov","mkv","avi","webm","m4v","3gp","mpg","mpeg","ts","mts","m2ts","flv","ogv","wmv","asf","vob"] },
      { name: "Todos los archivos", extensions: ["*"] }
    ]});
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Selecciona un archivo válido.");
    const name = filePath.split(/[\\\\/]/).pop() ?? filePath;
    return { id: crypto.randomUUID(), name, path: filePath, url: "media://local/" + Buffer.from(filePath).toString("base64url"), kind, size: info.size };
  });
  ipcMain.handle("media:waveform", async (_event, filePath: string, duration: number): Promise<number[]> => {
    if (typeof filePath !== "string" || !filePath.trim() || !Number.isFinite(duration) || duration <= 0) return [];
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("El archivo de audio no es válido.");
    const executablePath = ffmpegPath;
    if (!executablePath) throw new Error("No se encontró FFmpeg para analizar el audio.");
    const executable = app.isPackaged ? executablePath.replace("app.asar", "app.asar.unpacked") : executablePath;
    const peakCount = Math.max(30, Math.min(180, Math.ceil(duration * 3)));
    const samplesPerPeak = Math.max(1, Math.ceil(duration * 1000 / peakCount));
    const bytesPerPeak = samplesPerPeak * 2;
    return await new Promise<number[]>((resolve, reject) => {
      const child = spawn(executable, ["-v", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const peaks: number[] = [];
      let pending = Buffer.alloc(0);
      let errorText = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let offset = 0;
        while (offset + bytesPerPeak <= data.length && peaks.length < peakCount) {
          let maximum = 0;
          for (let index = offset; index < offset + bytesPerPeak; index += 2) maximum = Math.max(maximum, Math.abs(data.readInt16LE(index)));
          peaks.push(maximum / 32768);
          offset += bytesPerPeak;
        }
        pending = peaks.length >= peakCount ? Buffer.alloc(0) : Buffer.from(data.subarray(offset));
      });
      child.stderr.on("data", chunk => { errorText += chunk.toString(); if (errorText.length > 3000) errorText = errorText.slice(-3000); });
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) { reject(new Error("No se pudo analizar la forma de onda. " + errorText.slice(-900))); return; }
        if (pending.length >= 2 && peaks.length < peakCount) {
          let maximum = 0;
          for (let index = 0; index + 1 < pending.length; index += 2) maximum = Math.max(maximum, Math.abs(pending.readInt16LE(index)));
          peaks.push(maximum / 32768);
        }
        resolve(peaks);
      });
    });
  });
  ipcMain.handle("project:save", async (_event, data: string, saveAs = false) => {
    let targetPath = currentProjectPath;
    if (!targetPath || saveAs) {
      const result = await dialog.showSaveDialog({ defaultPath: "Mi proyecto.playstudio", filters: [{ name: "Proyecto Play Studio", extensions: ["playstudio"] }] });
      if (result.canceled || !result.filePath) return false;
      targetPath = result.filePath.toLowerCase().endsWith(".playstudio") ? result.filePath : result.filePath + ".playstudio";
    }
    const fs = await import("node:fs/promises");
    const temporaryPath = targetPath + "." + crypto.randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporaryPath, data, "utf8");
      await fs.rename(temporaryPath, targetPath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    currentProjectPath = targetPath;
    return true;
  });
  ipcMain.handle("project:reset-path", () => { currentProjectPath = null; return true; });
  ipcMain.handle("project:accept-load", () => { if (pendingProjectPath) currentProjectPath = pendingProjectPath; pendingProjectPath = null; return true; });
  ipcMain.handle("project:load", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Proyecto Play Studio", extensions: ["playstudio"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const data = await readFile(result.filePaths[0], "utf8");
    pendingProjectPath = result.filePaths[0];
    return data;
  });
  ipcMain.handle("export:cancel", () => {
    exportCanceled = true;
    if (exportProcess) exportProcess.kill();
    return true;
  });
  ipcMain.handle("export:render", async (event, request: { clips: ExportClip[]; resolution?: string; fps?: number }) => {
    if (exportProcess) throw new Error("Ya hay una exportación en curso.");
    if (!request || typeof request !== "object") throw new Error("La solicitud de exportación no es válida.");
    exportCanceled = false;
    const clips = Array.isArray(request.clips) ? request.clips : [];
    const ffmpegExecutable = ffmpegPath;
    if (!ffmpegExecutable) throw new Error("No se encontró el motor FFmpeg incluido.");
    const executable = app.isPackaged ? ffmpegExecutable.replace("app.asar", "app.asar.unpacked") : ffmpegExecutable;
    if (!Array.isArray(clips) || clips.length === 0) throw new Error("Agrega al menos un clip a la línea de tiempo.");
    const safeClips: ExportClip[] = [];
    for (const clip of clips) {
      if (!clip || typeof clip.path !== "string" || !clip.path.trim() || (clip.kind !== "video" && clip.kind !== "audio") || !Number.isFinite(clip.start) || !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.start < 0 || clip.sourceStart < 0) continue;
      try {
        const fileInfo = await stat(clip.path);
        if (!fileInfo.isFile()) throw new Error("La ruta no corresponde a un archivo.");
      } catch {
        const missingName = clip.path.split(/[\\/]/).pop() ?? clip.path;
        throw new Error("No se encuentra el archivo de medio: " + missingName + ". Vuelve a importarlo desde su ubicación original.");
      }
      safeClips.push({
        ...clip,
        trackOrder: boundedNumber(clip.trackOrder, 0, 0, 1000),
        volume: boundedNumber(clip.volume, 1, 0, 2),
        fadeIn: boundedNumber(clip.fadeIn, 0, 0, clip.duration),
        fadeOut: boundedNumber(clip.fadeOut, 0, 0, clip.duration),
        brightness: boundedNumber(clip.brightness, 0, -0.5, 0.5),
        contrast: boundedNumber(clip.contrast, 1, 0.5, 2),
        saturation: boundedNumber(clip.saturation, 1, 0, 2),
        title: typeof clip.title === "string" ? clip.title.slice(0, 120) : "",
        titleSize: boundedNumber(clip.titleSize, 48, 12, 160),
        titlePosition: ["top", "center", "bottom"].includes(clip.titlePosition ?? "bottom") ? (clip.titlePosition ?? "bottom") : "bottom"
      });
    }
    if (!safeClips.length) throw new Error("No hay clips válidos para exportar.");
    const totalDuration = Math.max(...safeClips.map(c => c.start + c.duration));
    if (exportCanceled) { exportCanceled = false; return { canceled: true }; }
    const target = await dialog.showSaveDialog({ defaultPath: "Video terminado.mp4", filters: [{ name: "Video MP4", extensions: ["mp4"] }] });
    if (target.canceled || !target.filePath || exportCanceled) { exportCanceled = false; return { canceled: true }; }
    const outputPath = target.filePath.toLowerCase().endsWith(".mp4") ? target.filePath : target.filePath + ".mp4";
    const videos = safeClips.filter(c => c.kind === "video").sort((a,b)=>(a.trackOrder??0)-(b.trackOrder??0)||a.start-b.start);
    const separateAudios = safeClips.filter(c => c.kind === "audio");
    const videoAudioFlags = await Promise.all(videos.map(clip => new Promise<boolean>(resolve => {
      const probe = spawn(executable, ["-hide_banner", "-i", clip.path], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let probeText = "";
      probe.stderr.on("data", chunk => { probeText += chunk.toString(); });
      probe.on("error", () => resolve(false));
      probe.on("close", () => resolve(/Stream #\d+:\d+.*Audio:/s.test(probeText)));
    })));
    if (exportCanceled) { exportCanceled = false; return { canceled: true }; }
    const audioSources = [...separateAudios, ...videos.filter((_clip, index) => videoAudioFlags[index])];
    const dimensions:Record<string,[number,number]> = {"720p":[1280,720],"1080p":[1920,1080],"4k":[3840,2160]};
    const [width,height] = dimensions[request.resolution ?? "1080p"] ?? dimensions["1080p"];
    const fps = [24,30,60].includes(request.fps ?? 30) ? (request.fps ?? 30) : 30;
    const args: string[] = ["-y"];
    safeClips.forEach(c => args.push("-i", c.path));
    const filters: string[] = [];
    filters.push("color=c=black:s="+width+"x"+height+":r="+fps+":d=" + totalDuration.toFixed(3) + "[base0]");
    let base = "base0";
    videos.forEach((clip, index) => {
      const inputIndex = safeClips.indexOf(clip);
      const label = "v" + index;
      const next = "base" + (index + 1);
      const videoFilters = ["trim=start="+clip.sourceStart.toFixed(3)+":duration="+clip.duration.toFixed(3),"setpts=PTS-STARTPTS","scale="+width+":"+height+":force_original_aspect_ratio=decrease","pad="+width+":"+height+":(ow-iw)/2:(oh-ih)/2","setsar=1","fps="+fps,"format=rgba","eq=brightness="+Math.max(-1,Math.min(1,clip.brightness??0)).toFixed(2)+":contrast="+Math.max(0,Math.min(3,clip.contrast??1)).toFixed(2)+":saturation="+Math.max(0,Math.min(3,clip.saturation??1)).toFixed(2)];
      const fadeIn=Math.max(0,Math.min(clip.duration,clip.fadeIn??0));
      const fadeOut=Math.max(0,Math.min(clip.duration,clip.fadeOut??0));
      if(fadeIn>0)videoFilters.push("fade=t=in:st=0:d="+fadeIn.toFixed(3)+":alpha=1");
      if(fadeOut>0)videoFilters.push("fade=t=out:st="+Math.max(0,clip.duration-fadeOut).toFixed(3)+":d="+fadeOut.toFixed(3)+":alpha=1");
      if(clip.title?.trim()){
        const y=clip.titlePosition==="top"?"60":clip.titlePosition==="center"?"(h-text_h)/2":"h-text_h-60";
        const title=escapeFilterText(clip.title.trim());
        const size=Math.max(12,Math.min(160,clip.titleSize??48));
        videoFilters.push("drawtext=fontfile='C:/Windows/Fonts/segoeui.ttf':text='"+title+"':fontcolor=white:fontsize="+size+":x=(w-text_w)/2:y="+y+":box=1:boxcolor=black@0.45:boxborderw=12");
      }
      videoFilters.push("setpts=PTS+"+clip.start.toFixed(3)+"/TB");
      filters.push("["+inputIndex+":v:0]"+videoFilters.join(",")+"["+label+"]");
      filters.push("[" + base + "][" + label + "]overlay=eof_action=pass:enable='between(t," + clip.start.toFixed(3) + "," + (clip.start + clip.duration).toFixed(3) + ")'[" + next + "]");
      base = next;
    });
    filters.push("[" + base + "]format=yuv420p[vout]");
    if (audioSources.length) {
      audioSources.forEach((clip, index) => {
        const inputIndex = safeClips.indexOf(clip);
        const delay = Math.max(0, Math.round(clip.start * 1000));
        const audioFilters=["atrim=start="+clip.sourceStart.toFixed(3)+":duration="+clip.duration.toFixed(3),"asetpts=PTS-STARTPTS","volume="+Math.max(0,Math.min(2,clip.volume??1)).toFixed(2)];
        const fadeIn=Math.max(0,Math.min(clip.duration,clip.fadeIn??0));
        const fadeOut=Math.max(0,Math.min(clip.duration,clip.fadeOut??0));
        if(fadeIn>0)audioFilters.push("afade=t=in:st=0:d="+fadeIn.toFixed(3));
        if(fadeOut>0)audioFilters.push("afade=t=out:st="+Math.max(0,clip.duration-fadeOut).toFixed(3)+":d="+fadeOut.toFixed(3));
        audioFilters.push("adelay="+delay+"|"+delay);
        filters.push("["+inputIndex+":a:0]"+audioFilters.join(",")+"[a"+index+"]");
      });
      filters.push(audioSources.map((_,i)=>"[a"+i+"]").join("") + "amix=inputs=" + audioSources.length + ":duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=50,atrim=duration=" + totalDuration.toFixed(3) + "[aout]");
    } else {
      filters.push("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=" + totalDuration.toFixed(3) + "[aout]");
    }
    args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", totalDuration.toFixed(3), "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outputPath);
    return await new Promise((resolve, reject) => {
      if (exportCanceled) { exportCanceled = false; resolve({ canceled: true }); return; }
      const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      exportProcess = child;
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
      child.on("error", error => {
        exportProcess = null;
        reject(error);
      });
      child.on("close", code => {
        exportProcess = null;
        if (exportCanceled) {
          exportCanceled = false;
          void unlink(outputPath).catch(() => {});
          resolve({ canceled: true });
        } else if (code === 0) {
          event.sender.send("export:progress", 100);
          resolve({ canceled: false, path: outputPath });
        } else reject(new Error("FFmpeg no pudo completar la exportación. " + errorText.slice(-1800)));
      });
    });
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
