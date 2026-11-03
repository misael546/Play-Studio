# AdX AutoClose

Aplicación Android independiente dentro de AI-Studio. Requiere Android 8+ y no requiere root.

## Estado

Esta es una base inicial compilable, no una versión definitiva verificada en dispositivo. El servicio de accesibilidad solo puede pulsar controles de cierre expuestos explícitamente por la jerarquía de accesibilidad. No puede reconocer de forma fiable iconos dibujados en un canvas o imágenes. La detección visual mediante MediaProjection todavía no está implementada; no se debe presentar como función disponible.

## Compilar

Desde esta carpeta con JDK 17+ y Android SDK 35:

```bash
gradle assembleDebug
```

El APK se publica como artefacto de GitHub Actions al ejecutar el workflow.

## Límites de seguridad

No abre anuncios, no automatiza visualizaciones ni reclamaciones de recompensas, no pulsa Skip/Omitir ni controles ambiguos. Solo intenta activar controles de cierre con etiquetas exactas. Probar primero en un entorno no crítico.
