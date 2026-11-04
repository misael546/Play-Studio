# Play Studio

Editor de video de escritorio para Windows. Interfaz tradicional, edición por línea de tiempo y un asistente pequeño de ayuda; no usa IA para editar ni generar contenido.

## Funciones implementadas en esta base
- Importar video y audio desde el explorador de Windows.
- Lectura de duración de medios y biblioteca del proyecto.
- Varias pistas de video y audio.
- Selección, mover clips, recortar bordes, dividir, cortar, copiar, pegar y eliminar.
- Cabezal de reproducción controlado con clic derecho en la línea de tiempo.
- Propiedades de posición, duración y volumen de clips de video y audio.
- Fundidos de entrada y salida de video y audio.
- Texto superpuesto por clip, con posición y tamaño ajustables.
- Ajustes de brillo, contraste y saturación, visibles también en el monitor de vista previa.
- Exportación con resolución 720p, 1080p o 4K y 24, 30 o 60 FPS.
- Guardar y abrir proyectos `.playstudio`.
- Exportación MP4 mediante FFmpeg incluido, con progreso de exportación y mezcla del audio original de los videos con las pistas de audio añadidas.

## Formatos de entrada
MP4, MOV, MKV, AVI, WebM, M4V, MP3, WAV, AAC, M4A, FLAC, OGG y WMA. La compatibilidad final depende de los códecs incluidos en FFmpeg.

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
Esta versión incluye el motor inicial de exportación MP4, fundidos, títulos, ajustes básicos de imagen, mezcla de audio original y pistas independientes. Las transiciones entre clips, la corrección avanzada de sincronización y las pruebas de uso real siguen pendientes.
