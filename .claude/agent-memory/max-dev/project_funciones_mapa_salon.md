---
name: funciones-mapa-salon
description: Módulo funciones de ONE (Sabor etapa 2, PR #1234): migración 20261022170000 APLICADA (26-oct); campañas, cupos, tarifa con preventa, pagos, saldo (P14), panel, ficha P11 y tres textos
metadata:
  type: project
---

PR #1234 (rama `feat/funciones-mapa-salon`). Migración `20261022170000_modulo_funciones.sql` **APLICADA en prod (26-oct): no editarla**; va
DESPUÉS de `20261021090000_asistente_chatwoot.sql` (#1225; main la da por aplicada, confirmarlo en el ledger).
Dry-run: `node scripts/funciones-dry-run.mjs` (esperado al 25-oct: 56 RPC, 8 tablas con RLS; corre en PGlite con los
fixtures, así se prueba antes de pasarlo).

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
- Frases con tema van en `saludo_grupo` de la experiencia; recepción/puerta del negocio sin tema.
- El módulo NO es solo cine (26-oct, Mauricio): Sabor hace también catas de vino y clases de sushi. Textos visibles
  y parte fija de la plantilla dicen «experiencia»; la puerta cerrada perdió «durante la proyección. 🎬». Caso de cata
  (12 cupos) en `textos.test.ts`, `funciones-sql.test.ts` y caso G de `funciones-concurrencia.sh`, con regex anti-cine.
  Rama `feat/funciones-texto-experiencia` (sin push). `_shared/agente/publico` (asistente) sigue con ejemplos de cine.
- Plazo del saldo = `funcion_campanas.dias_saldo_antes` (default 1; viaja dentro de `p_precios` de
  `funcion_guardar_campana`, como `tope_sobreventa`, para no cambiar la firma). La reserva guarda su FOTO
  (`funcion_reservas.dias_saldo_antes`). P16 (26-oct, Mauricio): se acepta 0 = hasta que empieza la función
  (`funcion_plazo_saldo(t,0)=t`), migración `20261026210000_funciones_saldo_plazo_cero.sql` (rama
  feat/funciones-saldo-plazo-cero; SIN aplicar al abrir el PR; dry-run `scripts/funciones-saldo-plazo-cero-dry-run.mjs`).
  Las pruebas SQL cargan las dos migraciones. Texto de la oferta con 0 («antes de que empiece la experiencia») SIN aprobar.
  Una prueba «a N horas de la función con 1 día» cruza la medianoche de Bogotá según la hora en que corre: usar 1 minuto.
- Saldo (P14a-c, 25-oct): la modalidad se elige AL PAGAR (`funcion_preparar_pago(ws, ids, modalidad)`), no al apartar.
  El saldo es un pago más (`funcion_pagos.concepto`/`medio`); pagado y saldo se calculan en `funcion_saldo_de`, nunca
  se guardan. La verificación a mano crea un pago `manual` (decisión de Max: sin él el saldo sale mal). El link de
  saldo se regenera (el viejo queda `vencido` pero SIGUE vivo en Bold hasta su vence_at: un aviso aprobado sobre un
  pago cerrado va a `revisar`, nunca se ignora). P14d (plantilla WA, recordatorio) pendiente de Vera.
- `pasarelaDelWorkspace` (src/lib/funciones/pasarela-servidor.ts) devuelve null hasta el frente de la pasarela.
- El job de CI quita los `for update` con un perl que solo ve los que cierran en `;` o `loop`: un `for update` dentro
  de un subquery (`... for update) x`) rompe la mutación. Candado aparte con `perform ... for update;`.
- [Saldo cobrado] es idempotente (26-oct): `p_clave` + índice único parcial en funcion_pagos. Con índice único, una
  prueba de «sin candado deja >1 fila con la misma clave» es imposible: el caso F mide la respuesta del reintento y el
  cobro doble con claves distintas.
- `pasarelaEnMemoria` numera las referencias globalmente: la base exige referencia única por workspace.
- Al asistente NUNCA un número de cupo: `estado` y alternativas (prueba que recorre las salidas).
- Pagos (P13): `funcion_preparar_pago` → link → `funcion_registrar_pago` (servidor, idempotente). Sin cupo al pagar =
  `pendiente_persona`; solo una persona sobrevende o devuelve. `expiration_date` de Bold en ms SIN VERIFICAR.
- Regla de la fecha de fin de preventa en pantalla: `preventaPasaLaFuncion` + `diaBogota` (`reglas.ts`), contrastadas
  con la RPC en `funciones-sql.test.ts` (incluye una función a las 10 p. m., que en UTC ya es otro día).
- La prueba de fechas por patrón vive en `textos.test.ts`: si se agrega una fecha u hora a una plantilla, tiene que
  salir de la función o de la campaña, o la prueba cae.
- PGlite no prueba el `for update`: la concurrencia real va en el job de CI con Postgres 16 y su mutación sin candado.
- El fixture `src/lib/funciones/__fixtures__/esquema-base.sql` crea service_role con BYPASSRLS (como Supabase).
