-- El historial de cambios de contactos necesita que `entidad_tipo` admita 'contacto'.
--
-- `activity_log` no tiene FK a ninguna entidad — son dos columnas sueltas
-- (`entidad_tipo` + `entidad_id`) — pero SI tiene un CHECK que enumera los tipos
-- permitidos, y 'contacto' no estaba. Sin esto el insert falla, y en varias de las
-- rutas que escriben ahi el fallo es silencioso.
--
-- Solo ENSANCHA el CHECK: ninguna fila existente deja de cumplirlo y no se toca
-- ningun dato.
alter table activity_log drop constraint if exists activity_log_entidad_tipo_check;

alter table activity_log add constraint activity_log_entidad_tipo_check
  check (entidad_tipo = any (array['oportunidad'::text, 'proyecto'::text, 'negocio'::text, 'contacto'::text]));
