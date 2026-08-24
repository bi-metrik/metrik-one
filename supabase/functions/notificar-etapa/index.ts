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
// Quién dispara esto: el trigger `trg_avisar_entrada_etapa` sobre `negocios`,
// vía pg_net (mismo patrón que los crons de wa-alerts).
//
// La notificación IN-APP ya la creó el trigger. Esto es el refuerzo por correo:
// el comercial puede estar sin la plataforma abierta.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FROM = 'MéTRIK ONE <noreply@metrikone.co>';

type Payload = { negocio_id: string };

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

  const { data: etapa } = await supabase
    .from('etapas_negocio')
    .select('nombre, config_extra')
    .eq('id', negocio.etapa_actual_id)
    .maybeSingle();

  const cfgEtapa = etapa?.config_extra as Record<string, unknown> | null;

  const avisoRaw = cfgEtapa?.avisar_al_entrar as
    | { email?: boolean; activo?: boolean; titulo?: string; mensaje?: string; areas?: string[] }
    | undefined;
  // `activo: false` apaga el aviso interno conservando su texto (ver la migración
  // 20260813000001). Ausente = encendido, que es como se comportó siempre.
  const aviso = avisoRaw?.activo === false ? undefined : avisoRaw;

  const avisoCliente = cfgEtapa?.avisar_al_cliente as
    | { email?: boolean; whatsapp?: boolean; titulo?: string; mensaje?: string }
    | undefined;

  // Dos destinos independientes, y el del cliente tiene dos canales que también son
  // independientes: se puede querer WhatsApp sin correo. Si nadie pide nada no hay
  // trabajo (la notificación in-app del equipo ya la creó el trigger).
  const quiereInterno = aviso?.email === true;
  const quiereCliente = avisoCliente?.email === true;
  const quiereClienteWa = avisoCliente?.whatsapp === true;
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
  if (quiereCliente) {
    const r = await enviarAlCliente(supabase, resendKey, negocio, etapa?.nombre ?? '', avisoCliente!);
    clienteEnviado = r.enviadoA;
    clienteOmitido = r.omitidoPor;
    clienteRespondeA = r.respondeA ?? null;
  }

  // ── El aviso al cliente por WHATSAPP ───────────────────────────────────────
  // Canal aparte y con su propio try: los dos van al mismo cliente, así que un fallo
  // de FunnelChat no puede dejarlo sin el correo que sí salió, ni al revés.
  let waDisparado: string | null = null;
  let waOmitido: string | null = null;
  if (quiereClienteWa) {
    const r = await enviarWhatsAppAlCliente(supabase, negocio, etapa?.nombre ?? '', avisoCliente!);
    waDisparado = r.disparadoA;
    waOmitido = r.omitidoPor;
  }

  if (!quiereInterno) {
    return json({
      ok: true,
      cliente: clienteEnviado,
      cliente_omitido: clienteOmitido,
      responde_a: clienteRespondeA,
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
    whatsapp_disparado: waDisparado,
    whatsapp_omitido: waOmitido,
  });
});


// ── Datos que el copy puede citar ────────────────────────────────────────────
// La fecha de la cita y el enlace al documento no viven en columnas de `negocios`:
// viven en bloques. La cita en `fecha_cita_dian` (etapa Cita, pero el aviso sale
// dos etapas despues) y el documento en el bloque de la etapa que lo pide, que en
// SOENA es el Certificado UPME en Entrega. Se leen aqui porque el copy es lo unico
// que sabe si los necesita.
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

