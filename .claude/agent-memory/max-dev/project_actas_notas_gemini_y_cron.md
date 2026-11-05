---
name: project-actas-notas-gemini-y-cron
description: Por qué no hay actas desde el 2026-09-13 (filtros del cron, no el parser) y el formato nuevo de las Notas de Gemini que el parser ya acepta
metadata:
  type: project
---

Medido el 2026-11-05 (PR fix/actas-parser-notas-gemini):

- **El cron actas-diarias corre todos los días con 200** (00:00 UTC = 19:00 Bogotá, procesa el día Bogotá que está terminando). Desde el 13-sep ningún evento del calendario primary pasó los filtros: 7 eventos con transcript entre 12-sep y 5-nov; el resto `sin_adjuntos`; 3 sin invitados (`sin_participantes`), 2 de menos de 45 min, 1 sin habla. **No es el parser.**
- **Las Notas de Gemini cambiaron de export sin que el Doc cambie** (modifiedTime = creación): antes «Transcripción» suelta, hoy «Registros de la reunión Transcripción» (fila de pestañas, NO es el corte) + «<título> - Transcripción». Las Notas del 4 y 5-sep generaron acta en septiembre y hoy salían vacías.
- `vercel logs` de ONE solo guarda ~10 días; el calendario de Google (misma OAuth del `.env.local`) reconstruye el resto.

**Why:** el silencio de actas parecía una falla; es falta de reuniones que califiquen (umbral 45 min + invitados + adjunto).
**How to apply:** ante «no hay actas», correr la lectura del calendario antes de tocar código. Si Google vuelve a cambiar el export, el síntoma es `transcripcion_vacia` en el log del cron, no un error.
