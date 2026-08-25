-- Cuando cambia el comercial de un contacto en ONE, cambia el agente en FunnelChat.
--
-- LA REGLA QUE ESTO IMPLEMENTA (Mauricio, 2026-08-25)
--   El comercial se asigna en MeTRIK ONE. El chat obedece.
--   Hasta hoy las dos plataformas se movian por separado: se cambiaba el responsable del
--   contacto en ONE y la conversacion de WhatsApp seguia en la bandeja de otro, sin que
--   nada fallara y sin que nadie se enterara.
--
-- POR QUE UN TRIGGER Y NO UN CAMBIO EN LA UI
--   El responsable de un contacto se toca desde varios sitios (la ficha del contacto, la
--   conversion de una interaccion en negocio, un UPDATE por SQL en un cargue). Un trigger
--   cubre todos esos caminos; enganchar en la UI habria cubierto solo el que se engancho.
--   Mismo criterio que `trg_avisar_entrada_etapa` (20260728000003).
--
-- POR QUE `contactos` Y NO `negocios`
--   Esta sincronizacion es del CONTACTO. Una conversacion de WhatsApp le pertenece a una
--   persona, no a un tramite, y aqui no hay etapas de por medio. Los negocios no se tocan.
--
-- POR QUE pg_net DIRECTO Y NO UNA EDGE FUNCTION
--   `notificar-etapa` pasa por una edge function porque ademas manda correos con Resend,
--   que necesita una API key que no puede vivir en SQL. Aca no hay correo: es un POST con
--   tres campos. Todo lo que la edge function haria (validar el proveedor de la URL,
--   normalizar el telefono, resolver el correo del comercial) se resuelve en la base, que
--   es donde ya viven los tres datos. Una funcion intermedia seria un salto de red mas y
--   un artefacto mas que desplegar, sin comprar nada.
--
-- QUE PASA DEL OTRO LADO
--   El POST va al disparador del tablero 46341 de FunnelChat ("MÉTRIK ASIGNAR COMERCIAL -
--   ONE"), que graba el correo en el campo `Comercial email ONE` del contacto y, con 5
--   condiciones encadenadas, asigna la conversacion al agente que corresponde. Ese tablero
--   NO tiene nodo de mensaje a proposito: una reasignacion interna no es un hecho del
--   cliente y no puede escribirle. El tablero 46213 (aviso de etapa) si le escribe, y por
--   eso son dos disparadores distintos y no uno reutilizado.
--
-- ⚠️ LA URL DEL DISPARADOR ES LA CREDENCIAL
--   No lleva token ni firma: quien la tenga puede asignar conversaciones. Por eso vive en
--   `workspaces.config_extra` (server-only, mismo trato que `trigger_url` y que las
--   credenciales de Siigo) y no en una tabla que el cliente autenticado pueda leer. Y como
--   la escribe un admin, se acota al proveedor antes de hacer de puente hacia donde diga.
--
-- ⚠️ LO QUE ESTO NO HACE
--   Quitarle el responsable a un contacto (dejarlo en NULL) no le quita la conversacion al
--   agente en FunnelChat: su constructor de flujos sabe asignar, no desasignar. Se sale
--   temprano en ese caso en vez de mandar un correo vacio, que ademas le borraria al
--   contacto el rastro de a quien se le habia asignado. Reasignar a OTRO comercial si
--   funciona, que es el caso real.
--
-- ⚠️ SOLO LOS 5 COMERCIALES DEL TABLERO
--   El flujo tiene una condicion por correo, y hoy son cinco (jessica.tejada,
--   tatiana.cepeda, daniela.jativa, esperanza.verdugo, liant.chirinos @gruposoena.com). Un
--   contacto de alguien que no este en esa lista dispara igual y no pasa nada del otro
--   lado: no cumple ninguna condicion. Medido el 2026-08-25 en SOENA: 21 contactos con
--   responsable fuera de esa lista (Juan Bruce 12, Juan Jose Ibanez 9).
--
-- ⚠️ UN UPDATE MASIVO ES UN DISPARO POR FILA
--   `for each row`: reasignar 400 contactos en una sola sentencia son 400 POST a
--   FunnelChat. No se pone freno aqui porque no hay ningun cargue que hoy haga eso, pero
--   quien vaya a hacerlo que lo sepa antes, no despues.
--
-- DONDE SE VE SI SALIO
--   `net._http_response` guarda el status y el cuerpo de cada POST. Es el rastro de que
--   esto se disparo y de que FunnelChat lo recibio. Un 200 dice que el disparo entro, no
--   que la conversacion quedo asignada: eso solo se ve en la bandeja.

create or replace function public.asignar_comercial_funnelchat()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_url text;
  v_nacional text;
  v_email text;
  v_nombre text;
begin
  -- `after update of responsable_id` dispara ante cualquier UPDATE que MENCIONE la
  -- columna, aunque el valor no cambie. Esta comparacion es la que hace que solo viaje un
  -- cambio real. Un INSERT no tiene `old` y cae directo al siguiente guard.
  if tg_op = 'UPDATE' and new.responsable_id is not distinct from old.responsable_id then
    return new;
  end if;

  -- Sin comercial no hay a quien asignar. Ver la nota de arriba sobre desasignar.
  if new.responsable_id is null then
    return new;
  end if;

  -- Un workspace sin disparador no es un error: es un workspace que no usa FunnelChat.
  select w.config_extra -> 'funnelchat' ->> 'trigger_asignacion_url'
    into v_url
  from workspaces w where w.id = new.workspace_id;
  if v_url is null then return new; end if;

  -- Acotado al proveedor: la URL la escribe un admin y esta funcion no puede volverse un
  -- puente hacia cualquier host.
  if v_url !~ '^https://[a-zA-Z0-9.-]+\.funnelchat\.app/' then return new; end if;

  -- FunnelChat identifica al contacto por el telefono. Se usa la MISMA regla que el resto
  -- del sistema (`telefono_movil_co`, 20260822000003) en vez de abrir una segunda copia:
  -- limpia el decimal de Excel, el indicativo duplicado y los separadores. Un fijo o un
  -- handle de Instagram no reciben WhatsApp y no tienen conversacion que asignar.
  v_nacional := public.telefono_movil_co(new.telefono);
  if v_nacional is null or v_nacional !~ '^3[0-9]{9}$' then return new; end if;

  -- El cruce entre plataformas es por CORREO: es la unica llave estable entre una persona
  -- de ONE y un agente de FunnelChat. `contactos.responsable_id` guarda `staff_id`
  -- (20260721000002) y el correo vive en `auth.users`, alcanzable por `staff.profile_id`.
  select s.full_name, u.email
    into v_nombre, v_email
  from staff s
  left join auth.users u on u.id = s.profile_id
  where s.id = new.responsable_id;
  if v_email is null then return new; end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'telefono', '+57' || v_nacional,
      'comercial_email', v_email,
      'comercial_nombre', coalesce(v_nombre, '')
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  return new;
end;
$$;

-- Misma politica que las otras 48 funciones de trigger (20260811100000): PostgreSQL exige
-- EXECUTE al CREAR el trigger, no al dispararlo.
revoke execute on function public.asignar_comercial_funnelchat() from public, anon, authenticated;

drop trigger if exists trg_asignar_comercial_funnelchat on public.contactos;
create trigger trg_asignar_comercial_funnelchat
  after insert or update of responsable_id on public.contactos
  for each row execute function public.asignar_comercial_funnelchat();

comment on function public.asignar_comercial_funnelchat() is
  'Avisa a FunnelChat quien atiende un contacto cuando cambia contactos.responsable_id, con POST via pg_net al disparador del workspace. El comercial se asigna en ONE y el chat obedece. No desasigna: FunnelChat no expone esa accion.';

-- ============================================================
-- ROLLBACK (correr manualmente si hay que revertir):
--
-- drop trigger if exists trg_asignar_comercial_funnelchat on public.contactos;
-- drop function if exists public.asignar_comercial_funnelchat();
-- ============================================================
