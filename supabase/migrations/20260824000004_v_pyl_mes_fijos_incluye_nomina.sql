-- v_pyl_mes: los costos fijos ahora incluyen la nomina de `staff`.
--
-- El problema: /numeros mostraba dos respuestas distintas a la misma pregunta. Arriba,
-- "EBITDA" con la etiqueta "MC − costos fijos"; abajo, la tarjeta "¿Estoy ganando?".
-- En SOENA la pantalla decia EBITDA $15.538.684 y utilidad $9.538.683 el mismo dia. La
-- diferencia era exactamente $6.000.001: la nomina.
--
-- La causa: `fijos_total` sumaba gastos con clasificacion 'fijo', `fixed_expenses` y el
-- legacy `gastos_fijos_config`, pero NO la nomina de `staff`. La pagina, en cambio, calcula
-- su utilidad restando `componenteNomina + componenteOperativo`. Dos definiciones de costo
-- fijo para el mismo tablero.
--
-- Con la nomina dentro, las dos cuentas quedan identicas por construccion:
--   vista:   ingresos − variables − (gastos_fijos + fixed_expenses + nomina)
--   pagina:  ingresos − (variables + gastos_fijos) − (nomina + fixed_expenses)
-- Se verifico que `gastos.clasificacion_costo` solo toma 'variable' y 'fijo' (0 nulos en
-- las 253 filas de la base) y que `gastos_fijos_config` no tiene filas activas en ningun
-- workspace, que son los dos supuestos que hacen que la igualdad se sostenga.
--
-- Alcance: la nomina es una foto del presente, sin dimension de mes, igual que
-- `fixed_expenses` desde que existe la vista. Aplicarla hacia atras baja el EBITDA
-- historico de los 5 workspaces que tienen salarios cargados. Es el comportamiento
-- correcto y el que la pagina ya asumia en su utilidad.
--
-- Se conserva `security_invoker=on` y el grant a `authenticated`. Con invoker, la nomina
-- solo suma para quien puede leer `staff` en su workspace, que es la politica `staff_ws`.

drop view if exists v_pyl_mes;

create view v_pyl_mes
with (security_invoker = on)
as
with meses as (
  select distinct workspace_id, date_trunc('month', fecha::timestamptz)::date as mes
    from cobros
  union
  select distinct workspace_id, date_trunc('month', fecha::timestamptz)::date as mes
    from gastos
),
ingresos as (
  select cv.workspace_id,
         date_trunc('month', cv.fecha::timestamptz)::date as mes,
         sum(round((cv.a_tramo1 + cv.a_tramo2) / (1 + cv.iva_frac), 2)) as ingresos,
         sum(cv.a_tramo1 + cv.a_tramo2) as ingresos_con_iva,
         sum(cv.a_tramo1 + cv.a_tramo2 - round((cv.a_tramo1 + cv.a_tramo2) / (1 + cv.iva_frac), 2)) as iva_recaudado,
         sum(cv.a_tarifa + cv.excedente) as recaudo_terceros,
         sum(cv.a_tarifa) as tarifa_recaudada
    from v_cobro_valor cv
   group by cv.workspace_id, date_trunc('month', cv.fecha::timestamptz)::date
),
variables as (
  select workspace_id,
         date_trunc('month', fecha::timestamptz)::date as mes,
         sum(monto) as costos_variables
    from gastos
   where clasificacion_costo = 'variable'
   group by workspace_id, date_trunc('month', fecha::timestamptz)::date
),
fijos_gastos as (
  select workspace_id,
         date_trunc('month', fecha::timestamptz)::date as mes,
         sum(monto) as fijos_gastos
    from gastos
   where clasificacion_costo = 'fijo'
   group by workspace_id, date_trunc('month', fecha::timestamptz)::date
),
fijos_config as (
  select workspace_id, sum(monthly_amount) as fijos_recurrentes
    from fixed_expenses
   where is_active = true
   group by workspace_id
),
fijos_legacy as (
  select workspace_id, sum(monto_referencia) as fijos_recurrentes_legacy
    from gastos_fijos_config
   where activo = true
   group by workspace_id
),
-- Nomina mensual. Mismo filtro que usa /numeros para su `componenteNomina`:
-- empleados directos activos con salario. Contratistas y freelance quedan fuera —
-- su costo entra como gasto cuando se paga.
fijos_nomina as (
  select workspace_id, sum(salary) as fijos_nomina
    from staff
   where is_active = true
     and tipo_vinculo = 'empleado'
     and coalesce(salary, 0) > 0
   group by workspace_id
)
select m.workspace_id,
       m.mes,
       coalesce(i.ingresos, 0) as ingresos,
       coalesce(i.ingresos_con_iva, 0) as ingresos_con_iva,
       coalesce(i.iva_recaudado, 0) as iva_recaudado,
       coalesce(i.recaudo_terceros, 0) as recaudo_terceros,
       coalesce(i.tarifa_recaudada, 0) as tarifa_recaudada,
       coalesce(v.costos_variables, 0) as costos_variables,
       coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0) as mc,
       case when coalesce(i.ingresos, 0) > 0
            then (coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0)) / i.ingresos
            else null
       end as mc_pct,
       coalesce(fg.fijos_gastos, 0) as fijos_gastos_mes,
       coalesce(fc.fijos_recurrentes, 0) + coalesce(fl.fijos_recurrentes_legacy, 0) as fijos_recurrentes,
       coalesce(fn.fijos_nomina, 0) as fijos_nomina,
       coalesce(fg.fijos_gastos, 0)
         + coalesce(fc.fijos_recurrentes, 0)
         + coalesce(fl.fijos_recurrentes_legacy, 0)
         + coalesce(fn.fijos_nomina, 0) as fijos_total,
       coalesce(i.ingresos, 0)
         - coalesce(v.costos_variables, 0)
         - (coalesce(fg.fijos_gastos, 0)
            + coalesce(fc.fijos_recurrentes, 0)
            + coalesce(fl.fijos_recurrentes_legacy, 0)
            + coalesce(fn.fijos_nomina, 0)) as ebitda
  from meses m
  left join ingresos i     on i.workspace_id  = m.workspace_id and i.mes = m.mes
  left join variables v    on v.workspace_id  = m.workspace_id and v.mes = m.mes
  left join fijos_gastos fg on fg.workspace_id = m.workspace_id and fg.mes = m.mes
  left join fijos_config fc on fc.workspace_id = m.workspace_id
  left join fijos_legacy fl on fl.workspace_id = m.workspace_id
  left join fijos_nomina fn on fn.workspace_id = m.workspace_id;

grant select on v_pyl_mes to authenticated;

comment on view v_pyl_mes is
  'PyL mensual por workspace. fijos_total = gastos del mes clasificados fijo + fixed_expenses activos + gastos_fijos_config legacy + nomina de staff (empleados activos con salario). ebitda = ingresos - costos_variables - fijos_total, la misma cuenta que /numeros muestra como utilidad.';
