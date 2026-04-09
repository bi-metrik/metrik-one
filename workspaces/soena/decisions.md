# SOENA — Decisiones

Historial acumulativo de decisiones especificas del workspace SOENA.

| Fecha | Decision | Contexto |
|-------|----------|----------|
| 2026-04-01 | Proceso VE como primer Clarity sobre ONE | Pipeline (A-B comercial) + Proyectos (C-F operativo). 11 etapas, 9 campos custom, gates documentales. Bizzagi sin API |
| 2026-04-01 | Gates son servicio Clarity — tenant_rules vacio por defecto | MeTRIK configura via /configure-gates segun proceso real del cliente |
| 2026-04-05 | Modulos financieros todos activos para SOENA | proyecto_modules: flujo_caja, costos_ejecutados, detalle_ejecucion, cotizacion_readonly |
| 2026-04-05 | Auto-cobros VE: anticipo al ganar + saldo al llegar a por_cobrar | ganarOportunidad crea anticipo si referencia + valor existen. moveProyectoVe crea saldo dinamico |
| 2026-04-05 | Cotizaciones de negocio: codigo = consecutivo directo | Trigger detecta oportunidad_id IS NULL y usa consecutivo. No formato opp_codigo-CN |
| 2026-04-06 | Persona natural = empresa automatica | Regla de negocio: PN es su propia empresa. Migration 004 fue parche incorrecto |
| 2026-04-06 | BloqueDocumentos: upload real (no inputs URL) | Bucket ve-documentos, path workspace/negocios/negocioId/bloqueId/slug.ext |
| 2026-04-06 | Gate comentario: config_extra.gates en etapas_negocio | Array configurable por etapa. comentario_requerido verifica activity_log |
| 2026-04-07 | Cobros automaticos desde bloques datos, nunca manuales | Anticipo (etapa A2) y multi-pago (etapa D2) via config_extra triggers |
| 2026-04-07 | Saldo = precio_total - sum(cobros), nunca pre-creado | Calculo dinamico en BloqueCobros. Evita inconsistencias |
| 2026-04-07 | require_confirm para bloques financieros | BloqueDatos anticipo no auto-completa. Boton explicito |
| 2026-04-07 | cobros.proyecto_id nullable — negocios VE no tienen proyecto | Cobros de negocios solo tienen negocio_id |
| 2026-04-08 | BloqueDocumentos: useRef para auto-complete | React 18 setState batching no confiable. useRef.current sincrono |
| 2026-04-09 | BloqueHistorial: visualizacion pura en etapas ejecucion/cobro | Tabs gastos/horas/cobros, is_visualization=true, sin edicion |
