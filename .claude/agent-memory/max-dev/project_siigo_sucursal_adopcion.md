---
name: siigo-sucursal-adopcion
description: PR #550 (sin mergear) — la sucursal del tercero de Siigo y la adopción de la factura que ya existe; qué se autocorrige solo, qué queda abierto y por qué las dos piezas van juntas
metadata:
  type: project
---

**PR [#550](https://github.com/bi-metrik/metrik-one/pull/550)** — checks en verde,
**Mauricio decide el merge**: toca el camino de emisión de facturas electrónicas.

**Why:** Siigo resuelve el tercero de un documento por **identificación MÁS
sucursal**, y el payload mandaba la sucursal 0 fija. Un tercero que vive en la
sucursal 1 hacía que la API respondiera `The customer doesn't exist: <cédula>` —
literalmente cierto para Siigo y completamente engañoso para quien lo lee. Al
medir el radio apareció lo grande: los dos casos bloqueados (V0345 y V0134) **ya
tienen factura en Siigo** del 2026-03-31 por su valor exacto. El error de sucursal
era lo único que evitaba una segunda factura electrónica a un cliente ya
facturado, y una radicada no se corrige, se anula.

**How to apply:** las dos piezas van **juntas o en ese orden**. Arreglar solo la
sucursal habilita la segunda factura. Si alguien parte el PR, la adopción va
primero.

## Lo que se autocorrige solo (no hay backfill que correr)

`marcaSigueValida` exige ahora que la marca del tercero traiga `branch_office`.
Las **252 marcas** que existen no lo tienen, así que el primer intento de
facturar rehace el camino (GET + re-marca) y el segundo emite. Verificado contra
producción el 2026-09-07: ni V0345 ni V0134 lo traen todavía. Es el mismo patrón
de `nit_sin_dv` (#394).

⚠️ **No proponer un backfill de esas marcas.** Cuesta un GET por caso, una sola
vez, y solo en los casos que alguien de verdad va a facturar.

## Lo que queda ABIERTO

- **Quedan ~24 terceros más fuera de la sucursal 0** en el catálogo de SOENA (26
  de 711: bo=1 son 23, más uno en la 2, la 10 y la 214). El día que entre un
  negocio de alguno, el fix ya lo cubre — pero mover esos terceros a la sucursal 0
  **no** es la solución y quedó fuera de alcance a propósito: es la contabilidad
  del cliente y además no evita la reincidencia.
- **Los 6 candidatos 1-a-1 del cruce NO se aplicaron y no son una lista para
  aplicar.** Tres de ellos (V0134, V0253, V0276) están en la lista de 7
  emparejamientos que **Mauricio rechazó el 2026-08-10** (respaldo
  `backup_marcas_factura_20260810`); V0253 empareja con una factura de $850.000
  contra un precio aprobado de $637.500. La coincidencia de valor no es prueba.
- **Nada de QA en pantalla.** La adopción no se ejercitó contra el Siigo real: en
  toda la sesión hubo cero POST y cero escrituras. Lo que se probó es el código,
  con dobles.

## Dos hechos medidos que la pantalla ahora usa

- **269 de 430 negocios de SOENA tienen marca de factura**, y **exactamente 2 no
  tienen su PDF en el bloque**: V0177 (FV-2-373) y V0076 (FV-2-459). Son los
  únicos que el campo nuevo `factura_sin_pdf` va a señalar, y el botón para ellos
  dice «Traer el PDF desde Siigo».
- El guardián de duplicados **filtraba por el producto a emitir** y por eso no
  veía las facturas hechas a mano: ONE emite bajo el `11`, las manuales viejas
  están bajo el `22` (146 de las 213 libres). Ese filtro ya no existe.

Relacionado: [[sql-prod-one]], [[marcas-siigo-soena]], [[medir-antes-de-construir]].
