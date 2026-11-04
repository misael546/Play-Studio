# Play Studio

Editor de video de escritorio para Windows. Interfaz tradicional, edición por línea de tiempo y un asistente pequeño de ayuda; no usa IA para editar ni generar contenido.

## Funciones implementadas en esta base
- Importar video y audio desde el explorador de Windows.
- Lectura de duración de medios, rechazo de archivos cuya duración no se puede leer y biblioteca del proyecto.
- Varias pistas de video y audio, con capas superpuestas en el monitor y orden de composición según la pista.
- Formas de onda de audio generadas con FFmpeg y ajustadas al recorte del clip.
- Selección, mover clips, recortar bordes, dividir, cortar, copiar, pegar y eliminar.
- Cabezal de reproducción controlado con clic derecho en la línea de tiempo, regla clicable, seguimiento automático durante reproducción y avance sincronizado con reloj real.
- Propiedades de posición, duración y volumen de clips de video y audio.
- Fundidos de entrada y salida de video y audio.
- Texto superpuesto por clip, con posición y tamaño ajustables.
- Ajustes de brillo, contraste y saturación, visibles también en el monitor de vista previa.
- Exportación con resolución 720p, 1080p o 4K y 24, 30 o 60 FPS.
- Crear, guardar y abrir proyectos `.playstudio`, con confirmación antes de descartar cambios.
- Guardado normal sobre el proyecto abierto y opción independiente de **Guardar como**.
- Reemplazar o localizar archivos fuente cuando se hayan movido de carpeta, conservando los ajustes del clip.
- Exportación MP4 mediante FFmpeg incluido, con progreso, cancelación, mezcla del audio original de los videos y pistas independientes, orden de capas coherente y limitador para reducir saturación.

## Atajos de teclado
- `Ctrl + N`: nuevo proyecto.
- `Ctrl + O`: abrir proyecto.
- `Ctrl + S`: guardar proyecto.
- `Espacio`: reproducir o pausar.
- `← / →`: avanzar o retroceder un fotograma.
- `S`: dividir el clip seleccionado.
- `Ctrl + Z`: deshacer.
- `Ctrl + Y` o `Ctrl + Shift + Z`: rehacer.

## Formatos de entrada
MP4, MOV, MKV, AVI, WebM, M4V, 3GP, MPG, MPEG, TS, MTS, M2TS, FLV, OGV, WMV, ASF, VOB, MP3, WAV, AAC, M4A, FLAC, OGG, WMA, OPUS, AIFF, AMR y APE. La compatibilidad final depende de los códecs incluidos en FFmpeg.

## Requisitos de desarrollo
- Windows 10/11 de 64 bits
- Node.js LTS y npm

## Ejecutar en desarrollo
```bash
npm install
npm run dev
```

## Crear instalador
```bash
npm run dist
```
El instalador NSIS se genera en la carpeta `release`.

## Nota técnica
Esta versión incluye el motor inicial de exportación MP4, fundidos, títulos, ajustes básicos de imagen, mezcla de audio original y pistas independientes. Las transiciones entre clips, la corrección avanzada de sincronización, las transiciones entre clips y las pruebas de uso real siguen pendientes.
