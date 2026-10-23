---
name: funciones-mapa-salon
description: Módulo funciones de ONE (Sabor etapa 2, PR #1234): migración 20261022170000 SIN aplicar; campañas, cupos, tarifa con preventa por fecha de fin, pagos, panel, ficha P11 y tres textos
metadata:
  type: project
---

PR #1234 (rama `feat/funciones-mapa-salon`). Migración `20261022170000_modulo_funciones.sql` **SIN aplicar**; va
DESPUÉS de `20261021090000_asistente_chatwoot.sql` (#1225; main la da por aplicada, confirmarlo en el ledger).
Dry-run: `node scripts/funciones-dry-run.mjs` (esperado al 23-oct: 49 RPC, 8 tablas con RLS).

**Why:** decisiones de Mauricio del 22 y 23-oct: sin mapa del salón; «Todo sale y vuelve a ONE» (precio, abono,
cupos y monto en la base, el asistente no hace cuentas); Experiencia → Campaña → Función; P11 (ficha en tres niveles
y tres textos, §1.8 del diseño, que manda sobre lo anterior); P4 (preventa = interruptor por función con fecha de fin).

**How to apply:**
- La ficha se crea en ONE (sin PDF ni extracción). Campos aprobados y NO más: experiencia (título oferta, gancho,
  intro, qué incluye[], emojis, saludo y relato del grupo, edad mínima), función (es_preventa, preventa_hasta) y
  `funcion_negocio` (dirección, piso, recepción, parqueadero, firma). El «mensaje largo de condiciones» no existe.
- Una regla, un lugar: `funcion_tarifa` (precio y preventa vigente por día de Bogotá), `funcion_motivo_asistente`,
  `funcion_ocupadas`. En TS solo el doble `memoria.ts`, que el contrato compara con la base. Los textos usan la tarifa
  que ya resolvió la base, no recalculan.
- Textos en `_shared/funciones/textos.ts` (lógica) + `textos-plantilla.ts`: solo link de Bold; Nequi/Daviplata en un
  texto libre = `avisos` que NO bloquea (23-oct); `[FALTA: …]` y pasar el límite SÍ bloquean copiar; sobrante no se
  corta. El DM va SIN la intro (23-oct): con la ficha real de Jack, 771 bytes (con intro eran 965). Las líneas de pago
  están aprobadas palabra por palabra (oferta sin punto final): no retocarlas.
- Frases con tema de la película van en `saludo_grupo` de la experiencia; recepción/puerta del negocio sin tema.
- Plazo del saldo = `funcion_campanas.dias_saldo_antes` (1..30, default 1; viaja dentro de `p_precios` de
  `funcion_guardar_campana`, como `tope_sobreventa`, para no cambiar la firma). Solo dato + texto: link/pago del saldo
  esperan la P14. Se eligió ≥ 1 (no 0) para dar margen de verificar el pago antes de la función.
- Al asistente NUNCA un número de cupo: `estado` y alternativas (prueba que recorre las salidas).
- Pagos (P13): `funcion_preparar_pago` → link → `funcion_registrar_pago` (servidor, idempotente). Sin cupo al pagar =
  `pendiente_persona`; solo una persona sobrevende o devuelve. `expiration_date` de Bold en ms SIN VERIFICAR.
- Regla de la fecha de fin de preventa en pantalla: `preventaPasaLaFuncion` + `diaBogota` (`reglas.ts`), contrastadas
  con la RPC en `funciones-sql.test.ts` (incluye una función a las 10 p. m., que en UTC ya es otro día).
- La prueba de fechas por patrón vive en `textos.test.ts`: si se agrega una fecha u hora a una plantilla, tiene que
  salir de la función o de la campaña, o la prueba cae.
- PGlite no prueba el `for update`: la concurrencia real va en el job de CI con Postgres 16 y su mutación sin candado.
- El fixture `src/lib/funciones/__fixtures__/esquema-base.sql` crea service_role con BYPASSRLS (como Supabase).
