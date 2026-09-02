// Edge function — avisa por CORREO cuando un negocio entra a una etapa marcada
// para avisar.
//
// POR QUE UNA EDGE FUNCTION Y NO UN CAMBIO EN `cambiarEtapaNegocio`:
//   1. El motor de avance de etapa es territorio de otra sesión de trabajo (S1).
//      Un trigger de base de datos captura el cambio SIN tocar ese archivo.
//   2. Un trigger cubre TODOS los caminos: la UI, el motor de routing, un salto
//      automático de etapa, un backfill por SQL. Enganchar en el código habría
//      cubierto solo el camino que se enganchó.
//   3. La RESEND_API_KEY vive en los secretos de la edge function, no en SQL.
//
// Quién dispara esto: dos triggers, vía pg_net (mismo patrón que los crons de
// wa-alerts).
//
//   · `trg_avisar_entrada_etapa` sobre `negocios` — el negocio entró a una etapa que
//     declara aviso. Es el camino original.
//   · `trg_avisar_documento_cargado` sobre `negocio_bloques` — llegó el documento de un
//     bloque que declara aviso, y manda además el `bloque_config_id`. Existe porque hay
//     novedades que no coinciden con ningún cambio de etapa: la factura de SOENA se sube
//     desde 10 etapas distintas y en 142 de 185 casos el negocio ya no vuelve a moverse
//     después de recibirla (migración 20260902000006).
//
// La notificación IN-APP ya la creó el trigger. Esto es el refuerzo por correo:
// el comercial puede estar sin la plataforma abierta.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const FROM = 'MéTRIK ONE <noreply@metrikone.co>';

/**
 * `prueba` manda el MISMO correo que recibiria el cliente a otras direcciones, para
 * poder verlo antes de que un cliente real lo reciba.
 *
 * Se renderiza el mismo HTML, con el mismo remitente, el mismo `reply_to` y los datos
 * reales del negocio: si se armara un correo aparte "de ejemplo", lo que se aprueba no
 * seria lo que sale. Lo unico que cambia: el destinatario, un aviso arriba diciendo a
 * quien le habria llegado, y el asunto con `[PRUEBA]` delante.
 *
 * Una prueba NO manda WhatsApp, NO avisa al equipo, NO deja traza y NO copia al
 * comercial: nada de lo que hace debe verse despues como si el cliente hubiera sido
 * avisado.
 *
 * `etapa_id` permite ver el copy de una etapa por la que el negocio no esta pasando
 * ahora (para revisar los dos avisos con un solo negocio). `bloque_config_id` hace lo
 * mismo con el copy que declara un BLOQUE.
 */
type Payload = {
  negocio_id: string;
  /**
   * De donde sale el aviso al cliente. Lo decide QUIEN disparo:
   *
   *   · ausente -> la ETAPA, via `trg_avisar_entrada_etapa`. Es el camino de siempre.
   *   · presente -> el BLOQUE, via `trg_avisar_documento_cargado`. El evento ahi es
   *     "llego el documento", que no coincide con ningun cambio de etapa: en SOENA la
   *     factura se sube desde 10 etapas distintas y en 142 de 185 casos el negocio ya
   *     no vuelve a moverse despues de recibirla.
   *
   * El aviso INTERNO al equipo no tiene version por bloque: sigue colgando de la etapa.
   */
  bloque_config_id?: string;
  prueba?: { to: string[]; etapa_id?: string; bloque_config_id?: string };
};

// Las edge functions no tienen el `Database` generado, y sin el supabase-js
// resuelve TODA fila como `never`: probado con `deno check`, son 13 errores de
// tipos. Este `any` es el ESQUEMA, no el cliente — se cambia por el `Database`
// generado el dia que exista, y mientras tanto vive en un solo sitio en vez de
// repartido por las firmas.
// deno-lint-ignore no-explicit-any
type EsquemaSinGenerar = any; // eslint-disable-line @typescript-eslint/no-explicit-any

type Supabase = SupabaseClient<EsquemaSinGenerar>;

/**
 * El aviso al cliente, tal como lo declara la etapa en `config_extra`.
 *
 * `link_bloque_slug` dice de QUE bloque sale el `{link}` del copy. Es opt-in y no tiene
 * default a proposito: sin el, un copy que promete un documento se omite en vez de
 * mandar el que la base devuelva primero.
 *
 * `plantilla` es el NOMBRE de la plantilla aprobada de WhatsApp que FunnelChat debe
 * mandar para esta etapa. Sin ella FunnelChat solo puede mandar texto libre, y Meta
 * bota el texto libre con el error 131047 cuando el cliente no ha escrito en 24 horas,
 * que es el caso normal de un aviso de tramite. Va por NOMBRE y no por posicion de
 * etapa porque renombrar una etapa no puede romper un envio en silencio.
 *
 * Viaja SOLO si el correo salio, igual que `mensaje_whatsapp` y por la misma razon: el
 * texto aprobado de las plantillas de SOENA remite al correo, y FunnelChat las manda sin
 * volver a preguntar. Declararla no basta para que salga.
 *
 * ── Los tres copys y por que son tres ──────────────────────────────────────────
 * `mensaje` es el copy que se basta solo: cuenta la novedad completa. Es el unico
 * obligatorio y el unico que existia antes.
 *
 * `mensaje_email` es el copy propio del correo. Existe porque el correo NO tiene la
 * restriccion que si tiene WhatsApp: fuera de la ventana de 24 horas Meta solo entrega
 * plantillas aprobadas, cortas y con casillas fijas, mientras que un correo admite
 * varios parrafos y el nombre de quien lo recibe. Si la etapa no lo declara, el correo
 * usa `mensaje` y se comporta igual que siempre.
 *
 * `mensaje_whatsapp` es el copy que remite al correo ("te llego un correo con..."), y
 * lo usa el WhatsApp SOLO cuando el correo efectivamente salio. Es lo que convierte al
 * correo en la fuente de verdad sin obligar a mantener el mismo detalle en dos textos
 * que se desincronizarian. Cuando el correo no sale —el cliente no tiene correo
 * registrado, o el copy se omitio por falta de dato— WhatsApp vuelve a `mensaje`, que
 * si se basta solo: avisar de un correo que nunca va a llegar es peor que no avisar.
 *
 * `campos_copy` declara de que bloque y de que campos salen los datos OPCIONALES del
 * copy (en SOENA, el vehiculo de la factura). Ver `datosOpcionales`.
 */
type AvisoCliente = {
  email?: boolean;
  whatsapp?: boolean;
  titulo?: string;
  mensaje?: string;
  mensaje_email?: string;
  mensaje_whatsapp?: string;
  link_bloque_slug?: string;
  plantilla?: string;
  campos_copy?: CamposCopy;
};

/**
 * Lo que paso con el correo al cliente, en la forma que la traza necesita.
 *
 * `enviadoA` es a quien LE LLEGO de verdad y por eso queda vacio en una prueba;
 * `destinatarioReal` es a quien le habria llegado, que es lo que hay que poder mostrar
 * al revisar el envio. Separarlos evita el unico error grave posible aqui: registrar
 * un ensayo como si el cliente hubiera sido avisado.
 */
