---
name: valida-bolsa-prepagada
description: Bolsa prepagada de consultas en metrik-valida (4D SOFT) — #43 ya en main y 0032 en produccion; reglas vigentes y la forma de consumo_actual con bolsa (plan y periodo en null)
metadata:
  type: project
---

**Estado al 2026-09-15 (segun el coordinador):** #43 mergeado (`db63fb8`), 0032 en produccion y 4D SOFT
con bolsa vigente de 20.000 consultas que vence el 2027-03-15. ⚠️ Lo de abajo sobre "sin mergear / sin
aplicar / sin bolsa" CADUCO. Con bolsa, `consumo_actual` trae `plan: null` y `periodo: null` a
proposito: todo consumidor tiene que mirar `modalidad` antes (el portal #42 se caia leyendo
`periodo.inicio`, ver [[valida-portal-autoservicio]]).

**Estado al 2026-09-14 (caducado):** PR **bi-metrik/metrik-valida#43** (`feat/bolsa-prepagada`) abierto, **sin
mergear**; `db/migrations/0032_bolsa_prepagada.sql` **sin aplicar**; 4D SOFT (cliente_api
`8c211c68-6c25-4beb-b364-c91c284d6379`, externo, sin plan) **sin bolsa asignada** y con 0 consultas.

**Reglas vigentes (decision de Mauricio 2026-09-14, fuente `negocios.metadata` de X1 26 1 en ONE):**
la bolsa vence 6 meses despues de la entrega de credenciales, se corta con lo primero (agotarse o
vencer), sin excedente ni arrastre; cortada, `/validate` responde 402 `bolsa_agotada` / `bolsa_vencida`.
⚠️ El brief original decia lo contrario (no vence, excedente descontado de la bolsa siguiente) y el
coordinador lo corrigio a mitad del encargo: **las condiciones comerciales de un cliente se leen de la
metadata del negocio en ONE, no del brief**. Toda la parte de excedentes se quito.

**Why:** es el primer cliente de API directa y el modelo de cobro (plata) vive en SQL: trigger `BEFORE
INSERT` en `consultas` con SQLSTATE `VB001`/`VB002`, recarga idempotente por referencia de pago.

**How to apply:**
- Orden: aplicar 0032 **antes** del merge (es compatible con el codigo de main: llaves nuevas que el
  codigo viejo ignora y trigger inerte sin bolsas). Registrar la fila del ledger. Ojo: el ledger no
  registra 0031.
- Justo despues del merge, asignar la bolsa por `POST /api/admin/clientes/<id>/bolsa`: un cliente
  externo sin plan ni bolsa **no tiene tope** en `/validate`.
- Decisiones abiertas en el cuerpo del PR (vence_en exacto, recompra anticipada que pierde saldo,
  avisos 30/7/1 fijos, recarga sin UI, IVA).
- Otro Max construye el portal de autoservicio (`feat/portal-api-autoservicio`) que solo LEE
  `/cuenta/consumo` y `/cuenta/alertas`; la forma de la bolsa quedo publicada en el PR. Si cambia la
  forma, avisar a ese frente. Relacionado: [[pglite-pruebas-sql]], [[sql-y-despliegue-metrik-valida]].
