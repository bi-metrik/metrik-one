---
name: propuesta-formato-edgar
description: La propuesta HTML de Trappvel copia el formato de Edgar del 2026-10-14 (carta, Poppins) con hoja de precios al final; qué se adaptó, qué no existe en el modelo y cómo renderizar la QA sin base
metadata:
  type: project
---

Desde el 2026-10-27 (decisión de Mauricio) `src/lib/pdf/html/trappvel/plantilla.ts` + `estilos.ts` reproducen el PDF
de Edgar (`proyectos/trappvel/clarity/docs/entrada/formato-edgar/`), rama `trappvel/pdf-formato-edgar`. Reemplaza el
diseño v4/v5 del 14-oct (salen «Lo que van a vivir», la ruta y los días «número grande»; las pruebas que vigilaban
eso se reescribieron). QA en `proyectos/trappvel/clarity/qa/2026-10-27_pdf-formato-edgar/`.

**Why:** Edgar mandó su formato como referencia; Mauricio pidió igualarlo y agregar la hoja de precios con su estilo.

**How to apply:**
- La referencia es CARTA (612×792), no A4 como decía el brief: medirla con `pdfinfo` antes de fijar `@page`.
- Lo que el modelo no tiene y Edgar sí: titular, localizadores, e-tickets, dirección/teléfono del hotel, clima,
  contactos de proveedores, fecha de llegada de un vuelo nocturno. No se inventan: la fila no sale. Si Mauricio
  quiere alguno, primero va al modelo (`modelo-documento.ts`).
- El collage de portada usa portada → ciudades → hoteles de la Recomendada (`fotosDePortada`); la foto del día,
  la de la actividad incluida (`fotoDeActividad`, nuevo en recursos) o la de la ciudad el primer día.
- QA sin base ni cuota: fixture `test/propuesta-curazao.ts` (forma de la COT-2026-0004) y un `*.test.ts` temporal
  que llama `pdfDePropuestaHtml` con `CHROMIUM_EJECUTABLE=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`.
  Este subagente no tuvo MCP de Supabase: la COT real no se pudo leer.
- Destinatario (ajuste de Mauricio del mismo día): el CONTACTO del negocio (`contactos(nombre)` en la misma
  consulta del negocio), con nombre propio (`destinatario.ts`: mayúsculas → «Ricardo Peñuela», partículas en
  minúscula, mixto se respeta) y la empresa solo si `tipo_persona <> 'natural'`. Aviso «Propuesta de viaje para …»
  y cuarta tarjeta «Cotizada para»; sin contacto vuelve a pasajeros / «Incluye». La empresa de relleno «Cliente»
  de la acción NO cuenta. El doble `test/cotizacion-pdf-doble.ts` ya proyecta `empresas(` y `contactos(` del negocio.
- Desde el 2026-10-28 (pedido de Edgar, rama `trappvel/pdf-compacto`) NO hay saltos forzados: los precios
  siguen a lo anterior. Atómicos solo las unidades (vuelo, hotel, día, versión, tabla de pagos, tarjeta de
  condiciones, firma pegada a la última fila). Un `.sh` va siempre en un `.nobr` con su primer bloque:
  `break-after: avoid` solo, Chromium no lo respeta.
- La holgura es fina: con textos como la COT-2026-0004 real la hoja 3 sobra por ~5 mm. Si alguien sube un
  espaciado vertical, vuelve a 4 hojas: medir con `pdftotext -bbox` (última palabra sobre el pie) antes de
  tocar márgenes. Fixture «curazao-largo» (textos largos ficticios) vive solo en el test temporal de la QA.
- Ver [[propuesta-motor-html-h33]] y [[fotos-catalogo]].
