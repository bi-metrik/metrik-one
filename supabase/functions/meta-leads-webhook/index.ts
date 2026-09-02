// ============================================================
// meta-leads-webhook — Captura de leads de Meta (Lead Ads) → ONE
// ------------------------------------------------------------
// El webhook de Meta NO trae los datos del lead, solo un leadgen_id.
// Flujo: verificar firma → traer field_data via Graph API con el
// System User token → mapear page_id → workspace → crear/dedup el
// CONTACTO y registrar una INTERACCIÓN (contacto_interacciones).
//
// CAMBIO DE PARADIGMA (2026-07-21): un lead de Meta ya NO crea un negocio.
// Crea (o reusa) un contacto y deja una interacción en estado 'nueva'. El
// humano decide luego cuáles convierten a negocio (crearNegocioDesdeInteraccion),
// y solo ahí se resuelve la etapa de entrada y se dispara la carpeta de Drive.
//
// Config por workspace en workspaces.config_extra.meta_leads:
//   {
//     "page_id": "1234567890",          // Página de FB que dispara el webhook
//     "field_map": {                    // opcional, override del mapeo por defecto
//       "nombre":  ["full_name"],
//       "email":   ["email"],
//       "telefono":["phone_number"]
//     }
//   }
// (linea_id / etapa_entrada_orden ya no se usan aquí: el negocio nace en la
//  conversión, no en el webhook. Quedan inertes si están configurados.)
//
// Idempotencia: contacto_interacciones (workspace_id, 'meta', leadgen_id).
// verify_jwt=false en config.toml (Meta no manda el JWT de Supabase).
//
// ⚠️ TODO EVENTO DEJA RASTRO ANTES DE PROCESARSE (meta_leads_eventos), y el
// trabajo diferido va SIEMPRE dentro de EdgeRuntime.waitUntil. Las dos cosas
// son la misma leccion: una vez respondimos 200, Meta no reintenta NUNCA, asi
// que cualquier cosa que se pierda despues de ese 200 se pierde para siempre y
// sin sintoma (el registro HTTP queda en 200). Ver el detalle en cada sitio.
// ============================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRAPH_VERSION = 'v21.0';

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

