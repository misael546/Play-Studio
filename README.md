# Play Studio

Editor de video de escritorio para Windows. Interfaz tradicional, edición por línea de tiempo y un asistente pequeño de ayuda; no usa IA para editar ni generar contenido.

## Funciones implementadas en esta base
- Importar video y audio desde el explorador de Windows.
- Lectura de duración de medios y biblioteca del proyecto.
- Varias pistas de video y audio.
- Selección, mover clips, recortar bordes, dividir, cortar, copiar, pegar y eliminar.
- Cabezal de reproducción controlado con clic derecho en la línea de tiempo.
- Propiedades de posición, duración y volumen de clips de audio.\n- Fundidos de entrada y salida de video y audio.\n- Texto superpuesto por clip, con posición y tamaño ajustables.\n- Ajustes de brillo, contraste y saturación.\n- Exportación con resolución 720p, 1080p o 4K y 24, 30 o 60 FPS.
- Guardar y abrir proyectos `.playstudio`.
- Exportación MP4 mediante FFmpeg incluido, con progreso de exportación.

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
Esta versión ya incluye el primer motor de exportación MP4. La previsualización multipista sincronizada, audio original incrustado en los clips de video, transiciones, títulos, efectos y mezcla avanzada siguen siendo etapas pendientes de desarrollo y pruebas.
