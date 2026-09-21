-- ============================================================================
-- SOENA · línea GIT EV/HEV · bloque `recibo_caja_upme` · 2026-09-21
--
-- El correo del recibo deja de prometer UN enlace muerto y pasa a nombrar los
-- documentos del pago, cada uno con su número, su concepto, su valor y su enlace.
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Es configuración sobre datos de producción y la aplica
-- la sesión principal. El código que lo consume ya está mergeado y es INERTE sin
-- este cambio: `{recibos}` solo se resuelve si el copy lo escribe.
--
-- ── Qué arregla, medido contra producción el 2026-09-21 ──────────────────────
-- · Los 3 PDF de `recibo_caja_upme` que se probaron devuelven **401** sin sesión.
--   Control limpio: los 3 de `factura_emitida` devuelven **200**. O sea que el 401
--   es del recibo, no del método de medición.
-- · La causa está en el propio código: `recibos.ts` archiva con
--   `archivarPdfEnBloque(..., publicoConEnlace = false)` desde el 2026-09-16 —el
--   PDF nace CERRADO en Drive, a propósito— y el copy siguió diciendo «Puedes ver y
--   descargar el recibo aquí: {link}», donde `{link}` es ese archivo cerrado.
-- · Alcance: **14 avisos con estado `enviado`, a 8 correos de clientes reales**, el
--   16 y el 17 de septiembre. Todos prometen una descarga y entregan un 401.
--
-- ── Qué cambia el día que se aplique ─────────────────────────────────────────
-- · El correo lista los documentos del ÚLTIMO pago (los del mismo `cobro_id`), uno
--   por línea: «RC-1-79 · Honorarios de asesoría · $637.500» y debajo su enlace,
--   firmado por 7 días contra la copia en Storage (bucket privado). Con un solo
--   componente sale una línea; con dos, dos.
-- · El enlace VENCE. Es la diferencia con «cualquiera con el enlace» de Drive, que
--   no vencía nunca y sobrevivía a reenviar el correo.
-- · ⚠️ Un negocio cuyo bloque NO tenga la lista `data.recibos` deja de recibir el
--   aviso (se omite con `sin_recibos`) en vez de recibirlo con el enlace muerto.
--   Medido: **1 de las 7 filas vivas** del bloque está así (un recibo archivado
--   antes de que la lista existiera). Omitir es la regla ya establecida para
--   `{link}` y `{fecha_cita}`: un correo que promete un documento y no lo entrega
--   deja al cliente peor que no recibirlo, y en el log se ve como éxito.
-- · Los recibos que se emitan DESPUÉS del deploy traen `concepto` y `ref` en su
--   entrada; los 7 anteriores no, y por eso se nombrarían sin concepto y sin
--   enlace. En la práctica no ocurre: el aviso solo se dispara cuando llega un
--   documento nuevo.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- 1. Merge del PR.
-- 2. `supabase functions deploy notificar-etapa`  ← mergear NO despliega la función.
-- 3. Este SQL.
--
-- Al revés (SQL primero) el copy pide `{recibos}`, la función vieja no conoce esa
-- marca, la deja literal en el cuerpo y el cliente recibe la palabra «{recibos}».
--
-- ── Qué NO toca ──────────────────────────────────────────────────────────────
-- · `link_bloque_slug` se queda: es la MISMA declaración de la que sale `{recibos}`.
-- · `campos_copy.recibo` se queda: `{recibo}` sigue vivo en `mensaje`.
-- · `mensaje_whatsapp` se queda igual (remite al correo).
-- · `whatsapp` sigue en `false` en este bloque.
--
-- `mensaje` (el copy genérico) pierde su `{link}` aunque hoy NO se use —el bloque
-- manda correo y `mensaje_email` está declarado—, porque el día que alguien
-- encienda WhatsApp ese enlace muerto saldría solo. No gana `{recibos}`: ese bloque
-- son dos líneas por documento con una URL larga adentro, y una plantilla aprobada
-- de Meta tiene casillas fijas de una sola línea.
-- ============================================================================

do $$
declare
  v_bloque   constant uuid := 'e89004cc-5b66-4132-9385-8130b80a383b';  -- recibo_caja_upme
  v_aviso    jsonb;
  v_email_ant text;
  v_msg_ant   text;
begin
  select config_extra -> 'avisar_al_cliente' into v_aviso
  from public.bloque_configs
  where id = v_bloque;

  if v_aviso is null then
    raise exception 'El bloque % no existe o no declara avisar_al_cliente', v_bloque;
  end if;

  v_email_ant := v_aviso ->> 'mensaje_email';
  v_msg_ant   := v_aviso ->> 'mensaje';

  -- Guarda: si el copy ya no es el que se midió, alguien lo editó en el camino y
  -- este script lo pisaría sin que nadie se entere.
  if position('Puedes ver y descargar el recibo aquí: {link}' in coalesce(v_email_ant, '')) = 0 then
    raise exception 'El copy del correo ya no es el medido el 2026-09-21. Revisar antes de aplicar. Actual: %', v_email_ant;
  end if;

  update public.bloque_configs
  set config_extra = jsonb_set(
    jsonb_set(
      config_extra,
      '{avisar_al_cliente,mensaje_email}',
      to_jsonb($copy$Hola[ {cliente}].

Recibimos tu pago y ya quedó registrado[ en el trámite de tu {vehiculo}].

Estos son los documentos de tu pago:

{recibos}

Si tienes alguna duda, escríbenos y con gusto te ayudamos.$copy$::text)
    ),
    '{avisar_al_cliente,mensaje}',
    to_jsonb($copy$Hola[ {cliente}]. Recibimos tu pago y ya quedó registrado.[ Número de recibo: {recibo}.] Escríbenos si necesitas el soporte.$copy$::text)
  )
  where id = v_bloque;

  -- Comprobación sobre lo que QUEDÓ, no sobre lo que se envió.
  select config_extra -> 'avisar_al_cliente' into v_aviso
  from public.bloque_configs
  where id = v_bloque;

  if position('{recibos}' in (v_aviso ->> 'mensaje_email')) = 0 then
    raise exception 'El copy del correo no quedó con {recibos}';
  end if;
  if position('{link}' in (v_aviso ->> 'mensaje')) > 0 then
    raise exception 'El copy genérico quedó con {link}, que es el enlace muerto';
  end if;
  if (v_aviso ->> 'link_bloque_slug') is distinct from 'recibo_caja_upme' then
    raise exception 'Se perdió link_bloque_slug: {recibos} sale de esa misma declaración';
  end if;

  raise notice 'Listo. Copy anterior del correo: %', v_email_ant;
  raise notice 'Copy anterior genérico: %', v_msg_ant;
end $$;
