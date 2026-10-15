# Suscripciones multiproducto: una base propia, un solo motor de cobro

> Rama `feat/suscripciones-multiproducto`, apilada sobre `feat/valida-cobro-consulta-11` (#1169 → #1110 → #1107 → #1104).
> Decisión de Mauricio, 2026-10-15: «ejecuta todo el panel de suscripción». Diseño con Hana y Max.

## 1. Qué cambia

Los clientes de productos de suscripción (Valida hoy; Sustenta, Business y lo que venga) dejan de vivir en `negocios`
del CRM de `metrik`, que es la base de Clarity, Analytics y Projects. Tienen su propia base, `suscripciones_producto`,
genérica por `producto`.

No hay un segundo sistema de cobro. El motor de siempre (contrato, plan, cuotas, cobros, enrolamiento por ciclo,
renovación, cobro con token ePayco, enlaces de pago, mora, Términos) cobra «un contrato», y un contrato cuelga de un
NEGOCIO o de una SUSCRIPCIÓN, exactamente uno. Lo llamamos el **ancla** del contrato.

| Antes (negocio) | Ahora (suscripción) |
|---|---|
| empresa en el directorio de `metrik` | la empresa declarada vive en la suscripción (razón social, NIT, DV, correo, RUT) |
| negocio en la línea Valida, etapa «Cobro» | sin negocio: ni tablero comercial, ni carpeta de Drive, ni gate de carpeta |
| Términos `alcance = 'cliente'` con `empresa_id` | Términos `alcance = 'cliente'` con `suscripcion_id` |
| contrato, plan, cobros y aceptación por `negocio_id` | los mismos, por `suscripcion_id` |
| timeline en `activity_log` (`entidad_tipo = 'negocio'`) | bitácora en `suscripciones_producto_eventos` |

## 2. Base de datos (3 migraciones, ninguna escribe filas)

1. `20261016100000_suscripciones_producto.sql`: las dos tablas nuevas y la columna `suscripcion_id` en las seis tablas
   del motor, con sus CHECK de «exactamente uno». **Toca tablas con datos de producción** (`servicios_contratados` 11
   filas, `planes_cobro` 15, `cobros` 594, `aceptaciones_terminos` 13, `documentos_contractuales_versiones` 18): solo
   DDL; los CHECK nuevos se validan contra las filas de hoy, y si una no cumple la migración entera aborta.
2. `20261016100100_motor_cobro_ancla_suscripcion.sql`: once funciones vivas reescritas por **reemplazo de texto sobre
   la definición de producción** (`pg_get_functiondef`), no con la copia del repo: si un patrón no está exactamente las
   veces esperadas, aborta todo. Para un contrato de negocio el resultado es el mismo de hoy (la prueba lo compara).
   Más el trigger `suscripcion_del_mismo_cobrador` y `valida_activar_autogestion` reescrita (crea suscripción).
3. `20261016100200_mrr_por_producto.sql`: las vistas `v_mrr_por_producto` y `v_mrr_por_producto_resumen` (§5).

Reversa: `sql/suscripciones-producto/reversa-20261016.sql` (y después volver a correr `20261012100000`). La prueba
`migracion-sql.test.ts` aplica las tres y la reversa, y comprueba que las once funciones quedan byte a byte como estaban.

### Orden de aplicación (sesión principal, con OK de Mauricio, ANTES del merge)

1. Ensayo en transacción con ROLLBACK de las tres (memoria `dry-run-sql-mcp-do-raise`).
2. Aplicar 100000 → 100100 → 100200 y las filas del ledger.
3. Verificar: `select count(*) from suscripciones_producto` = 0; los 4 CDA siguen viendo lo mismo por `mis_servicios`,
   `mis_cuotas_de_servicio`, `mis_cobros_de_servicio` y `mis_documentos_de_servicio` (comparar antes/después).
4. Merge de la pila. La exención del gate de carpeta (20261015180000) queda como red de seguridad: ya ningún camino
   crea ese negocio.

## 3. Código

- `src/lib/suscripciones-producto/ancla.ts`: `anclaDeFila`, `filtrarPorAncla`, `columnasDeAncla`, `llaveDeFila`.
- `bitacora.ts`: `anotarEnAncla` (timeline del negocio o bitácora de la suscripción; nunca lanza).
- `contrato-del-cobro.ts`: origen, contrato y comprador de un cobro (para la factura electrónica).
- Leen el ancla: activación (`activarPlanDelEspacio`, `asegurarCobroDelEspacio`), cobro al día 7 y en la consulta 11
  (`cobro-prueba-servidor`), cobro con token (`cobro-token-servidor`: la tarjeta es la de la suscripción), webhook y
  apertura del ciclo en Valida (`pago-en-linea-servidor`, `ciclo-servidor`), enrolamiento, renovación, enlace de pago
  (botón y automático; el aviso de una suscripción va a su bitácora, no a `avisos_cliente`), Términos por módulo
  (`versionContratada`), `/suscripcion` (contexto y licencias), carga manual de factura de cuota, cron (pasos 1-3).
- El emisor de cuentas de cobro (persona natural, Mauricio) **no** emite a una suscripción: la vende METRIK IA S.A.S. y
  su documento es la factura electrónica (Aliaddo, #1153). Se salta y se cuenta en `omitidasPorSuscripcion`.
- El Plan Anual CDA no se ofrece a un contrato de suscripción (es un anexo de los Términos CDA).

## 4. Piloto y los 4 CDA (plan, NO ejecutado)

Solo las altas autogestionadas nuevas nacen como suscripción. Los 4 CDA siguen en negocios, sin tocar, hasta que
terminen sus planes (nov/dic). Para migrarlos entonces, uno por uno y con OK de Mauricio:

1. Al cerrar la última cuota pagada del plan del negocio, NO renovar ese plan (`auto_renovar = false`).
2. Crear la suscripción con los datos de la empresa del directorio (razón social, NIT con DV, correo) y el origen
   comercial que tenga el contrato (`comision`, AFI).
3. Nuevo contrato `servicios_contratados` colgado de la suscripción, con la misma ficha y parámetros, la misma designada
   y `vigente_desde` = día siguiente al último periodo pagado; cerrar el contrato viejo (`terminado`).
4. Los Términos: registrar la versión vigente del CDA como documento de la suscripción (mismo texto y PDF NO: la huella
   del PDF es única; se registra la misma versión con el PDF de la suscripción) y pedir la aceptación por el módulo, o
   decidir con Emilio si la aceptación del negocio se traslada como evidencia (no se copia sin decisión legal).
5. `workspace_modulos`: cerrar la activación del contrato viejo y abrir la del nuevo (la proyección no cambia nada).
6. El negocio queda en el CRM como histórico (ganado/cerrado); sus cobros pagados se quedan donde están.

Pendiente de decidir antes: si el histórico de pagos del CDA se muestra en la pestaña Pagos de la suscripción (hoy
`mis_cobros_de_servicio` lee los cobros del ancla del contrato: los del negocio viejo no aparecerían).

## 5. MRR (para Carmen; la regla contable NO la decide esta vista)

`v_mrr_por_producto` da una fila por plan de cobro con sus supuestos en columnas (S1-S8 en la migración): el MRR es el
monto de la cuota llevado a mes; cuenta lo vigente hoy; la mora no resta; `activo` del plan no se usa; un negocio cuenta
solo con contrato por ciclo activo o pausado (`clase = 'contrato_ciclo'`); las bolsas prepagadas (`contrato_consumo`) y
los planes sin contrato (`plan_sin_contrato`) salen en el detalle pero NO se suman; una suscripción cuenta si está
`activa`. `v_mrr_por_producto_resumen` suma solo `cuenta_en_mrr`. Sin grant a nadie: solo servidor o SQL.

## 6. ¿Hizo falta el plan A?

No. El plan A (que `COBRADOR_VALIDA` cobre desde un workspace aparte, sin gate ni Drive) era un paso intermedio para
salir al público antes de tener la base propia. El diseño B queda construido y probado en esta misma pila, así que A
sería trabajo desechable.

## 7. Lo que queda fuera (a propósito)

- Devoluciones de dinero (`devoluciones_dinero`, SOE-007) siguen siendo de negocios: alimentan las ventas netas de
  SOENA. La devolución de un cobro de suscripción hoy es: reembolso en ePayco + anular el cobro (la anulación no
  depende del negocio). Si se quiere el registro formal, agregar `suscripcion_id` a esa tabla y su RPC.
- El Radar SECOP autogestionado sigue creando negocio (no estaba en el alcance).
- La tabla `suscripciones` de 20260908 (licencias ONE, 0 filas, ciclo propio en el paso 5 del cron) queda como está.
  Su concepto lo cubre ahora `suscripciones_producto`; retirarla es otra decisión.
- La factura electrónica de un cobro de suscripción: el resolutor está aquí (`contratoDelCobro`, `anclasDeOrigenes`)
  y el cambio en #1153 (que no está en esta pila) va como parche listo:
  `docs/specs/2026-10-16_aliaddo-sobre-suscripcion.patch` (contexto del cobro, barrido por negocios Y suscripciones,
  aviso a la bitácora, y su prueba). Verificado fuera de git sobre #1191 + #1153: typecheck limpio, 88 tests en verde,
  y la prueba nueva falla sin el parche. Se aplica en #1153 cuando esta pila esté en main. La activación deja
  `metadata.origen = 'valida_autogestion'` en la suscripción, la marca que la factura usa para decidir.
