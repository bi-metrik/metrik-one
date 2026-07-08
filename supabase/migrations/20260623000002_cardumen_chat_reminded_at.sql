-- CardumenChat: marca de recordatorio enviado (cron de 2h). NULL = aun no recordada.
alter table public.cardumen_chat_sessions
  add column if not exists reminded_at timestamptz;
