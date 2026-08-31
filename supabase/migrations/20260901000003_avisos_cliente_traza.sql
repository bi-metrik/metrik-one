-- ============================================================
-- Traza de los avisos al CLIENTE
--
-- EL PROBLEMA QUE CIERRA:
--   Hoy, si un aviso al cliente salio o se omitio vive UNICAMENTE en los logs de
--   la edge function `notificar-etapa`, que duran dias. Nadie puede responder
--   "¿a este cliente ya le avisamos?" sin adivinar. Medido el 2026-08-31: 12
--   invocaciones el 28 y 29 de agosto, todas 200, y ni una sola fila en ninguna
--   tabla que diga a quien le llego.
--
-- POR QUE UNA TABLA NUEVA Y NO `notificaciones`:
--   `notificaciones` es la campana del EQUIPO: sus filas tienen `profile_id`,
--   se marcan leidas, se resuelven y las limpia un cron de obsoletas. Un aviso
--   al cliente no tiene profile, no se lee, no se resuelve y no puede
--   caducar — es un hecho historico. Meterlo ahi habria roto los dos contratos.
--
-- POR QUE REGISTRA TAMBIEN LO QUE NO SALIO:
--   La pregunta operativa no es "¿a quien le avisamos?" sino "¿por que a este
--   no?". Un aviso omitido por `sin_correo` o `sin_fecha_cita` es exactamente la
--   fila que el equipo necesita ver para ir a buscar el dato. Una tabla que solo
--   guarda exitos deja el caso roto viendose igual que el caso que nunca aplico:
--   es la leccion transversal del 2026-08-31 (A3, A6, A8).
--
-- QUIEN ESCRIBE: solo la edge function, con `service_role`.
--   ⚠️ A3 (2026-08-31) fallo justo por lo contrario: `reprocesarNegocio` insertaba
--   con el cliente de la sesion contra una tabla que le revoca la escritura a
--   `authenticated`, y los 7 inserts volvian con 42501 tragado por un console.error.
--   Aqui el escritor ES service_role desde el primer dia (la edge function ya crea
--   su cliente con SUPABASE_SERVICE_ROLE_KEY), asi que la politica y el escritor
--   nacen alineados.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.avisos_cliente (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  negocio_id     uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  -- La etapa que disparo el aviso. Se guarda el nombre ADEMAS del id porque
  -- renombrar o desactivar una etapa no puede reescribir el historico: la fila
  -- tiene que seguir diciendo que se le aviso al cliente "por entrar a Anexos"
  -- aunque manana esa etapa se llame de otra forma.
  etapa_id       uuid REFERENCES public.etapas_negocio(id) ON DELETE SET NULL,
  etapa_nombre   text,
  canal          text NOT NULL CHECK (canal IN ('email', 'whatsapp')),
  -- `enviado`   = el proveedor acepto el envio. SOLO correo.
  -- `disparado` = SOLO WhatsApp. Un 200 de FunnelChat dice que el disparo se
  --   recibio, no que el mensaje le llego a nadie, y fuera de la ventana de 24 h
  --   Meta bota el texto libre con el 131047. Registrarlo como `enviado` seria
  --   exactamente la pantalla que miente; el canal tiene su propio estado para
  --   que nadie pueda contar disparos como avisos entregados.
  -- `omitido`   = la plataforma decidio no mandarlo (falta un dato, no hay correo).
  -- `fallido`   = se intento y el proveedor lo rechazo.
  -- La distincion importa: omitido es trabajo para el equipo (falta un dato),
  -- fallido es trabajo para nosotros.
  estado         text NOT NULL CHECK (estado IN ('enviado', 'disparado', 'omitido', 'fallido')),
  -- Correo o telefono al que se mando. NULL cuando se omitio justamente por no
  -- tenerlo.
  destino        text,
  -- El comercial que quedo en copia (bcc) y como `reply_to`. Es la trazabilidad
  -- que pidio Mauricio: quien lleva el caso ve el mismo correo que vio el cliente.
  copia_a        text,
  -- El motivo en el vocabulario que ya usaba la funcion en sus logs y en su
  -- respuesta JSON: `sin_correo`, `sin_fecha_cita`, `sin_link`, `sin_telefono`,
  -- `resend_422`, `funnelchat_500`... Se deja como texto libre a proposito: un
  -- CHECK con la lista de hoy obligaria a una migracion cada vez que aparezca un
  -- motivo nuevo, y el que aparezca es justo el que hay que poder ver.
  motivo         text,
  -- El asunto que efectivamente salio, ya con los reemplazos aplicados. Sin esto
  -- no se puede reconstruir que le dijimos al cliente: el copy vive en
  -- `config_extra` de la etapa y cambia.
  titulo         text,
  -- El id del proveedor (Resend). Es la llave para ir a buscar el rebote.
  proveedor_id   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.avisos_cliente IS
  'Un hecho por cada aviso al cliente que la plataforma intento, por canal: enviado, omitido (con motivo) o fallido. Antes esto vivia solo en los logs de la edge function `notificar-etapa`, que duran dias, y nadie podia responder "¿a este cliente le avisamos?". No es la campana del equipo (eso es `notificaciones`): estas filas no se leen, no se resuelven y no caducan.';

COMMENT ON COLUMN public.avisos_cliente.copia_a IS
  'Comercial del negocio, que va en bcc del correo al cliente y como su reply_to. Va en bcc y no en cc para no exponerle al cliente una direccion mas de la que ya ve al responder.';

CREATE INDEX IF NOT EXISTS avisos_cliente_negocio_idx
  ON public.avisos_cliente (negocio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS avisos_cliente_ws_fecha_idx
  ON public.avisos_cliente (workspace_id, created_at DESC);
-- Para la pregunta inversa: "¿que avisos se estan omitiendo, y por que?".
CREATE INDEX IF NOT EXISTS avisos_cliente_estado_idx
  ON public.avisos_cliente (workspace_id, estado, created_at DESC);

ALTER TABLE public.avisos_cliente ENABLE ROW LEVEL SECURITY;

-- El helper va envuelto en (SELECT ...) desde el primer dia: es el patron que el
-- PR #443 tuvo que ir a aplicarle a todas las politicas viejas para que Postgres
-- lo evalue una vez (InitPlan) y no una vez por fila.
DROP POLICY IF EXISTS avisos_cliente_select ON public.avisos_cliente;
CREATE POLICY avisos_cliente_select ON public.avisos_cliente
  FOR SELECT TO authenticated
  USING (workspace_id = (SELECT current_user_workspace_id()));

REVOKE ALL ON public.avisos_cliente FROM anon;
REVOKE ALL ON public.avisos_cliente FROM authenticated;
-- Lectura para la app. La escritura la hace la edge function con service_role:
-- un operador no puede borrar la evidencia de que a su cliente no se le aviso.
GRANT SELECT ON public.avisos_cliente TO authenticated;
