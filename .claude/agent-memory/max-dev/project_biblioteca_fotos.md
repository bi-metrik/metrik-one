---
name: biblioteca-fotos
description: Biblioteca de fotos /fotos (rama feat/biblioteca-fotos, 2026-10-16) — migración 20261016153000 SIN aplicar (3 por elemento, una principal, origen sitio_oficial); interruptor fotos_sitio_oficial apagado; extras en mosaico
metadata:
  type: project
---

PR de la rama `feat/biblioteca-fotos` (2026-10-16), NO listo para merge hasta aplicar
`supabase/migrations/20261016153000_fotos_catalogo_tres_por_elemento.sql` (probada en PGlite sobre la de
20261014221500: columnas `principal` default true / `posicion` default 1 / `imagen_url`; índices únicos
(ws,tipo,clave,posicion) y (ws,tipo,clave) where principal; CHECK de origen y fuente_url reemplazados SIN
`if exists` a propósito).

- Hotel: ya NO es «solo origen asesora». Regla `fotoImprimible(tipo, origen, revisada, {sitioOficial})`: hotel se
  imprime si `revisada` (lo eligió una persona) u origen asesora; automático nunca. `seSugiereDeCommons` sigue
  frenando la sugerencia sola; el selector (`consultasParaElegir`) sí busca hoteles.
- Página oficial: `config_extra.documento_viaje.fotos_sitio_oficial = true` (sin SQL hecho; Emilio no la validó).
  Apagado: ni se ofrece ni se IMPRIME la que haya. Se encuentra por URL pegada o Wikidata (P856, nombre + ciudad,
  una sola entidad). Toda descarga por `traerSeguro` (SSRF: https/443, IP pública, redirecciones revisadas).
- Extras (2 máx) van DENTRO del recuadro de la principal (mosaico 2fr/1fr): no cambian alto → no agregan hojas.
  Medido en la muestra: 7 hojas sin y con. La prueba compara el HTML sin el mosaico (salvo créditos).
- Menú «Fotos» y `/fotos` por plantilla (`tienePropuestaHtml`, en `pdf/motor-html.ts` liviano), no por motor
  encendido: se precarga antes de prender el motor. `/fotos` agregada a Clarity en `modulos/catalogo.ts`.
- Capturas con datos de muestra: página temporal `src/app/demo-biblioteca` + corte temporal en middleware (ya
  borrados); ids de muestra deterministas o salta el aviso de hidratación.

**How to apply:** aplicar la migración + fila del ledger antes del merge; el código viejo sigue funcionando con la
migración aplicada (inserts sin principal/posicion caen en los defaults). Relacionado: [[fotos-catalogo]].
