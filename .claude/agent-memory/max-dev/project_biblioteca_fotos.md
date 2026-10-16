---
name: biblioteca-fotos
description: REEMPLAZADA por fotos-perfiles (2026-10-16): Biblioteca de fotos /fotos (#1194, migración 20261016153000 APLICADA) y su puerta en la tarjeta del hotel (feat/biblioteca-en-tarjeta) — una sola verdad: la foto del hotel vive en la biblioteca, la de la opción es respaldo viejo
metadata:
  type: project
---

#1194 (`a2c64e9a`, 2026-10-16) en main con `20261016153000_fotos_catalogo_tres_por_elemento.sql` ya aplicada
(columnas `principal`/`posicion`/`imagen_url`; índices únicos (ws,tipo,clave,posicion) y principal parcial).

- Hotel: se imprime si `revisada` u origen asesora (`fotoImprimible`); nunca sugerido solo (`seSugiereDeCommons`).
- Página oficial: `config_extra.documento_viaje.fotos_sitio_oficial = true` (apagada; Emilio no la validó). Apagada,
  ni se ofrece ni se imprime. Descarga solo por `traerSeguro` (SSRF).
- Extras (2 máx) en mosaico dentro del recuadro de la principal: no agregan hojas.
- Menú «Fotos» y `/fotos` por plantilla (`tienePropuestaHtml`), no por motor encendido.

**Tarjeta del hotel = puerta a la biblioteca** (rama `feat/biblioteca-en-tarjeta`, 2026-10-16, pedido de Mauricio:
«dónde quedó lo de la biblioteca, debería ser aquí»). Sin migración.
- Una sola verdad: en espacios con `tienePropuestaHtml`, `ponerFotoDelHotel` escribe en la biblioteca (llave
  `hotel|ciudad`) y suelta `tarifa_pax.fotoHotel`. El PDF (los DOS motores) toma la biblioteca primero y la vieja de
  la opción solo de respaldo (`foto-hotel-documento.ts`). Con motor html no se pone `h.foto` si hay biblioteca: el
  catálogo la pone con sus extras.
- Las tarjetas se leen en UNA acción (`FotosEnTarjetas` envuelve el editor; las tarjetas se registran). Cambios de la
  tarjeta y del panel se avisan por el evento `one:fotos-biblioteca`.
- Presupuesto de idas de C0 (igualdad-servidor): el PDF Trappvel quedó en 23 = tope. Pasar el `config_extra` ya
  leído en vez de releer `workspaces`; una ida más rompe el test (y el fixture NO se sube).
- Tours/planes: la tarjeta de actividad no tiene recuadro de foto; no se agregó (pendiente si Mauricio lo pide).
- Capturas: página temporal + corte temporal en middleware, `next dev` con env falsas (no hace falta `.env.local`),
  puppeteer-core del worktree + chromium de `~/.cache/ms-playwright`. «Cambiar» es hover: en headless, `page.focus`
  al botón (Tailwind 4 `group-hover` no responde al hover emulado).

**How to apply:** antes de tocar la foto del hotel, leer `foto-hotel-documento.ts`; nada nuevo debe escribir en
`tarifa_pax.fotoHotel` en un espacio con biblioteca. Relacionado: [[fotos-catalogo]], [[cotizacion-integrada-c0]].
