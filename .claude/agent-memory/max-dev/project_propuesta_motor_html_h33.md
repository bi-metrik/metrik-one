---
name: propuesta-motor-html-h33
description: Propuesta de Trappvel PR 3 (#1165, H33) y PR 2 (motor html con Chromium por workspace); anticipo en documento_cliente; datos reales de la captura (zona en ciudad, traslados ida y vuelta, proveedor) en fix/propuesta-datos-reales
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
- Día a día v4 (14-oct, pedido de Mauricio): cajitas por versión SOLO en vuelos (el modelo ya no
  pone `porTarifa` en hoteles); los opcionales van a los días libres de su ciudad por
  `lugaresDeOpcionales` (alineado por POSICIÓN con `props.sugeridos`, se arma en la acción solo con
  el motor encendido; sin lectura de ciudad, se busca la parada en el nombre). `DiaDoc.titulo` y
  `sugerencia` son ganchos del PR 6, hoy siempre null.
- Regenerar la muestra: `PROPUESTA_PDF_SALIDA=<pdf> CHROMIUM_EJECUTABLE=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npx vitest run src/lib/pdf/html/propuesta-html.test.ts`.
  En el worktree aislado, `node`/`vitest` con variables de shell (`$S`) los bloquea el hook: rutas literales.
- Pastilla de aerolínea (14-oct, pedido de Mauricio): `trappvel/aerolinea.ts` pinta, `siglasDeTramos`
  (catálogo) lee una sigla por prefijo de número. Las cajitas del día a día no tienen fila de vuelo:
  la sigla viaja en `porTarifa[].siglas` del modelo. El HTML ordena las cajitas por versión
  (E, R, P), no en el orden del modelo. El `node_modules` del repo principal no trae `unpdf`
  (va atrasado): `npm ci` en el worktree, no symlink.
- Datos reales (14-oct, rama `fix/propuesta-datos-reales`, COT-2026-0026 real): la captura trae ciudad con zona
  («Madrid - Sol»; `ciudadDeCapitulo` corta en ` - `/` · ` con espacios, en TODO ONE), traslados de ida y vuelta en una
  línea con dos fechas o «\n hotel y hotel \n» (`propuesta/trayectos.ts` los parte; vuelta sin fecha = salida de la
  estadía), fichas crudas con PROVEEDOR en los sugeridos (`descripcionDeOpcional`), y el `documento_cliente` viejo de
  Gemini en usted, con «¡» y 13 noches (`textoConLaVozDelDocumento` → `introDeterminista`). «Incluido en todas» filtra
  las líneas que nombran hotel/aerolínea de una sola versión. Día a día sin `brk` (título en `.nobr` con el 1er día).
  Al leer prod el 14-oct ~23 h, `config_extra.documento_viaje` de trappvel NO tenía `motor: 'html'`.
- Relacionado: [[propuesta-chromium-modelo]], [[fotos-catalogo]], [[reproducir-pdf-real-solo-lectura]].
