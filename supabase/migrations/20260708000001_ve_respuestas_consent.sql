-- Voz de Venezuela — registro del consentimiento informado (Ley 1581).
-- El saludo del bot expone la salvedad y enlaza la politica (voz.metrik.com.co); el primer mensaje
-- del participante tras el saludo es su aceptacion por conducta concluyente. Se guarda version + fecha.

alter table public.ve_respuestas
  add column if not exists consent_version text,
  add column if not exists consent_at timestamptz;
