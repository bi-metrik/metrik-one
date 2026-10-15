---
name: fotos-catalogo
description: PR 4 de la propuesta (catálogo de fotos, rama feat/fotos-catalogo) — migración 20261014221500 SIN aplicar (tabla + bucket privado fotos-catalogo); sugerencia de Wikimedia Commons; solo con motor html
metadata:
  type: project
---

Abierto el 2026-10-14, NO listo para merge hasta aplicar `supabase/migrations/20261014221500_fotos_catalogo.sql`
(tabla `fotos_catalogo` + `insert into storage.buckets` del bucket privado `fotos-catalogo`). Probada en PGlite
(CHECK de licencias, unique por clave, RLS por workspace, anon sin grant).

- Archivos: `one://fotos-catalogo/<ws>/<tipo>/<huella>.jpg`, solo servidor con service client. NO está en
  `BUCKETS_ONE` a propósito: `/api/archivos/abrir` no la abre; el panel firma por la acción.
- El almacenamiento externo de Trappvel (`sbext://`) no sirvió: solo acepta rutas por negocio, y el catálogo es
  del workspace. La foto por opción de hotel se BORRA al cambiarla: por eso el catálogo COPIA los bytes.
- Commons exige TODAS las palabras: «Park Güell con guía Barcelona» da 0. `consultasDeFoto` afloja solo
  actividades; un hotel aflojado trajo una protesta en Sol (por eso no). Las miniaturas vienen de
  `thumb.wikimedia.org`, no solo de `upload.`.
- La sugerencia corre sola al abrir el panel (una vez por apertura) y queda `revisada=false`; igual se imprime.
  Emilio no ha cerrado derechos de uso comercial de fotos BY-SA (plan §2.5): Mauricio lo pidió igual.
- #1178 ya en main (merge limpio el 14-oct). La etiqueta «Madrid · dom 13» sale en `.where` sobre la foto del plan:
  ciudad del plan + `o.fecha` o el día donde `repartirOpcionales` lo puso; solo si hay alguna foto de plan.
- Saltos (14-oct): `.tarifas nobr` + `.tf` sin partir; tablas largas por `tramosDeFilas` (3 filas juntas arriba con el
  título, 2 abajo). Muestra: 7 hojas, ningún hueco > 16 %; no hizo falta reordenar secciones.

**How to apply:** antes de mergear, aplicar la migración y registrar la fila del ledger; sin ella el panel dice
«falta aplicar la migración» y el PDF sale como hoy. Relacionado: [[propuesta-motor-html-h33]].
