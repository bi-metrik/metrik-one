-- Un aviso automático al cliente sale UNA vez por el mismo hecho (SOE-008 / SOE-009,
-- decisión de Mauricio del 2026-10-09: «la primera debe ser blindada para que en los
-- reprocesos no se envíen los correos»).
--
-- POR QUÉ. `notificar-etapa` avisa al cliente cada vez que el caso ENTRA a una etapa que
-- lo declara. Un reproceso hace pasar el caso otra vez por las mismas etapas y el aviso
-- volvía a salir. Medido en SOENA: V0457 recibió dos veces «Tu cita con la DIAN quedó
-- agendada» (21 y 22 de septiembre) con la misma cita. La guarda de la etapa
-- (`omitir_si_bloque_completo`) no lo atajaba porque el reproceso vacía también el bloque
-- que dice «ya le avisé al cliente».
--
-- QUÉ CAMBIA AQUÍ. Solo una columna: `huella`, los datos del hecho que el aviso le contó
-- al cliente (la cita, la referencia del documento, los recibos), como texto. La edge
-- function la escribe en cada fila y, antes de mandar, busca una fila previa del mismo
-- origen y canal que haya salido con la misma huella. Regla completa en
-- `supabase/functions/_shared/aviso-mismo-hecho.ts`.
--
-- Las filas anteriores quedan con `huella` NULL a propósito: no se rellenan. La función
-- reconstruye su huella del historial del bloque (`data._ciclos`) en el momento de
-- decidir. Esta migración no escribe ni una fila.
--
-- ORDEN. Esta migración ANTES de desplegar `notificar-etapa`: la función nueva inserta
-- `huella` y sin la columna el insert de la traza falla (la traza se pierde, el aviso no).
-- Con el código viejo la columna es inocua: nadie la lee.

alter table public.avisos_cliente add column if not exists huella text;

comment on column public.avisos_cliente.huella is
  'Los datos del hecho que el aviso le contó al cliente (p. ej. {"fecha_cita":"2026-10-20T09:30"}; {} si el aviso no cita datos). Un aviso con la misma huella, del mismo origen y canal, que ya salió (enviado/disparado) no se repite: motivo duplicado. Otra huella (cita reprogramada, documento reemitido) es un hecho nuevo y sí sale. NULL en filas anteriores al 2026-10-09: la edge function la reconstruye del historial del bloque. Fuente: supabase/functions/_shared/aviso-mismo-hecho.ts.';
