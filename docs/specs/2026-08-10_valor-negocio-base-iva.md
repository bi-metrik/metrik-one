# El valor de un negocio: total, base e IVA, desde un solo lugar

**Fecha:** 2026-08-10. **Owner:** Max. **Alcance:** producto ONE, todo workspace que facture con IVA.
**Migracion:** `supabase/migrations/20260810130000_valor_negocio_base_iva.sql`.
**Origen:** revision fiscal de SOENA (Felipe) → `proyectos/metrik/one/2026-08-10_frente-indicadores-base-iva.md`.

## El problema

`negocios.precio_aprobado` guarda el honorario **CON IVA**. Cada consumidor decidia por su
cuenta si lo descontaba, y no todos lo hacian. Medido contra las definiciones vigentes en
produccion el 2026-08-10:

| Consumidor | ¿Descontaba IVA? |
|---|---|
| `get_comercial_kpis_mes_soena` | Si, dividiendo por el literal `1.19` |
| `get_comercial_serie_mensual_soena` | Si, mismo literal |
| `get_comercial_perfil_soena` | No |
| `get_comercial_resumen_soena` | No |
| `count_negocios_por_conciliar` | No |
| `v_mc_negocio` | No |

Consecuencia visible: la misma venta se veia distinta segun la pantalla. El caso mas grave
era `v_mc_negocio`, donde `mc = precio_aprobado - costos` comparaba un ingreso CON IVA contra
costos SIN IVA (los gastos de comision ePayco separan el impuesto a `impuestos_recuperables`
desde `20260622000002`). El IVA no es ingreso: es plata que se recauda para la DIAN. Ese
margen estaba inflado y cualquier decision tomada mirandolo iba sesgada al alza.

## La fuente unica: `v_negocio_valor`

Una fila por negocio. Expone el valor total, la base y el IVA, mas el origen de la tarifa:

| Columna | Que es |
|---|---|
| `valor_aprobado_total` | `negocios.precio_aprobado`. NULL mientras no haya honorario aprobado |
| `valor_aprobado_base` | Ese total sin IVA |
| `valor_aprobado_iva` | La diferencia |
| `valor_total` / `valor_base` / `valor_iva` | Lo mismo con respaldo en `precio_estimado`. Nunca nulo |
| `es_estimado` | El valor vigente salio del estimado, no del aprobado |
| `iva_frac` | Fraccion (0.19), ya normalizada |
| `iva_origen` | `propuesta` / `servicio` / `workspace` / `sin_declarar` |
| `iva_declarado` | `false` = nadie declaro si ese precio incluye IVA |

**El monto lo manda `precio_aprobado`, no el bloque de propuesta.** Es lo que corrige
"Corregir valor aprobado" y lo que consumen cartera y la emision en Siigo. Medido: en 2 casos
de SOENA el bloque y el precio difieren (V0259 637.500 vs 510.000; V0097 637.585 vs 637.500)
y el del bloque es el viejo. Las dos RPC que preferian el bloque cambian su cifra por esto.

**La tarifa de IVA sale de la configuracion, nunca de un literal.** No todos los workspaces
traen precios con IVA (SOENA si; otros no) y dentro de un workspace puede diferir por linea de
negocio, asi que la declaracion vive en la **configuracion del workspace y de la linea**.
Cadena por negocio:

1. `propuesta` — la propuesta economica **aprobada** del negocio (`data.iva_pct`).
2. `linea` — `lineas_negocio.config_extra->'honorario'->>'iva_pct'`.
3. `servicio` — `servicios.tarifa_iva` del servicio que declara el bloque de propuesta de la
   **linea** del negocio (`config_extra.auto_propuesta.servicio_id`). Se resuelve por linea y
   no por instancia del bloque porque 44 de los 265 negocios de SOENA nunca instanciaron ese
   bloque. Si una linea alcanza dos tarifas distintas, es ambigua y se pasa al escalon
   siguiente: un parametro ambiguo no se resuelve por comodidad.
4. `workspace` — `workspaces.config_extra->'honorario'->>'iva_pct'`.
5. `sin_declarar` — `iva_frac = 0`, o sea base = total.

**La declaracion explicita (linea, workspace) gana sobre la inferida del servicio**, porque una
declaracion que no puede sobrescribir lo inferido no es una decision: es decoracion. El dato del
caso concreto (la propuesta aprobada de ESE negocio) gana sobre todo.

La normalizacion (0.19 vs 19) vive en un solo sitio; antes estaba copiada en dos funciones.

**SOENA queda declarado en su workspace** (`config_extra.honorario.iva_pct = 0.19`) en la misma
migracion. Hoy resuelve igual por el servicio, asi que no mueve ninguna cifra; lo que cambia es
que deja de depender de una inferencia: si mañana alguien cambia el servicio o crea una linea
nueva, la respuesta sigue estando dicha. Ninguno de los otros seis se declara.

