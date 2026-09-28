---
name: publicacion-terminos-radar
description: terminos-uso-radar@1.0 ya está publicado en producción (PDF + fila, verificados) y el alcance 'plantilla' estrenado: un documento genérico se ve por el MÓDULO contratado, no por la empresa; lo que sigue sin ejercitarse es la aceptación real
metadata:
  type: project
---

Documento cerrado por Emilio Castañeda (CLO) el 2026-09-28:
`proyectos/metrik/legal/terminos-uso-radar-v1.0.md`, 12 cláusulas. Sin su fila registrada el gate
del Radar no abre; sin aceptación, el trial de 5 días de #955 no arranca (ancla:
`aceptaciones_terminos.respondido_at`).

## Aplicado en producción el 2026-09-28 (autorizado por Mauricio)

- `20260929030000_documentos_alcance_plantilla.sql` — **APLICADA**.
- PDF en `aceptaciones-documentos/metrik/terminos-uso-radar-v1.0.pdf` (60.912 bytes; huella
  verificada bajándolo de vuelta, no solo por el 200 de la subida).
- La fila de `sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql` — **REGISTRADA**
  (`alcance` plantilla, `modulo` radar_secop, `empresa_id` null, `texto_cuadra` true). Versión
  **`1.0` sin la `v`**, y la fila es inmutable por trigger: eso no se corrige después.
- Workspace `fabri` creado (`ed9840b9-…`, grupo `secop`, Drive OK, solo `business`, 0 usuarios,
  0 contratos, `radar_secop` apagado).

## ⚠️⚠️ Un documento «plantilla» se ve por el MÓDULO contratado

El alcance `plantilla` existía desde C2 y **nunca se había ejercitado** (las 10 filas de producción
eran `cliente`). Tres puntos unían documento y cliente solo por `empresa_id`, y un genérico quedaba
invisible. La decisión que cerró eso: **el documento declara su módulo**
(`documentos_contractuales_versiones.modulo`, cuarta copia de la lista de llaves, ya guardada por
`catalogo.test.ts`) y **lo ve solo quien tenga contratado un servicio de ese módulo**
(`catalogo_servicios.modulo`).

Aflojar el join por empresa sin poner nada en su lugar habría mostrado el documento a TODO espacio
con cualquier contrato — y peor: su entrada de módulo le habría pedido aceptarlo para entrar a
Valida, porque `estadoTerminos` exige aceptados **todos** los documentos vigentes visibles.

`alcance` y `modulo` entraron a la inmutabilidad de la tabla: sin eso un UPDATE convertía el
documento de una empresa en el de todo un módulo. `titulo` y `linea_id` siguen mutables (hueco de
C2, sin cerrar).

**How to apply:** al publicar otro documento genérico (no de un cliente), la pregunta no es «¿es
plantilla?» sino «¿de qué módulo es?». Sin `modulo` el CHECK lo rechaza; con el módulo equivocado no
lo ve nadie.

## Qué NO está ejercitado, y por qué

La aceptación real. No hay ficha de Radar en `catalogo_servicios` ni contrato en
`servicios_contratados`, así que **hoy ningún espacio ve el documento** (medido: los 6 espacios con
contrato ven 0). El camino completo —ver → aceptar → constancia— está probado **ejecutado en PGlite**
con dos clientes de Radar (`src/lib/valida-api/aceptacion-modulo-sql.test.ts`, bloque «un documento
genérico se ve por el módulo contratado»), incluido que la constancia de un cliente no se le cuelgue
al otro aunque el PDF sea el mismo archivo. Contra producción solo se midió lo que no exige datos
nuevos: que los 10 documentos `cliente` se vean exactamente igual que antes (0 de diferencia en las
dos direcciones).

## Cuál huella es la canónica

La del **PDF**: `aceptaciones_terminos.documento_sha256 = pdf_sha256` es la llave del vínculo, y el
PDF es lo que el cliente recibe. `texto_sha256` es el segundo sello, y sigue siendo sha256 del
`texto_md` TAL CUAL (sin trim ni salto final).

PDF y texto canónico se generan juntos con
`proyectos/metrik/legal/terminos-radar-v1.0/_generador/generar.py` (WeasyPrint, mismo CSS y logos
que 4D SOFT y los CDA; 4 páginas). **El lector de la pantalla no pinta tablas**: la tabla de la
cláusula 8 va a lista de guiones, y por eso el texto que se firma no es el Markdown de la fuente.

## ⚠️ Dónde el documento aprobado y el producto todavía no calzan

- **Cláusula 8 vs `src/lib/radar/acceso.ts`:** el documento dice que, pagada la primera cuota, el
  impago posterior **nunca bloquea** (gracia a 5 días, luego solo lectura). El código cierra el
  módulo entero y lo cierra **el mismo día** del vencimiento. Los dos huecos los cierra el motor de
  solo lectura (`proyectos/metrik/one/2026-09-28_spec-motor-solo-lectura.md`).
- **Cláusula 11:** el comentario de `producto.ts` que decía «el Radar no tiene esa cláusula» quedó
  corregido: la cláusula existe y se cumple sin designación porque quien acepta declara su calidad.

Relacionado: [[radar-secop-modulo]], [[terminos-modulo-radar]], [[entrada-unica-valida-api]],
[[razon-social-metrik-ia]].
