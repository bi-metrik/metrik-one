-- ============================================================
-- 20261007184500_plazos_por_hito_y_motivo_reproceso
--
-- SOE-001 (SOENA, 2026-10-07): Seguimiento pasa a operaciones y se parte en
-- cuatro etapas (Confirmación del radicado, Validación de rechazo, Acto
-- administrativo, Dinero en cuenta). Los relojes cuentan desde T0, la entrega a
-- la DIAN. Esta migración es SOLO de producto: funciones y columnas, cero filas
-- de cliente. La configuración de SOENA va aparte, en su carpeta de proyecto.
--
-- TRES CAMBIOS
--
-- 1. `plazos_pendientes`: alcance POR HITO.
--    Antes, `etapas_orden` y `ancla` eran de la línea y valían para todos los
--    hitos. Con cuatro etapas eso falla de dos formas:
--      · Un caso que ya está en Acto administrativo y nunca recibió el aviso de
--        5 días lo recibía tarde, el día que se encendiera la config: el hito
--        "confirma el radicado" no le aplica a quien ya lo confirmó.
--      · "Dinero en cuenta = acto administrativo + 5 días hábiles" cuelga de otra
--        fecha, no de T0. Con una sola ancla por línea no se podía declarar.
--    Ahora cada hito puede traer su `etapas_orden` y su `ancla`; si no las trae,
--    hereda las de la línea, así que una config vieja se lee exactamente igual.
--
-- 2. `alertas_plazo_log`: un aviso por hito Y POR CICLO de reproceso.
--    La UNIQUE (negocio_id, hito) decía "un aviso por caso para siempre". Con el
--    rechazo de la DIAN como reproceso (decisión de Mauricio del 2026-10-07), el
--    caso vuelve atrás, se fija un T0 nuevo y el reloj arranca otra vez: con la
--    UNIQUE vieja ese segundo ciclo no recibía NINGÚN aviso, en silencio.
--    · Columna `ciclo`, la llena un trigger desde `negocios.metadata.reproceso`.
--      La llena la BASE y no la edge function para que el orden de despliegue no
--      importe: con la función vieja desplegada, el insert sigue sin `ciclo` y el
--      trigger lo pone igual.
--    · UNIQUE (negocio_id, hito, ciclo): sigue siendo el insert el que gana la
--      carrera, ahora dentro del ciclo.
--    · "¿Ya se avisó en ESTE ciclo?" se decide por TIEMPO: cuenta un aviso enviado
--      después de que se abrió el último reproceso. No por la columna, porque las
--      63 filas que ya existen nacieron sin ciclo (quedan en 0) y algunas son de
--      casos que hoy van en el ciclo 1 o 2: compararlas por número las daría por
--      no avisadas y el primer cron las repetiría.
--
-- 3. `reproceso_eventos.motivo`: el porqué del reproceso, de una lista cerrada.
--    El texto libre (`detalle`) se queda. Medido el 2026-10-07: 54 de los 59
--    reprocesos son "Devolución DIAN" y la mitad no son un rechazo de la DIAN (el
--    cliente está fuera del país, no le llegó el enlace). Sin un motivo de lista
--    no hay forma de contar cuántos rechazos hubo por formato mal diligenciado.
--    La lista vive en el código (`src/lib/negocios/motivos-reproceso.ts`); la
--    columna es texto libre a propósito, para que agregar un motivo no pida
--    migración. Nullable: los 59 eventos viejos no tienen motivo y no se inventa.
-- ============================================================


-- ── 2. Ciclo en el log de avisos ─────────────────────────────────────────────

alter table public.alertas_plazo_log
  add column if not exists ciclo integer not null default 0;

comment on column public.alertas_plazo_log.ciclo is
  'Ciclo de reproceso del negocio cuando salió el aviso (negocios.metadata.reproceso.ciclo; 0 si nunca se reprocesó). Lo llena el trigger alertas_plazo_log_ciclo, no quien inserta.';