### Por que el default es 0 y no 19%

Medido en produccion el 2026-08-10, en ensayo con `rollback`:

| Workspace | Negocios | Origen | Efecto |
|---|---|---|---|
| soena | 66 | `propuesta` (0.19) | MC baja |
| soena | 199 | `servicio` (0.19) | MC baja |
| afi | 53 | `sin_declarar` | sin cambio |
| metrik | 26 | `sin_declarar` | sin cambio |
| ana-demo | 5 | `sin_declarar` | sin cambio |
| advise | 2 | `sin_declarar` | sin cambio |
| wmc-sm | 2 | `sin_declarar` | sin cambio |
| dimpro | 1 | `sin_declarar` | sin cambio |

Nadie ha dicho si los precios de esos cinco workspaces incluyen IVA. Asumir 19% habria movido
sus cifras sobre una suposicion que nadie pidio; dejar 0 conserva exactamente lo que hay hasta
que alguien responda, y `iva_declarado = false` lo dice en vez de callarlo.

**El umbral, medido, para cuando respondan.** Si declararan 19%, el MC acumulado baja:

| Workspace | MC hoy | MC con 19% | Diferencia |
|---|---|---|---|
| wmc-sm | $140.801.644 | $105.327.415 | −$35.474.229 |
| metrik | $199.563.642 | $167.682.130 | −$31.881.512 |
| ana-demo | $52.050.000 | $42.150.840 | −$9.899.160 |
| afi | $46.245.000 | $38.861.345 | −$7.383.655 |
| dimpro | $10.900.000 | $9.143.697 | −$1.756.303 |
| advise | $2.700 | $2.269 | −$431 |

Declararlo es una linea en `config_extra`, no un deploy.

## Que muestra cada indicador (la decision)

Hasta hoy esto no estaba decidido en ninguna parte: simplemente ocurria.

| Indicador | Base | Por que |
|---|---|---|
| Valor vendido, ticket, ingreso/dia, cumplimiento de meta | **sin IVA** | Es el ingreso real de la empresa |
| Valor aprobado en perfil y resumen del comercial | **sin IVA** | Misma razon; antes iban con IVA y no cuadraban con el KPI del mes |
| Margen de contribucion (`v_mc_negocio`) | **sin IVA** | Se compara contra costos, que ya vienen sin impuesto recuperable |
| Pendiente de recaudo (cartera) | **con IVA** | Es lo que falta que entre a la cuenta |
| Valor a recaudar y sobrepagos (`count_negocios_por_conciliar`) | **con IVA** | Se compara contra pagos, que llegan con IVA |
| Tasa de recaudo y "caso completo" | **con IVA** en los dos lados | Ver abajo |

**Corolario que NO estaba escrito: `pendiente_honorario` no es `valor_aprobado − recaudado`.**
Son bases distintas y restarlas no significa nada. La pantalla lo dice ahora en la etiqueta.

### Lo recaudado nunca se compara contra una base sin IVA

`caso_completo` y `tasa_recaudo` comparaban plata recaudada (que llega con IVA) contra el
valor sin IVA. Eso daba por cobrado un caso al 84% y permitia tasas por encima del 100%.
Ahora los dos lados van con IVA. Efecto medido en SOENA: la tasa de recaudo de julio pasa de
161% a 135,3%, la de agosto de 231,3% a 196,4%, y la global de 175,7% a 148,1%.

**Sigue por encima de 100% y eso NO lo arregla este cambio.** El recaudo de un mes incluye
cobros de negocios vendidos en meses anteriores, y ademas hay pagos de tarifa UPME que no
estan marcados `tipo_cobro = 'pasante'` y entran como honorario. Es un hallazgo aparte, con
un dato duro: agosto muestra $24,2M recaudados contra $12,4M vendidos con IVA.

## El otro lado: lo que entra a la cuenta no es todo ingreso

El inventario del brief eran 6 consumidores. Buscando la **forma** de la formula en la base
aparecieron **8**, y dos vistas mas con el defecto entrando por los cobros:

- `cs_estado_pagos` y `cs_identificar_cliente` (bot de servicio al cliente) usan
  `precio_aprobado` para hablar de saldo y pagos. Es cartera: **con IVA es lo correcto** y no
  cambian. Quedan declaradas aqui.
- **`v_pyl_mes` y `v_mc_linea_mes` calculaban `ingresos = sum(cobros.monto)`**, y ahi habia
  DOS errores, no uno.

