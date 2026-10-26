---
name: reproducir-pdf-real-solo-lectura
description: Cómo reproducir EN LOCAL el PDF de una cotización real de producción sin poder escribir (cliente Supabase con fetch solo GET); sin MCP en el subagente
metadata:
  type: reference
---

El subagente max-dev aislado NO tiene el MCP de Supabase (2026-10-14). Para reproducir el PDF de una cotización
real se corre `generateCotizacionPDF(id, { vistaPrevia: true })` desde un `*.local.test.ts` temporal con:

- `vi.mock('@/lib/actions/get-workspace')` y `vi.mock('@/lib/supabase/server')` devolviendo un `createClient` de
  `@supabase/supabase-js` con la service key de `.env.local` del repo principal y `global.fetch` que **responde 403 a
  todo lo que no sea GET/HEAD** (escribir es imposible por construcción; `vistaPrevia` tampoco escribe).
- `imagenComoDataUrl` mockeado a `null` (las fotos de hotel viven en el `sbext://` de Trappvel).
- Si el interruptor de prod no está, forzarlo con un mock parcial de `@/lib/pdf/plantillas-cotizacion`.
- Un doble que ignore el `select` NO sirve: las lecturas usan alias (`adultos:data->adultos`) y embeds.

Validado: el PDF salió byte a byte del mismo tamaño que el descargado de prod (878.251 B). El test y los JSON
quedan en el scratchpad, nunca en el repo. Leer el texto: `extractText` de `unpdf`; páginas a PNG: pdfjs de
`unpdf/dist/pdfjs.mjs` en Chromium (`--allow-file-access-from-files`, ruta ABSOLUTA del html).
Relacionado: [[propuesta-motor-html-h33]].
