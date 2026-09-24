---
name: titularidad-tarjeta-excel
description: negocio_card.campos_extra (2026-09-24) — titularidad en tarjeta y Excel; migración SOENA SIN aplicar; la lista NO evalúa «aplica», lo reemplaza solo_si
metadata:
  type: project
---

`workspaces.config_extra.negocio_card.campos_extra` (módulo `src/lib/negocios/card-extras.ts`): campos extra en la tarjeta de /negocios y columnas extra al final del Excel. Primer uso: titularidad de SOENA (Deisy).

**Why:** la titularidad solo se veía en la ficha (datos clave); para saber qué casos eran copropiedad había que abrirlos uno por uno.

**How to apply:**
- ⚠️ Migración `20260925150000_soena_titularidad_tarjeta_y_excel.sql` va ANTES del merge (inerte con código viejo). Solo config.
- La RPC `negocio_bloques_campos_json` indexa por NOMBRE de bloque; la config va por slug y una lectura de `bloque_configs` traduce. Lee también copias con el mismo nombre (primera con valor gana), igual que la cédula.
- La lista NO evalúa si el bloque aplica (`condicion_cumplida` por negocio es caro). Lo reemplaza `solo_si` por línea de detalle: el RUT 2 solo si `modalidad_solicitante = copropiedad`.
- Medido 2026-09-24 (476 negocios SOENA): 381 único, 13 copropiedad, 82 sin modalidad; CERO casos no-copropiedad con RUT 2 cargado hoy. V0381 y V0482 son copropiedad sin RUT 2.
- Mutante equivalente conocido: `json_to_sheet` agrega al final las claves que no están en `header`, así que pasarle solo `ENCABEZADOS` al libro no cambia nada visible.

Relacionado: [[datos-clave-cruces-titularidad]].
