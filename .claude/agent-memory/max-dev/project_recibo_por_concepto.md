---
name: recibo-por-concepto
description: "PR #795 MERGEADO el 2026-09-19 (squash `0d5a8b5f`) y apagado: un pago sale con un recibo por componente. La marca de `cobros.siigo_recibo` tiene DOS formas y `mis_cobros_de_servicio` solo lee una; el comprobante del pasante NO EXISTE todavía"
metadata:
  type: project
---

PR **[#795](https://github.com/bi-metrik/metrik-one/pull/795)**, rama `feat/recibo-por-concepto`.
**MERGEADO el 2026-09-19** con los 8 checks verdes (squash `0d5a8b5f`, verificado con
`gh pr view 795` el 2026-09-21). Nació sin mergear —el brief cerraba con «Mauricio decide el
merge»— y él lo mergeó el mismo día. **El código está en `main` y sigue INERTE**: ninguna línea
declara `recibo_por_concepto` y `recibo_automatico` sigue en `false`.

Un pago mixto salía con UN recibo por el total y ese total entraba entero a la cuenta del único
comprobante configurado. Ahora, si la línea declara `config_extra.siigo.recibo_por_concepto`, sale
un recibo por cada componente con valor mayor a cero.

**Why:** la tarifa UPME es plata de terceros y **es el `document.id` lo que decide a qué cuenta
contable entra** — la API de Siigo no acepta la cuenta en el payload (el recibo `Detailed`, el único
que traía `items[].account.code`, fue retirado). Medido el 2026-09-19 sobre los 425 cobros vivos de
SOENA: **63 mixtos**, 317 solo honorario, 45 solo tarifa.

**How to apply:**

- ⚠️⚠️ **`cobros.siigo_recibo` tiene DOS formas y hay un consumidor en SQL que solo lee una.**
  `mis_cobros_de_servicio` (migración `20260916180000`, módulo Valida API, otro workspace) usa
  `c.siigo_recibo ->> 'numero'`, y ese operador **sobre un arreglo devuelve NULL sin dar error**.
  Por eso el camino de siempre **sigue escribiendo el OBJETO** y solo una línea con
  `recibo_por_concepto` escribe lista. En TypeScript nunca se lee de frente: `recibosDelCobro` /
  `primerRecibo` / `tieneRecibo` de `src/lib/siigo/recibo-componentes.ts` son el criterio único.
- ⚠️ **Una lista vacía es `truthy`.** `if (cobro.siigo_recibo)` la lee como «ya tiene recibo» y el
  cobro no volvería a emitir nunca. Ya mordió en `recibo-automatico.ts`; hay prueba que lo fija.
- ✅ **CADUCÓ (medido 2026-09-22):** el comprobante del pasante YA EXISTE: RC-3 `33546`, y la
  línea GIT EV/HEV ya lo declara en `recibo_por_concepto.pasante`. Y el honorario pasa a ser
  ABONO a la factura en [[factura-libre-abono]] (#818). Lo que sigue es la historia:
- ⚠️⚠️ **El comprobante del componente pasante NO EXISTE.** Mauricio decidió el 2026-09-19 no reusar
  el RC-2 (`32623`): es **de uso mixto** — 13 vouchers, solo 2 son recaudo UPME (del 2026-07-21) y
  los otros 11 son de marzo, de $535.670 a $25.902.492, sin observación. Se le pide a SOENA un tipo
  de recibo de caja **nuevo**. El de honorario sí es real: `4594`. **NO escribir en ninguna parte
  que el 32623 es el comprobante de recaudo a favor de terceros.** En la config el `pasante` va con
  `document_id: 0` para que se vea que el valor no existe todavía; `leerReciboPorConcepto` lee el 0
  como ausente y `planDeEmision` FRENA antes del primer POST (no emite solo el honorario).
- ⚠️ **Los sufijos de idempotencia NO se cambian nunca**: `rchon` y `rcpas`, congelados en
  `SUFIJO_IDEMPOTENCIA` con prueba por valor. Si cambian entre despliegues, un reintento deja de
  reconocer el recibo que ya existe y emite otro, consumiendo numeración que no se deshace. El
  camino de siempre conserva `'rc'`.
- ⚠️ **Migración `20260919120000_siigo_recibo_admite_lista.sql` SIN aplicar.** Es un
  `comment on column`, cero datos — solo deja la advertencia de las dos formas en el catálogo.
  Antes de aplicarla, comprobar la versión contra `supabase_migrations.schema_migrations`, no contra
  el directorio (ver [[sql-prod-one]]).
- **Ningún backfill, ninguna reemisión.** Una marca **sin `componente`** acusa el total y cuenta como
  cobro cubierto, en la emisión **y** en el panel: los 3 mixtos ya emitidos se quedan como están.
  Si hay que corregirlos, lo hace Diana en Siigo.
- **Sigue apagado todo**: `recibo_automatico` en `false` y ninguna línea declara `recibo_por_concepto`
  (medido contra producción el 2026-09-19; la única línea con config `siigo` es GIT EV/HEV de SOENA).

### Dos puntos donde el brief va por delante del código, reportados en el PR

1. ✅ **CERRADO por el [[correo-recibo-dos-documentos]] (#804, sin mergear).** Decía que el correo
   no podía nombrar los dos documentos: la plantilla de `notificar-etapa` nombraba UN documento y UN
   enlace. Ya existe la marca `{recibos}`, que sale del mismo bloque y lista los documentos del
   ÚLTIMO pago con número, concepto, valor y enlace propio. Sigue en pie lo de siempre: **mergear no
   despliega edge functions**, y el copy de SOENA es un SQL aparte, sin aplicar.
2. **La suma exacta se garantiza en los datos que existen, no en general.**
   `honorario + pasante = monto` sale del propio reparto y está fijado por prueba. Pero
   `/v1/document-types` da **`decimals: false`** en el 32623 y `true` en el 4594: un comprobante
   puede no aceptar centavos. Medido hoy: **cero** de los 425 cobros vivos tiene centavos, ni en
   `monto` ni en ninguna de las dos bolsas. **No se construyó un redondeo de compensación** para un
   caso que no existe; `redondear()` solo evita que un `0.30000000000000004` viaje a Siigo y su
   comentario dice que no debe volverse otra cosa.

### Decisiones de forma que costaron pensarlas

- **El reparto se CONSUME, no se inventa**: sale de `v_cobro_valor` (`a_tramo1 + a_tramo2 +
  excedente` = honorario, `a_tarifa` = pasante), la regla del 2026-08-18. **Sin fila no se adivina**:
  `repartoDeCobro` devuelve `null` y la emisión para. La única excepción es `tipo_cobro = 'pasante'`,
  que `v_cobro_valor` excluye a propósito y cuya plata es toda de terceros (medido: **cero** cobros
  así en los 516 de toda la base). El camino de siempre **ni siquiera consulta la vista**.
- **La marca se guarda DESPUÉS DE CADA componente**, no al final: el primer recibo ya consumió
  numeración y su marca tiene que quedar aunque el segundo falle. En el camino de lista se relee
  justo antes de escribir (criterio de `guardarMarcaEnMetadata`).
- **El valor corregido a mano NO se reparte a ojo.** El reparto parte el monto del cobro; con otra
  cifra no hay forma de saber cuánto de la diferencia es honorario. Se rechaza pidiendo corregir el
  monto, en vez de repartir en proporción — que sería inventar la respuesta.
- **El panel deja de ser binario** (`recibos-control-actions.ts`): un mixto con el honorario emitido
  y la tarifa no se ve **pendiente**, y la fila dice cuál falta. Si se viera resuelto, el panel
  volvería a esconder trabajo (la lección del #581). Para saberlo lee la config de la línea y
  `v_cobro_valor`, **y las dos lecturas se saltan enteras** si ninguna línea declara componentes.
- **`/api/archivos/cobro` gana `doc=recibo_pasante`.** Dos recibos son dos PDF: con un solo nombre la
  ruta bajaría siempre el mismo. `doc=recibo` sigue resolviendo el del honorario **y la marca vieja**,
  así que ningún enlace ya repartido cambia de destino.
- **El fallback de `emitirReciboDeNegocio` sin `cobroId`** solo ve cobros **sin ninguna marca**
  (`.is('siigo_recibo', null)`): un mixto a medias no lo encuentra. Se reintenta desde el panel, que
  siempre pasa `cobroId`. Declarado en el código.

Relacionado: [[conciliacion-por-referencia]] (el mismo movimiento, del negocio a la porción),
[[ruta-iva-por-servicio]], [[emision-cuentas-cobro]], [[modulo-valida-api-c2]].
