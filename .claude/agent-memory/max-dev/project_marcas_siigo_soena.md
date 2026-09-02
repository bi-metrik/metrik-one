---
name: marcas-siigo-soena
description: Estado de las marcas siigo_cliente de SOENA tras la corrección del 2026-09-02 — qué se corrigió, qué NO se tocó a propósito, y los terceros basura que quedan en Siigo esperando a Diana
metadata:
  type: project
---

El 2026-09-02 se corrigieron **11** marcas `negocios.metadata.siigo_cliente` de SOENA
que la emisión de la factura había pisado (PR de `fix/correo-cola-y-marca-siigo`,
migración `20260902000010`, respaldo en `public.backup_marcas_siigo_cliente_20260902`).

**Why:** el daño original era la heurística `nit_sin_dv` (cédula sin su último
dígito); `asegurarClienteSiigo` ya lo corregía al vuelo, y el `update` de
`siigo_factura` —hecho sobre una copia de `metadata` leída antes— lo volvía a
sembrar. Verificado contra Siigo por GET antes de tocar nada: **11 de las 12
facturas salieron con la identificación del RUT**, así que el documento fiscal
está bien y lo único que mentía era la marca.

**Lo que quedó ABIERTO y NO se tocó:**

- ⚠️ **V0189 / FV-2-244 salió con la cédula TRUNCADA** (`8081571`; el RUT dice
  `80815711`), estado `Accepted` en Siigo. Es un documento fiscal mal emitido:
  lo deciden Mauricio y Carmen. Su marca se dejó como está porque es el registro
  fiel de lo que se emitió; corregirla borraría la evidencia. El comentario de
  `marcaSigueValida` ya la mencionaba como rechazada por la DIAN, y el `stamp`
  de Siigo dice `Accepted`: las dos cosas no se contradicen necesariamente
  (rechazo del cliente vs. validación técnica), pero **nadie lo ha comprobado**.
- **7 marcas desalineadas en negocios SIN factura** (V0012, V0046, V0066, V0087,
  V0279, V0282, V0283). Se reparan solas la próxima vez que corra
  `asegurarClienteSiigo`, que compara la marca contra el RUT.
- **V0279 NO es una truncación: es otra identidad.** Marca `1032416140` (SARA
  MARCELA VILLALOBOS SIERRA, el RUT de V0257) sobre un negocio de ADRIANA GARCIA
  (`51977545`). La marca se escribió el 2026-08-10 y el RUT del negocio se
  corrigió el 2026-08-25: el bloque `rut` de V0279 tenía el documento de otra
  persona. No se facturó, así que no hubo daño; se arregla sola.
- **15 terceros basura en Siigo** con la cédula truncada y **cero facturas**
  (V0012, V0046, V0066, V0087, V0135, V0137, V0160, V0177, V0181, V0191, V0199,
  V0206, V0272, V0275, V0282/V0283 comparten uno). Diana los puede borrar. El
  decimosexto, `8081571`, **NO se puede borrar**: tiene FV-2-244 colgando.

**How to apply:** antes de proponer cualquier limpieza de marcas o de terceros de
SOENA, releer este estado y **re-medir** — las 7 abiertas cambian solas. Y antes
de tocar una marca de un negocio facturado, preguntarle a Siigo con qué
identificación salió el documento: la marca y la factura pueden discrepar en
cualquiera de los dos sentidos.

Relacionado: [[medir-antes-de-construir]], [[sql-prod-one]],
[[medicion-cola-facturacion-con-vitest]].
