---
name: aviso-factura-cuota-cargada
description: Aviso en la campana al pagador cuando metrik carga la factura de una cuota; migración 20261022153000 APLICADA en prod (22-oct); solo la persona designada lo recibe
metadata:
  type: project
---

`cargarFacturaCuota` llama `avisarFacturaCargada` (`src/lib/valida-cda/aviso-factura-cuota*.ts`) tras el upsert: tipo
`factura_cargada`, en el `workspace_pagador_id`, `grupo_clave = factura_cuota:<cuota>`, enlace `/suscripcion?tab=pagos`.
PR #1244 (2026-10-22). La migración `20261022153000_notificaciones_tipo_factura_cargada.sql` ya está aplicada en prod y
en el ledger con esa versión: no renombrarla (sin ella el insert choca con el CHECK y solo se loguea).

**Why:** Mauricio (22-oct) pidió avisar al pagador al cargar la factura. La pestaña Pagos solo la ve la persona designada
(`puedeVerSuscripcion`), así que el brief «quien ve Pagos + designado» se reduce al designado; avisar al dueño lo
mandaría a un 404.

**How to apply:** si piden avisar a más gente, cambiar `destinatariosAvisoFactura` Y la regla de Pagos juntas. El Carmen
(e86ab950) tiene contrato cancelado (designado «Oficial de Cumplimiento») y activo (designado «CDA El Carmen», admin):
manda el activo. El subagente lee prod con supabase-js solo-GET ([[reproducir-pdf-real-solo-lectura]]); sin MCP no lee
`pg_constraint`, por eso la migración amplía el CHECK leyendo el vivo (patrón 20260928170500).
