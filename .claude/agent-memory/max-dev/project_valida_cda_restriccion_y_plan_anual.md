---
name: valida-cda-restriccion-y-plan-anual
description: Plan Anual CDA (#1065) — migración 20261007210000 SIN aplicar; anexo final v1/v2.0 GENERADO desde docs/legal; vigente_hasta = 12.1 (null en los 4 CDA); mención en tabla aparte; comisión prepago; pendientes en #1072
metadata:
  type: project
---

**#1065 (feat/valida-cda-plan-anual)**: migración `20261007210000` SIN aplicar (renombrada desde
`20261007090000` el 2026-10-07: ordenaba antes de #1068 y SOE-001, ya aplicadas). Inerte sin
`servicios_contratados.parametros.plan_anual_habilitado = true`. Pendientes del anexo (8.1, 8.2, 10.2,
5.2, motor de comisión) en el issue #1072.

**Why:** decisiones de Mauricio 2026-10-06/07; Vera aprobó el texto CONDICIONADO a que #1065 mueva
`vigente_hasta` antes de encender (`proyectos/metrik/valida/decisions.md`, fila 2026-10-07).

**How to apply (lo que no se ve en el código):**
- ⚠️ La fecha de la cláusula 12.1 NO tiene columna propia: `servicios_contratados.vigente_hasta` hace de
  ella, pero el SQL de carga la dejó `null` en los 4 CDA (la fecha solo está en el texto de los Términos:
  Maxitec 21-dic-2026, los otros 15-ene-2027). Nada en ONE la lee para avisar fin ni suspender.
- ⚠️ El anexo NO se edita a mano: `docs/legal/plan-anual/*.md` (copia byte a byte del repo metrik) →
  `node scripts/generar-anexo-plan-anual.mjs`. La prueba compara constante ↔ .md en CI.
- ⚠️ Un documento en `documentos_contractuales_versiones` visible para un CDA es uno que la entrada de
  `/valida` le EXIGE aceptar: por eso el anexo vive como constante y la constancia en `planes_anuales_cda`.
- Durante el plan las cuotas del plazo son `usuarios_adicionales` (pueden valer 0); la mora del servicio
  las ignora (`TIPOS_CUOTA_SIN_MORA`) y con #1068 la restricción de 5 días también.
- `calcularComision` no la llama ningún motor todavía: el `prepago` está listo pero nadie lo usa.
- El dry-run va con `EXECUTE $mig$ <archivo> $mig$` y se ensaya en PGlite sobre el ESQUEMA_BASE de
  `plan-anual-sql.test.ts` antes de ponerlo en el PR.

Relacionado: [[valida-cda-terminos-v14-por-aviso]], [[pago-en-linea-bold]], [[seccion-suscripcion-cda]].
