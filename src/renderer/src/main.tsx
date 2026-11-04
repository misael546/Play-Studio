import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MediaItem, ExportClip } from "../../preload";
import "./style.css";

type Track = { id: string; name: string; kind: "video" | "audio" };
type Clip = MediaItem & { start: number; duration: number; sourceStart: number; sourceDuration: number; track: string; volume: number };
type DragState = { id: string; mode: "move" | "left" | "right"; x: number; clip: Clip };
declare global {
  interface Window {
    playStudio: {
      openMedia: () => Promise<MediaItem[]>;
      saveProject: (data: string) => Promise<boolean>;
      loadProject: () => Promise<string | null>;
      exportVideo: (clips: ExportClip[]) => Promise<{ canceled: boolean; path?: string }>;
      onExportProgress: (callback: (progress: number) => void) => () => void;
    };
  }
}
const makeMediaUrl = (path: string) => "media://local/" + btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const readDuration = (item: MediaItem) => new Promise<number>(resolve => {
  const element = document.createElement(item.kind === "audio" ? "audio" : "video");
  element.preload = "metadata";
  element.onloadedmetadata = () => resolve(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 10);
  element.onerror = () => resolve(10);
  element.src = item.url;
});
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
  const [exportProgress, setExportProgress] = useState(0);
  const [projectName, setProjectName] = useState("Proyecto sin título");
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const active = clips.find(c => c.id === selected);
  const duration = Math.max(30, ...clips.map(c => c.start + c.duration));
  const pixelsPerSecond = 48 * zoom;
  const previewClip = clips.filter(c => c.kind === "video" && playhead >= c.start && playhead < c.start + c.duration).sort((a,b)=>b.start-a.start)[0] ?? (active?.kind === "video" ? active : undefined);
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
    const items = await window.playStudio.openMedia();
    if (!items.length) return;
    const prepared = await Promise.all(items.map(async item => ({...item, mediaDuration: await readDuration(item)})));
    commitClips(old => {
      const next = [...old];
      let cursor = Math.max(0, ...next.map(c => c.start + c.duration));
      for (const item of prepared) {
        const track = tracks.find(t => t.kind === item.kind) ?? tracks[0];
        const {mediaDuration, ...media} = item;
        const clip: Clip = {...media, start: cursor, duration: mediaDuration, sourceStart: 0, sourceDuration: mediaDuration, track: track.id, volume: 1};
        next.push(clip);
        cursor += item.mediaDuration;
      }
      return next;
    });
  };
  const split = () => {
    if (!active || playhead <= active.start + 0.02 || playhead >= active.start + active.duration - 0.02) return;
    const leftDuration = playhead - active.start;
    const rightDuration = active.duration - leftDuration;
    commitClips(old => old.flatMap(c => c.id !== active.id ? [c] : [
      {...c, duration:leftDuration, sourceDuration:leftDuration},
      {...c, id:crypto.randomUUID(), name:c.name+" (parte 2)", start:playhead, sourceStart:c.sourceStart+leftDuration, duration:rightDuration, sourceDuration:rightDuration}
    ]));
  };
  const remove = () => { if (selected) { commitClips(old=>old.filter(c=>c.id!==selected)); setSelected(null); } };
  const copy = () => { if (active) setClipboard({...active}); };
  const paste = () => { if (clipboard) { const clone={...clipboard,id:crypto.randomUUID(),start:playhead}; commitClips(old=>[...old,clone]);setSelected(clone.id); } };
  const cut = () => { if (active) { setClipboard({...active});remove(); } };
  const addTrack = (kind:"video"|"audio") => {
    const count=tracks.filter(t=>t.kind===kind).length+1;
    setTracks(old=>[...old,{id:kind+"-"+count,name:(kind==="video"?"VIDEO ":"AUDIO ")+count,kind}]);
  };
  const save = async () => {
    const data={version:2,name:projectName,tracks,clips:clips.map(({url,...c})=>c),playhead};
    await window.playStudio.saveProject(JSON.stringify(data,null,2));
  };
  const load = async () => {
    const data=await window.playStudio.loadProject();
    if(!data)return;
    try {
      const p=JSON.parse(data);
      setProjectName(p.name??"Proyecto importado");
      setTracks(p.tracks?.length?p.tracks:[{id:"video-1",name:"VIDEO 1",kind:"video"},{id:"audio-1",name:"AUDIO 1",kind:"audio"}]);
      setClips((p.clips??[]).map((clip:Omit<Clip,"url">)=>({...clip,url:makeMediaUrl(clip.path)})));
      setPlayhead(p.playhead??0);setSelected(null);setPlaying(false);setUndoStack([]);setRedoStack([]);
    } catch { alert("El archivo de proyecto no es válido."); }
  };
  const exportVideo = async () => {
    if(!clips.some(c=>c.kind==="video")) { alert("Agrega al menos un video a la línea de tiempo antes de exportar.");return; }
    setExporting(true);setExportProgress(0);
    const stop=window.playStudio.onExportProgress(setExportProgress);
    try {
      const payload:ExportClip[]=clips.map(c=>({path:c.path,kind:c.kind,start:c.start,sourceStart:c.sourceStart,duration:c.duration,volume:c.volume}));
      const result=await window.playStudio.exportVideo(payload);
      if(!result.canceled) alert("Exportación terminada.\n"+result.path);
    } catch(error) { alert(error instanceof Error?error.message:"No se pudo exportar el video."); }
    finally { stop();setExporting(false);setExportProgress(0); }
  };
  const time=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");};

  useEffect(()=>{
    const onMove=(event:PointerEvent)=>{
      const drag=dragRef.current;if(!drag)return;
      const delta=(event.clientX-drag.x)/pixelsPerSecond;
      const target= document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-track-id]") as HTMLElement|null;
      const targetTrack=target?.dataset.trackId;
      const allowedTrack=targetTrack&&tracks.some(t=>t.id===targetTrack&&t.kind===drag.clip.kind)?targetTrack:drag.clip.track;
      setClips(old=>old.map(c=>{
        if(c.id!==drag.id)return c;
        if(drag.mode==="move")return {...c,start:Math.max(0,drag.clip.start+delta),track:allowedTrack};
        if(drag.mode==="left"){
          const change=Math.min(drag.clip.duration-0.15,Math.max(-drag.clip.sourceStart,delta));
          return {...c,start:Math.max(0,drag.clip.start+change),sourceStart:drag.clip.sourceStart+change,duration:drag.clip.duration-change,sourceDuration:drag.clip.duration-change};
        }
        const next=Math.max(0.15,drag.clip.duration+delta);
        return {...c,duration:Math.min(next,drag.clip.sourceDuration)};
      }));
    };
    const onUp=()=>{dragRef.current=null;};
    window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);
    return()=>{window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);};
  },[pixelsPerSecond,tracks]);

  useEffect(()=>{
    const video=videoRef.current;if(!video||!previewClip||playing)return;
    const wanted=previewClip.sourceStart+Math.min(previewClip.duration,Math.max(0,playhead-previewClip.start));
    if(Math.abs(video.currentTime-wanted)>0.18) { try{video.currentTime=wanted;}catch{} }
  },[previewClip?.id,playhead,previewClip?.sourceStart,previewClip?.start,previewClip?.duration,playing]);

  useEffect(()=>{
    const video=videoRef.current;if(!video)return;
    if(playing&&previewClip)void video.play().catch(()=>setPlaying(false));
    else video.pause();
  },[playing,previewClip?.id]);

  useEffect(()=>{
    if(!playing)return;
    const timer=window.setInterval(()=>setPlayhead(old=>{
      const next=old+0.05;
      if(next>=duration){setPlaying(false);return duration;}
      return next;
    }),50);
    return()=>window.clearInterval(timer);
  },[playing,duration]);

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement)?.tagName==="INPUT")return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey)&&key==="z"){event.preventDefault();undo();}\n      else if((event.ctrlKey||event.metaKey)&&key==="y"){event.preventDefault();redo();}\n      else if((event.ctrlKey||event.metaKey)&&key==="s"){event.preventDefault();void save();}
      else if((event.ctrlKey||event.metaKey)&&key==="o"){event.preventDefault();void load();}
      else if((event.ctrlKey||event.metaKey)&&key==="c"){event.preventDefault();copy();}
      else if((event.ctrlKey||event.metaKey)&&key==="v"){event.preventDefault();paste();}
      else if((event.ctrlKey||event.metaKey)&&key==="x"){event.preventDefault();cut();}
      else if(key==="delete"||key==="backspace"){remove();}
      else if(key===" "){event.preventDefault();setPlaying(v=>!v);}
      else if(key==="s"&&!event.ctrlKey){split();}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  });

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">P</span><div><b>PLAY STUDIO</b><small>EDITOR DE VIDEO</small></div></div>
      <nav><button onClick={load}>Abrir proyecto</button><button onClick={save}>Guardar proyecto</button><button className="export" onClick={exportVideo} disabled={exporting}>Exportar MP4</button></nav>
      <button className="assistant-toggle" onClick={()=>setAssistant(!assistant)}>✦ Asistente</button>
    </header>
    <div className="menubar"><span>Archivo</span><span>Editar</span><span>Ver</span><span>Clip</span><span>Ayuda</span><input className="project-name" value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Nombre del proyecto"/></div>
    <main className="workspace">
      <aside className="media-panel">
        <div className="panel-heading"><b>MEDIOS DEL PROYECTO</b><button className="plus" onClick={addMedia}>＋</button></div>
        <button className="add-media" onClick={addMedia}>＋ Añadir video o audio</button>
        <div className="media-list">{clips.map(c=><button key={c.id} className={"media-item "+(selected===c.id?"active":"")} onClick={()=>setSelected(c.id)}><span className="media-icon">{c.kind==="audio"?"♫":"▣"}</span><span>{c.name}</span></button>)}</div>
        <div className="panel-footer">Importa MP4, MOV, MKV, MP3, WAV y más formatos</div>
      </aside>
      <section className="preview-panel">
        <div className="panel-heading"><b>MONITOR DE PROGRAMA</b><span className="muted">{previewClip?.name??"VISTA PREVIA"}</span></div>
        <div className="preview-screen">{previewClip?<video ref={videoRef} src={previewClip.url} controls={false} onLoadedMetadata={e=>{const wanted=previewClip.sourceStart+Math.min(previewClip.duration,Math.max(0,playhead-previewClip.start));e.currentTarget.currentTime=wanted;if(playing)void e.currentTarget.play().catch(()=>setPlaying(false));}} onTimeUpdate={e=>{if(playing)setPlayhead(previewClip.start+e.currentTarget.currentTime-previewClip.sourceStart);}} onEnded={()=>setPlaying(false)}/>:<div className="empty-preview"><div className="play-logo">▶</div><b>Vista previa</b><span>Agrega un video para comenzar a editar</span></div>}</div>
        <div className="transport"><button onClick={()=>{setPlayhead(0);setPlaying(false);}}>⏮</button><button className="play" onClick={()=>setPlaying(v=>!v)}>{playing?"Ⅱ":"▶"}</button><button onClick={()=>setPlayhead(duration)}>⏭</button><span>{time(playhead)} / {time(duration)}</span></div>
      </section>
      <aside className="inspector">
        <div className="panel-heading"><b>PROPIEDADES</b></div>
        {active?<><div className="property-title">{active.name}</div><label>Tipo <span>{active.kind==="video"?"Video":"Audio"}</span></label><label>Pista <span>{selectedTrack?.name??active.track}</span></label>
          <label>Inicio (s)<input type="number" min="0" step="0.1" value={active.start.toFixed(1)} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,start:Math.max(0,Number(e.target.value)||0)}:c))}/></label>
          <label>Duración (s)<input type="number" min="0.1" step="0.1" value={active.duration.toFixed(1)} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,duration:Math.max(.1,Math.min(active.sourceDuration,Number(e.target.value)||.1))}:c))}/></label>
          {active.kind==="audio"&&<label className="volume-property">Volumen <input type="range" min="0" max="2" step=".05" value={active.volume} onChange={e=>commitClips(old=>old.map(c=>c.id===active.id?{...c,volume:Number(e.target.value)}:c))}/><span>{Math.round(active.volume*100)}%</span></label>}
          <button className="danger-button" onClick={remove}>Eliminar clip</button>
        </>:<div className="inspector-empty">Selecciona un clip para ajustar sus propiedades.</div>}
      </aside>
    </main>
    <section className="timeline">
      <div className="timeline-toolbar"><div><b>LÍNEA DE TIEMPO</b><span className="muted"> · Arrastra clips para moverlos y sus bordes para recortarlos</span></div>
        <div className="tools"><button onClick={undo} disabled={!undoStack.length} title="Deshacer (Ctrl+Z)">↶</button><button onClick={redo} disabled={!redoStack.length} title="Rehacer (Ctrl+Y)">↷</button><button onClick={split} title="Dividir en el cabezal">✂ Dividir</button><button onClick={cut}>Cortar</button><button onClick={copy}>Copiar</button><button onClick={paste} disabled={!clipboard}>Pegar</button><button onClick={remove}>Eliminar</button><button onClick={()=>addTrack("video")}>＋ Video</button><button onClick={()=>addTrack("audio")}>＋ Audio</button><span className="separator"></span><button onClick={()=>setZoom(z=>Math.max(.35,z-.2))}>−</button><button onClick={()=>setZoom(z=>Math.min(4,z+.2))}>＋</button></div>
      </div>
      <div className="timeline-scroll">
        <div className="ruler"><div className="track-label"></div><div className="ruler-area" style={{width:duration*pixelsPerSecond}}>{Array.from({length:Math.ceil(duration/5)+1},(_,i)=><span key={i} style={{left:i*5*pixelsPerSecond}}>{time(i*5)}</span>)}</div></div>
        {tracks.map(track=><div className="track-row" key={track.id}>
          <div className="track-label">{track.name}</div>
          <div className="track-area" data-track-id={track.id} style={{width:duration*pixelsPerSecond}} onContextMenu={e=>{e.preventDefault();setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}} onClick={e=>{if(e.target===e.currentTarget)setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}}>
            {clips.filter(c=>c.track===track.id).map(c=><div key={c.id} className={"clip "+track.kind+(selected===c.id?" selected":"")} style={{left:c.start*pixelsPerSecond,width:Math.max(32,c.duration*pixelsPerSecond)}} onClick={()=>setSelected(c.id)} onContextMenu={e=>{e.preventDefault();setSelected(c.id);setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond)+c.start);}}>
              <span className="trim-handle left" onPointerDown={e=>{e.stopPropagation();e.preventDefault();setSelected(c.id);setUndoStack(old=>[...old,clips].slice(-60));setRedoStack([]);dragRef.current={id:c.id,mode:"left",x:e.clientX,clip:{...c}};}}/>
              <b>{track.kind==="audio"?"♫":"▣"} {c.name}</b><small>{time(c.duration)}</small>
              <span className="trim-handle right" onPointerDown={e=>{e.stopPropagation();e.preventDefault();setSelected(c.id);dragRef.current={id:c.id,mode:"right",x:e.clientX,clip:{...c}};}}/>
              <span className="move-surface" onPointerDown={e=>{e.stopPropagation();setSelected(c.id);dragRef.current={id:c.id,mode:"move",x:e.clientX,clip:{...c}};}}/>
            </div>)}
          </div>
        </div>)}
        <div className="playhead" style={{left:150+playhead*pixelsPerSecond}}><div className="playhead-cap"></div></div>
      </div>
      <div className="timeline-hint">Clic izquierdo: seleccionar · Clic derecho: mover el cabezal · Arrastrar clip: mover · Arrastrar bordes: recortar · Ctrl+C / Ctrl+V / Ctrl+X · Supr: eliminar</div>
    </section>
    {exporting&&<div className="export-overlay"><div className="export-box"><b>Exportando video MP4</b><div className="progress-track"><span style={{width:exportProgress+"%"}}/></div><span>{exportProgress}% · No cierres Play Studio</span></div></div>}
    {assistant&&<div className="assistant"><div className="assistant-head">✦ Asistente de Play Studio <button onClick={()=>setAssistant(false)}>×</button></div><p>Asistente de ayuda para las herramientas del editor. No aplica efectos ni modifica contenido con IA.</p><input value={assistantText} onChange={e=>setAssistantText(e.target.value)} placeholder="¿Cómo puedo dividir un clip?"/><button onClick={()=>setAssistantText("Selecciona el clip, coloca el cabezal donde quieras cortar y pulsa Dividir. También puedes usar la tecla S.")}>Cómo dividir un clip</button><button onClick={()=>setAssistantText("Arrastra el centro del clip para moverlo. Arrastra cualquiera de sus bordes para recortar su inicio o final.")}>Cómo mover o recortar</button><small>Ayuda local · Sin edición con IA</small></div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
