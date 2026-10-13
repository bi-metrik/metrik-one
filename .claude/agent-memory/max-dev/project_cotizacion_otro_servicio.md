---
name: cotizacion-otro-servicio
description: «Otro servicio» (tipo de ranura `otro`) de la cotización por pasos Trappvel (2026-10-13) — migración 20261013140000 SIN aplicar; fuera de botones y detección; valor por todo se reparte; marca asistenciaMedica
metadata:
  type: project
---

Rama `feat/cotizacion-otro-servicio`, desde main tras #1146/#1147. Migración
`20261013140000_cotizacion_ranuras_tipo_otro.sql` (solo amplía el CHECK de `cotizacion_ranuras.tipo`): la aplica la
sesión principal ANTES del merge; sin ella crear la ranura falla 23514 y la línea queda solo con `items.grupo`.

**Why:** Mauricio autorizó la migración el 2026-10-13; diseño de Noor Paso 1 «Escribirlo a mano» y §11; C1–C6 lo
habían dejado fuera por el CHECK de cuatro tipos ([[cotizacion-integrada-c1-c6]]).

**How to apply (lo que no se ve a primera vista):**
- `TIPOS_RANURA` ya incluye `otro`; lo que ofrece la pantalla de siempre o la detección es `TIPOS_CON_PANTALLAZO`.
  Todo `esTipoRanura` nuevo que llegue del cliente debe pensar en `otro` y en el interruptor (`exigirPorPasos`).
- Las guardas viven en 3 sitios (leer, aceptar, `crearRanuraConOpcion`): mutar solo una no rompe N5 (defensa doble).
- «Un valor por todo» se REPARTE en filas por tipo: un solo total con menores cae en TP4 («Falta el 2») y la opción
  queda sin costo. El traslado manual «por vehículo» con niños probablemente tiene ese mismo hueco (sin verificar).
- La prueba de guarda N4 (`por-pasos-lectura-guard`) falla si un lector de plata contiene el TEXTO de la llave del
  interruptor, aunque sea en un comentario.

Relacionado: [[cotizacion-integrada-c0]], [[pruebas-por-mutacion]].
