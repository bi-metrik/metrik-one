---
name: soe001-seguimiento-operaciones
description: SOE-001 SOENA (2026-10-07) — Seguimiento partido en 4 etapas de operaciones; migración 20261007184500 y SQL de datos SIN aplicar; orden migración → merge → deploy alertas-plazo → datos
metadata:
  type: project
---

Seguimiento (orden 19) se reusa como «Entrega a la DIAN» (T0) y se agregan 21 Confirmación del
radicado, 22 Validación de rechazo (sin gate), 23 Acto administrativo, 24 Dinero en cuenta. Opción A
por decisión de Mauricio (Hana recomendaba B).

- Producto (PR feat/soena-seguimiento-operaciones): `plazos_pendientes` con alcance y ancla POR HITO;
  `alertas_plazo_log.ciclo` por trigger + «ya avisado» por `enviado_at` posterior al último reproceso;
  destinatarios por hito en la edge `alertas-plazo`; motivo de lista en reprocesos
  (`reproceso_eventos.motivo`); el operativo del caso reprocesa donde la etapa declara
  `reproceso_operativo` y la causa la fija el motivo; `registrar_avance_anticipado` (marca en
  activity_log, sin frenar); `get_directivo_soena` fila 9 = [19,21,22,23,24].
- Datos: `proyectos/soena/ve/migrations/20261007_soe001_seguimiento_pasa_a_operaciones.sql`, un DO con
  `v_seco` (true = dry-run). Aborta si la migración de producto no está aplicada.

**Why:** el primer cron con hitos nuevos y sin alcance por hito le manda todo el inventario (R6).

**How to apply:** orden estricto: migración → merge → deploy `alertas-plazo` → SQL de datos → `seco`
antes del cron de las 8:00. Primer digest esperado ~148/72/5 (radicado_5/rechazo_15/acto_30), todo
«estimada». Abiertos sin resolver: SLA de la 19 (240 h), V0065 con fecha_devolucion '0006-02-18',
quién corrige la causa de un reproceso abierto por el operativo. Relacionado: [[cierre-automatico-reproceso]].
