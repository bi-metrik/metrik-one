---
name: paginacion-pdf-trappvel
description: §4.11 del PDF de Trappvel (2026-10-08) — escala de espacios, composición en hasta 4 renders midiendo el PDF, Aire en vez de marginTop; paso 3 casi no hace nada
metadata:
  type: project
---

Rama `feat/paginacion-pdf-trappvel` (brief 2026-10-08, regla §4.11 de `sistema-visual-documento.md`, aprobada por
Mauricio). Sin migración. La acción ya NO renderiza Trappvel una vez: pasa por `compositorDePlantilla` →
`componerCotizacionTrappvel` (`cotizacion-trappvel-paginacion.ts`), que mide con `medir-pdf.ts` y recompone.

- **Marcas invisibles**: un `View` de 0,5 pt color `rgb(255,254,id)` al inicio de cada sección dice en qué hoja empezó.
  Si se agrega una sección nueva, darle número en `NUMERO_DE_SECCION` (el orden de los números = orden del documento).
- **El paso 3 (foto de ciudad a 110 pt) casi no ahorra nada**: la regla supone la banda de 150 pt de §4.3, pero desde
  el #832 la foto del capítulo ya es una miniatura de ~111 pt. **Why:** Ren escribió sobre el diseño viejo. **How to
  apply:** si Mauricio pregunta por qué no rescata hojas, es esto; la decisión de rehacerlo es de Ren.
- **Si los tres pasos no bastan se entrega la composición NORMAL** (no la compactada). Decisión mía, reportada.
- «Nunca < 9 pt» se probó como «compactar no cambia ningún tamaño de letra»: el diseño ya tenía chips de 6,5 y
  metadatos de 7,5-8,5 desde §2.
- Medir el PDF: el recorte (`W n`) importa — una foto `cover` se dibuja más grande que su marco.

Relacionado: [[documento-trappvel-fotos-ritmo]], [[project-foto-hotel-y-fila-de-acciones]], [[mirar-pdf-renderizado]].
