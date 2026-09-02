# Punto 80 SOENA: el cash de honorario en tableros va neto de IVA

Estado al 2026-09-02. Esta nota vive en la rama para poder retomar sin la conversacion.

## La decision

Mauricio, 2026-09-02: el honorario que muestran los tableros es INGRESO, y el IVA no es
ingreso (se recauda para la DIAN y se previsiona aparte). La meta de Direccion ya estaba
declarada sin IVA. Los comerciales deben calcular su comision sobre el valor sin IVA.

Esto REVIERTE la regla que el codigo traia escrita en `comercial-types.ts`, que dejaba el
recaudo bruto para que fuera comparable contra el extracto bancario.

## Que quedo construido

**Vistas** (`fab9165`)
- `v_cobro_valor` conserva TODAS sus columnas y gana `a_tramo1_base` / `a_tramo2_base`.
  No se tocan los tramos brutos: los consumen `v_cartera_negocio`, `v_mc_linea_mes`,
  `v_pyl_mes` y la conciliacion contra ePayco (`src/lib/upme/imputacion-pago.ts`).
  `a_tarifa` NO tiene base y no debe tenerla: la tarifa UPME no causa IVA.
- `v_venta_mes_comercial` baja a base EN SITIO, porque sus unicos consumidores son las
  RPC de tablero (verificado contra `pg_proc`).
- `caso_completo` cambia LOS DOS lados. Medido: con los dos en base quedan 285 completos
  de 306, identico a hoy; bajando solo el numerador habrian quedado **0**.

**Las 7 RPC** (`45d9b38`)
- Escritas desde `pg_get_functiondef` de PRODUCCION. Cuatro divergian del repo por
  migraciones aplicadas via MCP que nunca quedaron como archivo.
- `get_comercial_pagos_mes_soena` NO se toca (decision de Mauricio): es el panel de
  conciliacion contra banco y ePayco, ahi la cifra es la que entro a la cuenta.

**Rotulos TS** (`45d9b38`)
- Panel de pagos: "Honorario cobrado (con IVA)" mas una nota de que la barra del tablero
  va sin IVA. Antes decia "Honorario (es la barra)", que dejo de ser cierto.
- Direccion: una nota bajo la tabla, no "(sin IVA)" repetido en cada fila.
- Comercial: el historico y el grafico de recaudo dicen "(sin IVA)" porque su valor cambia.
- `comercial-types.ts`: dos comentarios documentaban la regla vieja.

## Verificado contra produccion (sin escribir nada)

| Cifra | Hoy | Con el cambio |
|---|---|---|
| Direccion agosto, ventas totales | $33.543.716 | $28.187.997 |
| Direccion agosto, cumplimiento (meta $48.614.400) | 69,0% | **58,0%** |
| Casos completos (de 306 vendidos) | 285 | 285 |
| Casos completos si bajara SOLO el numerador | — | **0** |
| Honorario historico del perfil | $238.045.501 | $155.260.308 |

## Hallazgo que excede el IVA: `get_comercial_perfil_soena`

No leia `v_cobro_valor`. Sumaba `cobros.monto` a secas y separaba honorario de tarifa por
`tipo_cobro`. Dos defectos, los dos vivos:

- El cobro ENTERO se contaba como honorario del comercial. La diferencia contra el bruto
  ($53.285.735) es exactamente tarifa ($52.076.380) mas excedente ($1.209.355).
- `tarifa_recaudada` mostraba CERO para todos, siempre: SOENA no registra ni un cobro con
  `tipo_cobro = 'pasante'`. La tarifa viaja dentro del cobro y la separan los techos.

Quedaba contradiciendo a `get_comercial_resumen_soena`, que ya imputaba bien: las dos
sirven la misma cifra para la misma persona.

**Efecto por comercial (historico):**

| Comercial | Honorario hoy | Honorario nuevo | Tarifa hoy | Tarifa nueva |
|---|---|---|---|---|
| Jessica Tejada | $141.988.329 | $96.596.706 | $0 | $26.850.813 |
| Daniela Jativa | $45.427.490 | $33.162.022 | $0 | $4.944.704 |
| Esperanza Verdugo | $22.640.680 | $9.571.364 | $0 | $11.249.745 |
| Jenny Cepeda | $16.486.502 | $6.264.250 | $0 | $9.031.118 |
| Juan Bruce | $9.837.500 | $8.266.807 | $0 | $0 |

**Esto lo tiene que hablar SOENA con su equipo antes de que lo vean en pantalla.** No es
que hayan recaudado menos: es que antes se les contaba como honorario propio la plata que
se le gira a la UPME. Y el mismo cambio les da una columna de tarifa que llevaba meses en
cero para todos.

## Aplicado en produccion — 2026-09-02

Version en el ledger: `20260902220053`.

Se aplico por el MCP de Supabase, no con `db push`, por dos razones. La torre no tiene
`SUPABASE_ACCESS_TOKEN` ni `psql`. Y el archivo chocaba de numero con
`20260902000010_corregir_marcas_siigo_cliente_pisadas`, que ya estaba en el ledger: un
`db push` habria dado ese numero por aplicado y saltado este archivo en silencio. Por eso
el archivo se renombro a `20260902220053_...`, para que nombre y ledger digan lo mismo.

El ensayo con `rollback` nunca corrio: sigue sin haber token. La duda que ese ensayo
resolvia era si el SQL que llega a produccion es el del archivo, y eso se resolvio mejor
por el otro lado, despues de aplicar: `md5(prosrc)` de las siete funciones en produccion
contra los siete cuerpos del archivo. **7 de 7 identicas**, byte por byte.

Medido despues de aplicar:

| Comprobacion | Esperado | Produccion |
|---|---|---|
| Direccion agosto | $28.187.997 (58,0%) | $28.187.997 (58,0%) |
| Casos completos | 285 de 306 | 285 de 306 |
| Honorario historico en base | $155.260.308 | $155.260.308 |
| Tarifa historica | $52.076.380 | $52.076.380 |
| ACL de las 7 RPC | anon no, authenticated si | anon no, authenticated si |

Y lo bruto quedo intacto, que era la condicion de no romper caja: honorario bruto
$184.759.766, tarifa $52.076.380, excedente $1.209.355, `monto` $238.045.501. Identicos a
la medicion previa, asi que `v_pyl_mes`, `v_mc_linea_mes`, `v_cartera_negocio`, el gate
`saldo_cero`, Siigo y la conciliacion contra ePayco ven lo mismo de siempre.

## Lo que falta

1. **QA en pantalla**: abrir Direccion de agosto y confirmar que lee 58,0%.
2. **SOENA con su equipo**, antes de que los comerciales vean sus cifras nuevas.

## Pendiente derivado, sin registrar

El repo dejo de ser fuente de verdad del esquema, y son dos fallas distintas:

- Migraciones aplicadas por MCP que nunca quedaron como archivo (`20260826141500`,
  `20260826162802`, `20260826211947`, `20260831171338`, `20260901192404`, entre otras).
- Numeros de version repetidos entre archivos: `20260902000004`, `20260902000006` y el
  `20260902000010` de este PR. Este es el peligroso, porque no falla: `db push` da por
  aplicado el archivo que nunca corrio y nadie se entera.

Merece pendiente propio, y probablemente un check de CI que rechace versiones duplicadas.

## Punto 81, despues de este

Cargar a ONE los negocios del Sheet desde el 1 de julio y cuadrar los indicadores a lado
y lado. Va DESPUES: conciliar antes compararia dos bases distintas y cada caso saldria
descuadrado en 19%. Receta: `scripts/cargue-historico-iva.ts`.