El segundo es mas grande que el que abrio este frente. En SOENA el cliente paga en una sola
referencia el honorario **mas la tarifa que se le gira a la UPME**, y esa tarifa casi nunca
queda marcada `tipo_cobro = 'pasante'`. Medido el 2026-08-10: de **$63.138.351** cobrados,
**$21.041.601 (33%) exceden el honorario aprobado** del negocio, en 32 casos. Plata de terceros
contada como ingreso propio.

Corregir solo el IVA habria dejado el P&L igual de falso pero con aspecto de corregido, que es
peor: una pantalla rota se ve, una pantalla sana que miente no.

**Criterio, el mismo que ya usa la conciliacion** (`valor a recaudar = honorario + tarifa`): de
lo que entra por un negocio, es ingreso propio lo que cabe dentro de su valor (CON IVA),
consumido en orden cronologico; **el excedente no es ingreso**. Da igual si es tarifa de
terceros o un sobrepago por devolver: en los dos casos es plata que no se queda. `v_cobro_valor`
es la fuente unica de ese desglose, hermana de `v_negocio_valor`.

Casos limite, decididos a proposito y no por omision:

| Caso | Decision | Medido hoy |
|---|---|---|
| Negocio sin ningun valor declarado | Sin techo: cuenta todo. Ausencia de dato no es cero | 0 casos |
| Cobro sin negocio | Sin techo; IVA de la declaracion del workspace | 0 cobros |
| Monto negativo (`devolucion_pendiente`) | Va entero a terceros; no descuenta ingreso, porque devuelve plata que nunca fue ingreso | 0 cobros |
| `tipo_cobro = 'pasante'` | Excluido, ya era plata de terceros declarada | 0 cobros |

`v_pyl_mes` gana `ingresos_con_iva`, `iva_recaudado` y `recaudo_terceros` para que la plata que
entro siga a la vista y se pueda conciliar contra el banco. Verificacion aritmetica: en SOENA
35.375.420 + 6.721.330 + 21.041.601 = **63.138.351**, el total cobrado, exacto.

De paso `v_mc_linea_mes` deja de contar los cobros `pasante` como ingreso: `v_pyl_mes` ya los
excluia y esta no, asi que las dos pantallas podian discrepar. Hoy no hay ninguno, asi que la
alineacion no mueve cifras todavia.

## Efecto medido del cambio

Ensayo en transaccion con rollback contra produccion, midiendo **antes y despues dentro de la
misma transaccion** (con `discard plans` entre medio) para no comparar contra una linea base que
ya se movio — la base es una sola y SOENA opera sobre ella todo el dia.

| Workspace | MC por negocio antes | despues | Ingresos P&L antes | despues |
|---|---|---|---|---|
| soena | $118.474.905 | $99.319.689 | $63.138.351 | $35.375.420 |
| ana-demo | $52.050.000 | **igual** | $36.700.000 | $35.800.000 |
| afi | $46.245.000 | **igual** | $0 | **igual** |
| metrik | $199.563.642 | **igual** | $17.366.667 | **igual** |
| wmc-sm | $140.801.644 | **igual** | $0 | **igual** |
| dimpro | $10.900.000 | **igual** | $0 | **igual** |
| advise | $2.700 | **igual** | $1.600 | **igual** |

Los **$19.155.216** que pierde el MC de SOENA son el IVA que estaba contando como ingreso. Los
**$27.762.931** que pierden sus ingresos del P&L son ese IVA ($6,7M) mas la tarifa de terceros
($21,0M). El movimiento de ana-demo ($900.000) es un excedente sobre el valor del negocio, y cae
por el mismo criterio.

Sin cambio, verificado: negocios por conciliar (5 → 5) y el pendiente de recaudo del perfil
comercial, que son las dos cifras de cartera.

## Lo que NO se hizo, y por que

**No se abrio un modulo fiscal en ONE que acumule el IVA facturado.** El IVA se causa con la
factura y las facturas viven en Siigo, que es el libro contable del cliente. Un acumulado
calculado en ONE seria una segunda verdad sobre una cifra que se declara ante la DIAN, y el
dia que difiera (notas credito, anulaciones, ajustes) nadie sabria cual manda. Si se quiere
ver el IVA facturado dentro de ONE, se trae de Siigo. Decision de Felipe, 2026-08-10.

**No se reclasificaron los cobros de tarifa UPME a `tipo_cobro = 'pasante'`.** El P&L ya no los
cuenta como ingreso, que era el daño; marcarlos uno por uno es una migracion de datos con su
propio criterio y su propia medicion. Queda como pendiente separado.

## Regla que este frente confirma

Un conteo heredado de sitios es piso, nunca techo. Se busca la formula por su **forma** en el
codigo, no por la lista que dejo escrita el fix anterior. Aqui el brief decia 6 y eran 8, y el
error mas grande no estaba en ninguno de los dos: estaba en los cobros.
