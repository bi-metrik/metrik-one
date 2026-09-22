-- El mismo correo del cliente que resuelve el aviso, pero para una LISTA de negocios.
--
-- Por qué hace falta. El panel de recibos (`recibos-control-actions.ts`) decía "al
-- cliente no se le avisa: no hay correo" leyendo `contactos.email` y nada más, mientras
-- el aviso real (`notificar-etapa`) resuelve el destinatario con
-- `email_cliente_negocio`, que prefiere el correo del RUT. Medido contra producción el
-- 2026-09-22 sobre los 410 cobros pendientes de SOENA: la advertencia salía en 119 casos
-- y era FALSA en 112, y en otros 73 el panel mostraba una dirección distinta de la que
-- iba a recibir el soporte. Quien emite lee esa frase para decidir si le toca avisarle
-- al cliente por otro lado, así que el panel estaba mandando a perseguir por WhatsApp
-- pagos ya confirmados por correo.
--
-- Por qué una función nueva y no la regla copiada en TypeScript. La precedencia
-- (rut → rut_solicitante_2 → contacto) tiene que seguir teniendo UNA sola definición:
-- copiarla en la action es volver a crear este mismo defecto dentro de seis meses, con
-- el agravante de que la copia se desincronizaría en silencio. Esta función no decide
-- nada: llama a `email_cliente_negocio` una vez por id.
--
-- Por qué por lote y no una llamada por fila. El panel muestra 410 cobros sobre ~300
-- negocios. Una llamada por negocio son 300 idas y vueltas por carga de pantalla.
--
-- Solo DDL: no lee ni escribe datos de nadie al aplicarse.

create or replace function public.emails_cliente_negocio(p_negocio_ids uuid[])
returns table (negocio_id uuid, email text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id, public.email_cliente_negocio(t.id)
  from unnest(coalesce(p_negocio_ids, '{}'::uuid[])) as t(id)
$function$;

-- server-only: la llama el panel de recibos con `createServiceClient`, igual que
-- `email_cliente_negocio` la llama `notificar-etapa` con service_role. Devuelve correos
-- de cualquier negocio sin filtrar por workspace (es `security definer`), así que no se
-- expone al cliente con sesión: el filtro por inquilino lo pone quien llama, que solo le
-- pasa los ids de los negocios de su propio workspace.
revoke execute on function public.emails_cliente_negocio(uuid[]) from public, anon, authenticated;
grant execute on function public.emails_cliente_negocio(uuid[]) to service_role;

comment on function public.emails_cliente_negocio(uuid[]) is
  'Correo del cliente de varios negocios en una sola llamada. No define precedencia: delega en email_cliente_negocio(uuid), que es la fuente unica. Server-only (service_role).';