create or replace function public.alertas_plazo_log_ciclo()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Se ignora lo que mande quien inserta: el ciclo es un hecho del negocio, no
  -- una opinión del cron.
  select coalesce(
           case when jsonb_typeof(n.metadata->'reproceso'->'ciclo') = 'number'
                then (n.metadata->'reproceso'->>'ciclo')::integer end,
           0)
    into new.ciclo
  from public.negocios n
  where n.id = new.negocio_id;

  new.ciclo := coalesce(new.ciclo, 0);
  return new;
end;
$$;

-- Función de trigger: nadie la invoca desde el cliente.
revoke execute on function public.alertas_plazo_log_ciclo() from public, anon, authenticated;

drop trigger if exists trg_alertas_plazo_log_ciclo on public.alertas_plazo_log;
create trigger trg_alertas_plazo_log_ciclo
  before insert on public.alertas_plazo_log
  for each row execute function public.alertas_plazo_log_ciclo();

alter table public.alertas_plazo_log drop constraint if exists alertas_plazo_log_unico;
alter table public.alertas_plazo_log
  add constraint alertas_plazo_log_unico unique (negocio_id, hito, ciclo);


-- ── 1. Quién está vencido hoy, con alcance por hito ──────────────────────────
--
-- Forma de `lineas_negocio.config_extra.alertas_plazo` (lo nuevo va marcado):
--   {
--     "areas": ["operaciones"],
--     "etapas_orden": [19, 21, 22, 23],            -- default de los hitos
--     "ancla": { "campo": "fecha_entrega_dian",     -- default de los hitos
--                "fallback_campo": "fecha_cita_dian",
--                "fallback_dias_habiles": 0 },
--     "cerrar_si": { "campo": "fecha_devolucion_dian" },
--     "hitos": [
--       { "slug": "radicado_5", "dias_habiles": 5, "titulo": "...",
--         "etapas_orden": [19, 21] },                -- NUEVO: alcance propio
--       { "slug": "dinero_5", "dias_habiles": 5, "titulo": "...",
--         "etapas_orden": [24],
--         "ancla": { "campo": "fecha_acto_administrativo" } },  -- NUEVO: ancla propia
--       { "slug": "acto_45", ...,
--         "destinatarios": { "areas": [...], "staff_ids": [...] } }  -- lo lee la edge function
--     ]
--   }
--
-- La firma y las columnas de salida NO cambian: `create or replace` conserva el
-- dueño, el SECURITY DEFINER y los grants, y la edge function vieja la sigue
-- leyendo igual durante la ventana entre esta migración y su despliegue.
--
-- `hoy_bogota()` y no CURRENT_DATE: la instancia corre en UTC (20260927000001).

