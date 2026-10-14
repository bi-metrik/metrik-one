-- ============================================================================
-- F4 · Documentos del viajero en el CONTACTO (post-cotización, PR 11). SOLO ESQUEMA.
--
-- Vera §2 C11 (vinculante): los documentos del viajero (pasaporte, visa, asistencia médica) se
-- guardan en el contacto, no en el negocio, y el gate de «Documentos y entrega» lee del contacto.
-- Así el pasaporte que se leyó para un viaje sirve para el siguiente y su vencimiento se mide
-- contra cada regreso (F4-2: aviso rojo si vence a menos de 6 meses del regreso).
--
--   · Un documento = una fila: tipo, número, nombre como aparece, país, fechas y el archivo como
--     referencia `one://` en Storage (F0-6: archivo, nunca un link pegado).
--   · `leido_por_ia`: la lectura propuso los datos y la persona los confirmó (o los escribió).
--   · `negocio_id`: el viaje en el que se cargó (traza); el documento es del contacto.
--   · Nada se borra a mano desde la pantalla: un documento reemplazado queda `vigente = false`.
--
-- La lee y escribe la sesión (`authenticated`) por workspace; quién puede cargar (comercial
-- dueña, operaciones y aprobadores) lo revisa la acción del servidor (Vera §7.4).
--
-- No escribe ni corrige ninguna fila de ningún workspace. Lo que se construye encima queda detrás
-- de `lineas_negocio.config_extra.entrega_viaje.activo` (ausente = apagado = como hoy).
--
-- `aprobaciones_excepcion` ya trae el tipo `enviar_paquete_sin_cobro` (#1111) y `notificaciones`
-- ya trae `viaje_sin_listo`: esta migración no los toca.
-- ============================================================================

create table public.contacto_documentos (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  contacto_id         uuid not null references public.contactos(id) on delete cascade,
  tipo                text not null
                      check (tipo in ('pasaporte', 'visa', 'asistencia_medica', 'otro')),
  numero              text check (numero is null or length(btrim(numero)) between 1 and 60),
  -- Como aparece en el documento (puede no coincidir con el nombre del contacto).
  nombre_en_documento text check (nombre_en_documento is null or length(nombre_en_documento) <= 200),
  -- País que lo expide (pasaporte) o para el que vale (visa), en texto llano.
  pais                text check (pais is null or length(pais) <= 80),
  fecha_emision       date,
  fecha_vencimiento   date,
  archivo_ref         text check (archivo_ref is null or archivo_ref like 'one://%'),
  leido_por_ia        boolean not null default false,
  vigente             boolean not null default true,
  negocio_id          uuid references public.negocios(id) on delete set null,
  created_by          uuid references public.staff(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint contacto_documentos_fechas
    check (fecha_emision is null or fecha_vencimiento is null or fecha_vencimiento >= fecha_emision),
  -- Un documento sin número ni archivo no prueba nada.
  constraint contacto_documentos_con_algo
    check (numero is not null or archivo_ref is not null)
);

-- Un mismo documento (tipo + número) vigente una sola vez por contacto: volver a pegar el mismo
-- pasaporte actualiza, no duplica.
create unique index contacto_documentos_vigente_unico
  on public.contacto_documentos (contacto_id, tipo, numero)
  where vigente and numero is not null;
create index idx_contacto_documentos_contacto
  on public.contacto_documentos (workspace_id, contacto_id) where vigente;

alter table public.contacto_documentos enable row level security;
revoke all on table public.contacto_documentos from public, anon, authenticated;
create policy contacto_documentos_ws on public.contacto_documentos for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update on public.contacto_documentos to authenticated;

comment on table public.contacto_documentos is
  'Documentos del viajero (pasaporte, visa, asistencia médica) guardados en el contacto (Vera C11). El gate de Documentos y entrega lee de aquí. Sin delete: un documento reemplazado queda vigente = false.';
