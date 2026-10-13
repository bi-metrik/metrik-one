-- ============================================================
-- 20261013090000 — Cobro al cumplirse los 7 días de la prueba de Valida (con tarjeta en ePayco)
--
-- Decisión de Mauricio (2026-10-12): «Se debe registrar medio de pago al ingresar y el cobro se hace
-- de manera automática a los 7 días». Opción A de Emilio: fecha FIJA, apertura + 7 días, aunque las
-- 10 consultas se agoten antes. Textos: `proyectos/metrik/valida/docs/legal/condiciones-prueba-valida-v2.0.md`
-- (numerales 7.1 a 7.3) y el veredicto de Vera (`vera-condiciones-v2.0.md`, filas 13 y 16).
--
-- ## Qué escribe: DDL sobre `valida_registros`. Ni una fila de datos.
--
-- Columnas nuevas, todas nulas por defecto: las filas que ya existen (registros sin tarjeta) quedan
-- igual, con `cobro_estado` nulo, y el cobro no las mira.
--
--   cobro_estado           null = no hay cobro (registro sin tarjeta). Si no:
--                            programado      la prueba abrió con tarjeta; se cobra después de cobro_programado_at
--                            cancelado       la Empresa canceló a tiempo (7.3): no se cobra
--                            cobrando        una corrida lo reclamó y está cobrando (la guarda contra el doble cobro)
--                            cobrado         ePayco aprobó el primer mes
--                            cobro_pendiente ePayco dejó el cobro pendiente: lo cierra la confirmación
--                            rechazado       ePayco lo rechazó: 7.5, enlace de pago
--                            revisar         resultado dudoso (error de red con ePayco): lo mira una persona
--   cobro_programado_at    el instante EXACTO en que se cumplen los 7 días (`vence_en` de la prueba). El
--                          cobro nunca corre antes (fila 13 de Vera), aunque el cron sea a las 07:00.
--   cobro_aviso_enviado_at el correo del 7.2. El cobro exige que haya salido al menos 48 h antes.
--   cobro_cancelado_at, cobro_cancelado_por   el 7.3: botón «Cancelar prueba» o correo (lo registra una persona).
--   cobro_token_borrado_at cuándo ePayco confirmó que borró la tarjeta tras cancelar (7.3).
--   cobro_intento_at, cobro_ref, cobro_detalle   el rastro del cobro (referencia de ePayco, motivo).
--   cobro_entorno          el despliegue que abrió la prueba (production | preview | development).
--                          Los previews usan la base de producción: un preview solo procesa los suyos, y
--                          producción solo los suyos. Sin esto, un cobro de prueba en un preview
--                          podría "pagar" el registro real de un cliente.
--
-- Y `metodo_pago_estado` admite `eliminado`: la tarjeta se borró en ePayco y ya no sirve para cobrar.
--
-- ## Reversa
--   alter table public.valida_registros
--     drop constraint if exists valida_registros_cobro_estado_check,
--     drop constraint if exists valida_registros_cobro_cancelado_por_check,
--     drop constraint if exists valida_registros_cobro_programado_coherente,
--     drop column if exists cobro_estado, drop column if exists cobro_programado_at,
--     drop column if exists cobro_aviso_enviado_at, drop column if exists cobro_cancelado_at,
--     drop column if exists cobro_cancelado_por, drop column if exists cobro_token_borrado_at,
--     drop column if exists cobro_intento_at, drop column if exists cobro_ref,
--     drop column if exists cobro_detalle, drop column if exists cobro_entorno;
--   drop index if exists public.valida_registros_cobro_pendiente;
--   -- y el CHECK de metodo_pago_estado como estaba (sin 'eliminado').
-- ============================================================

alter table public.valida_registros
  add column if not exists cobro_estado text,
  add column if not exists cobro_programado_at timestamptz,
  add column if not exists cobro_aviso_enviado_at timestamptz,
  add column if not exists cobro_cancelado_at timestamptz,
  add column if not exists cobro_cancelado_por text,
  add column if not exists cobro_token_borrado_at timestamptz,
  add column if not exists cobro_intento_at timestamptz,
  add column if not exists cobro_ref text,
  add column if not exists cobro_detalle text,
  add column if not exists cobro_entorno text;

alter table public.valida_registros drop constraint if exists valida_registros_cobro_estado_check;
alter table public.valida_registros add constraint valida_registros_cobro_estado_check
  check (cobro_estado is null or cobro_estado in (
    'programado', 'cancelado', 'cobrando', 'cobrado', 'cobro_pendiente', 'rechazado', 'revisar'
  ));

alter table public.valida_registros drop constraint if exists valida_registros_cobro_cancelado_por_check;
alter table public.valida_registros add constraint valida_registros_cobro_cancelado_por_check
  check (cobro_cancelado_por is null or cobro_cancelado_por in ('boton', 'correo'));

-- Un cobro programado tiene su instante y su entorno; uno cancelado, cuándo.
alter table public.valida_registros drop constraint if exists valida_registros_cobro_programado_coherente;
alter table public.valida_registros add constraint valida_registros_cobro_programado_coherente
  check (
    (cobro_estado is null or (cobro_programado_at is not null and cobro_entorno is not null))
    and (cobro_estado is distinct from 'cancelado' or cobro_cancelado_at is not null)
  );

alter table public.valida_registros drop constraint if exists valida_registros_metodo_pago_estado_check;
alter table public.valida_registros add constraint valida_registros_metodo_pago_estado_check
  check (metodo_pago_estado in ('no_requerido', 'pendiente', 'registrado', 'fallido', 'eliminado'));

-- Lo que lee el cron: los cobros por hacer y las tarjetas por borrar.
create index if not exists valida_registros_cobro_pendiente
  on public.valida_registros (cobro_entorno, cobro_programado_at)
  where cobro_estado in ('programado', 'cancelado');

-- server-only: la tabla sigue sin policy ni grant para anon/authenticated (20261010090000). Lo
-- nuevo lo escriben el registro, el botón «Cancelar prueba» (server action) y el cron, todos con
-- service_role.
