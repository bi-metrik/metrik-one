-- ============================================================
-- 20261014234500 — La constancia del cobro del primer mes AL CONFIRMAR (Valida autogestionada)
--
-- Decisión de Mauricio (2026-10-14): el primer mes se cobra en el primero de dos momentos, los 7 días
-- de la prueba o la consulta 11 (agotó las 10 de prueba), y en este segundo caso solo con la
-- confirmación de la Empresa: la pantalla muestra el valor y los últimos 4 dígitos de la tarjeta y
-- un botón. Condiciones de la prueba v2.1, numeral 7.1 literal a; Términos v2.1 autoservicio, 3.5.
--
-- Ese clic es la autorización de un cobro que se adelanta a la fecha informada: se guarda su prueba
-- en el mismo registro, en el reclamo del cobro (`cobrarAlConfirmar`, `cobro-prueba-servidor.ts`).
--
-- ## Qué escribe: DDL sobre `valida_registros`. Ni una fila de datos.
--
--   cobro_confirmado_at     cuándo confirmó. Null = el cobro es (o será) el del día 7.
--   cobro_confirmado_por    quién confirmó (el usuario; el servidor exige que sea quien se registró).
--   cobro_confirmado_ip     la IP desde la que confirmó.
--   cobro_confirmado_texto  el texto exacto que vio antes de confirmar (título, detalle y botón). El
--                           servidor no cobra si el texto que arma al cobrar no tiene la huella del
--                           que mostró la pantalla (C8 del dictamen de Emilio, 2026-10-14).
--   cobro_confirmacion_rechazada_at  ePayco rechazó el cobro al confirmar. La fila vuelve a `programado`
--                           (conserva la prueba y el cobro del día 7 sigue en pie, 7.5 v2.1) y no se
--                           le vuelve a ofrecer la confirmación.
--
-- Si la activación falla ANTES de cobrar, la fila vuelve a `programado` y la constancia queda (un
-- intento de confirmación sin cobro). Un nuevo clic la deja antes en `activity_log` y luego la reemplaza.
--
-- Sin esta migración, la lectura del cobro al confirmar falla (columna inexistente) y NO cobra: el
-- cobro del día 7 no lee estas columnas y sigue igual.
--
-- ## Reversa
--   alter table public.valida_registros
--     drop constraint if exists valida_registros_cobro_confirmado_coherente,
--     drop column if exists cobro_confirmado_at,
--     drop column if exists cobro_confirmado_por,
--     drop column if exists cobro_confirmacion_rechazada_at,
--     drop column if exists cobro_confirmado_ip,
--     drop column if exists cobro_confirmado_texto;
-- ============================================================

alter table public.valida_registros
  add column if not exists cobro_confirmado_at timestamptz,
  add column if not exists cobro_confirmado_por uuid,
  add column if not exists cobro_confirmado_ip text,
  add column if not exists cobro_confirmacion_rechazada_at timestamptz,
  add column if not exists cobro_confirmado_texto text;

-- Una confirmación sin el texto que se vio, o sin quién confirmó, no prueba nada.
alter table public.valida_registros drop constraint if exists valida_registros_cobro_confirmado_coherente;
alter table public.valida_registros add constraint valida_registros_cobro_confirmado_coherente
  check (
    cobro_confirmado_at is null
    or (cobro_confirmado_texto is not null and length(cobro_confirmado_texto) > 0 and cobro_confirmado_por is not null)
  );
