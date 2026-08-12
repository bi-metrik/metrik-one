-- `anon` deja de tener INSERT / UPDATE / DELETE sobre `public`. Excepcion declarada: Cardumen.
--
-- Defensa en profundidad, no cierre de una fuga: medido el 2026-08-10, de las 123 tablas con
-- grant de escritura para `anon`, **122 ya estaban cerradas por RLS** y ninguna estaba sin RLS.
-- RLS esta haciendo su trabajo. El problema es que es la UNICA capa: una tabla nueva a la que
-- se le olvide el `enable row level security` queda escribible sin sesion, y el default del
-- proyecto garantiza que el grant ya este puesto esperandola. Fue exactamente lo que paso el
-- 2026-08-09/10 con los seis respaldos `CREATE TABLE ... AS SELECT`.
--
-- Quitar el grant convierte ese olvido en una tabla inerte en vez de una tabla abierta.
--
-- No hay flujo del producto que escriba sin sesion: el middleware solo deja pasar `/login`
-- (signup, onboarding e invitaciones estan cerrados) y la certificacion publica por QR entra
-- por `service_role`, que bypasea grants y RLS. Una vez hay sesion el rol efectivo es
-- `authenticated`, que no se toca aqui.
--
-- UNICA excepcion, deliberada y con policy que la respalda: `cardumen_respuestas`. Cardumen es
-- una encuesta publica que comparte esta instancia; su policy `anon inserta respuesta`
-- (INSERT, with check true) es by-design. Se le devuelve el INSERT de forma explicita, que es
-- justo la diferencia entre un permiso decidido y un permiso heredado.
--
-- SELECT de `anon` NO se toca en esta migracion: hay 8 tablas de catalogo global legibles sin
-- sesion y esa decision va por separado (ver el bloque de convenciones en CLAUDE.md).

revoke insert, update, delete on all tables in schema public from anon;

grant insert on public.cardumen_respuestas to anon;

do $$
declare fuera int;
begin
  select count(distinct table_name) into fuera
  from information_schema.role_table_grants
  where table_schema='public' and grantee='anon'
    and privilege_type in ('INSERT','UPDATE','DELETE')
    and table_name <> 'cardumen_respuestas';
  if fuera > 0 then
    raise exception 'Quedaron % tablas con escritura para anon fuera de la excepcion declarada', fuera;
  end if;
end $$;
