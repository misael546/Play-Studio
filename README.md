# Play Studio

Editor de video de escritorio para Windows, con interfaz tradicional y asistente básico (sin funciones de edición con IA).

## Objetivo
- Importar video y audio desde el explorador de archivos de Windows.
- Línea de tiempo multipista con selección, división y organización de clips.
- Vista previa y controles de reproducción.
- Guardado de proyectos editables.
- Exportación mediante un motor FFmpeg que se integrará en la siguiente fase.

## Desarrollo
Requisitos: Node.js LTS y npm.

```bash
npm install
npm run dev
```

## Crear instalador de Windows
```bash
npm run build
```

El instalador de Windows se configurará en la fase de empaquetado. Esta primera base es el esqueleto funcional de la interfaz y edición inicial; la exportación y operaciones avanzadas siguen pendientes.
