---
name: post-cotizacion-ola2
description: Post-cotización Trappvel ola 2 (2026-10-12) — motor de recordatorios #1113, esquema plan de pagos #1114, seguimiento F1 (PR 5 apilado); 3 migraciones SIN aplicar
metadata:
  type: project
---

Ola 2 del plan post-cotización: #1113 motor de recordatorios (`recordatorios_log`, 20261012160000), #1114 esquema
del plan de pagos del viajero (20261012170000), PR 5 seguimiento F1 apilado sobre #1113
(`cotizaciones.origen_version`, 20261012180000). Las tres migraciones **SIN aplicar** al cerrar la sesión.

**Why:** Vera manda sobre el diseño técnico; los hallazgos no obvios que cambian lo que sigue:
- `pausado_hasta` NO sirve como fuente del toque del aplazamiento: `pausa-sla` (6:00) lo borra al reactivar, antes
  del motor (7:30). El toque lee `negocios.metadata.seguimiento.aplazado_para`.
- `enviarCotizacionNegocio` (bloque) nunca escribía `fecha_envio`; `enviarCotizacion` (editor) sí, siempre. El PDF
  usa `fecha_envio` para la fecha y la vigencia: escribirla fuera del interruptor cambiaría el PDF de SOENA.
- El canal del envío vive en `activity_log` (`campo_modificado = 'cotizacion_envio'`, `valor_nuevo` = canal): el
  brief permitía una sola columna.
- `perderNegocio` no validaba el motivo contra ninguna lista; los 5 motivos de Noor usan los `value` globales tal
  cual (precio, competencia, timing, no_responde, otro), sin mapeo.

**How to apply:**
- Motor: solo canal `in_app`; `email`/`wa_manual` no reclaman la llave (llegan en PR 9 con la franja 7-20 h).
- Gate `resultado_seguimiento` (F1-6) y embudo (F1-5) NO están: dependen de PR 8 y F6.
- Antes de PR 9 (fuente `cuota`), extraer `cuotasConEstado` a `src/lib/cobros/cuotas-fifo.ts`.

Relacionado: [[post-cotizacion-servicios-f0]], [[pruebas-por-mutacion]].
