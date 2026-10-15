---
name: propuesta-motor-html-h33
description: Propuesta de Trappvel PR 3 (#1165, H33 «¿Ya se la mandaste?») y PR 2 (motor html con Chromium, encendido por workspace); anticipo en documento_cliente; SQL del interruptor SIN aplicar
metadata:
  type: project
---

Abiertos el 2026-10-14. #1165 mergeado (e8e10f0d); PR 2 es #1168, sin mergear. Plan: `proyectos/trappvel/clarity/diseno/propuesta-emocional/max.md` §3.

- **#1165 (PR 3, H33):** descargar ya no escribe `fecha_envio`; el editor pregunta (`debePreguntarEnvio`:
  viaje o seguimiento, borrador, PDF limpio) y el «Sí» va por `enviarCotizacion(id,'descargado')` /
  `enviarPorPasos`. Cambia el criterio C3 de Vera (el deshacer de 8 s se fue): Vera tiene que validarlo.
  La normalización de cotizaciones viejas con `fecha_envio` en borrador NO está (SQL aparte).
- **PR 2 (rama `feat/propuesta-html-trappvel`, independiente de #1165):** `src/lib/pdf/html/`.
  - Interruptor: `workspaces.config_extra.documento_viaje.motor = 'html'` (`usaMotorHtml`). SQL en
    `proyectos/trappvel/clarity/migrations/2026-10-14_motor-html-propuesta*.sql`, probado en PGlite, SIN aplicar.
  - Anticipo (decisión 3): `cotizaciones.documento_cliente.anticipo` (jsonb existente, sin migración). Los
    escritores del texto lo conservan con `conAnticipo`; la copia NO lo hereda.
  - La respuesta del PDF suma `avisoFormato` y `renderedVia: 'chromium'` SOLO con el motor encendido: el
    fixture de igualdad C0 sigue igual apagado.
  - Tracing: `'/negocios/*/cotizacion/*'` en `next.config.ts` (la llave se compara con `contains` contra
    `/app/negocios/[id]/cotizacion/[cotId]`).

**Why:** decisiones de Mauricio del 2026-10-14 (nombres de menores con autorización, sin cancelaciones,
anticipo a mano + wa.me). Un anticipo registrado como pago mueve el negocio a Reservas (N4 de Hana).

**How to apply:**
- `textoDelPDF` (de react-pdf) no lee los PDF de Chromium (fuentes CID): usar `textoDelPdf` de `ai/texto-pdf.ts`.
- Ver páginas de un PDF en la torre: no hay poppler; `pdfjs` de `unpdf/dist/pdfjs.mjs` cargado en Chromium
  con `--allow-file-access-from-files` (script en el scratchpad de la sesión, `pdf2png.mjs`).
- Saltos de hoja (14-oct, queja del dueño por los blancos): nada de `nobr` sobre una tabla entera; el bloque
  que no se parte es el tramo (`<tbody class="nobr">`), con `<thead>` repetido y `tr { break-inside: avoid }`.
  Medir el hueco por hoja con `medir-hojas.mjs` (scratchpad): última fila no blanca sobre el alto útil.
- `esTren` por marca o estación-a-estación; una estación en un extremo es el traslado al tren.
- Relacionado: [[propuesta-chromium-modelo]].
