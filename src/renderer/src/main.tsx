import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MediaItem } from "../../../preload";
import "./style.css";

declare global { interface Window { playStudio: { openMedia: () => Promise<MediaItem[]>; saveProject: (data: string) => Promise<boolean>; loadProject: () => Promise<string | null> } } }
type Clip = MediaItem & { start: number; duration: number; track: "video" | "audio" };
function App() {
  const [clips,setClips] = useState<Clip[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [playhead,setPlayhead] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [assistant,setAssistant] = useState(false);
  const [assistantText,setAssistantText] = useState("");
  const [zoom,setZoom] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = clips.find(c=>c.id===selected);
  const duration = Math.max(30,...clips.map(c=>c.start+c.duration));
  const pixelsPerSecond = 48*zoom;
  const addMedia = async () => {
    const items = await window.playStudio.openMedia();
    setClips(old=>[...old,...items.map((m)=>({...m,start:old.length?Math.max(...old.map(c=>c.start+c.duration)):0,duration:30,track:m.kind}))]);
  };
  const split = () => {
    if(!active || playhead<=active.start || playhead>=active.start+active.duration) return;
    const left=playhead-active.start, right=active.duration-left;
    setClips(old=>old.flatMap(c=>c.id!==active.id?[c]:[{...c,duration:left},{...c,id:crypto.randomUUID(),name:c.name+" (parte 2)",start:playhead,duration:right}]));
  };
  const remove = () => { if(selected){setClips(old=>old.filter(c=>c.id!==selected));setSelected(null);} };
  const copy = () => { if(active) { const clone={...active,id:crypto.randomUUID(),start:active.start+active.duration}; setClips(old=>[...old,clone]); setSelected(clone.id); } };
  const save = async () => { await window.playStudio.saveProject(JSON.stringify({version:1,clips:clips.map(({url,...c})=>c),playhead},null,2)); };
  const load = async () => { const data=await window.playStudio.loadProject(); if(data){try{const p=JSON.parse(data);setClips(p.clips??[]);setPlayhead(p.playhead??0);}catch{alert("El archivo de proyecto no es válido.");}} };
  const time = (s:number)=>{const m=Math.floor(s/60),sec=Math.floor(s%60);return m+":"+String(sec).padStart(2,"0");};
  const selectedMedia = useMemo(()=>clips.find(c=>c.id===selected),[clips,selected]);
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brand-mark">P</span><div><b>PLAY STUDIO</b><small>EDITOR DE VIDEO</small></div></div><nav><button onClick={load}>Abrir proyecto</button><button onClick={save}>Guardar proyecto</button><button className="export" onClick={()=>alert("La exportación se habilitará al integrar el motor FFmpeg.")}>Exportar</button></nav><button className="assistant-toggle" onClick={()=>setAssistant(!assistant)}>✦ Asistente</button></header>
    <div className="menubar"><span>Archivo</span><span>Editar</span><span>Ver</span><span>Clip</span><span>Ayuda</span><div className="project-name">Proyecto sin título</div></div>
    <main className="workspace">
      <aside className="media-panel"><div className="panel-heading"><b>MEDIOS DEL PROYECTO</b><button className="plus" onClick={addMedia}>＋</button></div><button className="add-media" onClick={addMedia}>＋ Añadir medios</button><div className="media-list">{clips.map(c=><button key={c.id} className={"media-item "+(selected===c.id?"active":"")} onClick={()=>setSelected(c.id)}><span className="media-icon">{c.kind==="audio"?"♫":"▣"}</span><span>{c.name}</span></button>)}</div><div className="panel-footer">Arrastra archivos aquí o pulsa Añadir medios</div></aside>
      <section className="preview-panel"><div className="panel-heading"><b>MONITOR DE PROGRAMA</b><span className="muted">VISTA PREVIA</span></div><div className="preview-screen">{selectedMedia?.kind==="video"? <video ref={videoRef} src={selectedMedia.url} controls={false} onTimeUpdate={e=>setPlayhead(e.currentTarget.currentTime)} />:<div className="empty-preview"><div className="play-logo">▶</div><b>Vista previa</b><span>Agrega un video para comenzar a editar</span></div>}</div><div className="transport"><button onClick={()=>setPlayhead(0)}>⏮</button><button className="play" onClick={()=>{setPlaying(!playing);if(videoRef.current){if(playing)videoRef.current.pause();else void videoRef.current.play();}}}>{playing?"Ⅱ":"▶"}</button><button onClick={()=>setPlayhead(duration)}>⏭</button><span>{time(playhead)} / {time(duration)}</span></div></section>
      <aside className="inspector"><div className="panel-heading"><b>PROPIEDADES</b></div>{active?<><div className="property-title">{active.name}</div><label>Tipo <span>{active.kind==="video"?"Video":"Audio"}</span></label><label>Inicio <span>{time(active.start)}</span></label><label>Duración <span>{time(active.duration)}</span></label><button className="danger-button" onClick={remove}>Eliminar clip</button></>:<div className="inspector-empty">Selecciona un clip para ver sus propiedades</div>}</aside>
    </main>
    <section className="timeline"><div className="timeline-toolbar"><div><b>LÍNEA DE TIEMPO</b><span className="muted"> · Edición multipista</span></div><div className="tools"><button onClick={split} title="Dividir en el cabezal">✂ Dividir</button><button onClick={copy}>Copiar</button><button onClick={remove}>Eliminar</button><span className="separator"></span><button onClick={()=>setZoom(z=>Math.max(.5,z-.25))}>−</button><button onClick={()=>setZoom(z=>Math.min(3,z+.25))}>＋</button></div></div>
      <div className="timeline-scroll"><div className="ruler"><div className="track-label"></div><div className="ruler-area" style={{width:duration*pixelsPerSecond}}>{Array.from({length:Math.ceil(duration/5)+1},(_,i)=><span key={i} style={{left:i*5*pixelsPerSecond}}>{time(i*5)}</span>)}</div></div>
      {(["video","audio"] as const).map(track=><div className="track-row" key={track}><div className="track-label">{track==="video"?"VIDEO 1":"AUDIO 1"}</div><div className="track-area" style={{width:duration*pixelsPerSecond}} onContextMenu={e=>{e.preventDefault();setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}} onClick={e=>{if(e.target===e.currentTarget)setPlayhead(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/pixelsPerSecond));}}>{clips.filter(c=>c.track===track).map(c=><button key={c.id} className={"clip "+track+(selected===c.id?" selected":"")} style={{left:c.start*pixelsPerSecond,width:Math.max(55,c.duration*pixelsPerSecond)}} onClick={e=>{e.stopPropagation();setSelected(c.id);}} onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelected(c.id);setPlayhead(c.start);}}><b>{track==="audio"?"♫":"▣"} {c.name}</b><small>{time(c.duration)}</small></button>)}</div></div>)}
      <div className="playhead" style={{left:150+playhead*pixelsPerSecond}}><div className="playhead-cap"></div></div></div>
      <div className="timeline-hint">Clic izquierdo: seleccionar · Clic derecho en la línea: mover el cabezal · Clic derecho en un clip: seleccionar y colocar el cabezal al inicio · Dividir: cortar en la posición del cabezal</div>
    </section>
    {assistant&&<div className="assistant"><div className="assistant-head">✦ Asistente de Play Studio <button onClick={()=>setAssistant(false)}>×</button></div><p>Te ayudo a encontrar herramientas y entender la edición. No modifico tu video con IA.</p><input value={assistantText} onChange={e=>setAssistantText(e.target.value)} placeholder="¿Cómo puedo dividir un clip?"/><button onClick={()=>setAssistantText("Selecciona el clip, coloca el cabezal donde quieras cortar y pulsa Dividir.")}>Cómo dividir un clip</button><small>Asistente básico · Sin generación ni edición con IA</small></div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
