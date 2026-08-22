-- El segmento del contacto viaja con el candidato.
--
-- Decision de negocio (2026-08-22): FunnelChat es la fuente de verdad del
-- segmento. El comercial etiqueta en el chat, que es donde de verdad trabaja, y
-- ONE refleja. Para reflejar hay que comparar, y para comparar hay que saber en
-- que segmento esta hoy el contacto.
--
-- Se agrega `segmento` a lo que devuelve la busqueda por telefono en vez de
-- hacer una segunda consulta desde el receptor: son la misma pregunta ("quien es
-- y como esta"), y separarlas abre una ventana entre leer y escribir.
--
-- ⚠️ Cambia la firma de salida, asi que toca DROP + CREATE. `create or replace`
-- falla cuando cambian las columnas de un returns table.
drop function if exists public.funnelchat_contactos_por_telefono(uuid, text);

create function public.funnelchat_contactos_por_telefono(
  p_workspace_id uuid,
  p_nacional text
)
returns table (id uuid, nombre text, telefono text, segmento text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id, c.nombre, c.telefono, c.segmento
  from public.contactos c
  where c.workspace_id = p_workspace_id
    and p_nacional ~ '^3[0-9]{9}$'
    and public.telefono_movil_co(c.telefono) = p_nacional
  order by c.created_at
$$;

-- El revoke se vuelve a declarar porque el DROP se llevo los privilegios con la
-- funcion anterior. Una migracion tiene que ser valida leida sola.
revoke execute on function public.funnelchat_contactos_por_telefono(uuid, text) from public, anon, authenticated;

comment on function public.funnelchat_contactos_por_telefono(uuid, text) is
  'Contactos del workspace cuyo movil normalizado es el numero dado, con su segmento actual. Puede devolver mas de uno: la ambiguedad es real y la decide quien llama, no esta funcion.';

-- Que hizo el receptor con la etiqueta, guardado junto al evento que la trajo.
--
-- Va en la bitacora y no solo en `activity_log` porque los casos que NO escriben
-- son los que importan: una etiqueta desconocida, un evento que llega tarde y no
-- retrocede, un contacto ambiguo. `activity_log` solo registra cambios; si estos
-- no quedaran en ningun lado, "no paso nada" y "paso algo y lo rechace" volverian
-- a ser indistinguibles, que es el fallo que este frente ya pago caro.
alter table public.funnelchat_eventos
  add column if not exists sincronizacion jsonb;

comment on column public.funnelchat_eventos.sincronizacion is
  'Veredicto del sincronizador de segmento para este evento: aplica / no_retrocede / sin_cambio / etiqueta_desconocida / sin_etiqueta / fallo.';