create or replace function public.plazos_pendientes(p_linea_id uuid)
returns table (
  negocio_id uuid,
  workspace_id uuid,
  codigo text,
  nombre text,
  etapa text,
  hito text,
  hito_titulo text,
  dias_habiles integer,
  fecha_ancla date,
  ancla_origen text,
  dias_transcurridos integer,
  festivos_cargados boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (
    select l.config_extra->'alertas_plazo' as c
    from lineas_negocio l
    where l.id = p_linea_id
      and l.config_extra ? 'alertas_plazo'
  ),
  -- Cada hito con SU alcance y SU ancla, o los de la línea si no declara.
  hitos as (
    select (h->>'slug')::text as slug,
           (h->>'titulo')::text as titulo,
           (h->>'dias_habiles')::integer as dias,
           coalesce(h->'etapas_orden', cfg.c->'etapas_orden') as etapas,
           coalesce(h->'ancla', cfg.c->'ancla') as ancla
    from cfg, jsonb_array_elements(cfg.c->'hitos') as h
  ),
  candidatos as (
    select n.id, n.workspace_id, n.codigo, n.nombre, e.nombre as etapa, e.orden,
           -- Desde cuándo corre el ciclo actual. Un texto que no parece fecha se
           -- descarta en vez de tumbar la consulta de toda la línea.
           case when (n.metadata->'reproceso'->>'abierto_at') ~ '^\d{4}-\d{2}-\d{2}'
                then (n.metadata->'reproceso'->>'abierto_at')::timestamptz end as ciclo_desde
    from negocios n
    join etapas_negocio e on e.id = n.etapa_actual_id
    where n.estado = 'abierto'
      and e.linea_id = p_linea_id
  ),
  cerrados as (
    select distinct nb.negocio_id
    from negocio_bloques nb
    cross join cfg
    where cfg.c ? 'cerrar_si'
      and fecha_de_texto(nb.data->>(cfg.c->'cerrar_si'->>'campo')) is not null
  ),
  -- Un par (caso, hito) existe solo si la etapa del caso está en el alcance del hito.
  pares as (
    select c.*, h.slug, h.titulo, h.dias, h.ancla
    from candidatos c
    join hitos h
      on c.orden in (select (v)::text::integer from jsonb_array_elements(h.etapas) as v)
    where c.id not in (select negocio_id from cerrados)
  ),
  -- El valor de un campo puede vivir en cualquier casilla del negocio: se toma el
  -- primero legible, no el primero que exista, para que una casilla con el año
  -- mal escrito no tape a otra que sí está bien.
  resuelto as (
    select p.id, p.workspace_id, p.codigo, p.nombre, p.etapa, p.slug, p.titulo, p.dias,
           p.ciclo_desde,
           coalesce(
             a.declarada,
             sumar_dias_habiles(a.fallback, coalesce((p.ancla->>'fallback_dias_habiles')::integer, 0))
           ) as fecha_ancla,
           case when a.declarada is not null then 'declarada' else 'estimada' end as origen
    from pares p
    cross join lateral (
      select max(fecha_de_texto(nb.data->>(p.ancla->>'campo'))) as declarada,
             max(fecha_de_texto(nb.data->>(p.ancla->>'fallback_campo'))) as fallback
      from negocio_bloques nb
      where nb.negocio_id = p.id
    ) a
  )
  select r.id, r.workspace_id, r.codigo, r.nombre, r.etapa,
         r.slug, r.titulo, r.dias,
         r.fecha_ancla, r.origen,
         dias_habiles_entre(r.fecha_ancla, hoy_bogota()),
         exists (
           select 1 from festivos_colombia f
           where extract(year from f.fecha) = extract(year from hoy_bogota())
         )
  from resuelto r
  where r.fecha_ancla is not null
    and dias_habiles_entre(r.fecha_ancla, hoy_bogota()) >= r.dias
    -- Ya avisado EN ESTE CICLO: un aviso anterior al último reproceso es del
    -- ciclo que la DIAN devolvió y no cuenta.
    and not exists (
      select 1 from alertas_plazo_log g
      where g.negocio_id = r.id
        and g.hito = r.slug
        and (r.ciclo_desde is null or g.enviado_at >= r.ciclo_desde)
    )
  order by r.fecha_ancla, r.codigo, r.slug;
$$;

comment on function public.plazos_pendientes(uuid) is
  'Negocios de una línea que cumplieron un hito de plazo y no han sido avisados en su ciclo actual. Cada hito declara (o hereda de la línea) su alcance por etapas_orden y su ancla, en config_extra.alertas_plazo.';

-- La invoca la edge function con service_role. Nadie más.
revoke execute on function public.plazos_pendientes(uuid) from public, anon, authenticated;


-- ── 3. Motivo del reproceso ──────────────────────────────────────────────────

alter table public.reproceso_eventos
  add column if not exists motivo text;

comment on column public.reproceso_eventos.motivo is
  'Motivo de la lista cerrada por tipo (src/lib/negocios/motivos-reproceso.ts). NULL en los eventos anteriores al 2026-10-07, que solo tienen el texto libre de detalle.';
