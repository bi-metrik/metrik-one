---
name: valida-cda-restriccion-y-plan-anual
description: #1064 restricción de consultas a los 5 días (rige 2026-11-05) y el PR del Plan Anual CDA — migración 20261007090000 SIN aplicar; el anexo NO va en documentos_contractuales_versiones; cuotas usuarios_adicionales en cero
metadata:
  type: project
---

Dos PR del 2026-10-06 (decisiones de Mauricio en `proyectos/metrik/valida/decisions.md`).

**#1064 (restricción por mora, sin migración)**: `restringido` desde D+6, `suspendido` desde D+31, solo
desde `RESTRICCION_VIGENTE_DESDE = '2026-11-05'` (si el aviso de la 13.1 sale otro día, se corre esa
constante). `accesoValida({ consultaNueva: true })` solo en `consultarValida` y `prepararLoteValida`.
Debe estar en producción ANTES del 2026-11-05.

**Plan Anual (feat/valida-cda-plan-anual)**: migración `20261007090000` SIN aplicar; inerte sin
`servicios_contratados.parametros.plan_anual_habilitado = true`.

**Why:** el anexo (Emilio) sigue en borrador; Mauricio decidió 11 x 12 hasta 2027-03-31.

**How to apply (lo que no se ve en el código):**
- ⚠️ Un documento en `documentos_contractuales_versiones` visible para un CDA es uno que la entrada de
  `/valida` le EXIGE aceptar (`estadoTerminos`). Por eso el anexo vive como constante
  (`plan-anual-anexo.ts`) y la constancia en `planes_anuales_cda`. Registrarlo ahí cierra Valida a todos.
- Durante el plan las cuotas mensuales del plazo son `usuarios_adicionales` (pueden valer 0): así una
  licencia comprada en el año se carga por la maquinaria de siempre. La mora del servicio las ignora
  (`TIPOS_CUOTA_SIN_MORA`). `licencias-servidor` excluye la cuota `anual` (su período de 12 meses se
  leería como UNO y cargaría $50.000 por el año).
- La cuota anual vence el día ANTERIOR al pago: si venciera el mismo día, el FIFO le daría parte de la
  plata a la mensualidad en curso.
- Al terminar el plan no hay cuotas de renovación (pendiente general de `cuotaDeRenovacion`).

Relacionado: [[valida-cda-gracia-facturas]], [[pago-en-linea-bold]], [[seccion-suscripcion-cda]].
