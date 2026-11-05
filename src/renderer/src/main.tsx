import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MediaItem, ExportClip, ExportRequest } from "../../preload";
import "./style.css";

type Track = { id: string; name: string; kind: "video" | "audio" };
type Clip = MediaItem & { waveform?: number[]; thumbnail?: string; start: number; duration: number; sourceStart: number; sourceDuration: number; track: string; volume: number; fadeIn: number; fadeOut: number; brightness: number; contrast: number; saturation: number; title: string; titleSize: number; titlePosition: "top" | "center" | "bottom" };
type DragState = { id: string; mode: "move" | "left" | "right"; x: number; clip: Clip };
declare global {
  interface Window {
    playStudio: {
      openMedia: () => Promise<MediaItem[]>;
      relinkMedia: (kind: "video" | "audio") => Promise<MediaItem | null>;
      getWaveform: (filePath: string, duration: number) => Promise<number[]>;
      getThumbnail: (filePath: string, timestamp: number) => Promise<string | null>;
      getMediaDuration: (filePath: string) => Promise<number>;
      saveProject: (data: string, saveAs?: boolean) => Promise<boolean>;
      resetProjectPath: () => Promise<boolean>;
      acceptLoadedProject: () => Promise<boolean>;
      loadProject: () => Promise<string | null>;
      exportVideo: (request: ExportRequest) => Promise<{ canceled: boolean; path?: string }>;
      cancelExport: () => Promise<boolean>;
      onExportProgress: (callback: (progress: number) => void) => () => void;
    };
  }
}
const makeMediaUrl = (path: string) => "media://local/" + btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const readDuration = async (item: MediaItem): Promise<number> => {
  const browserDuration = await new Promise<number>(resolve => {
    const element = document.createElement(item.kind === "audio" ? "audio" : "video");
    let settled = false;
    const finish = (duration: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(0), 8000);
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0);
    element.onerror = () => finish(0);
    element.src = item.url;
  });
  if (browserDuration > 0) return browserDuration;
  return await window.playStudio.getMediaDuration(item.path).catch(() => 0);
};
const fadeGain = (clip: Clip, elapsed: number) => {
  const fadeInGain = clip.fadeIn > 0 ? elapsed / clip.fadeIn : 1;
  const remaining = clip.duration - elapsed;
  const fadeOutGain = clip.fadeOut > 0 ? remaining / clip.fadeOut : 1;
  return Math.max(0, Math.min(1, fadeInGain, fadeOutGain));
};
async function mapInBatches<T, R>(items: T[], batchSize: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = await Promise.all(items.slice(index, index + batchSize).map(mapper));
    results.push(...batch);
  }
  return results;
}
const makeProjectKey = (name: string, tracks: Track[], clips: Clip[]) => JSON.stringify({name,tracks,clips:clips.map(({url,thumbnail,...clip})=>clip)});
function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [undoStack, setUndoStack] = useState<Clip[][]>([]);
  const [redoStack, setRedoStack] = useState<Clip[][]>([]);
  const [tracks, setTracks] = useState<Track[]>([{id:"video-1",name:"VIDEO 1",kind:"video"},{id:"audio-1",name:"AUDIO 1",kind:"audio"}]);
  const [selected, setSelected] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<Record<string,string>>({});
  const [exportProgress, setExportProgress] = useState(0);
  const [resolution,setResolution] = useState<"720p"|"1080p"|"4k">("1080p");
  const [fps,setFps] = useState<24|30|60>(30);
  const [projectName, setProjectName] = useState("Proyecto sin título");
  const videoRefs = useRef<Record<string,HTMLVideoElement|null>>({});
  const audioRefs = useRef<Record<string,HTMLAudioElement|null>>({});
  const playbackFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef(0);
  const active = clips.find(c => c.id === selected);
  const contentDuration = Math.max(0, ...clips.map(c => c.start + c.duration));
  const projectContentKey = makeProjectKey(projectName,tracks,clips);
  const savedProjectKeyRef = useRef(projectContentKey);
  const isDirty = projectContentKey !== savedProjectKeyRef.current;
  const duration = Math.max(30, contentDuration);
  const pixelsPerSecond = 48 * zoom;
  const previewClips = clips.filter(c => c.kind === "video" && playhead >= c.start && playhead < c.start + c.duration).sort((a,b)=>tracks.findIndex(t=>t.id===a.track)-tracks.findIndex(t=>t.id===b.track)||a.start-b.start);
  const previewLayers = previewClips.length ? previewClips : (!playing && active?.kind === "video" ? [active] : []);
  const previewLayerKey = previewLayers.map(c=>c.id).join("|");
  const previewClip = previewLayers[previewLayers.length-1];
  const selectedTrack = tracks.find(t => t.id === active?.track);
  const commitClips = (update: Clip[] | ((old:Clip[])=>Clip[])) => {
    const next = typeof update === "function" ? update(clips) : update;
    setUndoStack(old=>[...old,clips].slice(-60));setRedoStack([]);setClips(next);
  };
  const undo = () => {
    if(!undoStack.length)return;
    setRedoStack(old=>[...old,clips]);setClips(undoStack[undoStack.length-1]);setUndoStack(old=>old.slice(0,-1));
  };
  const redo = () => {
    if(!redoStack.length)return;
    setUndoStack(old=>[...old,clips]);setClips(redoStack[redoStack.length-1]);setRedoStack(old=>old.slice(0,-1));
  };

  const addMedia = async () => {
    try {
      const items = await window.playStudio.openMedia();
      if (!items.length) return;
      setImporting(true);
      try {
        const prepared = await mapInBatches(items,2,async item => {
          const mediaDuration=await readDuration(item);
          const [waveform,thumbnail]=await Promise.all([
            item.kind==="audio"&&mediaDuration>0?window.playStudio.getWaveform(item.path,mediaDuration).catch(()=>[]):Promise.resolve(undefined),
            item.kind==="video"&&mediaDuration>0?window.playStudio.getThumbnail(item.path,Math.min(1,mediaDuration/2)).catch(()=>null):Promise.resolve(null)
          ]);
          return {...item,mediaDuration,waveform,thumbnail:thumbnail??undefined};
        });
        const valid = prepared.filter(item => item.mediaDuration > 0);
        const invalid = prepared.filter(item => item.mediaDuration <= 0);
        if(invalid.length)alert("No se pudo leer la duración de estos archivos y no se añadieron:\\n"+invalid.map(item=>item.name).join("\\n")+"\\nComprueba que el archivo no esté dañado y que Windows pueda reproducirlo.");
        if(!valid.length)return;
        commitClips(old => {
          const next = [...old];
          const cursors: Record<"video"|"audio",number> = {
            video: Math.max(0, ...next.filter(c=>c.kind==="video").map(c=>c.start+c.duration)),
            audio: Math.max(0, ...next.filter(c=>c.kind==="audio").map(c=>c.start+c.duration))
          };
          for (const item of valid) {
            const track = tracks.find(t => t.kind === item.kind) ?? tracks[0];
            const {mediaDuration, ...media} = item;
            const clip: Clip = {...media, start: cursors[item.kind], duration: mediaDuration, sourceStart: 0, sourceDuration: mediaDuration, track: track.id, volume: 1, fadeIn:0, fadeOut:0, brightness:0, contrast:1, saturation:1, title:"", titleSize:48, titlePosition:"bottom"};
            next.push(clip);
            cursors[item.kind] += item.mediaDuration;
          }
          return next;
        });
      } finally {
        setImporting(false);
      }
    } catch(error) {
      setImporting(false);
      alert(error instanceof Error?"No se pudieron importar los medios: "+error.message:"No se pudieron importar los medios.");
    }
  };
  const relinkSelected = async () => {
    if(!active)return;
    try{
      const replacement=await window.playStudio.relinkMedia(active.kind);
      if(!replacement)return;
      const mediaDuration=await readDuration(replacement);
      if(!Number.isFinite(mediaDuration)||mediaDuration<=0.1){
        alert("No se pudo leer la duración del archivo seleccionado.");
        return;
      }
      const [waveform,thumbnail]=await Promise.all([
        active.kind==="audio"?window.playStudio.getWaveform(replacement.path,mediaDuration).catch(()=>[]):Promise.resolve(undefined),
        active.kind==="video"?window.playStudio.getThumbnail(replacement.path,Math.min(1,mediaDuration/2)).catch(()=>null):Promise.resolve(null)
      ]);
      setPreviewErrors(old=>{if(!old[active.id])return old;const next={...old};delete next[active.id];return next;});
      commitClips(old=>old.map(clip=>{
        if(clip.id!==active.id)return clip;
        const sourceStart=Math.min(clip.sourceStart,mediaDuration-0.1);
        return {...clip,name:replacement.name,path:replacement.path,url:replacement.url,size:replacement.size,sourceDuration:mediaDuration,sourceStart,duration:Math.max(0.1,Math.min(clip.duration,mediaDuration-sourceStart)),waveform,thumbnail:thumbnail??undefined};
      }));
    }catch(error){alert(error instanceof Error?"No se pudo reemplazar el medio: "+error.message:"No se pudo reemplazar el medio.");}
  };
  const split = () => {
    if (!active || playhead <= active.start + 0.02 || playhead >= active.start + active.duration - 0.02) return;
    const leftDuration = playhead - active.start;
    const rightDuration = active.duration - leftDuration;
    commitClips(old => old.flatMap(c => c.id !== active.id ? [c] : [
      {...c, duration:leftDuration},
      {...c, id:crypto.randomUUID(), name:c.name+" (parte 2)", start:playhead, sourceStart:c.sourceStart+leftDuration, duration:rightDuration}
    ]));
  };
  const remove = () => { if (selected) { commitClips(old=>old.filter(c=>c.id!==selected)); setSelected(null); } };
  const copy = () => { if (active) setClipboard({...active}); };
  const paste = () => { if (clipboard) { const clone={...clipboard,id:crypto.randomUUID(),start:playhead}; commitClips(old=>[...old,clone]);setSelected(clone.id); } };
  const cut = () => { if (active) { setClipboard({...active});remove(); } };
  const addTrack = (kind:"video"|"audio") => {
    const count=tracks.filter(t=>t.kind===kind).length+1;
    setTracks(old=>[...old,{id:crypto.randomUUID(),name:(kind==="video"?"VIDEO ":"AUDIO ")+count,kind}]);
  };
  const renameTrack = (track:Track) => {
    const name=window.prompt("Nuevo nombre para la pista:",track.name);
    if(name===null)return;
    const cleanName=name.trim().slice(0,32);
    if(!cleanName){alert("El nombre de la pista no puede estar vacío.");return;}
    setTracks(old=>old.map(item=>item.id===track.id?{...item,name:cleanName}:item));
  };
  const moveTrack = (index:number,direction:-1|1) => {
    const target=index+direction;
    if(target<0||target>=tracks.length)return;
    setTracks(old=>{const next=[...old];[next[index],next[target]]=[next[target],next[index]];return next;});
  };
  const deleteTrack = (track:Track) => {
    if(clips.some(clip=>clip.track===track.id)){alert("La pista contiene clips. Mueve o elimina esos clips antes de borrar la pista.");return;}
    if(tracks.filter(item=>item.kind===track.kind).length<=1){alert("Debe quedar al menos una pista de "+(track.kind==="video"?"video":"audio")+".");return;}
    if(!window.confirm("¿Eliminar la pista vacía \""+track.name+"\"?"))return;
    setTracks(old=>old.filter(item=>item.id!==track.id));
  };
  const save = async (saveAs = false) => {
    try{
      const data={version:2,name:projectName,tracks,clips:clips.map(({url,thumbnail,...c})=>c),playhead};
      const saved=await window.playStudio.saveProject(JSON.stringify(data,null,2),saveAs);
      if(!saved)return;
      savedProjectKeyRef.current=makeProjectKey(projectName,tracks,clips);
    }catch(error){alert(error instanceof Error?"No se pudo guardar el proyecto: "+error.message:"No se pudo guardar el proyecto.");}
  };
  const load = async () => {
    if(isDirty&&!window.confirm("Abrir otro proyecto y descartar los cambios actuales? Guarda primero si los necesitas."))return;
    let data:string|null;
    try{data=await window.playStudio.loadProject();}
    catch(error){alert(error instanceof Error?"No se pudo abrir el proyecto: "+error.message:"No se pudo abrir el proyecto.");return;}
    if(!data)return;
    setImporting(true);
    try {
      const p=JSON.parse(data);
      const importedProjectName=typeof p.name==="string"&&p.name.trim()?p.name:"Proyecto importado";
      const defaultTracks:Track[]=[{id:"video-1",name:"VIDEO 1",kind:"video"},{id:"audio-1",name:"AUDIO 1",kind:"audio"}];
      const loadedTracks=Array.isArray(p.tracks)?p.tracks.filter((t:any,index:number,all:any[])=>t&&typeof t.id==="string"&&typeof t.name==="string"&&(t.kind==="video"||t.kind==="audio")&&all.findIndex(other=>other?.id===t.id)===index) as Track[]:[];
      const normalizedTracks=loadedTracks.length?[...loadedTracks]:[...defaultTracks];
      for(const kind of ["video","audio"] as const)if(!normalizedTracks.some(t=>t.kind===kind))normalizedTracks.push({id:kind+"-1",name:(kind==="video"?"VIDEO ":"AUDIO ")+ "1",kind});
      const rawClips=Array.isArray(p.clips)?p.clips:[];
      const validClips=rawClips.filter((clip:any,index:number,all:any[])=>clip&&typeof clip.id==="string"&&typeof clip.name==="string"&&typeof clip.path==="string"&&clip.path.trim().length>0&&(clip.kind==="video"||clip.kind==="audio")&&Number.isFinite(clip.start)&&clip.start>=0&&Number.isFinite(clip.duration)&&clip.duration>0&&Number.isFinite(clip.sourceStart)&&clip.sourceStart>=0&&all.findIndex(other=>other?.id===clip.id)===index);
      if(validClips.length!==rawClips.length)alert("Se omitieron clips dañados o incompletos al abrir el proyecto.");
      const normalizedClips=await mapInBatches(validClips,2,async (clip:any)=>{
        const sourceDuration=Math.max(0.1,Number.isFinite(clip.sourceDuration)&&clip.sourceDuration>0?clip.sourceDuration:clip.sourceStart+clip.duration);
        const sourceStart=Math.max(0,Math.min(sourceDuration-0.1,clip.sourceStart));
        const clipDuration=Math.max(0.1,Math.min(clip.duration,sourceDuration-sourceStart));
        const fallbackTrack=normalizedTracks.find(t=>t.kind===clip.kind)?.id??normalizedTracks[0].id;
        const track=normalizedTracks.some(t=>t.id===clip.track&&t.kind===clip.kind)?clip.track:fallbackTrack;
        const savedWaveform=Array.isArray(clip.waveform)?clip.waveform.filter((peak:any)=>Number.isFinite(peak)).slice(0,180).map((peak:number)=>Math.max(0,Math.min(1,peak))):[];
        const [waveform,thumbnail]=await Promise.all([
          clip.kind==="audio"?(savedWaveform.length?Promise.resolve(savedWaveform):window.playStudio.getWaveform(clip.path,sourceDuration).catch(()=>[])):Promise.resolve(undefined),
          clip.kind==="video"?window.playStudio.getThumbnail(clip.path,Math.min(1,sourceDuration/2)).catch(()=>null):Promise.resolve(null)
        ]);
        return {...clip,track,sourceDuration,sourceStart,duration:clipDuration,waveform,thumbnail:thumbnail??undefined,volume:Number.isFinite(clip.volume)?Math.max(0,Math.min(2,clip.volume)):1,fadeIn:Number.isFinite(clip.fadeIn)?Math.max(0,Math.min(clipDuration,clip.fadeIn)):0,fadeOut:Number.isFinite(clip.fadeOut)?Math.max(0,Math.min(clipDuration,clip.fadeOut)):0,brightness:Number.isFinite(clip.brightness)?Math.max(-0.5,Math.min(0.5,clip.brightness)):0,contrast:Number.isFinite(clip.contrast)?Math.max(0.5,Math.min(2,clip.contrast)):1,saturation:Number.isFinite(clip.saturation)?Math.max(0,Math.min(2,clip.saturation)):1,title:typeof clip.title==="string"?clip.title:"",titleSize:Number.isFinite(clip.titleSize)?Math.max(12,Math.min(160,clip.titleSize)):48,titlePosition:["top","center","bottom"].includes(clip.titlePosition)?clip.titlePosition:"bottom",url:makeMediaUrl(clip.path)} as Clip;
      });
      setProjectName(importedProjectName);
      setTracks(normalizedTracks);
      setClips(normalizedClips);
      setPreviewErrors({});
      savedProjectKeyRef.current=makeProjectKey(importedProjectName,normalizedTracks,normalizedClips);
      setPlayhead(Number.isFinite(p.playhead)?Math.max(0,p.playhead):0);setSelected(null);setPlaying(false);setUndoStack([]);setRedoStack([]);
      await window.playStudio.acceptLoadedProject();
    } catch { alert("El archivo de proyecto no es válido."); }
    finally { setImporting(false); }
  };
  const newProject = () => {
    if(isDirty&&!window.confirm("¿Crear un proyecto nuevo? Se perderán los cambios que no hayas guardado."))return;
    void window.playStudio.resetProjectPath();
    const defaultTracks:Track[]=[{id:"video-1",name:"VIDEO 1",kind:"video"},{id:"audio-1",name:"AUDIO 1",kind:"audio"}];
    savedProjectKeyRef.current=makeProjectKey("Proyecto sin título",defaultTracks,[]);
    setPreviewErrors({});
    setProjectName("Proyecto sin título");
    setTracks(defaultTracks);
    setClips([]);setSelected(null);setClipboard(null);setPlayhead(0);setPlaying(false);setUndoStack([]);setRedoStack([]);
  };
  const exportVideo = async () => {
    if(!clips.some(c=>c.kind==="video")) { alert("Agrega al menos un video a la línea de tiempo antes de exportar.");return; }
    setExporting(true);setExportProgress(0);
    const stop=window.playStudio.onExportProgress(setExportProgress);
    try {
      const payload:ExportClip[]=clips.map(c=>({path:c.path,kind:c.kind,start:c.start,sourceStart:c.sourceStart,duration:c.duration,trackOrder:tracks.findIndex(t=>t.id===c.track),volume:c.volume,fadeIn:c.fadeIn,fadeOut:c.fadeOut,brightness:c.brightness,contrast:c.contrast,saturation:c.saturation,title:c.title,titleSize:c.titleSize,titlePosition:c.titlePosition}));
      const request:ExportRequest={clips:payload,resolution,fps};
      const result=await window.playStudio.exportVideo(request);
      if(!result.canceled) alert("Exportación terminada.\n"+result.path);
    } catch(error) { alert(error instanceof Error?error.message:"No se pudo exportar el video."); }
    finally { stop();setExporting(false);setExportProgress(0); }
  };
  const fitTimeline = () => {
    const container=timelineScrollRef.current;
    if(!container)return;
    const availableWidth=Math.max(240,container.clientWidth-170);
    const totalSeconds=contentDuration>0?contentDuration:30;
    setZoom(Math.max(0.35,Math.min(4,availableWidth/(totalSeconds*48))));
    container.scrollLeft=0;
  };
  const time=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");};
  const togglePlayback=()=>{if(playing){setPlaying(false);return;}if(contentDuration<=0)return;if(playhead>=contentDuration)setPlayhead(0);setPlaying(true);};

  useEffect(()=>{
    const onMove=(event:PointerEvent)=>{
      const drag=dragRef.current;if(!drag)return;
      const delta=(event.clientX-drag.x)/pixelsPerSecond;
      const target= document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-track-id]") as HTMLElement|null;
      const targetTrack=target?.dataset.trackId;
      const allowedTrack=targetTrack&&tracks.some(t=>t.id===targetTrack&&t.kind===drag.clip.kind)?targetTrack:drag.clip.track;
      setClips(old=>{
        const others=old.filter(c=>c.id!==drag.id);
        let movedStart=Math.max(0,drag.clip.start+delta);
        if(drag.mode==="move"){
          const snapPoints=[playheadRef.current,...others.flatMap(c=>[c.start,c.start+c.duration])];
          let bestDifference=0;
          let bestDistance=8/pixelsPerSecond;
          for(const point of snapPoints){
            for(const edge of [movedStart,movedStart+drag.clip.duration]){
              const difference=point-edge;
              if(Math.abs(difference)<bestDistance){
                bestDifference=difference;
                bestDistance=Math.abs(difference);
              }
            }
          }
          movedStart=Math.max(0,movedStart+bestDifference);
        }
        return old.map(c=>{
          if(c.id!==drag.id)return c;
          if(drag.mode==="move")return {...c,start:movedStart,track:allowedTrack};
          if(drag.mode==="left"){
            const change=Math.min(drag.clip.duration-0.1,Math.max(-drag.clip.sourceStart,-drag.clip.start,delta));
            return {...c,start:Math.max(0,drag.clip.start+change),sourceStart:drag.clip.sourceStart+change,duration:drag.clip.duration-change};
          }
          const next=Math.max(0.1,drag.clip.duration+delta);
          return {...c,duration:Math.min(next,drag.clip.sourceDuration-drag.clip.sourceStart)};
        });
      });
    };
    const onUp=()=>{dragRef.current=null;};
    const onCancel=()=>{dragRef.current=null;};
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp);
    window.addEventListener("pointercancel",onCancel);
    window.addEventListener("blur",onCancel);
    return()=>{
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp);
      window.removeEventListener("pointercancel",onCancel);
      window.removeEventListener("blur",onCancel);
    };
  },[pixelsPerSecond,tracks]);

  useEffect(()=>{playheadRef.current=playhead;},[playhead]);

  useEffect(()=>{
    for(const clip of previewLayers){
      const video=videoRefs.current[clip.id];if(!video)continue;
      const elapsed=Math.min(clip.duration,Math.max(0,playhead-clip.start));
      video.volume=Math.min(1,Math.max(0,clip.volume*fadeGain(clip,elapsed)));
    }
  },[previewLayers,playhead]);

  useEffect(()=>{
    for(const clip of previewLayers){
      const video=videoRefs.current[clip.id];if(!video)continue;
      const wanted=clip.sourceStart+Math.min(clip.duration,Math.max(0,playhead-clip.start));
      const tolerance=playing?0.25:0.18;
      if(Math.abs(video.currentTime-wanted)>tolerance){try{video.currentTime=wanted;}catch{}}
    }
  },[previewLayers,playhead,playing]);

  useEffect(()=>{
    for(const clip of previewLayers){
      const video=videoRefs.current[clip.id];if(!video)continue;
      if(playing)void video.play().catch(()=>setPlaying(false));
      else video.pause();
    }
  },[playing,previewLayerKey]);

  useEffect(()=>{
    for(const clip of clips.filter(c=>c.kind==="audio")){
      const audio=audioRefs.current[clip.id];if(!audio)continue;
      const inRange=playing&&playhead>=clip.start&&playhead<clip.start+clip.duration;
      if(inRange){
        const wanted=clip.sourceStart+(playhead-clip.start);
        if(audio.paused||Math.abs(audio.currentTime-wanted)>0.3){try{audio.currentTime=wanted;}catch{}}
        const elapsed=playhead-clip.start;
        audio.volume=Math.min(1,Math.max(0,clip.volume*fadeGain(clip,elapsed)));
        if(audio.paused)void audio.play().catch(()=>{});
      }else audio.pause();
    }
  },[clips,playhead,playing]);

  useEffect(()=>{
    if(!playing)return;
    let previousTime=performance.now();
    const tick=(now:number)=>{
      const elapsed=Math.max(0,(now-previousTime)/1000);
      previousTime=now;
      const next=playheadRef.current+elapsed;
      if(next>=contentDuration){
        playheadRef.current=contentDuration;
        setPlayhead(contentDuration);
        setPlaying(false);
        return;
      }
      playheadRef.current=next;
      setPlayhead(next);
      playbackFrameRef.current=window.requestAnimationFrame(tick);
    };
    playbackFrameRef.current=window.requestAnimationFrame(tick);
    return()=>{
      if(playbackFrameRef.current!==null)window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current=null;
    };
  },[playing,contentDuration]);

  useEffect(()=>{
    if(!playing)return;
    const container=timelineScrollRef.current;
    if(!container)return;
    const playheadX=150+playhead*pixelsPerSecond;
    const visibleLeft=container.scrollLeft+170;
    const visibleRight=container.scrollLeft+container.clientWidth-100;
    if(playheadX<visibleLeft)container.scrollLeft=Math.max(0,playheadX-170);
    else if(playheadX>visibleRight)container.scrollLeft=Math.max(0,playheadX-container.clientWidth*0.75);
  },[playhead,playing,pixelsPerSecond]);

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(importing||exporting)return;
      const target=event.target as HTMLElement;if(["INPUT","TEXTAREA","SELECT","BUTTON"].includes(target?.tagName)||target?.isContentEditable)return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&key==="z"){event.preventDefault();redo();}
      else if((event.ctrlKey||event.metaKey)&&key==="z"){event.preventDefault();undo();}
      else if((event.ctrlKey||event.metaKey)&&key==="y"){event.preventDefault();redo();}
      else if((event.ctrlKey||event.metaKey)&&key==="n"){event.preventDefault();newProject();}
      else if((event.ctrlKey||event.metaKey)&&key==="o"){event.preventDefault();void load();}
      else if((event.ctrlKey||event.metaKey)&&event.shiftKey&&key==="s"){event.preventDefault();void save(true);}
      else if((event.ctrlKey||event.metaKey)&&key==="s"){event.preventDefault();void save();}
      else if((event.ctrlKey||event.metaKey)&&key==="0"){event.preventDefault();fitTimeline();}
      else if((event.ctrlKey||event.metaKey)&&key==="c"){event.preventDefault();copy();}
      else if((event.ctrlKey||event.metaKey)&&key==="v"){event.preventDefault();paste();}
      else if((event.ctrlKey||event.metaKey)&&key==="x"){event.preventDefault();cut();}
      else if(key==="delete"||key==="backspace"){remove();}
      else if(key===" "){event.preventDefault();togglePlayback();}
      else if(key==="arrowleft"){event.preventDefault();setPlayhead(v=>Math.max(0,v-1/fps));}
      else if(key==="arrowright"){event.preventDefault();setPlayhead(v=>Math.min(duration,v+1/fps));}
      else if(key==="home"){event.preventDefault();setPlayhead(0);setPlaying(false);}
      else if(key==="end"){event.preventDefault();setPlayhead(contentDuration);setPlaying(false);}
      else if(key==="s"&&!event.ctrlKey&&!event.metaKey){split();}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  });

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">P</span><div><b>PLAY STUDIO{isDirty?" •":""}</b><small>{isDirty?"CAMBIOS SIN GUARDAR":"EDITOR DE VIDEO"}</small></div></div>
      <nav><button onClick={newProject}>Nuevo proyecto</button><button onClick={load}>Abrir proyecto</button><button onClick={()=>void save()}>Guardar</button><button onClick={()=>void save(true)}>Guardar como</button><label className="export-setting">Resolución<select value={resolution} onChange={e=>setResolution(e.target.value as "720p"|"1080p"|"4k")}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option></select></label><label className="export-setting">FPS<select value={fps} onChange={e=>setFps(Number(e.target.value) as 24|30|60)}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></label><button className="export" onClick={exportVideo} disabled={exporting}>Exportar MP4</button></nav>
      <button className="assistant-toggle" onClick={()=>setAssistant(!assistant)}>✦ Asistente</button>
    </header>
    <div className="menubar"><span>Archivo</span><span>Editar</span><span>Ver</span><span>Clip</span><span>Ayuda</span><input className="project-name" value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Nombre del proyecto"/></div>
    <main className="workspace">
      <aside className="media-panel">
        <div className="panel-heading"><b>MEDIOS DEL PROYECTO</b><button className="plus" onClick={addMedia}>＋</button></div>
        <button className="add-media" onClick={addMedia}>＋ Añadir video o audio</button>
        <div className="media-list">{clips.map(c=><button key={c.id} className={"media-item "+(selected===c.id?"active":"")} onClick={()=>{setSelected(c.id);setPlayhead(c.start);setPlaying(false);}}><span className="media-thumb">{c.kind==="video"&&c.thumbnail?<img src={c.thumbnail} alt="" />:<span className="media-icon">{c.kind==="audio"?"♫":"▣"}</span>}</span><span>{c.name}</span></button>)}</div>
        <div className="panel-footer">Importa MP4, MOV, MKV, MP3, WAV y más formatos</div>
      </aside>
      <section className="preview-panel">
        <div className="panel-heading"><b>MONITOR DE PROGRAMA</b><span className="muted">{previewClip?.name??"VISTA PREVIA"}</span></div>
        <div className="preview-screen">{previewClip?<div className="preview-composite">{previewLayers.map(clip=><React.Fragment key={clip.id}><video ref={element=>{if(element)videoRefs.current[clip.id]=element;else delete videoRefs.current[clip.id];}} src={clip.url} style={{filter:`brightness(${100+clip.brightness*100}%) contrast(${clip.contrast*100}%) saturate(${clip.saturation*100}%)`,opacity:fadeGain(clip,Math.min(clip.duration,Math.max(0,playhead-clip.start))),zIndex:tracks.findIndex(t=>t.id===clip.track)+1}} controls={false} onError={()=>setPreviewErrors(old=>({...old,[clip.id]:"Este archivo usa un formato o códec que Chromium no puede reproducir en la vista previa."}))} onLoadedMetadata={e=>{setPreviewErrors(old=>{if(!old[clip.id])return old;const next={...old};delete next[clip.id];return next;});const wanted=clip.sourceStart+Math.min(clip.duration,Math.max(0,playhead-clip.start));e.currentTarget.currentTime=wanted;if(playing)void e.currentTarget.play().catch(()=>setPlaying(false));}} />{clip.title.trim()&&<div className={"preview-title "+clip.titlePosition} style={{fontSize:clip.titleSize+"px",zIndex:tracks.findIndex(t=>t.id===clip.track)+2}}>{clip.title}</div>}</React.Fragment>)}{previewLayers.some(layer=>previewErrors[layer.id])&&<div className="preview-error"><b>No se puede mostrar este video</b><span>{previewErrors[previewLayers.find(layer=>previewErrors[layer.id])!.id]}</span><small>Convierte el archivo a MP4 con video H.264 para editarlo en la vista previa. FFmpeg puede admitir más formatos al exportar.</small></div>}</div>:<div className="empty-preview"><div className="play-logo">▶</div><b>Vista previa</b><span>Agrega un video para comenzar a editar</span></div>}</div>
        <div className="transport"><button onClick={()=>{setPlayhead(0);setPlaying(false);}}>⏮</button><button className="play" onClick={togglePlayback}>{playing?"Ⅱ":"▶"}</button><button onClick={()=>{setPlayhead(contentDuration);setPlaying(false);}}>⏭</button><span>{time(playhead)} / {time(contentDuration)}</span></div>
      </section>
      <aside className="inspector">
        <div className="panel-heading"><b>PROPIEDADES</b></div>
        {active?<><div className="property-title">{active.name}</div><button className="relink-button" onClick={()=>void relinkSelected()}>Reemplazar / localizar archivo</button><label>Tipo <span>{active.kind==="video"?"Video":"Audio"}</span></label><label>Pista <span>{selectedTrack?.name??active.track}</span></label>
          <label>Inicio (s)<input type="number" min="0" step="0.1" value={active.start.toFixed(1)} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,start:Math.max(0,Number(e.target.value)||0)}:c))}/></label>
          <label>Duración (s)<input type="number" min="0.1" step="0.1" value={active.duration.toFixed(1)} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,duration:Math.max(.1,Math.min(active.sourceDuration-active.sourceStart,Number(e.target.value)||.1))}:c))}/></label>
          <label>Fundido entrada (s)<input type="number" min="0" step=".1" max={active.duration} value={active.fadeIn} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,fadeIn:Math.max(0,Math.min(active.duration,Number(e.target.value)||0))}:c))}/></label>
          <label>Fundido salida (s)<input type="number" min="0" step=".1" max={active.duration} value={active.fadeOut} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,fadeOut:Math.max(0,Math.min(active.duration,Number(e.target.value)||0))}:c))}/></label>
          {active.kind==="video"&&<>
            <label className="stacked-property">Texto en pantalla<input type="text" maxLength={120} value={active.title} placeholder="Escribe un título..." onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,title:e.target.value}:c))}/></label>
            <label>Posición del texto<select value={active.titlePosition} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,titlePosition:e.target.value as Clip["titlePosition"]}:c))}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
            <label>Tamaño del texto<input type="number" min="12" max="160" value={active.titleSize} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,titleSize:Math.max(12,Math.min(160,Number(e.target.value)||48))}:c))}/></label>
            <label className="volume-property">Brillo <input type="range" min="-.5" max=".5" step=".05" value={active.brightness} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,brightness:Number(e.target.value)}:c))}/><span>{active.brightness.toFixed(2)}</span></label>
            <label className="volume-property">Contraste <input type="range" min=".5" max="2" step=".05" value={active.contrast} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,contrast:Number(e.target.value)}:c))}/><span>{active.contrast.toFixed(2)}</span></label>
            <label className="volume-property">Saturación <input type="range" min="0" max="2" step=".05" value={active.saturation} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,saturation:Number(e.target.value)}:c))}/><span>{active.saturation.toFixed(2)}</span></label>
          </>}
          {<label className="volume-property">Volumen de clip <input type="range" min="0" max="2" step=".05" value={active.volume} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,volume:Number(e.target.value)}:c))}/><span>{Math.round(active.volume*100)}%</span></label>}
          <button className="danger-button" onClick={remove}>Eliminar clip</button>
        </>:<div className="inspector-empty">Selecciona un clip para ajustar sus propiedades.</div>}
      </aside>
    </main>
    <section className="timeline">
      <div className="timeline-toolbar"><div><b>LÍNEA DE TIEMPO</b><span className="muted"> · Imán: alinea clips con el cabezal y otros clips; arrastra bordes para recortar</span></div>
        <div className="tools"><button onClick={undo} disabled={!undoStack.length} title="Deshacer (Ctrl+Z)">↶</button><button onClick={redo} disabled={!redoStack.length} title="Rehacer (Ctrl+Y)">↷</button><button onClick={split} title="Dividir en el cabezal">✂ Dividir</button><button onClick={cut}>Cortar</button><button onClick={copy}>Copiar</button><button onClick={paste} disabled={!clipboard}>Pegar</button><button onClick={remove}>Eliminar</button><button onClick={()=>addTrack("video")}>＋ Video</button><button onClick={()=>addTrack("audio")}>＋ Audio</button><span className="separator"></span><button onClick={()=>setZoom(z=>Math.max(.35,z-.2))}>−</button><button onClick={()=>setZoom(z=>Math.min(4,z+.2))}>＋</button><button onClick={fitTimeline} title="Ajustar toda la edición">Ajustar</button></div>
      </div>
      <div className="timeline-scroll" ref={timelineScrollRef}>
        <div className="ruler"><div className="track-label"></div><div className="ruler-area" style={{width:duration*pixelsPerSecond,backgroundSize:pixelsPerSecond+"px 100%"}} onClick={e=>setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond))} onContextMenu={e=>{e.preventDefault();setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}}>{Array.from({length:Math.ceil(duration/5)+1},(_,i)=><span key={i} style={{left:i*5*pixelsPerSecond}}>{time(i*5)}</span>)}</div></div>
        {tracks.map((track,trackIndex)=><div className="track-row" key={track.id}>
          <div className="track-label" style={{display:"flex",alignItems:"center",gap:4,padding:"0 6px"}}>
            <span title={track.name} style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{track.name}</span>
            <button title="Renombrar pista" aria-label={"Renombrar "+track.name} onClick={()=>renameTrack(track)} style={{padding:"3px 4px",fontSize:11}}>✎</button>
            <button title="Subir pista" aria-label={"Subir "+track.name} disabled={trackIndex===0} onClick={()=>moveTrack(trackIndex,-1)} style={{padding:"3px 4px",fontSize:11}}>↑</button>
            <button title="Bajar pista" aria-label={"Bajar "+track.name} disabled={trackIndex===tracks.length-1} onClick={()=>moveTrack(trackIndex,1)} style={{padding:"3px 4px",fontSize:11}}>↓</button>
            <button title="Eliminar pista vacía" aria-label={"Eliminar "+track.name} disabled={clips.some(clip=>clip.track===track.id)||tracks.filter(item=>item.kind===track.kind).length<=1} onClick={()=>deleteTrack(track)} style={{padding:"3px 4px",fontSize:11,color:"#ff9da9"}}>×</button>
          </div>
          <div className="track-area" data-track-id={track.id} style={{width:duration*pixelsPerSecond,backgroundSize:pixelsPerSecond+"px 100%"}} onContextMenu={e=>{e.preventDefault();setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}} onClick={e=>{if(e.target===e.currentTarget)setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}}>
            {clips.filter(c=>c.track===track.id).map(c=>{
              const sourceWaveform=c.waveform??[];
              const waveStart=c.sourceDuration>0?Math.floor(c.sourceStart/c.sourceDuration*sourceWaveform.length):0;
              const waveEnd=c.sourceDuration>0?Math.ceil((c.sourceStart+c.duration)/c.sourceDuration*sourceWaveform.length):sourceWaveform.length;
              const visibleWaveform=sourceWaveform.slice(waveStart,Math.max(waveStart+1,waveEnd));
              return <div key={c.id} className={"clip "+track.kind+(selected===c.id?" selected":"")} style={{left:c.start*pixelsPerSecond,width:Math.max(32,c.duration*pixelsPerSecond)}} onClick={()=>setSelected(c.id)} onContextMenu={e=>{e.preventDefault();setSelected(c.id);setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond)+c.start);}}>
                {c.kind==="video"&&c.thumbnail&&<img className="timeline-clip-thumbnail" src={c.thumbnail} alt="" draggable={false}/>}<span className="trim-handle left" onPointerDown={e=>{e.stopPropagation();e.preventDefault();setSelected(c.id);setUndoStack(old=>[...old,clips].slice(-60));setRedoStack([]);dragRef.current={id:c.id,mode:"left",x:e.clientX,clip:{...c}};}}/>
                <b>{track.kind==="audio"?"♫":"▣"} {c.name}</b><small>{time(c.duration)}</small>
                {track.kind==="audio"&&visibleWaveform.length>0&&<div className="clip-waveform">{visibleWaveform.map((peak,index)=><i key={index} style={{height:Math.max(2,peak*100)+"%"}}/>)}</div>}
                <span className="trim-handle right" onPointerDown={e=>{e.stopPropagation();e.preventDefault();setSelected(c.id);setUndoStack(old=>[...old,clips].slice(-60));setRedoStack([]);dragRef.current={id:c.id,mode:"right",x:e.clientX,clip:{...c}};}}/>
                <span className="move-surface" onPointerDown={e=>{e.stopPropagation();setSelected(c.id);setUndoStack(old=>[...old,clips].slice(-60));setRedoStack([]);dragRef.current={id:c.id,mode:"move",x:e.clientX,clip:{...c}};}}/>
              </div>;
            })}
          </div>
        </div>)}
        <div className="playhead" style={{left:150+playhead*pixelsPerSecond}}><div className="playhead-cap"></div></div>
      </div>
      <div className="timeline-hint">Clic izquierdo: seleccionar · Clic derecho: mover el cabezal · Arrastrar clip: mover · Arrastrar bordes: recortar · Ctrl+C / Ctrl+V / Ctrl+X · Supr: eliminar</div>
    </section>
    <div className="audio-players" aria-hidden="true">{clips.filter(c=>c.kind==="audio").map(c=><audio key={c.id} ref={element=>{audioRefs.current[c.id]=element;}} src={c.url} preload="auto"/>)}</div>
    {importing&&<div className="import-overlay"><div className="import-box"><b>Preparando medios…</b><span>Analizando archivos y generando formas de onda</span></div></div>}
    {exporting&&<div className="export-overlay"><div className="export-box"><b>Exportando video MP4</b><div className="progress-track"><span style={{width:exportProgress+"%"}}/></div><span>{exportProgress}% · No cierres Play Studio</span><button className="cancel-export" onClick={()=>void window.playStudio.cancelExport()}>Cancelar exportación</button></div></div>}
    {assistant&&<div className="assistant"><div className="assistant-head">✦ Asistente de Play Studio <button onClick={()=>setAssistant(false)}>×</button></div><p>Asistente de ayuda para las herramientas del editor. No aplica efectos ni modifica contenido con IA.</p><input value={assistantText} onChange={e=>setAssistantText(e.target.value)} placeholder="¿Cómo puedo dividir un clip?"/><button onClick={()=>setAssistantText("Selecciona el clip, coloca el cabezal donde quieras cortar y pulsa Dividir. También puedes usar la tecla S.")}>Cómo dividir un clip</button><button onClick={()=>setAssistantText("Arrastra el centro del clip para moverlo. Arrastra cualquiera de sus bordes para recortar su inicio o final.")}>Cómo mover o recortar</button><small>Ayuda local · Sin edición con IA</small></div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
