---
name: project-valida-cargue-concurrente
description: Cargue masivo de Valida concurrente (3 filas), tope 45 s navegador / 30 s API, reintento de red con dedup en servidor; orden del PDF de lote ya no es el del XLSX
metadata:
  type: project
---

Cargue masivo de Valida (2026-10-04, rama `fix/valida-cargue-masivo-concurrente`): `src/lib/valida/cargue-lote.ts` procesa 3 filas a la vez; `llamarValida` corta a 30 s y guarda `valida_tiempo_agotado`.

**Why:** el bucle serial se cortaba entero con una fila que lanzaba (diagnóstico 05 de crecimiento MRR de Valida).

**How to apply:**
- El reintento por red pasa `reintento: true` a `consultarValida`, que devuelve la fila ya guardada del lote (misma persona) en vez de cobrar otra vez. Límite: misma persona dos veces en el XLSX + reintento = una fila menos.
- El tiempo agotado en el navegador NO reintenta: el server action pudo seguir y cobrar.
- El PDF de lote ordena por `created_at`: con concurrencia el orden ya no es exactamente el del XLSX. Arreglarlo pide una columna de índice (migración).