type ResultadoCorreo = {
  estado: 'enviado' | 'omitido' | 'fallido';
  enviadoA: string | null;
  destinatarioReal: string | null;
  omitidoPor: string | null;
  respondeA: string | null;
  copiaA: string | null;
  titulo: string | null;
  proveedorId: string | null;
};

const CORREO_VACIO: ResultadoCorreo = {
  estado: 'omitido',
  enviadoA: null,
  destinatarioReal: null,
  omitidoPor: null,
  respondeA: null,
  copiaA: null,
  titulo: null,
  proveedorId: null,
};

/**
 * Lo que paso con el WhatsApp.
 *
 * ⚠️ Su estado bueno es `disparado`, no `enviado`, y no es un matiz de redaccion: un
 * 200 de FunnelChat dice que el disparo se recibio, no que el mensaje le llego a nadie
 * — y fuera de la ventana de 24 h Meta bota el texto libre con el 131047. El canal
 * tiene su propio estado para que nadie pueda contar disparos como avisos entregados.
 */
type ResultadoWhatsApp = {
  estado: 'disparado' | 'omitido' | 'fallido';
  disparadoA: string | null;
  omitidoPor: string | null;
};

/** Las columnas del negocio que leen los avisos al cliente. */
type Negocio = {
  id: string;
  codigo: string | null;
  nombre: string;
  workspace_id: string;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const expected = Deno.env.get('NOTIFICAR_ETAPA_SECRET');
  if (!expected) return json({ error: 'server_misconfigured', detail: 'NOTIFICAR_ETAPA_SECRET' }, 500);

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'server_misconfigured', detail: 'RESEND_API_KEY' }, 500);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body?.negocio_id) return json({ error: 'negocio_id requerido' }, 400);

  // El modo prueba manda correo de verdad, asi que su destinatario se valida aqui y no
  // dentro del envio: un `to` mal formado tiene que ser un 400, no un correo a nadie.
  const prueba = body.prueba;
  if (prueba) {
    const destinos = Array.isArray(prueba.to) ? prueba.to.filter((d) => typeof d === 'string' && d.includes('@')) : [];
    if (destinos.length === 0) return json({ error: 'prueba.to requerido' }, 400);
    prueba.to = destinos;
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Qué negocio, en qué etapa, con qué copy ────────────────────────────────
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, codigo, nombre, workspace_id, etapa_actual_id, workspaces(slug)')
    .eq('id', body.negocio_id)
    .maybeSingle();

  if (!negocio) return json({ error: 'negocio_no_encontrado' }, 404);

  // En una prueba se puede pedir el copy de OTRA etapa: asi los dos avisos de la linea
  // se revisan con un solo negocio, sin tener que buscar uno parado en cada etapa.
  const { data: etapa } = await supabase
    .from('etapas_negocio')
    .select('id, nombre, config_extra')
    .eq('id', prueba?.etapa_id ?? negocio.etapa_actual_id)
    .maybeSingle();

  // Solo se exige en una prueba, que es donde la etapa la pidio una persona y un id
  // equivocado tiene que decirlo. En el camino normal la ausencia se sigue tratando
  // como "esta etapa no declara aviso", que es como se comporto siempre.
  if (prueba && !etapa) return json({ error: 'etapa_no_encontrada' }, 404);

  const cfgEtapa = etapa?.config_extra as Record<string, unknown> | null;

  // ── El aviso que declara un BLOQUE ─────────────────────────────────────────
  // Se lee por id y no por slug: el trigger manda el `bloque_config_id` de la fila que
  // se acaba de escribir, o sea el bloque ORIGEN. Un slug obligaria a resolverlo otra
  // vez y abriria la puerta a leer una copia readonly, que es el fallo que ya cerro
  // `link_bloque_slug` (PR #395).
  const bloqueId = body.bloque_config_id ?? prueba?.bloque_config_id ?? null;
  const { data: bloque } = bloqueId
    ? await supabase
      .from('bloque_configs')
      .select('id, nombre, config_extra')
      .eq('id', bloqueId)
      .maybeSingle()
    : { data: null };
  if (bloqueId && !bloque) return json({ error: 'bloque_no_encontrado' }, 404);

  const avisoRaw = cfgEtapa?.avisar_al_entrar as
    | { email?: boolean; activo?: boolean; titulo?: string; mensaje?: string; areas?: string[] }
    | undefined;
  // `activo: false` apaga el aviso interno conservando su texto (ver la migración
  // 20260813000001). Ausente = encendido, que es como se comportó siempre.
  //
  // Un disparo por bloque NO lleva aviso interno: quien subió el documento es justamente
  // la persona a la que el aviso interno le diría que lo suba.
  const aviso = bloque ? undefined : (avisoRaw?.activo === false ? undefined : avisoRaw);

  const avisoCliente = (bloque
    ? (bloque.config_extra as Record<string, unknown> | null)?.avisar_al_cliente
    : cfgEtapa?.avisar_al_cliente) as AvisoCliente | undefined;

  // Dos destinos independientes, y el del cliente tiene dos canales que también son
  // independientes: se puede querer WhatsApp sin correo. Si nadie pide nada no hay
  // trabajo (la notificación in-app del equipo ya la creó el trigger).
  const quiereInterno = aviso?.email === true;
  const quiereCliente = avisoCliente?.email === true;
  const quiereClienteWa = avisoCliente?.whatsapp === true;
  // ── Una prueba se corta aquí ───────────────────────────────────────────────
  // Manda el correo del cliente a quien lo pidió y no toca nada más: ni WhatsApp, ni
  // el aviso al equipo, ni la traza. Un ensayo no puede quedar registrado como un
  // cliente avisado.
  if (prueba) {
    if (!quiereCliente) {
      return json({
        ok: true,
        prueba: true,
        skipped: bloque ? 'bloque_sin_aviso_por_correo' : 'etapa_sin_aviso_por_correo',
        etapa: etapa?.nombre ?? null,
        bloque: bloque?.nombre ?? null,
      });
    }
    const r = await enviarAlCliente(supabase, resendKey, negocio, etapa?.nombre ?? '', avisoCliente!, prueba.to);
    return json({
      ok: true,
      prueba: true,
      etapa: etapa?.nombre ?? null,
      bloque: bloque?.nombre ?? null,
      enviado_a: r.estado === 'enviado' ? prueba.to : null,
      destinatario_real: r.destinatarioReal,
      titulo: r.titulo,
      omitido: r.omitidoPor,
      responde_a: r.respondeA,
    });
  }

  if (!quiereInterno && !quiereCliente && !quiereClienteWa) {
    return json({ ok: true, skipped: 'sin_aviso_email' });
  }

  // ── El aviso al CLIENTE ────────────────────────────────────────────────────
  // Se despacha antes que el interno porque es el que el cliente está esperando, y
  // porque un fallo del interno no puede dejarlo sin su aviso.
  let clienteEnviado: string | null = null;
  let clienteOmitido: string | null = null;
  // A dónde contesta el cliente. Se reporta para poder verificarlo sin abrir el correo.
  let clienteRespondeA: string | null = null;
  // A quién se le copió el correo (el comercial del negocio).
  let clienteCopiaA: string | null = null;
  if (quiereCliente) {
    const r = await enviarAlCliente(supabase, resendKey, negocio, etapa?.nombre ?? '', avisoCliente!);
    clienteEnviado = r.enviadoA;
    clienteOmitido = r.omitidoPor;
    clienteRespondeA = r.respondeA;
    clienteCopiaA = r.copiaA;
    await registrarAviso(supabase, negocio, etapa, bloqueId, {
      canal: 'email',
      estado: r.estado,
      destino: r.enviadoA ?? r.destinatarioReal,
      copia_a: r.copiaA,
      motivo: r.omitidoPor,
      titulo: r.titulo,
      proveedor_id: r.proveedorId,
    });
  }

  // ── El aviso al cliente por WHATSAPP ───────────────────────────────────────
  // Canal aparte y con su propio try: los dos van al mismo cliente, así que un fallo
  // de FunnelChat no puede dejarlo sin el correo que sí salió, ni al revés.
  let waDisparado: string | null = null;
  let waOmitido: string | null = null;
  if (quiereClienteWa) {
    // Le pasa si el correo SALIO de verdad (no si la etapa lo pedia): es lo que decide
    // si el WhatsApp puede remitir al correo o tiene que contar la novedad el mismo.
    const r = await enviarWhatsAppAlCliente(
      supabase, negocio, etapa?.nombre ?? '', avisoCliente!, clienteEnviado !== null,
    );
    waDisparado = r.disparadoA;
    waOmitido = r.omitidoPor;
    await registrarAviso(supabase, negocio, etapa, bloqueId, {
      canal: 'whatsapp',
      estado: r.estado,
      destino: r.disparadoA,
      copia_a: null,
      motivo: r.omitidoPor,
      titulo: null,
      proveedor_id: null,
    });
  }

  if (!quiereInterno) {
    return json({
      ok: true,
      cliente: clienteEnviado,
      cliente_omitido: clienteOmitido,
      responde_a: clienteRespondeA,
      copia_a: clienteCopiaA,
      whatsapp_disparado: waDisparado,
      whatsapp_omitido: waOmitido,
    });
  }

  // ── A quién ────────────────────────────────────────────────────────────────
  // Dos modos, y el correo TIENE que resolver igual que el trigger o la campana
  // y el correo le llegarían a personas distintas:
  //   · `areas` declarado -> a todo el staff de esas áreas (pendiente de equipo).
  //     Se reparte por `staff_areas` SIN mirar el rol, igual que
  //     `crear_notificacion_equipo`: quien lleva un área con rol `admin` en vez de
  //     `supervisor` también tiene que enterarse.
  //   · sin `areas` -> comportamiento original: el responsable del stage.
  let profileIds: string[] = [];

  if (Array.isArray(aviso.areas) && aviso.areas.length > 0) {
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id, profile_id')
      .eq('workspace_id', negocio.workspace_id)
      .not('profile_id', 'is', null);

    const staff = (staffRows ?? []) as Array<{ id: string; profile_id: string }>;
    if (staff.length > 0) {
      const { data: areaRows } = await supabase
        .from('staff_areas')
        .select('staff_id')
        .in('staff_id', staff.map((s) => s.id))
        .in('area', aviso.areas);

      const conArea = new Set(((areaRows ?? []) as Array<{ staff_id: string }>).map((a) => a.staff_id));
      profileIds = [...new Set(staff.filter((s) => conArea.has(s.id)).map((s) => s.profile_id))];
    }
  } else {
    const { data: destinatarios } = await supabase.rpc('destinatarios_negocio', {
      p_negocio_id: negocio.id,
    });

    profileIds = ((destinatarios ?? []) as Array<{ profile_id: string }>)
      .map((d) => d.profile_id)
      .filter(Boolean);
  }

  if (profileIds.length === 0) return json({ ok: true, skipped: 'sin_destinatarios' });

  // El email vive en auth.users, no en profiles.
  const correos: string[] = [];
  for (const pid of profileIds) {
    const { data: user } = await supabase.auth.admin.getUserById(pid);
    const email = user?.user?.email;
    if (email) correos.push(email);
  }
  if (correos.length === 0) return json({ ok: true, skipped: 'sin_correos' });

  // ── El correo ──────────────────────────────────────────────────────────────
  const slug = (negocio.workspaces as { slug?: string } | null)?.slug ?? '';
  const baseDomain = Deno.env.get('BASE_DOMAIN') ?? 'metrikone.co';
  const link = `https://${slug}.${baseDomain}/negocios/${negocio.id}`;
  const etiqueta = negocio.codigo ? `${negocio.codigo} — ${negocio.nombre}` : negocio.nombre;

  const titulo = aviso.titulo ?? `${negocio.nombre} llegó a ${etapa?.nombre ?? 'una etapa nueva'}`;
  const mensaje = (aviso.mensaje ?? 'Este negocio pasó a tu etapa y espera tu gestión.')
    .replaceAll('{negocio}', negocio.nombre ?? '')
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{etapa}', etapa?.nombre ?? '');

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escapar(etapa?.nombre ?? '')}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${escapar(mensaje)}</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6B7280">Negocio: <strong style="color:#1A1A1A">${escapar(etiqueta ?? '')}</strong></p>
    <a href="${link}" style="display:inline-block;background:#10B981;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Abrir el negocio</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: correos, subject: titulo, html }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[notificar-etapa] Resend falló:', res.status, detail);
    return json({ error: 'envio_fallido', status: res.status }, 502);
  }

  return json({
    ok: true,
    enviados: correos.length,
    cliente: clienteEnviado,
    cliente_omitido: clienteOmitido,
    responde_a: clienteRespondeA,
    copia_a: clienteCopiaA,
    whatsapp_disparado: waDisparado,
    whatsapp_omitido: waOmitido,
  });
});