Deno.serve(async (req) => {
  // --- GET: verificación del webhook (handshake de Meta) ---
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === Deno.env.get('META_LEADS_VERIFY_TOKEN')) {
      console.log('[meta-leads] verification OK');
      return new Response(challenge ?? '', { status: 200 });
    }
    console.warn('[meta-leads] verification FAILED (bad mode/token)');
    return new Response('Forbidden', { status: 403 });
  }

  // --- POST: notificación leadgen ---
  if (req.method === 'POST') {
    let body = '';
    try {
      body = await req.text();
      const signature = req.headers.get('x-hub-signature-256');
      if (!(await verifySignature(body, signature))) {
        console.error('[meta-leads] invalid signature');
        return new Response('Invalid signature', { status: 403 });
      }
      const payload = JSON.parse(body);
      const supabase = getServiceClient();

      // 1. Rastro ANTES de procesar. Este await es corto (un insert) y es el que
      //    garantiza que, pase lo que pase despues, quede una fila que diga que
      //    este lead llego. Registrar el evento DENTRO del trabajo diferido seria
      //    inutil: si el worker muere, muere tambien el rastro de que murio.
      const eventos = await registrarEventos(supabase, payload);

      // 2. Meta espera 200 en < 20s. El trabajo pesado (Graph API + inserts) va
      //    en segundo plano, pero sostenido por waitUntil para que sobreviva a
      //    la respuesta.
      await enSegundoPlano(
        procesarEventos(supabase, eventos)
          .catch((e) => console.error('[meta-leads] process error:', e)),
      );
      return new Response('OK', { status: 200 });
    } catch (e) {
      // Nunca devolver 5xx por un bug de parseo: Meta entraría en retry-storm.
      console.error('[meta-leads] handler error:', e instanceof Error ? e.message : e);
      return new Response('OK', { status: 200 });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

// ── Trabajo que debe sobrevivir a la respuesta ────────────────────────────
// `EdgeRuntime.waitUntil` le dice al runtime de Deno que no recicle el worker
// hasta que la promesa termine. SIN ESTO, el patrón "responder 200 y seguir
// trabajando" es una fuga: el fetch a la Graph API y los inserts quedan
// huérfanos y el worker puede desaparecer a mitad de camino. Y como ya
// respondimos 200, Meta NO reintenta — el lead se pierde en silencio, con el
// registro HTTP marcando éxito. Es intermitente y empeora en ráfagas, que es
// exactamente el patrón de la pérdida medida en SOENA (18 de 153 leads, 16 de
// ellos concentrados entre el 15 y el 18 de julio).
//
// Fuera del runtime de Supabase (local, tests) `EdgeRuntime` no existe: ahí se
// espera el trabajo en línea. Es más lento pero correcto, y es el único modo en
// que un test puede observar el resultado.
function enSegundoPlano(trabajo: Promise<unknown>): Promise<void> {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') {
    rt.waitUntil(trabajo);
    return Promise.resolve();
  }
  return trabajo.then(() => undefined);
}

// ── Bitácora cruda (meta_leads_eventos) ───────────────────────────────────
// Una fila por lead recibido, escrita apenas se valida la firma. Responde "¿llegó
// este leadgen_id?" y "¿por qué no se convirtió en interacción?", que antes no
// tenían respuesta: un page_id sin workspace se descartaba con un console.warn y
// no dejaba ninguna fila.

type EventoRegistrado = { eventoId: string | null; change: LeadgenChange | null };

type ResultadoLead =
  | { estado: 'procesado'; workspaceId: string; interaccionId: string; contactoId: string }
  | { estado: 'descartado'; motivo: string; workspaceId?: string }
  | { estado: 'error'; motivo: string; workspaceId?: string };

async function registrarEventos(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<EventoRegistrado[]> {
  const changes = extractChanges(payload);

  // Un POST del que no se puede extraer ningún leadgen igual deja fila: una
  // entrega malformada (o de otro tipo de suscripción) tampoco debe ser invisible.
  const filas: Array<{
    page_id: string | null;
    leadgen_id: string | null;
    form_id: string | null;
    created_time: string | null;
    estado: string;
    motivo?: string;
    payload: Record<string, unknown>;
  }> = changes.length
    ? changes.map((c) => ({
      page_id: c.page_id || null,
      leadgen_id: c.leadgen_id,
      form_id: c.form_id ?? null,
      created_time: c.created_time != null ? new Date(Number(c.created_time) * 1000).toISOString() : null,
      estado: 'recibido',
      payload,
    }))
    : [{
      page_id: null,
      leadgen_id: null,
      form_id: null,
      created_time: null,
      estado: 'descartado',
      motivo: 'sin_cambios_leadgen',
      payload,
    }];

  const { data, error } = await supabase
    .from('meta_leads_eventos').insert(filas).select('id');
  if (error) {
    // Que la bitácora falle NO puede tumbar la ingesta: el lead sigue valiendo
    // más que su rastro. Se procesa igual, sin eventoId (y el error queda en log).
    console.error('[meta-leads] error registrando evento crudo:', error.message);
    return changes.map((c) => ({ eventoId: null, change: c }));
  }

  const ids = (data ?? []) as Array<{ id: string }>;
  return changes.map((c, i) => ({ eventoId: ids[i]?.id ?? null, change: c }));
}

async function marcarEvento(
  supabase: SupabaseClient,
  eventoId: string | null,
  r: ResultadoLead,
): Promise<void> {
  if (!eventoId) return;
  const { error } = await supabase
    .from('meta_leads_eventos')
    .update({
      estado: r.estado,
      motivo: r.estado === 'procesado' ? null : r.motivo,
      workspace_id: r.workspaceId ?? null,
      interaccion_id: r.estado === 'procesado' ? r.interaccionId : null,
      contacto_id: r.estado === 'procesado' ? r.contactoId : null,
      procesado_en: new Date().toISOString(),
    })
    .eq('id', eventoId);
  if (error) console.error('[meta-leads] error marcando evento %s: %s', eventoId, error.message);
}

// ── Firma HMAC-SHA256 (x-hub-signature-256), mismo patrón que wa-webhook ──
async function verifySignature(body: string, signature: string | null): Promise<boolean> {
  const appSecret = Deno.env.get('META_LEADS_APP_SECRET');
  if (!appSecret) {
    const isProduction = !!Deno.env.get('DENO_DEPLOYMENT_ID') || Deno.env.get('NODE_ENV') === 'production';
    if (isProduction) {
      console.error('[meta-leads] META_LEADS_APP_SECRET not set in production — rejecting request');
      return false;
    }
    console.warn('[meta-leads] META_LEADS_APP_SECRET not set — skipping verification (dev only)');
    return true;
  }
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const computed = 'sha256=' + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computed === signature;
}

type LeadgenChange = {
  leadgen_id: string;
  form_id?: string;
  page_id: string;
  ad_id?: string;
  created_time?: number;
};

function extractChanges(payload: Record<string, unknown>): LeadgenChange[] {
  if (payload.object !== 'page') return [];
  const out: LeadgenChange[] = [];
  for (const entry of (payload.entry as Array<Record<string, unknown>>) ?? []) {
    for (const change of (entry.changes as Array<Record<string, unknown>>) ?? []) {
      const value = change.value as Record<string, unknown> | undefined;
      if (change.field === 'leadgen' && value?.leadgen_id) {
        out.push({
          leadgen_id: String(value.leadgen_id),
          form_id: value.form_id ? String(value.form_id) : undefined,
          page_id: String(value.page_id ?? entry.id ?? ''),
          ad_id: value.ad_id ? String(value.ad_id) : undefined,
          created_time: value.created_time ? Number(value.created_time) : undefined,
        });
      }
    }
  }
  return out;
}

async function procesarEventos(supabase: SupabaseClient, eventos: EventoRegistrado[]): Promise<void> {
  if (!eventos.length) {
    console.log('[meta-leads] payload sin cambios leadgen');
    return;
  }
  for (const { eventoId, change } of eventos) {
    if (!change) continue;
    let resultado: ResultadoLead;
    try {
      resultado = await handleLead(supabase, change);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error('[meta-leads] lead %s error: %s', change.leadgen_id, motivo);
      resultado = { estado: 'error', motivo: `excepcion: ${motivo}` };
    }
    await marcarEvento(supabase, eventoId, resultado);
  }
}

type MetaLeadsConfig = {
  page_id: string | number;
  field_map?: Record<string, string[]>;
  // Defaults del contacto que se crea desde el lead (opt-in). fuente_adquisicion y
  // fuente_detalle etiquetan el origen (ej. pauta digital pagada). rol_natural se
  // asigna solo si el lead declara ser persona natural (el campo tipo_persona_field
  // del formulario === natural_value); para jurídica no se asume rol.
  contacto?: {
    fuente_adquisicion?: string;
    fuente_detalle?: string;
    rol_natural?: string;
    // Uno o varios nombres aceptados, en orden de preferencia: el formulario de
    // Meta se renombra por fuera y con un solo nombre el dato deja de llegar sin
    // error (mismo criterio que campos_fuente.source_alternatives).
    tipo_persona_field?: string | string[];
    natural_value?: string;
    // Segmento inicial del contacto recién creado desde un lead (aún sin gestionar).
    segmento_inicial?: string;
  };
};

// Normaliza un valor de contacto para dedup: lower + trim. Emails se comparan así
// para que "  Ana@X.com " y "ana@x.com" sean el mismo.
function norm(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase();
  return t.length ? t : null;
}

// Graba el ORIGEN de primer toque en el contacto (custom_data.origen) si aun no
// lo tiene. Es first-touch INMUTABLE: la campana por la que el contacto llego la
// primera vez. Nunca pisa un origen existente (un contacto dedup que ya tenia
// origen conserva su primer toque). Merge no destructivo sobre custom_data.
async function escribirOrigenSiFalta(
  supabase: SupabaseClient,
  contactoId: string,
  origen: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from('contactos').select('custom_data').eq('id', contactoId).maybeSingle();
  const cd = ((data as { custom_data?: Record<string, unknown> } | null)?.custom_data ?? {}) as Record<string, unknown>;
  if (cd.origen) return; // ya tiene primer origen: no se pisa
  await supabase
    .from('contactos').update({ custom_data: { ...cd, origen } }).eq('id', contactoId);
}

// Devuelve SIEMPRE un resultado explícito (nunca void): cada salida temprana dice
// por qué el lead no llegó a interacción, y eso es lo que se graba en la bitácora.
async function handleLead(supabase: SupabaseClient, c: LeadgenChange): Promise<ResultadoLead> {
  // 1. Routing page_id → workspace (config-driven, opt-in).
  const { data: wss, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, config_extra');
  if (wsErr) {
    console.error('[meta-leads] error consultando workspaces:', wsErr.message);
    return { estado: 'error', motivo: `consultando_workspaces: ${wsErr.message}` };
  }
  const ws = (wss ?? []).find((w) => {
    const cfg = (w as { config_extra?: { meta_leads?: MetaLeadsConfig } }).config_extra?.meta_leads;
    return cfg && String(cfg.page_id) === String(c.page_id);
  }) as {
    id: string;
    config_extra: { meta_leads: MetaLeadsConfig };
  } | undefined;

  if (!ws) {
    // Antes esto era SOLO este warn: el lead se evaporaba sin dejar fila. Ahora
    // queda en meta_leads_eventos como descartado, reprocesable en cuanto alguien
    // configure el page_id en el workspace que corresponda.
    console.warn('[meta-leads] ningún workspace mapeado para page_id=%s (lead ignorado)', c.page_id);
    return { estado: 'descartado', motivo: `sin_workspace_para_page_id: ${c.page_id}` };
  }
  const cfg = ws.config_extra.meta_leads;
  const workspaceId = ws.id;

  // 2. Idempotencia por leadgen_id (interacción ya registrada).
  const { data: existing } = await supabase
    .from('contacto_interacciones')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('fuente', 'meta')
    .eq('fuente_ref', c.leadgen_id)
    .maybeSingle();
  if (existing) {
    console.log('[meta-leads] lead %s ya ingerido (interacción %s)', c.leadgen_id, (existing as { id: string }).id);
    return { estado: 'descartado', motivo: 'ya_ingerido', workspaceId };
  }

  // 3. Traer el field_data del lead via Graph API.
  const token = Deno.env.get('META_LEADS_SYSTEM_TOKEN');
  if (!token) {
    console.error('[meta-leads] META_LEADS_SYSTEM_TOKEN no configurado');
    return { estado: 'error', motivo: 'META_LEADS_SYSTEM_TOKEN no configurado', workspaceId };
  }
  const fields = 'field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time,platform';
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${c.leadgen_id}?fields=${fields}&access_token=${token}`,
  );
  const lead = await res.json();
  if (lead.error) {
    console.error('[meta-leads] Graph API error:', JSON.stringify(lead.error));
    return { estado: 'error', motivo: `graph_api: ${JSON.stringify(lead.error).slice(0, 500)}`, workspaceId };
  }
  const fieldData: Array<{ name: string; values: string[] }> = lead.field_data ?? [];
  const getField = (names: string[]): string | null => {
    for (const n of names) {
      const f = fieldData.find((fd) => fd.name?.toLowerCase() === n.toLowerCase());
      if (f?.values?.length) return f.values[0];
    }
    return null;
  };

  // Red de seguridad del mapa. `getField` exige que el nombre del campo COINCIDA
  // exacto, y en agosto de 2026 eso costó 97 leads: un formulario nuevo empezó a
  // mandar 'nombre_completo' y 'correo_electrónico' donde el mapa esperaba
  // 'full_name' y 'email'. El webhook respondía 200, el contacto nacía vacío y el
  // dato quedaba enterrado en el payload. Nadie se enteró en dos semanas.
  //
  // Por eso, si el mapa no acierta, se busca por PARECIDO del nombre del campo:
  // sin tildes, en minúsculas, por subcadena. 'número_de_teléfono' contiene
  // 'tel'; 'nombre_completo' contiene 'nombre'. Cubre español e inglés sin que
  // nadie tenga que anticipar cómo bautizaron el campo en Meta.
  //
  // El parecido NO reemplaza al mapa, lo respalda: el mapa sigue mandando cuando
  // acierta, porque es el único que sabe desempatar entre dos campos parecidos.
  const sinTildes = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const porParecido = (fragmentos: string[]): string | null => {
    for (const fd of fieldData) {
      const n = sinTildes(fd.name ?? '');
      if (fragmentos.some((f) => n.includes(f)) && fd.values?.length) return fd.values[0];
    }
    return null;
  };
  // El correo además se reconoce por su forma, que no admite confusión. Es la
  // última red: sirve aunque el campo se llame 'contacto' o '¿dónde te escribimos?'.
  const porFormaDeEmail = (): string | null =>
    fieldData.find((fd) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((fd.values?.[0] ?? '').trim()))
      ?.values?.[0] ?? null;

  const fm = cfg.field_map ?? {};
  const nombre = getField(fm.nombre ?? ['full_name', 'nombre', 'name'])
    ?? porParecido(['nombre', 'name'])
    ?? 'Lead sin nombre';
  const emailRaw = getField(fm.email ?? ['email', 'correo', 'correo_electronico'])
    ?? porParecido(['email', 'correo', 'mail'])
    ?? porFormaDeEmail();
  // Nada de adivinar el teléfono por su forma: una cédula también son diez
  // dígitos. Solo por el nombre del campo, que en un formulario de Meta siempre
  // dice de qué se trata.
  const telefonoRaw = getField(fm.telefono ?? ['phone_number', 'telefono', 'celular', 'phone'])
    ?? porParecido(['tel', 'phone', 'celular', 'movil', 'whatsapp']);
  const email = norm(emailRaw);

  // Si ni el mapa ni el parecido sacaron NADA, el formulario trae campos que este
  // workspace no conoce. Eso no es un lead sin datos: es un mapa desactualizado, y
  // el log tiene que decir cuál es el formulario y cómo se llaman sus campos, para
  // que arreglarlo sea una edición de `config_extra.meta_leads.field_map` y no una
  // investigación.
  const sinMapeo = !emailRaw && !telefonoRaw && nombre === 'Lead sin nombre';
  if (sinMapeo) {
    console.error(
      `[meta-leads] FORMULARIO SIN MAPEAR ws=${workspaceId} ` +
      `form_id=${c.form_id ?? lead.form_id ?? '?'} ` +
      `campos=[${fieldData.map((fd) => fd.name).join(', ')}]`,
    );
  }

  // Defaults del contacto creado desde el lead (opt-in): fuente = pauta digital,
  // rol = decisor si el lead es persona natural. Solo aplican al CREAR el contacto;
  // un contacto ya existente (dedup) no se pisa.
  const cc = cfg.contacto ?? {};
  const tipoPersonaNames = cc.tipo_persona_field
    ? (Array.isArray(cc.tipo_persona_field) ? cc.tipo_persona_field : [cc.tipo_persona_field])
    : [];
  const tipoPersona = tipoPersonaNames.length ? getField(tipoPersonaNames) : null;
  const esNatural = !!tipoPersona
    && tipoPersona.trim().toLowerCase().replace(/_+$/, '') === (cc.natural_value ?? 'natural').toLowerCase();
  const contactoRol = esNatural ? (cc.rol_natural ?? null) : null;

  // Nombre del contacto en MAYUSCULAS (homogeneo con negocios).
  const nombreUpper = nombre.toUpperCase();

  // Origen de primer toque (campana desde donde llego). Se graba en el contacto
  // (custom_data.origen), inmutable: solo si el contacto aun no lo tiene.
  const createdTimeOrigen = c.created_time ?? lead.created_time ?? null;
  const firstAtOrigen = createdTimeOrigen != null
    ? new Date(Number(createdTimeOrigen) * 1000).toISOString() : null;
  const origen = {
    fuente: 'meta',
    campaign_id: lead.campaign_id ?? null,
    campaign_name: lead.campaign_name ?? null,
    adset_name: lead.adset_name ?? null,
    ad_name: lead.ad_name ?? null,
    platform: lead.platform ?? null,
    first_at: firstAtOrigen,
  };

  // 3. Dedup de contacto — EMAIL-first. El email identifica mejor a una persona
  //    que el teléfono (un teléfono se comparte entre familiares/empresa). Reglas:
  //    a) hay email y matchea un contacto → fusiona con ese contacto.
  //    b) no hay match por email → intenta por teléfono; si matchea, fusiona.
  //    c) el teléfono matchea pero el email declarado DIFIERE del contacto hallado
  //       → NO fusiona (usa/crea el contacto por email) y marca la interacción
  //       'posible_duplicado' para revisión humana (dos personas, un teléfono).
  //    d) sin email ni teléfono → crea contacto igual (no se puede deduplicar).
  let contactoId: string | null = null;
  let estadoInteraccion = 'nueva';

  // La comparación la hace `buscar_contacto_duplicado` (migración 20260902000007),
  // la MISMA función que usan las puertas de creación de la app. Antes se hacía
  // aquí con dos consultas propias, y las dos fallaban en producción:
  //
  //   · la de email usaba `maybeSingle()`, que ante dos contactos con el mismo
  //     correo devuelve error y deja pasar el duplicado. Con 5 correos repetidos
  //     en el workspace, eso ya estaba ocurriendo.
  //   · la de teléfono se traía TODOS los contactos del workspace para comparar
  //     en memoria, contra el techo de 1.000 filas de PostgREST. Este workspace
  //     tiene 1.030 contactos: la lista ya llega recortada y el duplicado pasa.
  //
  // Dos verdades sobre lo que es "la misma persona" se desincronizan en el primer
  // cambio. Ahora hay una, en SQL, indexada, y este webhook la consulta.
  const buscarDuplicado = async (
    datos: { telefono?: string | null; email?: string | null },
  ): Promise<{ id: string; email: string | null } | null> => {
    const { data, error } = await supabase.rpc('buscar_contacto_duplicado', {
      p_workspace_id: workspaceId,
      p_telefono: datos.telefono ?? null,
      p_email: datos.email ?? null,
      p_excluir_id: null,
    });
    // Sin respuesta no se sabe si es duplicado, y crear a ciegas es justo lo que
    // llenó el directorio de repetidos. Se propaga para que el lead falle y Meta
    // lo reintente, en vez de resolverlo creando.
    if (error) throw new Error(`dedup: ${error.message}`);
    const filas = (data ?? []) as Array<{ id: string; email: string | null }>;
    return filas[0] ?? null;
  };

  // Email primero: identifica a una persona mejor que el teléfono, que se comparte
  // entre familia y empresa. Si el correo coincide, es la misma persona y se fusiona.
  if (emailRaw) {
    contactoId = (await buscarDuplicado({ email: emailRaw }))?.id ?? null;
  }

  // Sin match por correo, se intenta por teléfono.
  if (!contactoId && telefonoRaw) {
    const encontrado = await buscarDuplicado({ telefono: telefonoRaw });
    if (encontrado) {
      const emailContacto = norm(encontrado.email);
      // Conflicto: teléfono igual pero correo distinto → dos personas, un teléfono.
      // No fusionar; se crea contacto aparte y la interacción queda marcada para
      // que un humano decida. Es el caso que en este workspace separa a un cónyuge
      // de otro, y fusionarlos por el número borraría a uno de los dos.
      if (email && emailContacto && emailContacto !== email) {
        estadoInteraccion = 'posible_duplicado';
      } else {
        contactoId = encontrado.id;
      }
    }
  }

  // Crear contacto si no se resolvió por dedup.
  let contactoCreado = false;
  if (!contactoId) {
    const { data, error } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre: nombreUpper,
        telefono: telefonoRaw ?? null,
        email: emailRaw ?? null,
        fuente_adquisicion: cc.fuente_adquisicion ?? null,
        fuente_detalle: cc.fuente_detalle ?? null,
        rol: contactoRol,
        segmento: cc.segmento_inicial ?? null,
        // Origen de primer toque grabado desde el nacimiento del contacto.
        custom_data: { origen },
      })
      .select('id').single();
    if (error) {
      console.error('[meta-leads] error creando contacto:', error.message);
      return { estado: 'error', motivo: `creando_contacto: ${error.message}`, workspaceId };
    }
    contactoId = (data as { id: string }).id;
    contactoCreado = true;
  }

  // Contacto ya existente (dedup): grabar el primer origen si aun no lo tiene.
  if (!contactoCreado && contactoId) {
    await escribirOrigenSiFalta(supabase, contactoId, origen);
  }

  // 4. Registrar la INTERACCIÓN (no un negocio). El humano la convierte luego.
  //    payload = field_data crudo + metadata de campaña (para conservar contexto).
  const payload = {
    leadgen_id: c.leadgen_id,
    form_id: c.form_id ?? lead.form_id ?? null,
    ad_id: c.ad_id ?? lead.ad_id ?? null,
    ad_name: lead.ad_name ?? null,
    adset_id: lead.adset_id ?? null,
    adset_name: lead.adset_name ?? null,
    campaign_id: lead.campaign_id ?? null,
    campaign_name: lead.campaign_name ?? null,
    platform: lead.platform ?? null,
    created_time: c.created_time ?? lead.created_time ?? null,
    field_data: fieldData,
  };
  const createdTime = c.created_time ?? lead.created_time ?? null;
  const ocurridaAt = createdTime != null ? new Date(Number(createdTime) * 1000).toISOString() : null;

  const { data: inter, error: interErr } = await supabase
    .from('contacto_interacciones')
    .insert({
      workspace_id: workspaceId,
      contacto_id: contactoId,
      fuente: 'meta',
      fuente_ref: c.leadgen_id,
      payload,
      estado: estadoInteraccion,
      ocurrida_at: ocurridaAt,
    })
    .select('id').single();
  if (interErr) {
    // El índice único (workspace_id, 'meta', leadgen_id) protege de doble ingesta;
    // si dos entregas de Meta corren en paralelo, una gana y la otra choca aquí.
    console.error('[meta-leads] error registrando interacción:', interErr.message);
    return { estado: 'error', motivo: `registrando_interaccion: ${interErr.message}`, workspaceId };
  }
  console.log(
    '[meta-leads] interacción %s (estado=%s) registrada para contacto %s desde lead %s en ws %s',
    (inter as { id: string }).id, estadoInteraccion, contactoId, c.leadgen_id, workspaceId,
  );
  return {
    estado: 'procesado',
    workspaceId,
    interaccionId: (inter as { id: string }).id,
    contactoId,
  };
}