async function datosDelCopy(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  negocioId: string,
  etapaId: string | null,
): Promise<DatosCopy> {
  const { data: filas } = await supabase
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug, etapa_id)')
    .eq('negocio_id', negocioId);

  const out: DatosCopy = { fecha_cita: null, link: null };
  for (const fila of filas ?? []) {
    const cfg = fila?.bloque_configs as { slug?: string; etapa_id?: string } | null;
    const data = (fila?.data ?? {}) as Record<string, unknown>;
    const cita = data.fecha_cita_dian;
    if (cfg?.slug === 'fecha_cita_dian' && typeof cita === 'string') {
      out.fecha_cita = formatearCita(cita);
    }
    const url = data.drive_url;
    if (etapaId && cfg?.etapa_id === etapaId && typeof url === 'string' && url) {
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
 */
async function enviarAlCliente(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  resendKey: string,
  // deno-lint-ignore no-explicit-any
  negocio: any,
  etapaNombre: string,
  cfg: { titulo?: string; mensaje?: string },
): Promise<{ enviadoA: string | null; omitidoPor: string | null; respondeA?: string | null }> {
  const { data: email } = await supabase.rpc('email_cliente_negocio', { p_negocio_id: negocio.id });
  if (!email || typeof email !== 'string') {
    // Sin correo no se inventa un destinatario. Queda en el log para que el equipo
    // pueda pedirle el dato al cliente.
    console.warn('[notificar-etapa] sin correo de cliente:', negocio.codigo);
    return { enviadoA: null, omitidoPor: 'sin_correo' };
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
  const replyTo = (await comercialDelNegocio(supabase, negocio.id))?.email
    ?? (ws?.config_extra as { email_respuesta?: string } | null)?.email_respuesta
    ?? null;

  const titulo = (cfg.titulo ?? 'Tu tramite avanzo')
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '');
  const cuerpoDefault = replyTo
    ? 'Te contamos que tu tramite paso a la etapa "{etapa}". Cualquier duda, responde a este correo.'
    : 'Te contamos que tu tramite paso a la etapa "{etapa}".';
  const base = (cfg.mensaje ?? cuerpoDefault)
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{negocio}', negocio.nombre ?? '');
  const resuelto = aplicarDatosDelCopy(base, await datosDelCopy(supabase, negocio.id, negocio.etapa_actual_id ?? null));
  if (resuelto.falta) {
    console.warn('[notificar-etapa] copy sin dato:', resuelto.falta, negocio.codigo);
    return { enviadoA: null, omitidoPor: `sin_${resuelto.falta}` };
  }
  const cuerpo = resuelto.texto;

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escapar(marca)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${escapar(cuerpo)}</p>
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
      to: [email],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: titulo,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[notificar-etapa] Resend fallo con el cliente:', res.status, await res.text());
    return { enviadoA: null, omitidoPor: `resend_${res.status}` };
  }
  return { enviadoA: email, omitidoPor: null, respondeA: replyTo };
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
 * miente. Del mismo tamaño es la pregunta de las plantillas de Meta: fuera de la ventana
 * de 24 horas, WhatsApp solo entrega plantillas aprobadas, y un aviso de avance de
 * trámite casi siempre cae fuera de esa ventana.
 */
async function enviarWhatsAppAlCliente(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  negocio: any,
  etapaNombre: string,
  cfg: { titulo?: string; mensaje?: string },
): Promise<{ disparadoA: string | null; omitidoPor: string | null }> {
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
    return { disparadoA: null, omitidoPor: 'sin_trigger_url' };
  }

  // La URL viene de la base, así que un admin podría escribir cualquier cosa ahí y esta
  // función haría de puente hacia donde diga. Se acota al proveedor.
  let host: string;
  try {
    const u = new URL(url);
    host = u.hostname;
    if (u.protocol !== 'https:' || !host.endsWith('.funnelchat.app')) {
      return { disparadoA: null, omitidoPor: 'trigger_url_no_permitida' };
    }
  } catch {
    return { disparadoA: null, omitidoPor: 'trigger_url_invalida' };
  }

  const { data: telefono } = await supabase.rpc('telefono_cliente_negocio', {
    p_negocio_id: negocio.id,
  });
  if (!telefono || typeof telefono !== 'string') {
    // Sin número no se inventa un destinatario. Queda en el log para que el equipo
    // pueda pedirle el dato al cliente. Medido en SOENA: pasa en 12 de 254 abiertos.
    console.warn('[notificar-etapa] sin telefono de cliente:', negocio.codigo);
    return { disparadoA: null, omitidoPor: 'sin_telefono' };
  }

  const comercial = await comercialDelNegocio(supabase, negocio.id);

  // El mismo copy del correo, con los mismos reemplazos: si los dos canales dijeran
  // cosas distintas sobre el mismo hecho, el cliente creería la peor de las dos.
  const base = (cfg.mensaje ?? 'Te contamos que tu tramite paso a la etapa "{etapa}".')
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{negocio}', negocio.nombre ?? '');
  const resuelto = aplicarDatosDelCopy(base, await datosDelCopy(supabase, negocio.id, negocio.etapa_actual_id ?? null));
  if (resuelto.falta) {
    // El dato que el copy prometia no existe. Se omite y se dice cual: mandarlo a
    // medias deja al cliente peor que no mandarlo, y en el log parece un exito.
    console.warn('[notificar-etapa] copy sin dato:', resuelto.falta, negocio.codigo);
    return { disparadoA: null, omitidoPor: `sin_${resuelto.falta}` };
  }
  const cuerpo = resuelto.texto;

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
      return { disparadoA: null, omitidoPor: `funnelchat_${res.status}` };
    }
    return { disparadoA: telefono, omitidoPor: null };
  } catch (e) {
    console.error('[notificar-etapa] FunnelChat inalcanzable:', e);
    return { disparadoA: null, omitidoPor: 'funnelchat_sin_respuesta' };
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
// deno-lint-ignore no-explicit-any
async function comercialDelNegocio(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
