---
name: suscripciones-cobro-automatico
description: PR #577 (2026-09-08) sin mergear — suscripciones de licencia ONE Fase 1: qué NO hace a propósito (nadie se suspende solo, factura omitida, migración sin aplicar), el hallazgo de AFI con tres planes, y las tres decisiones que esperan a Mauricio
metadata:
  type: project
---

El PR #577 (`feat/suscripciones-cobro-automatico`) construye la Fase 1 del cobro automático
de licencias ONE y queda **sin mergear** por decisión del encargo: trae la migración
`20260908120000_suscripciones.sql` (DDL puro, **no aplicada**) y la decisión de pasarela sigue
abierta. Spec: `docs/specs/2026-09-08_suscripciones-cobro-automatico.md`.

**Why:** Mauricio decidió el 2026-09-08 que Valida/AFI, SOENA y Termotech registren un medio de
pago y la cuota se cobre sola, y que el pago habilite el acceso (regla
`cerebro/reglas/pago-anticipado-habilita-acceso.md`: "el acceso es el producto"). Pero Bold, la
pasarela que él quería, **no tiene hoy tokenización ni cobro iniciado por el comercio**
(verificado ese día en developers.bold.co); ePayco sí cobra por token. El ciclo se escribió
contra una interfaz `PasarelaAdapter` para que la elección no obligue a reescribirlo.

**How to apply:**
- **Nada se suspende solo.** `POLITICA_FASE_1.suspenderAutomaticamente = false`: el ciclo mueve
  `activa → pendiente_pago` al vencer la cuota (informativo, el gate lo deja pasar) y
  `suspendida` solo la escribe una persona. Cambiar eso es la decisión 3 de Mauricio, no un
  ajuste técnico. Y el gate del layout reacciona **solo** a `subscription_status='suspendida'`:
  los 17 workspaces medidos están en `trial`/`active`/`active_pro` y pasan.
- **La tabla `suscripciones` nace vacía y así se queda hasta que Mauricio autorice encenderla**
  (SQL de ejemplo en la §8.1 del spec, con `proximo_cobro` = siguiente cuota SIN pagar). Sin
  filas, el paso 5 del cron `procesar-planes-cobro` no escribe nada; sin la migración aplicada,
  falla dentro de su `try/catch` y los pasos 1-4 no se enteran.
- **AFI no cabe en el modelo "una suscripción = un plan"**: son TRES `planes_cobro` ($400.000 +
  $416.667 + $100.000 ×12) agrupados en una cuenta de $916.667. O se consolida (cambio de datos
  de producción, lo decide Mauricio) o Fase 2 agrega `suscripcion_planes`. Hasta entonces AFI
  sigue como hoy.
- **La factura va ANTES del cargo y en Fase 1 se omite** (`facturaOmitidaFase1`). La Fase 2
  necesita `emitirFacturaCuota` nuevo: `emitirFacturaNegocio` no sirve (exige honorario cubierto
  y una factura por negocio), y el impuesto tiene que ser "excluido" (art. 476 num. 21), no
  "exento" — se verifica contra el catálogo de Siigo antes de la primera emisión.
- **`fechaCuota` salió del cron a `src/lib/cobros/fecha-cuota.ts`** porque el paso 1 y el
  ciclo escriben la misma cuota bajo el unique `(plan_cobro_id, numero_cuota)`; si alguien
  cambia la aritmética en un solo lado, el 23505 lo esconde. El desborde de `setMonth` (31 ene
  + 1 mes = 3 mar) quedó documentado y probado, **no corregido**: ningún plan vivo arranca el
  29-31 y corregirlo movería cuotas ya emitidas.
- Las tres decisiones abiertas (pasarela; día de facturación 1 vs fecha de cuota; política de
  suspensión: gracia, reintentos, automática o manual) están en la §11 del spec. No proponer
  cerrarlas en código: se preguntan.

Relacionado: [[cobros-emision-gate]] (el paso 4 del cron sigue emitiendo cuentas de persona
natural desde el día 10; este PR no lo toca), [[emision-cuentas-cobro-solo-en-produccion]],
[[sql-prod-one]] (cómo se midieron los 17 workspaces y los 10 planes).
