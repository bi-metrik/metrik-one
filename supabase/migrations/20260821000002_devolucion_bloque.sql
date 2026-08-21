-- Devolución de un bloque a su área de origen — el insumo del indicador
--
-- Operaciones recibe un documento que comercial cargó mal (ilegible, vencido, el archivo
-- equivocado) y tiene que hacerlo corregir. Hoy eso ocurre por WhatsApp: medido en
-- producción el 2026-08-21, de 1.019 movimientos de etapa registrados en SOENA solo 3
-- casos volvieron de operaciones a comercial, y ninguna devolución guarda motivo.
--
-- ⚠️ POR QUE UNA TABLA Y NO `activity_log`. El log ya registra las ediciones, pero 1.493
--    de sus 1.555 entradas dicen `bloque_datos` con una frase en texto libre y SIN valor
--    anterior. No distingue "lo llenó" de "lo corrigió", ni permite agrupar por motivo.
--    Contar sobre texto libre es justo lo que hace inmedible el proceso hoy.
--
-- ⚠️ ESTO NO ES UN REPROCESO. `reproceso_eventos` cuenta las veces que un TERCERO (UPME,
--    DIAN) rechazó el trabajo, y pesa en el bono de operaciones. Una devolución interna no
--    puede caer ahí: inflaría un indicador que mide otra cosa.
--
-- La marca vigente vive en `negocio_bloques.data._devolucion`, pero solo conserva la
-- devolución ABIERTA (al corregir se borra). Contar sobre ella daría siempre "las abiertas
-- hoy". Por eso cada devolución se asienta además como hecho propio aquí.
--
-- IDEMPOTENTE.

begin;

create table if not exists public.devolucion_eventos (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  negocio_id        uuid not null references public.negocios(id) on delete cascade,
  -- La fila concreta que se devolvió. Sin `on delete cascade` explícito porque
  -- `negocio_bloques` se borra con el negocio, que ya cascadea arriba.
  negocio_bloque_id uuid not null references public.negocio_bloques(id) on delete cascade,
  -- Slug del bloque: el identificador ESTABLE para agrupar. `bloque_nombre` se guarda
  -- aparte porque un bloque puede renombrarse y el indicador histórico debe seguir
  -- diciendo cómo se llamaba cuando se devolvió.
  bloque_slug       text,
  bloque_nombre     text not null,
  motivo            text not null check (motivo in (
                      'ilegible', 'no_coincide', 'vencido', 'archivo_equivocado', 'incompleto')),
  nota              text,
  -- Dónde estaba el caso al devolver. Responde "en qué punto se detecta el error",
  -- que es distinto de "en qué etapa vive el documento".
  etapa_al_devolver text,
  devuelto_por      uuid references public.staff(id) on delete set null,
  devuelto_at       timestamptz not null default now(),
  -- Se estampa cuando alguien vuelve a diligenciar el bloque. La diferencia contra
  -- `devuelto_at` es la carga represada por la corrección.
  resuelto_at       timestamptz,
  resuelto_por      uuid references public.staff(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.devolucion_eventos is
  'Un hecho por bloque devuelto a su area de origen para correccion. NO es reproceso (eso es reproceso_eventos, que cuenta rechazos de terceros y pesa en el bono). La marca vigente vive en negocio_bloques.data._devolucion y solo conserva la abierta; esta tabla permite contar por periodo, por bloque y por motivo.';

create index if not exists devolucion_eventos_ws_fecha_idx
  on public.devolucion_eventos (workspace_id, devuelto_at);
create index if not exists devolucion_eventos_bloque_idx
  on public.devolucion_eventos (workspace_id, bloque_slug, devuelto_at);
create index if not exists devolucion_eventos_negocio_idx
  on public.devolucion_eventos (negocio_id);
-- Cerrar una devolucion busca la fila abierta de ESA casilla. Parcial porque las
-- resueltas nunca se consultan por este camino.
create index if not exists devolucion_eventos_abiertas_idx
  on public.devolucion_eventos (negocio_bloque_id)
  where resuelto_at is null;

alter table public.devolucion_eventos enable row level security;

drop policy if exists devolucion_eventos_select on public.devolucion_eventos;
create policy devolucion_eventos_select on public.devolucion_eventos
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

-- Mismo criterio que `reproceso_eventos`: lectura para la app, escritura solo desde el
-- server action con service_role. Sin el REVOKE, quien devuelve mal podria borrar su
-- propia devolucion y el indicador contaria de menos justo donde importa.
revoke all on public.devolucion_eventos from anon;
revoke all on public.devolucion_eventos from authenticated;
grant select on public.devolucion_eventos to authenticated;

-- ── Notificacion ────────────────────────────────────────────────────────────
-- `notificaciones.tipo` es un CHECK, y un tipo fuera de la lista falla EN SILENCIO:
-- el insert se rechaza, nadie recibe el aviso y la pantalla se ve bien. Ya mordio
-- cuatro veces en este repo (ver el comentario de `reproceso-actions`).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notificaciones_tipo_check'
      and pg_get_constraintdef(oid) like '%devolucion_bloque%'
  ) then
    alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
    alter table public.notificaciones add constraint notificaciones_tipo_check
      check (tipo = any (array[
        'inactividad_oportunidad','handoff','asignacion_responsable','asignacion_colaborador',
        'mencion','streak_roto','inactividad_proyecto','proyecto_entregado','proyecto_cerrado',
        'cobro_vencido','cobro_proximo','plan_terminado','cuenta_cobro_pendiente_aprobacion',
        'cuenta_cobro_enviada','cuenta_cobro_envio_fallo','responsable_faltante_area',
        'negocio_cancelado','negocio_reabierto','negocio_reactivado','conciliacion_solicitada',
        'mencion_equipo','reproceso','negocio_en_etapa','precio_corregido',
        'devolucion_bloque'
      ]::text[]));
  end if;
end $$;

commit;
