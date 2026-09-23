---
name: retencion-iva-cobro-neto
description: 2026-09-23 — enlace de pago por el neto con retención de IVA del cliente (METRIK IA del SIMPLE); migración 20260924100000 SIN aplicar; inerte hasta cargar 3 datos
metadata:
  type: project
---

PR `feat/retencion-iva-cobro-neto`: el enlace de una cuota gravada sale por total − 15% del IVA
cuando el cliente es responsable de IVA; el cobro queda con `monto` = neto (la plata que entró) y
`cobros.retencion_iva` en `certificado_pendiente`. Migración `20260924100000_retencion_iva_cobro.sql`
**sin aplicar** al abrirlo (va ANTES del merge: el detalle del negocio y la sección Suscripción
seleccionan `retencion_iva` y rebotarían con 400).

**Why:** acta Carmen/Felipe 2026-09-23 (sección A). Operación interna de MeTRIK como cobrador; no
es función de producto (frase vetada «calcula retenciones automáticamente»).

**How to apply:**
- Inerte hasta que existan LOS TRES datos: `workspaces.config_extra.cobros.retencion_iva_pagador_pct`
  (15, solo en `metrik`), `plan_cobro_cuotas.iva` > 0 (IVA incluido en el total, la cifra de la
  factura) y `empresas.responsable_iva = true` (ya existía, del OCR del RUT; `null` NO retiene).
- Lo que CUBRE la cuota es `monto + retencion_iva`: el FIFO (`cuotasConEstado`), `cobradoConfirmado`,
  la tarjeta BloqueCobros y la RPC `mis_cobros_de_servicio` (nueva columna al final) lo cuentan. Otras
  sumas de `cobros.monto` del motor (gates UPME de SOENA) NO — no aplican a metrik.
- Si el cliente paga el total por el enlace, el webhook quita la retención (`quitarRetencionIva`).
  La confirmación MANUAL no la quita: si pagó el total por transferencia hay que limpiarla a mano.
- Medido al abrirlo: 8 clientes de metrik con `responsable_iva = true`, solo AirXpress y Termotech con
  `rut_verificado`; Soena y AFI en `null`. Solo CP 26 1 y X1 26 1 tienen contrato de servicio (el
  enlace exige `servicios_contratados`), así que hoy ninguna cuota Clarity genera enlace.

Relacionado: [[pago-en-linea-bold]], [[project-enlace-pago-automatico]], [[factura-cobro-servicio]].
