-- El {link} del aviso al cliente deja de depender del orden de las filas.
--
-- El copy de la etapa Entrega de SOENA promete el certificado UPME:
--   "Tu certificado UPME ... Lo puedes ver y descargar aqui: {link}"
-- pero hasta ahora la edge function resolvia {link} recorriendo los bloques de la
-- etapa y quedandose con el ULTIMO que tuviera `drive_url`, sin `order by` y sin
-- mirar de que bloque era. Entrega tiene DOS con archivo (Certificado UPME y Factura
-- emitida), asi que el enlace lo elegia la base.
--
-- Medido antes de escribir esto (2026-08-25, produccion):
--   · 10 etapas de la base tienen mas de un bloque con `drive_url`, con 185 negocios
--     abiertos parados en ellas.
--   · De los 58 casos que ya pasaron por Entrega, 16 tienen archivo en LOS DOS, y en
--     los 16 el enlace que salia era el de la FACTURA, no el del certificado.
--
-- A partir del cambio en `supabase/functions/notificar-etapa/index.ts`, la etapa
-- DECLARA de que bloque sale el enlace, por el slug estable del bloque ORIGEN. Sin
-- esta clave el aviso se omite con `sin_link` en vez de adivinar: por eso esta
-- migracion acompaña al despliegue de la function.
--
-- Por que `concepto_upme` y no el nombre del bloque de Entrega: el bloque "Certificado
-- UPME" de Entrega es una copia heredada readonly (slug NULL, `source_bloque_slug`
-- = concepto_upme) y `getNegocioDetalle` le hace swap a su `data` por la del origen
-- antes de pintarla. El origen es lo que el operador ve en pantalla; leer la copia
-- mandaria un archivo que la plataforma no muestra en ningun lado — medido: en 11 de
-- 42 casos la copia tiene guardado un `drive_url` distinto del origen.
--
-- Vuelta atras: borrar la clave `link_bloque_slug`. El aviso deja de salir (`sin_link`),
-- que es el lado seguro.

do $$
declare
  v_etapa  uuid;
  v_linea  uuid;
begin
  -- Exactamente una etapa de SOENA cita {link} en el aviso al cliente. Si aparece otra,
  -- esta migracion ya no sabe a cual le toca este slug y aborta en vez de elegir.
  select e.id, e.linea_id
    into strict v_etapa, v_linea
    from etapas_negocio e
    join lineas_negocio l on l.id = e.linea_id
    join workspaces w on w.id = l.workspace_id
   where w.slug = 'soena'
     and coalesce(e.config_extra #>> '{avisar_al_cliente,mensaje}', '') like '%{link}%';

  -- El slug tiene que existir en la MISMA linea, o el aviso quedaria declarando un
  -- bloque que no existe y se omitiria para siempre sin que nadie sepa por que.
  perform 1
     from bloque_configs bc
     join etapas_negocio e2 on e2.id = bc.etapa_id
    where bc.slug = 'concepto_upme'
      and e2.linea_id = v_linea;
  if not found then
    raise exception 'La linea % no tiene un bloque con slug concepto_upme', v_linea;
  end if;

  update etapas_negocio
     set config_extra = jsonb_set(
           config_extra,
           '{avisar_al_cliente,link_bloque_slug}',
           '"concepto_upme"'::jsonb,
           true
         )
   where id = v_etapa;
end $$;
