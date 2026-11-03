-- Hito de la suscripción del modo obras (Anexo 1.4 del contrato): el PRIMER pago real que el asistente registró en el
-- workspace, fuera de la configuración. Inicia los dos meses incluidos. Solo lectura.
--
-- «Registrado por el asistente» = un gasto con `propuesta_huella` (nació de un toque sobre una propuesta del agente) y
-- canal whatsapp. «Fuera de la configuración» = desde la fecha en que se encendió `bot_conversacional.obras` (la da
-- quien lo encendió; si no se sabe, el primero sin más). Devuelve fecha y hora de Bogotá del registro y del pago.
-- Uso: reemplazar <WORKSPACE_ID> y <DESDE> (AAAA-MM-DD, el día en que se entregó el workspace configurado).

select g.id,
       (g.created_at at time zone 'America/Bogota') as registrado_bogota,
       g.fecha as fecha_del_pago,
       g.monto,
       n.codigo as obra,
       g.created_by_wa_name as quien
from public.gastos g
left join public.negocios n on n.id = g.negocio_id
where g.workspace_id = '<WORKSPACE_ID>'
  and g.canal_registro = 'whatsapp'
  and g.propuesta_huella is not null
  and (g.created_at at time zone 'America/Bogota')::date >= '<DESDE>'::date
order by g.created_at
limit 1;