// ── La traza ─────────────────────────────────────────────────────────────────

/**
 * Asienta lo que paso con UN aviso al cliente, en UN canal.
 *
 * Existe porque hasta hoy esto vivia solo en los logs de esta funcion, que duran dias:
 * nadie podia responder "¿a este cliente le avisamos?" sin adivinar. Se escribe tanto
 * el envio como la omision con su motivo, porque la pregunta operativa que sigue es
 * "¿y por que a este no?" — y un motivo como `sin_correo` o `sin_fecha_cita` es
 * exactamente el trabajo que el equipo tiene que ir a hacer.
 *
 * ⚠️ Nunca propaga su error. Si la traza fallara, el cliente YA recibio el aviso: hacer
 * fallar la respuesta haria que pg_net registre un error sobre un envio exitoso, y el
 * equipo saldria a buscar un correo que si salio. El fallo queda en el log, que es
 * donde se puede ver sin mentirle a nadie.
 */
async function registrarAviso(
  supabase: Supabase,
  negocio: Negocio,
  etapa: { id?: string; nombre?: string } | null,
  // De que bloque salio, cuando el evento fue "llego el documento". La etapa se sigue
  // guardando igual: es DONDE estaba el caso cuando el documento llego, que es la
  // pregunta que sigue despues de "¿le avisamos?".
  bloqueConfigId: string | null,
  fila: {
    canal: 'email' | 'whatsapp';
    estado: 'enviado' | 'disparado' | 'omitido' | 'fallido';
    destino: string | null;
    copia_a: string | null;
    motivo: string | null;
    titulo: string | null;
    proveedor_id: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('avisos_cliente').insert({
    workspace_id: negocio.workspace_id,
    negocio_id: negocio.id,
    etapa_id: etapa?.id ?? null,
    etapa_nombre: etapa?.nombre ?? null,
    bloque_config_id: bloqueConfigId,
    ...fila,
  });
  if (error) console.error('[notificar-etapa] no se pudo dejar traza:', negocio.codigo, fila.canal, error.message);
}


// ── Datos que el copy puede citar ────────────────────────────────────────────
// La fecha de la cita y el enlace al documento no viven en columnas de `negocios`:
// viven en bloques. Se leen aqui porque el copy es lo unico que sabe si los necesita.
//
// Los dos se resuelven por el SLUG del bloque, que es la identidad estable de la
// linea (ver la convencion de referencias por slug en CLAUDE.md). La cita por el
// slug fijo `fecha_cita_dian`; el enlace por el slug que DECLARA la etapa en
// `avisar_al_cliente.link_bloque_slug`.
//
// ⚠️ Antes el enlace se buscaba recorriendo los bloques de la etapa actual y
// quedandose con el ultimo que tuviera `drive_url`. Sin `order by` y sin filtrar por
// slug, con dos documentos en la misma etapa el que ganaba lo decidia el orden en que
// la base devolvia las filas. Medido: 10 etapas de la base tienen mas de un bloque con
// `drive_url` — en Entrega de SOENA son el Certificado UPME y la Factura emitida, y
// 16 de los 58 casos que pasaron por ahi tenian archivo en LOS DOS. El copy promete el
// certificado y el cliente podia recibir la factura. Un enlace equivocado a un tercero
// no se puede deshacer, asi que el bloque se DECLARA y, si no esta declarado, el aviso
// se omite en vez de adivinar.
//
// El slug declarado es el del bloque ORIGEN, no el de la copia heredada de la etapa
// donde sale el aviso: las copias readonly nacen con `slug` NULL (apuntan a su origen)
// y, ademas, `getNegocioDetalle` le hace swap a su `data` por la del origen antes de
// pintarlas. O sea que lo que el operador ve en pantalla es el archivo del origen; leer
// la copia mandaria un archivo que la plataforma no muestra en ninguna parte. Medido en
// SOENA: en 11 de 42 casos la copia de Entrega tiene guardado un `drive_url` distinto
// del origen — data vieja de la ruta que llego a escribir en copias readonly, la misma
// que CLAUDE.md documenta.
//
// El enlace es el `drive_url` que ya quedo publico-por-enlace al subirlo. FunnelChat
// no puede mandar el archivo — su paso de Documento exige subir un PDF fijo, igual
// para todos — asi que el cliente recibe el enlace al suyo.

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * "2026-09-09T08:00" -> "9 de septiembre de 2026 a las 8:00 a. m."
 * "2026-09-26"       -> "26 de septiembre de 2026"
 *
 * Los dos formatos conviven en produccion: el bloque acepta fecha sola y fecha con
 * hora. Un formato que no reconozca devuelve null y el aviso se omite antes que
 * mandarle al cliente una fecha cruda o a medias.
 */
function formatearCita(valor: string): string | null {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, anio, mes, dia, hh, mm] = m;
  const nombreMes = MESES[Number(mes) - 1];
  if (!nombreMes) return null;
  const fecha = `${Number(dia)} de ${nombreMes} de ${anio}`;
  if (!hh) return fecha;
  const h = Number(hh);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${fecha} a las ${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

type DatosCopy = { fecha_cita: string | null; link: string | null };

const SLUG_CITA = 'fecha_cita_dian';

/**
 * @param linkSlug slug del bloque ORIGEN cuyo `drive_url` es el `{link}` del copy, tal
 *   como lo declara la etapa. `null` si no lo declaro: entonces no hay enlace y el aviso
 *   se omite antes que mandar el documento de otro tramite.
 */
async function datosDelCopy(
  supabase: Supabase,
  negocioId: string,
  linkSlug: string | null,
): Promise<DatosCopy> {
  // Se piden los slugs concretos en vez de traer todos los bloques del negocio: Postgres
  // descomprime el jsonb `data` completo en cada fila, y por eso este mismo campo ya
  // costo una consulta de 22 MB en la lista de negocios (CLAUDE.md, PR #124).
  const slugs = [SLUG_CITA, ...(linkSlug ? [linkSlug] : [])];

  const { data: filas } = await supabase
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .in('bloque_configs.slug', slugs);

  const out: DatosCopy = { fecha_cita: null, link: null };
  for (const fila of filas ?? []) {
    const slug = (fila?.bloque_configs as { slug?: string } | null)?.slug;
    const data = (fila?.data ?? {}) as Record<string, unknown>;

    const cita = data.fecha_cita_dian;
    if (slug === SLUG_CITA && typeof cita === 'string') {
      out.fecha_cita = formatearCita(cita);
    }

    const url = data.drive_url;
    if (linkSlug && slug === linkSlug && typeof url === 'string' && url) {
      out.link = url;
    }
  }
  return out;
}

/**
 * Mete `{fecha_cita}` y `{link}` en el copy, y dice cual falto.
 *
 * Si el copy pide un dato que no existe, NO se manda el aviso: un WhatsApp que dice
 * "tu cita es el " o que trae un enlace vacio es peor que no mandar nada, y ademas
 * se ve como exito en el log. El que falta sale como motivo de omision.
 *
 * Los reemplazos viejos ({etapa}, {codigo}, {negocio}) siguen siendo sustitucion
 * simple: llevan meses saliendo con codigo vacio y no es esta la sesion para
 * cambiarles el comportamiento.
 */
function aplicarDatosDelCopy(texto: string, datos: DatosCopy): { texto: string; falta: string | null } {
  let out = texto;
  for (const clave of ['fecha_cita', 'link'] as const) {
    const marca = `{${clave}}`;
    if (!out.includes(marca)) continue;
    const valor = datos[clave];
    if (!valor) return { texto: out, falta: clave };
    out = out.replaceAll(marca, valor);
  }
  return { texto: out, falta: null };
}


// ── Datos OPCIONALES del copy ────────────────────────────────────────────────
// El nombre de quien recibe el aviso y, si la etapa lo declara, el objeto del tramite
// (en SOENA el vehiculo de la factura). Sirven para que el correo hable como una
// persona y no como un sistema.
//
// ⚠️ La diferencia con `datosDelCopy` es TODA la logica de este bloque: lo que falta
// aqui NO omite el aviso. `{fecha_cita}` y `{link}` SON el aviso — sin ellos no hay
// nada que decir y mandarlo a medias es peor que no mandarlo. El nombre y el vehiculo
// solo lo hacen cercano: cancelar el aviso de los 21 negocios abiertos de SOENA cuya
// factura no trae marca cambiaria un correo impersonal por NINGUN correo, que es peor
// para el cliente y ademas se ve como exito en el log.
//
// Por eso el copy los envuelve en corchetes y el segmento entero desaparece cuando el
// dato no esta (ver `aplicarOpcionales`).

/** De que bloque y de que campos sale cada dato opcional, declarado por la etapa. */
type CamposCopy = Record<string, { bloque_slug: string; campos: string[] }>;

type Opcionales = Record<string, string | null>;

const CLAVE_CLIENTE = 'cliente';

/**
 * Marcas de razon social. Un "contacto" que es una empresa no se saluda por su nombre:
 * "Hola Inversiones." es peor que "Hola.". Medido en SOENA: 4 de 382 negocios abiertos
 * tienen una razon social en el contacto (dos SAS, una LTDA, una CIA).
 */
const PARECE_EMPRESA = /(^|[\s.])(s\.?a\.?s?|ltda|cia|e\.?u\.?|leasing|banco|inversiones|sucursal)([\s.]|$)/i;

/**
 * "LINA ROSENDA BONILLA RUEDA" -> "Lina".
 *
 * Solo el primer nombre: es como saluda una persona, y el nombre completo en mayusculas
 * suena a carta de cobro. Devuelve null cuando no hay a quien saludar (vacio, razon
 * social, o una inicial suelta), y entonces el saludo se acomoda en vez de quedar a
 * medias.
 */
function primerNombre(nombre: string | null): string | null {
  const limpio = (nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio || PARECE_EMPRESA.test(limpio)) return null;
  const primero = limpio.split(' ')[0];
  if (primero.length < 2) return null;
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}

/**
 * Resuelve los datos opcionales que el copy realmente usa.
 *
 * Si el copy no nombra ninguno, no consulta nada: un workspace que no declare
 * `campos_copy` ni escriba `{cliente}` no paga una sola consulta de mas.
 *
 * @param texto el copy tal como lo declara la etapa, para saber que hace falta buscar.
 */
async function datosOpcionales(
  supabase: Supabase,
  negocio: Negocio,
  camposCopy: CamposCopy,
  texto: string,
): Promise<Opcionales> {
  const out: Opcionales = {};
  const usadas = [CLAVE_CLIENTE, ...Object.keys(camposCopy)].filter((k) => texto.includes(`{${k}}`));
  if (usadas.length === 0) return out;

  if (usadas.includes(CLAVE_CLIENTE)) {
    // El nombre sale del CONTACTO del negocio, que es tambien la primera fuente del
    // correo en `email_cliente_negocio`: se saluda a quien recibe. Medido en SOENA:
    // los 382 negocios abiertos tienen nombre de contacto.
    const { data } = await supabase
      .from('negocios')
      .select('contactos(nombre)')
      .eq('id', negocio.id)
      .maybeSingle();
    // PostgREST devuelve la relacion a-uno como objeto, pero segun la version del
    // esquema la misma consulta puede volver como arreglo de uno. Sin contemplar las dos
    // formas el saludo se degrada a "Hola." sin que nada falle: el correo sale, se ve
    // bien, y le falta justo lo que este cambio vino a poner.
    const rel = data?.contactos as { nombre?: string } | Array<{ nombre?: string }> | null;
    const nombre = (Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre) ?? null;
    out[CLAVE_CLIENTE] = primerNombre(nombre);
  }

  const declaradas = usadas.filter((k) => k !== CLAVE_CLIENTE);
  if (declaradas.length === 0) return out;

  // Mismo cuidado que en `datosDelCopy`: se piden los slugs concretos y no todos los
  // bloques del negocio, porque Postgres descomprime el jsonb `data` entero por fila.
  const slugs = [...new Set(declaradas.map((k) => camposCopy[k].bloque_slug).filter(Boolean))];
  const { data: filas } = slugs.length > 0
    ? await supabase
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocio.id)
      .in('bloque_configs.slug', slugs)
    : { data: [] };

  const camposPorSlug = new Map<string, Record<string, unknown>>();
  for (const fila of filas ?? []) {
    const slug = (fila?.bloque_configs as { slug?: string } | null)?.slug;
    if (!slug) continue;
    const data = (fila?.data ?? {}) as { campos?: Record<string, unknown> };
    camposPorSlug.set(slug, data.campos ?? {});
  }

  for (const clave of declaradas) {
    const decl = camposCopy[clave];
    const bag = camposPorSlug.get(decl.bloque_slug);
    const valores = (decl.campos ?? []).map((c) => {
      const v = (bag?.[c] as { value?: unknown } | undefined)?.value;
      return typeof v === 'string' ? v.trim() : '';
    });
    // El PRIMER campo declarado es el ancla: sin el no hay nada que nombrar. Los demas
    // se suman si estan. Con ["marca","linea","modelo"] eso da "TOYOTA RAV4" cuando
    // falta el modelo, y nada cuando falta la marca.
    out[clave] = valores[0] ? unir(valores.filter(Boolean)) : null;
  }
  return out;
}

/**
 * Une los campos de un dato opcional sin repetir lo que ya se dijo.
 *
 * Los valores van TAL CUAL vienen del documento, sin arreglarles las mayusculas: media
 * marca del mercado es una sigla (BYD, KIA, MG, BMW, GAC, JAC) y "capitalizar" las
 * convierte en Byd, Bmw, Jac. Un modelo en mayusculas se lee raro; una marca deformada
 * se lee mal.
 *
 * Lo que si hay que resolver es la repeticion, porque quien digita la factura suele
 * escribir la marca otra vez dentro de la linea. Medido en SOENA: pasa en 37 de los 362
 * negocios abiertos con marca — marca "FORESTER" y linea "FORESTER TOURING S-HEV" darian
 * "FORESTER FORESTER TOURING S-HEV" en un correo al cliente. Tres casos:
 *
 *   · el siguiente EMPIEZA con lo que ya se dijo -> lo reemplaza (es la version larga)
 *   · lo que ya se dijo YA CONTIENE al siguiente -> se descarta
 *   · nada en comun -> se agrega
 *
 * La comparacion exige PALABRA COMPLETA, y por eso marca "MG" con linea "MG3 HYBRID"
 * queda como "MG MG3 HYBRID" en vez de "MG3 HYBRID": es redundante, pero un prefijo
 * suelto no distingue esa repeticion de una marca que apenas se parece al inicio de la
 * linea, y ahi se perderia la marca. Redundante se lee mal; incompleto dice otra cosa.
 */
function unir(valores: string[]): string {
  let texto = '';
  for (const bruto of valores) {
    const v = bruto.replace(/\s+/g, ' ').trim();
    if (!v) continue;
    if (!texto) { texto = v; continue; }
    const a = texto.toUpperCase();
    const b = v.toUpperCase();
    if (b === a || b.startsWith(`${a} `)) texto = v;
    else if (!` ${a} `.includes(` ${b} `)) texto = `${texto} ${v}`;
  }
  return texto;
}

/**
 * Mete los datos opcionales en el copy y resuelve los segmentos entre corchetes.
 *
 * Un segmento `[...]` se conserva solo si TODOS los datos opcionales que nombra tienen
 * valor; si falta alguno desaparece el segmento completo, con su texto fijo y sus
 * espacios. Asi el copy se escribe UNA vez y se lee bien en los dos casos:
 *
 *   "Hola[ {cliente}]. Tu certificado[ de tu {vehiculo}] esta listo."
 *     con los dos datos -> "Hola Lina. Tu certificado de tu TOYOTA RAV4 2026 esta listo."
 *     sin ninguno       -> "Hola. Tu certificado esta listo."
 *
 * Un dato opcional FUERA de corchetes se reemplaza por vacio y el espacio sobrante se
 * colapsa: es la red para un copy mal escrito, deja una frase pobre y nunca una rota.
 *
 * ⚠️ `{fecha_cita}` y `{link}` NO van dentro de corchetes: los resuelve
 * `aplicarDatosDelCopy`, que corre antes y omite el aviso si faltan. Meterlos aqui
 * convertiria una omision deliberada en una frase incompleta.
 */
function aplicarOpcionales(texto: string, datos: Opcionales): string {
  const claves = Object.keys(datos);
  if (claves.length === 0) return texto;

  const sinSegmentosMuertos = texto.replace(/\[([^\][]*)\]/g, (_todo, dentro: string) =>
    claves.some((k) => !datos[k] && dentro.includes(`{${k}}`)) ? '' : dentro
  );

  let out = sinSegmentosMuertos;
  for (const clave of claves) out = out.replaceAll(`{${clave}}`, datos[clave] ?? '');

  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Aviso de avance al CLIENTE.
 *
 * Sale desde el correo de MeTRIK (somos el operador de la plataforma) pero el mensaje
 * habla de parte del workspace: quien contrató el trámite es cliente de SOENA y no
 * conoce a MeTRIK. Por eso el nombre del workspace encabeza el correo y el `reply_to`
 * apunta a su gente: si el cliente responde —y va a responder— tiene que caer donde
 * alguien lo lee, no en un buzón nuestro.
 *
 * Nunca lleva enlace a la plataforma: el cliente no tiene cuenta.
 *
 * El destinatario lo resuelve `email_cliente_negocio` en la base, que es la unica
 * definicion de "cual es el correo de este cliente" (contacto -> RUT).
 *
 * @param pruebaTo si viene, el correo se manda a estas direcciones EN VEZ del cliente,
 *   con `[PRUEBA]` en el asunto y un aviso arriba diciendo a quien habria ido. No copia
 *   al comercial: una prueba no puede aparecerle como un caso avisado.
 */
async function enviarAlCliente(
  supabase: Supabase,
  resendKey: string,
  negocio: Negocio,
  etapaNombre: string,
  cfg: AvisoCliente,
  pruebaTo?: string[],
): Promise<ResultadoCorreo> {
  const esPrueba = Array.isArray(pruebaTo) && pruebaTo.length > 0;
  const { data: email } = await supabase.rpc('email_cliente_negocio', { p_negocio_id: negocio.id });
  const destinatarioReal = typeof email === 'string' && email ? email : null;
  // En una prueba la falta de correo del cliente NO corta el envio: justamente sirve
  // para ver como sale el correo, y el aviso de arriba lo dice.
  if (!destinatarioReal && !esPrueba) {
    // Sin correo no se inventa un destinatario. Queda en el log para que el equipo
    // pueda pedirle el dato al cliente.
    console.warn('[notificar-etapa] sin correo de cliente:', negocio.codigo);
    return { ...CORREO_VACIO, estado: 'omitido', omitidoPor: 'sin_correo' };
  }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('nombre, config_extra')
    .eq('id', negocio.workspace_id)
    .maybeSingle();

  const marca = (ws?.nombre as string | undefined)?.trim() || 'tu proveedor';

  // ── A dónde contesta el cliente ────────────────────────────────────────────
  // Primero el COMERCIAL del negocio: es quien lo conoce y quien va a responderle.
  // Si no hay, el correo de respuesta que declare el workspace. Y si tampoco hay,
  // el correo NO invita a responder: prometer una respuesta que cae en un buzón sin
  // dueño es peor que no ofrecerla. (Medido en SOENA: 244 de 254 negocios abiertos
  // tienen comercial con cuenta.)
  const comercial = await comercialDelNegocio(supabase, negocio.id);
  const replyTo = comercial?.email
    ?? (ws?.config_extra as { email_respuesta?: string } | null)?.email_respuesta
    ?? null;

  // ── La copia al comercial ──────────────────────────────────────────────────
  // El comercial recibe el MISMO correo que el cliente, para tener la trazabilidad de
  // lo que se le dijo y cuando, sin depender de que el cliente le reenvie nada.
  //
  // Va en **bcc** y no en cc: el cliente ya ve esa direccion en el `reply_to`, asi que
  // repetirla como destinatario no le agrega nada y hace ver el correo como una cadena
  // interna. En una prueba no se copia a nadie — quien la pidio es el unico que la
  // tiene que ver.
  const copiaA = esPrueba ? null : (comercial?.email ?? null);

  const titulo = (cfg.titulo ?? 'Tu tramite avanzo')
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '');
  const cuerpoDefault = replyTo
    ? 'Te contamos que tu tramite paso a la etapa "{etapa}". Cualquier duda, responde a este correo.'
    : 'Te contamos que tu tramite paso a la etapa "{etapa}".';
  // El correo prefiere su PROPIO copy. Es el canal sin restriccion de plantilla, asi que
  // es donde tiene sentido escribir mas de una linea y saludar por el nombre. Sin
  // `mensaje_email` declarado cae a `mensaje` y nada cambia para los demas workspaces.
  const base = (cfg.mensaje_email ?? cfg.mensaje ?? cuerpoDefault)
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{negocio}', negocio.nombre ?? '');
  const resuelto = aplicarDatosDelCopy(base, await datosDelCopy(supabase, negocio.id, cfg.link_bloque_slug ?? null));
  if (resuelto.falta) {
    console.warn('[notificar-etapa] copy sin dato:', resuelto.falta, negocio.codigo);
    return { ...CORREO_VACIO, estado: 'omitido', omitidoPor: `sin_${resuelto.falta}`, destinatarioReal, respondeA: replyTo };
  }
  // Los opcionales se resuelven DESPUES de los obligatorios, a proposito: asi la
  // decision de omitir el aviso se toma sobre el copy tal como lo escribio la etapa, sin
  // que un segmento retirado pueda cambiarla.
  const cuerpo = aplicarOpcionales(
    resuelto.texto,
    await datosOpcionales(supabase, negocio, cfg.campos_copy ?? {}, base),
  );


  // El copy del correo puede traer varios parrafos, separados por una linea en blanco.
  // Sin esto se pegarian todos en un bloque: el HTML ignora los saltos de linea del
  // texto, y un correo de cuatro frases seguidas es justo lo que este cambio evita.
  const parrafos: string[] = cuerpo.split(/\n{2,}/).map((t: string) => t.trim()).filter(Boolean);
  const cuerpoHtml = parrafos
    .map((t: string, i: number) => {
      const abajo = i === parrafos.length - 1 ? 20 : 14;
      return `<p style="margin:0 0 ${abajo}px;font-size:14px;line-height:1.6;color:#374151">${
        escapar(t).replaceAll('\n', '<br>')
      }</p>`;
    })
    .join('\n    ');

  // El aviso de prueba va DENTRO de la tarjeta y arriba de todo: si fuera al pie, en un
  // correo largo se leeria despues del mensaje que se esta revisando.
  const avisoPrueba = esPrueba
    ? `<p style="margin:0 0 18px;padding:10px 12px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;font-size:12px;line-height:1.5;color:#92400E">
      <strong>Correo de prueba.</strong> Asi lo recibe el cliente del caso ${escapar(negocio.codigo ?? negocio.nombre ?? '')}.
      En un envio real habria llegado a ${escapar(destinatarioReal ?? 'nadie: ese negocio no tiene correo registrado')}.
    </p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    ${avisoPrueba}
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escapar(marca)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(titulo)}</h1>
    ${cuerpoHtml}
    ${negocio.codigo ? `<p style="margin:0 0 22px;font-size:13px;color:#6B7280">Radicado: <strong style="color:#1A1A1A">${escapar(negocio.codigo)}</strong></p>` : ''}
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">
      Recibes este aviso porque ${escapar(marca)} gestiona un tramite a tu nombre.${
        replyTo ? ' Si tienes dudas o no quieres recibir mas avisos, responde a este correo.' : ''
      }
    </p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${marca} (via MeTRIK) <noreply@metrikone.co>`,
      to: esPrueba ? pruebaTo : [destinatarioReal],
      ...(copiaA ? { bcc: [copiaA] } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: esPrueba ? `[PRUEBA] ${titulo}` : titulo,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[notificar-etapa] Resend fallo con el cliente:', res.status, await res.text());
    return { ...CORREO_VACIO, estado: 'fallido', omitidoPor: `resend_${res.status}`, destinatarioReal, respondeA: replyTo, titulo, copiaA };
  }
  // El id de Resend es la llave para ir a buscar despues un rebote o una queja.
  const enviado = await res.json().catch(() => null) as { id?: string } | null;
  return {
    estado: 'enviado',
    enviadoA: esPrueba ? null : destinatarioReal,
    destinatarioReal,
    omitidoPor: null,
    respondeA: replyTo,
    copiaA,
    titulo,
    proveedorId: enviado?.id ?? null,
  };
}

/**
 * Aviso de avance al cliente por WHATSAPP, vía FunnelChat.
 *
 * FunnelChat no expone una API para enviar: expone un DISPARADOR. Se le hace POST a la
 * URL de un flujo suyo y ese flujo es el que le escribe al cliente. Por eso aquí no se
 * arma un mensaje de WhatsApp sino el juego de datos que el flujo mapea a campos del
 * contacto (documentado en `proyectos/soena/ve/2026-08-14_mensaje-daniela-funnelchat.md`,
 * que es el mismo contrato que se le pidió configurar a SOENA).
 *
 * ⚠️ La URL del disparador ES la credencial: no lleva token, no lleva firma, y quien la
 * tenga puede mandarle WhatsApps a los clientes. Por eso vive en `config_extra` del
 * workspace (server-only, mismo trato que las credenciales de Siigo) y nunca en una
 * tabla que el cliente autenticado pueda leer.
 *
 * ⚠️ Lo que devuelve NO es una confirmación de entrega, y por eso se reporta como
 * `whatsapp_disparado` y no como "enviado": un 200 de FunnelChat dice que el disparo se
 * recibió, no que el mensaje le llegó a nadie. Está preguntado (pregunta 3 del mensaje a
 * Daniela) y hasta que se responda, afirmar "avisado" sería exactamente la pantalla que
 * miente.
 *
 * ⚠️ Fuera de la ventana de 24 horas WhatsApp solo entrega PLANTILLAS aprobadas, y un
 * aviso de avance de trámite casi siempre cae fuera de esa ventana: medido en SOENA, el
 * texto libre volvía con el error 131047 de Meta. Por eso la etapa declara `plantilla` y
 * viaja en el disparo. Una etapa con `whatsapp: true` y sin `plantilla` deja el envío en
 * manos del texto libre, o sea: le llega solo al cliente que escribió hace poco. Lo mismo
 * pasa cuando la etapa SI la declara pero el correo no salió, y ahí es a propósito: ver
 * la nota de `plantilla` en el cuerpo del POST.
 */
async function enviarWhatsAppAlCliente(
  supabase: Supabase,
  negocio: Negocio,
  etapaNombre: string,
  cfg: AvisoCliente,
  correoEnviado: boolean,
): Promise<ResultadoWhatsApp> {
  const { data: ws } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', negocio.workspace_id)
    .maybeSingle();

  const url = (ws?.config_extra as { funnelchat?: { trigger_url?: string } } | null)
    ?.funnelchat?.trigger_url;
  if (!url) {
    // El workspace no declaró disparador. No es un error: es un workspace que no usa
    // WhatsApp, y en ese caso la etapa no debería tener el interruptor encendido.
    return { estado: 'omitido', disparadoA: null, omitidoPor: 'sin_trigger_url' };
  }

  // La URL viene de la base, así que un admin podría escribir cualquier cosa ahí y esta
  // función haría de puente hacia donde diga. Se acota al proveedor.
  let host: string;
  try {
    const u = new URL(url);
    host = u.hostname;
    if (u.protocol !== 'https:' || !host.endsWith('.funnelchat.app')) {
      return { estado: 'omitido', disparadoA: null, omitidoPor: 'trigger_url_no_permitida' };
    }
  } catch {
    return { estado: 'omitido', disparadoA: null, omitidoPor: 'trigger_url_invalida' };
  }

  const { data: telefono } = await supabase.rpc('telefono_cliente_negocio', {
    p_negocio_id: negocio.id,
  });
  if (!telefono || typeof telefono !== 'string') {
    // Sin número no se inventa un destinatario. Queda en el log para que el equipo
    // pueda pedirle el dato al cliente. Medido en SOENA: pasa en 12 de 254 abiertos.
    console.warn('[notificar-etapa] sin telefono de cliente:', negocio.codigo);
    return { estado: 'omitido', disparadoA: null, omitidoPor: 'sin_telefono' };
  }

  const comercial = await comercialDelNegocio(supabase, negocio.id);

  // ── Que copy manda ────────────────────────────────────────────────────────
  // Cuando la etapa declara `mensaje_whatsapp`, el correo es la fuente de verdad y el
  // WhatsApp solo avisa que llego. Eso evita mantener el mismo detalle en dos textos
  // que se desincronizarian, y deja el detalle donde cabe: el correo no tiene la
  // restriccion de plantilla que Meta le impone al WhatsApp.
  //
  // ⚠️ Pero ese aviso solo es CIERTO si el correo salio. Si no salio —el cliente no
  // tiene correo registrado (27 de 382 abiertos en SOENA tienen celular y no correo), o
  // el copy del correo se omitio por falta de dato, o la etapa no manda correo— se usa
  // `mensaje`, que se basta solo. Decirle "te escribimos al correo" a quien no va a
  // recibir ningun correo lo deja esperando algo que no existe, y en el log se ve como
  // un cliente avisado.
  //
  // `correoEnviado` decide DOS cosas, no una: este copy y la `plantilla` que viaja mas
  // abajo en el cuerpo del POST. Son las dos mitades del mismo aviso, dicen lo mismo por
  // canales distintos, y por eso se deciden con el mismo dato. Separarlas deja pasar la
  // promesa por el lado que quedo sin guardia.
  const copy = (correoEnviado && cfg.mensaje_whatsapp)
    ? cfg.mensaje_whatsapp
    : (cfg.mensaje ?? 'Te contamos que tu tramite paso a la etapa "{etapa}".');
  const base = copy
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{negocio}', negocio.nombre ?? '');
  const datos = await datosDelCopy(supabase, negocio.id, cfg.link_bloque_slug ?? null);
  const resuelto = aplicarDatosDelCopy(base, datos);
  if (resuelto.falta) {
    // El dato que el copy prometia no existe. Se omite y se dice cual: mandarlo a
    // medias deja al cliente peor que no mandarlo, y en el log parece un exito.
    console.warn('[notificar-etapa] copy sin dato:', resuelto.falta, negocio.codigo);
    return { estado: 'omitido', disparadoA: null, omitidoPor: `sin_${resuelto.falta}` };
  }
  const cuerpo = aplicarOpcionales(
    resuelto.texto,
    await datosOpcionales(supabase, negocio, cfg.campos_copy ?? {}, base),
  );

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefono,
        nombre_cliente: negocio.nombre ?? '',
        codigo_caso: negocio.codigo ?? '',
        etapa: etapaNombre,
        mensaje: cuerpo,
        // Qué plantilla mandar, y con qué llenar sus variables.
        //
        // Las variables de una plantilla de FunnelChat NO son argumentos del disparo:
        // cada una queda amarrada a un CAMPO del contacto, y el disparador las llena
        // antes de mandar. Por eso `link` y `fecha_cita` viajan sueltos aunque el texto
        // libre ya los traiga (o ya no los nombre, cuando el copy remite al correo):
        // dentro del texto FunnelChat no los puede sacar, y la plantilla saldría con las
        // casillas vacías.
        //
        // Van en blanco cuando la etapa no los usa. Un campo vacío en el contacto es
        // correcto para una plantilla que no lo referencia; lo que nunca puede pasar es
        // que la plantilla lo referencie y el dato no exista, y de eso ya se encarga
        // arriba `aplicarDatosDelCopy`: si el copy promete un dato que no está, se
        // omite el aviso completo en vez de mandarlo a medias.
        //
        // ⚠️ Y va en blanco cuando el correo NO salio, aunque la etapa la declare. El
        // texto que Meta aprobo dice "te enviamos un correo con...", asi que la plantilla
        // solo es cierta si hubo correo. A diferencia del copy de arriba, aca FunnelChat
        // no vuelve a preguntar: recibe el nombre y manda. Dejarla viajar sin correo le
        // promete al cliente algo que nunca le va a llegar, que es exactamente el fallo
        // que `copy` ya cierra para el texto libre.
        //
        // Sin plantilla el disparo cae al texto libre de `mensaje`, que se basta solo:
        // dentro de las 24 h llega, y fuera de ellas Meta lo bota con el 131047. Que no
        // llegue nada es el resultado correcto; el par de filas de `avisos_cliente`
        // (`email/omitido/sin_correo` + `whatsapp/disparado`) deja ver por que.
        plantilla: correoEnviado ? (cfg.plantilla ?? '') : '',
        link: datos.link ?? '',
        fecha_cita: datos.fecha_cita ?? '',
        // Viaja el comercial para que FunnelChat pueda asignarle la conversación. El
        // cruce entre plataformas es por CORREO: es la única llave estable entre una
        // persona de ONE y un agente de FunnelChat.
        comercial_nombre: comercial?.nombre ?? '',
        comercial_email: comercial?.email ?? '',
      }),
      // Sin tope, un FunnelChat lento dejaría colgada la función que también manda el
      // correo interno.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error('[notificar-etapa] FunnelChat fallo:', res.status, await res.text());
      return { estado: 'fallido', disparadoA: null, omitidoPor: `funnelchat_${res.status}` };
    }
    return { estado: 'disparado', disparadoA: telefono, omitidoPor: null };
  } catch (e) {
    console.error('[notificar-etapa] FunnelChat inalcanzable:', e);
    return { estado: 'fallido', disparadoA: null, omitidoPor: 'funnelchat_sin_respuesta' };
  }
}

