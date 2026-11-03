---
name: soe035-rc3-solo-iva
description: SOE-035 (30-oct) — solo_iva sin techo_tarifa en v_negocio_valor (migración 20261030163500 SIN aplicar); sobrepago <= $1.000 en a_tarifa no es tarifa; fila frenada muestra porción UPME
metadata:
  type: project
---

SOE-035 (SOENA, 2026-10-30), rama `fix/soe-035-rc3-solo-iva`. Tres cambios:

1. `v_negocio_valor`: servicio `solo_iva` (bloque `servicio_contratado`) → `tarifa_confirmada` 0 → `techo_tarifa` 0. Migración `20261030163500_soe035_solo_iva_sin_techo_tarifa.sql` recreada desde la def del repo (20260824000001), **SIN aplicar**. Antes de aplicar hay que comparar con `pg_get_viewdef` de prod (no se pudo leer prod) y medir qué cobros solo_iva tienen ya un RC-3 (su a_tarifa pasa a excedente).
2. `planRc3DelNegocio`: si la `a_tarifa` total del negocio es <= `TOLERANCIA_SALDO_COP` y ningún pago tiene RC-3 → `sin_tarifa` (V0660: $45). Rompe la idea vieja de que los $45 de V0633 solos eran «esperando_pagos».
3. Panel: `porcion_upme` (= `plan.tarifaSinAcusar`) y `espera_upme` (frase entera, no «Falta …»); `emitibles` excluye `espera_upme`. `MENSAJE_SIN_COMPROBANTE_UPME` cambió de texto (también lo devuelve la emisión del servidor).

**Why:** Diana leía 7 frenados «Falta el valor del comprobante» con el pago entero en grande; 3 eran solo_iva y 1 un sobrepago de $45.

**How to apply:** si vuelve a aparecer un RC-3 raro en solo_iva, revisar primero si la migración ya está aplicada. El panel esconde un pago `sin_tarifa` solo si su reparto se conoce (sin reparto sigue frenado por «el reparto del pago»).
