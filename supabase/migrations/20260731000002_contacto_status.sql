-- Status del contacto: reemplaza el juego de valores de `contactos.segmento`.
--
-- El campo pasa de ser un DERIVADO del ciclo de vida del negocio (lo escribía
-- `sincronizarSegmentoContacto`, ya eliminada) a ser GESTIÓN comercial que marca
-- una persona: los tres intentos de contacto, conectado, no contestó, standby y
-- descartado. Ningún avance de negocio puede deducir un contador de intentos.
--
-- La COLUMNA se sigue llamando `segmento` a propósito: renombrarla obligaría a
-- tocar el webhook de Meta (`config_extra.meta_leads.contacto.segmento_inicial`)
-- y los tipos generados, sin beneficio visible para el equipo. Lo que cambia es
-- la etiqueta en pantalla ("Status") y los valores admitidos.
--
-- ⚠️ Esta migración AMPLÍA el CHECK: acepta los 7 valores nuevos Y los 4 viejos.
-- La base es compartida entre `main` y las ramas, así que restringir de una
-- rompería en vivo el código ya desplegado, que todavía escribe los viejos.
-- Secuencia acordada:
--   1. esta migración (amplía)           ← no toca datos, no rompe nada
--   2. merge + deploy del código nuevo
--   3. backfill de los valores viejos a los nuevos
--   4. migración posterior que restringe el CHECK a los 7 nuevos
--      y borra las cuatro líneas marcadas BORRAR TRAS EL BACKFILL

alter table public.contactos drop constraint if exists contactos_segmento_check;

alter table public.contactos add constraint contactos_segmento_check
  check (segmento = any (array[
    -- Vigentes (STATUS_CONTACTO en src/lib/catalogos/constants.ts)
    'primer_contacto'::text,
    'segundo_contacto'::text,
    'tercer_contacto'::text,
    'conectado'::text,
    'no_contesto'::text,
    'standby'::text,
    'descartado'::text,
    -- BORRAR TRAS EL BACKFILL: legacy, solo para no romper el código desplegado
    'sin_contactar'::text,
    'contactado'::text,
    'convertido'::text,
    'inactivo'::text
  ]));

comment on column public.contactos.segmento is
  'Status de gestión comercial del contacto (etiqueta visible: "Status"). Lo marca una persona, NO el sistema. Valores en STATUS_CONTACTO (src/lib/catalogos/constants.ts). El nombre de la columna es legacy.';
