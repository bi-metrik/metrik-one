# Punto 80 — cash de honorario neto de IVA en tableros

Rama `feat/tableros-honorario-sin-iva`. **NO mergear a medias:** la migracion de vistas
sola deja los tableros incoherentes (las cifras que salen de `v_venta_mes_comercial` bajan
a base y las que salen directo de `v_cobro_valor` se quedan brutas). Entra todo junto.

## Diseño (cerrado, verificado contra consumidores reales)

Se AGREGAN columnas base a `v_cobro_valor`, no se cambian las que ya tiene.
Verificado que los tramos brutos los consumen `v_cartera_negocio`, `v_mc_linea_mes`,
`v_pyl_mes` (o sea `/numeros`, el P&L de la empresa) y `/conciliacion` via
`src/lib/upme/imputacion-pago.ts`. Cambiarlos en sitio movia la contabilidad de MeTRIK,
que no es el alcance.

`v_venta_mes_comercial` SI cambia en sitio: sus unicos consumidores son las RPC de
tablero de SOENA (verificado contra `pg_proc`). Ahi tambien se corrige `caso_completo`,
que comparaba recaudo bruto contra `valor_aprobado_total`: bajar solo el numerador dejaba
a todos los casos como no cubiertos.

**La tarifa UPME no se toca en ninguna parte.** No causa IVA.

## Decision de Mauricio (2026-09-02) sobre el panel de pagos

`get_comercial_pagos_mes_soena` y `pagos-drawer.tsx` **se quedan en BRUTO** y ganan un
rotulo que lo diga. Es la vista con la que se concilia contra banco y ePayco: si la suma
de las partes deja de dar el monto recibido, deja de servir para lo unico que sirve.
Los INDICADORES (KPIs, graficos, totales, Direccion) si quedan netos.

## ⚠️ Blocker encontrado: produccion va por delante del repo

`supabase_migrations.schema_migrations` tiene versiones aplicadas que **no existen como
archivo** en `supabase/migrations/` (`20260826141500`, `20260826162802`, `20260826211947`,
`20260831171338`, `20260901192404`, entre otras). Son cambios aplicados con el
`apply_migration` del MCP, que timestampea por reloj y nunca quedaron commiteados.

Medido por md5 del cuerpo (`pg_proc.prosrc` normalizado) contra el texto del repo:

| RPC | repo == produccion |
|---|---|
| `get_comercial_resumen_soena` | si |
| `get_comercial_perfil_soena` | si |
| `get_comercial_serie_vendedor_soena` | si |
| `get_comercial_kpis_mes_soena` | NO |
| `get_comercial_serie_mensual_soena` | NO |
| `get_comercial_serie_seccional_soena` | NO |
| `get_directivo_soena` | NO |

**Consecuencia para quien siga:** las cuatro divergentes hay que reescribirlas desde
`pg_get_functiondef` de PRODUCCION, no desde el archivo del repo. Hacerlo desde el repo
revierte en silencio lo que produccion tiene. Verificar cada una por md5 antes y despues.

Esto excede el punto 80 y merece pendiente propio: el repo dejo de ser fuente de verdad
del esquema.

## Hecho

- [x] Auditoria completa (`proyectos/soena/ve/2026-09-02_auditoria-iva-tableros.md`)
- [x] Diseño y radio de impacto verificado contra consumidores reales
- [x] `supabase/migrations/20260902000010_tableros_honorario_neto_de_iva.sql`:
      `v_cobro_valor` (+ `a_tramo1_base`, `a_tramo2_base`) y `v_venta_mes_comercial`

## Falta

- [ ] Las 7 RPC. Transformacion mecanica y siempre la misma:
      `SUM(cv.a_tramo1 + cv.a_tramo2)` -> `SUM(cv.a_tramo1_base + cv.a_tramo2_base)`,
      `SUM(cv.a_tramo1)` -> `SUM(cv.a_tramo1_base)`, idem `a_tramo2`.
      `SUM(cv.a_tarifa)` NO se toca.
      - `get_comercial_kpis_mes_soena`: solo el denominador de `tasa_recaudo`
        (`valor_con_iva` -> `valor_sin_iva`, dos ocurrencias). El resto lo arregla la vista
      - `get_comercial_serie_mensual_soena`: tramos + denominador de `tasa_recaudo_global`
      - `get_comercial_serie_seccional_soena`, `..._vendedor_soena`, `..._resumen_soena`: tramos
      - `get_comercial_perfil_soena`: tramos + `pendiente_honorario` (los DOS lados a base)
      - `get_directivo_soena`: `sum(cv.a_tramo1)` / `sum(cv.a_tramo2)` (minuscula) -> base
      - `get_comercial_pagos_mes_soena`: NO SE TOCA (decision de Mauricio)
- [ ] TS: rotular el panel de pagos como bruto, revisar los "(sin IVA)" que ya no
      distinguen nada, y corregir el comentario de `comercial-types.ts:41`, que llama
      "ingreso real" a una cifra que hoy trae IVA
- [ ] Decidir si `valor_con_iva` / `valor_aprobado_con_iva` siguen en pantalla o quedan
      solo como columna de cartera
- [ ] QA contra produccion: Direccion agosto debe pasar de 69,0% a 58,0%
