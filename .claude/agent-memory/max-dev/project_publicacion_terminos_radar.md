---
name: publicacion-terminos-radar
description: Publicar terminos-uso-radar@1.0 destapó que el mecanismo de Valida SOLO sirve para documentos de alcance 'cliente' (con empresa_id); un documento genérico ('plantilla') es invisible y no se puede aceptar en tres lugares, y la fila propuesta sigue SIN aplicar
metadata:
  type: project
---

Documento cerrado por Emilio Castañeda (CLO) el 2026-09-28:
`proyectos/metrik/legal/terminos-uso-radar-v1.0.md`, 12 cláusulas. Sin su fila registrada el gate
del Radar no abre; sin aceptación, el trial de 5 días de #955 no arranca (ancla:
`aceptaciones_terminos.respondido_at`).

## ⚠️⚠️ Registrar un documento es una FILA de datos, y la del Radar queda inerte

`sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql` — **SIN aplicar**. No es migración: la tabla
`documentos_contractuales_versiones` ya existe desde `20260916180000`.

**El mecanismo de Valida NO sirve tal cual para un documento genérico.** El texto del Radar no
lleva datos de ningún cliente, así que su alcance es `plantilla` (sin `empresa_id`) — y ese camino
**nunca se ha ejercitado**: en producción no hay ni una fila `plantilla` (medido 2026-09-28). Tres
puntos lo unen por empresa y lo dejan fuera:

1. `mis_documentos_de_servicio()` (`20260916213000`): `join mios m on m.empresa_id = d.empresa_id`
   es un join INTERNO → el documento nunca sale.
2. `aceptaciones_terminos_modulo()` (`20260923220000`, paso 2): exige contrato con
   `sc.empresa_id = v_doc.empresa_id` → con nulo levanta excepción.
3. `versionContratada()` (`src/lib/valida-api/terminos-servidor.ts`): `if (!v?.empresa_id) return null`.

**Registrarlo como `cliente` por empresa tampoco sirve:** `pdf_sha256` es UNIQUE global y el PDF es
byte a byte el mismo para todos → el segundo cliente del Radar no podría registrarse. Y hoy no hay
a qué empresa colgarlo: **no existe contrato de Radar ni workspace de Fabri** (medido).

**How to apply:** antes de prometer que «publicar el documento abre el gate», mirar si el documento
es genérico. Si lo es, falta un PR que le enseñe `plantilla` a esos tres puntos (migración de dos
funciones + una línea de TS). Hermano de [[terminos-modulo-radar]], [[entrada-unica-valida-api]].

## Cuál huella es la canónica

La del **PDF**: `aceptaciones_terminos.documento_sha256 = pdf_sha256` es la llave del vínculo, y el
PDF es lo que el cliente recibe. `texto_sha256` es el segundo sello, y sigue siendo sha256 del
`texto_md` TAL CUAL (sin trim ni salto final).

PDF y texto canónico se generan juntos con
`proyectos/metrik/legal/terminos-radar-v1.0/_generador/generar.py` (WeasyPrint, mismo CSS y logos
que 4D SOFT y los CDA; 4 páginas, nada cortado, verificado extrayendo el texto del PDF). **El
lector de la pantalla no pinta tablas**: la tabla de la cláusula 8 va a lista de guiones, y por eso
el texto que se firma no es el Markdown de la fuente.

## ⚠️ Dónde el documento aprobado y el producto no calzan

- **Cláusula 8 vs `src/lib/radar/acceso.ts`:** el documento dice que, pagada la primera cuota, el
  impago posterior **NUNCA bloquea** (gracia a 5 días, luego solo lectura). El código mergeado en
  #955 **cierra el módulo entero** (`motivo: 'cuota_vencida'`) y lo cierra **el mismo día del
  vencimiento**, sin gracia. Las dos diferencias las tiene que cerrar el motor de solo lectura
  (`proyectos/metrik/one/2026-09-28_spec-motor-solo-lectura.md`), antes de la primera mora posible.
  El argumento viejo de que «solo lectura no restringiría nada en el Radar» quedó superado: se ven
  todos los procesos pero no se filtra.
- **Cláusula 11 pide representante legal o apoderado.** `producto.ts` justifica
  `exigeDesignado: false` diciendo que «el Radar no tiene esa cláusula»: esa razón ya es falsa.
  Funciona igual (el dueño declara su calidad, y `CALIDADES_ACEPTANTE` son justo esas dos), pero el
  comentario miente y hay que corregirlo si se vuelve a tocar.
- **Versión `1.0` sin la `v`:** las 10 filas de Valida usan `v1.0`/`v1.3`. Se siguió el propio
  documento (`Versión: 1.0`) y el comentario de `producto.ts` (`terminos-uso-radar@1.0`).

Relacionado: [[radar-secop-modulo]], [[terminos-modulo-radar]], [[razon-social-metrik-ia]].