/**
 * Comercial responsable del negocio: su nombre y su correo.
 *
 * El correo sirve para dos cosas distintas y por eso se resuelve una sola vez: es el
 * `reply_to` del aviso por correo, y es la llave con la que FunnelChat puede identificar
 * al agente que atiende la conversación.
 *
 * `negocio_responsables` guarda `staff_id`; el correo vive en `auth.users`, alcanzable
 * por `staff.profile_id`. Un negocio admite UN comercial (indice unico por rol), asi
 * que no hay que elegir entre varios.
 */
async function comercialDelNegocio(
  supabase: Supabase,
  negocioId: string,
): Promise<{ nombre: string | null; email: string | null } | null> {
  const { data: resp } = await supabase
    .from('negocio_responsables')
    .select('staff_id')
    .eq('negocio_id', negocioId)
    .eq('rol', 'comercial')
    .maybeSingle();
  if (!resp?.staff_id) return null;

  const { data: st } = await supabase
    .from('staff')
    .select('profile_id, full_name')
    .eq('id', resp.staff_id)
    .maybeSingle();
  if (!st) return null;

  // Un comercial sin cuenta de plataforma igual tiene nombre: sirve para que FunnelChat
  // sepa de quién es el caso aunque no se le pueda atar el agente por correo.
  if (!st.profile_id) return { nombre: st.full_name ?? null, email: null };

  const { data: user } = await supabase.auth.admin.getUserById(st.profile_id);
  return { nombre: st.full_name ?? null, email: user?.user?.email ?? null };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** El copy es configurable por workspace: se escapa antes de entrar al HTML. */
function escapar(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
