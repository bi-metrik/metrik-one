-- La cartera solo cuenta negocios que YA se vendieron.
--
-- Regla de negocio (Mauricio, 2026-08-22): un negocio se vuelve venta cuando
-- entra el primer pago. Antes de eso no hay venta, y sin venta no hay deuda por
-- mucho que exista un precio aprobado. Es la misma vara que ya usa
-- `v_venta_mes_comercial`, que fecha la venta en el primer cobro imputado: sin
-- esto /numeros era la unica pantalla midiendo con otra regla.
--
-- Lo que el cambio destapa, medido antes de escribirlo. De los 125 negocios que
-- la version anterior daba por deudores en SOENA ($79.936.645), **119 no tenian
-- registrado un solo peso** ($77.811.645), y **115 de esos son el cargue
-- historico V0130-V0248** ($75.049.145). Estan en Notificacion, Seguimiento,
-- Anexos, Generacion y Cita: SOENA ya les esta haciendo el trabajo. Con un
-- modelo que cobra anticipo antes de arrancar, un caso en Anexos sin ningun
-- cobro no es un cliente que no pago — es un pago que nunca entro a ONE. Ese
-- hueco es saneo de datos del cargue (S13), no cartera.
--
-- Cartera despues del cambio: $2.125.000 en 6 negocios.
--
-- ⚠️ /conciliacion NO cambia y va a seguir mostrando los ~$77,4M como
-- "Faltante", a proposito: esa pantalla pregunta "que casos no cuadran", y 115
-- casos sin ningun pago registrado es exactamente lo que debe gritar. La
-- diferencia entre las dos pantallas queda rotulada en las dos.
--
-- El unico cambio mecanico frente a `20260822000004` es que el `left join` a
-- los pagos pasa a ser `join`: sin fila en `v_cobro_valor` el negocio no entra.
create or replace view v_cartera_negocio as
with recaudo as (
  select cv.negocio_id, sum(cv.a_tramo1 + cv.a_tramo2) as honorario_recaudado
  from v_cobro_valor cv
  group by cv.negocio_id
)
select
  n.workspace_id,
  n.id as negocio_id,
  n.codigo,
  n.nombre,
  n.precio_aprobado as honorario,
  r.honorario_recaudado,
  greatest(0, n.precio_aprobado - r.honorario_recaudado) as saldo,
  (current_date - n.created_at::date) as dias
from negocios n
join recaudo r on r.negocio_id = n.id
where n.precio_aprobado is not null
  and n.estado not in ('perdido', 'cancelado');

alter view v_cartera_negocio set (security_invoker = on);
grant select on v_cartera_negocio to authenticated;
