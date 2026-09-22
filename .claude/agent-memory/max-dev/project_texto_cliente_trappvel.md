---
name: texto-cliente-trappvel
description: "#826 — ONE redacta el texto del documento de Trappvel (titular, intro, incluye, antes de viajar) y el equipo lo revisa; columna cotizaciones.documento_cliente SIN aplicar al abrir el PR; el PDF imprime solo lo revisado"
metadata:
  type: project
---

**PR [#826](https://github.com/bi-metrik/metrik-one/pull/826), abierto SIN mergear (2026-09-22).**
Lleva la migración `20260922230000_cotizaciones_documento_cliente.sql`, **sin aplicar**: la aplica
la sesión principal ANTES del merge. Aditiva, sin backfill, sin RLS nueva.

**Why:** Mauricio aprobó la columna y el redactor el 2026-09-22, tras la propuesta que quedó en
[[arreglos-documento-trappvel-0006]].

**How to apply:**
- **Solo sale lo revisado.** `textoParaElViaje(doc)` es la ÚNICA puerta entre la columna y el
  PDF: devuelve `{}` sin `revisado_en`, así que el objeto del viaje queda idéntico. No leer la
  columna por otro lado en el PDF.
- **El modelo ve solo `ViajeParaRedactar`.** Todo campo nuevo que se le quiera dar al redactor
  se agrega a mano en `viajeParaRedactar` y pasa por `limpiarTextoLibre` si es texto libre. Una
  prueba afirma que el JSON no trae nombres ni cifras: si falla, no se relaja.
- **Etiquetas de la lectura (fixtures):** la actividad se llama `Actividad` (no «Nombre») y el
  vehículo `Vehículo`. Con la etiqueta equivocada el campo cae en silencio;
  `serviciosDeItems` ahora antepone el nombre de la línea si la lectura no dice QUÉ es.
- **Gemini desobedeció «impersonal»**: la única llamada real (datos sintéticos, 6,1 s) trató de
  usted. El prompt se cambió a «usted, nunca tuteo» + minúscula tras dos puntos, y ese cambio
  **no se probó en vivo**. Si alguien reporta el tono, empezar por ahí.
- La guarda de carrera del UPDATE (`documento_cliente->>revisado_en is null`) usa filtro por
  ruta JSON de PostgREST; verificado en vivo con un control inverso.
- QA: `proyectos/trappvel/clarity/qa/2026-09-22_redactor/` (COT-0006 revisado, borrador, y el
  sintético con el texto real de Gemini).

Relacionado: [[documento-cliente-trappvel]], [[pruebas-por-mutacion]], [[mirar-pdf-renderizado]].
