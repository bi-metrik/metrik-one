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
      // Meta espera 200 en < 20s. Procesamos async y respondemos ya.
      processPayload(payload).catch((e) => console.error('[meta-leads] process error:', e));
      return new Response('OK', { status: 200 });
    } catch (e) {
      // Nunca devolver 5xx por un bug de parseo: Meta entraría en retry-storm.
      console.error('[meta-leads] handler error:', e instanceof Error ? e.message : e);
      return new Response('OK', { status: 200 });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

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

async function processPayload(payload: Record<string, unknown>): Promise<void> {
  const changes = extractChanges(payload);
  if (!changes.length) {
    console.log('[meta-leads] payload sin cambios leadgen (object=%s)', payload.object);
    return;
  }
  for (const c of changes) {
    try {
      await handleLead(c);
    } catch (e) {
      console.error('[meta-leads] lead %s error: %s', c.leadgen_id, e instanceof Error ? e.message : e);
    }
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
    tipo_persona_field?: string;
    natural_value?: string;
    // Segmento inicial del contacto recién creado desde un lead (aún sin gestionar).
    segmento_inicial?: string;
  };
};

// Normaliza un valor de contacto para dedup: lower + trim. Emails y teléfonos se
// comparan normalizados para que "  Ana@X.com " y "ana@x.com" sean el mismo.
function norm(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase();
  return t.length ? t : null;
}

async function handleLead(c: LeadgenChange): Promise<void> {
  const supabase = getServiceClient();

  // 1. Routing page_id → workspace (config-driven, opt-in).
  const { data: wss, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, config_extra');
  if (wsErr) {
    console.error('[meta-leads] error consultando workspaces:', wsErr.message);
    return;
  }
  const ws = (wss ?? []).find((w) => {
    const cfg = (w as { config_extra?: { meta_leads?: MetaLeadsConfig } }).config_extra?.meta_leads;
    return cfg && String(cfg.page_id) === String(c.page_id);
  }) as {
    id: string;
    config_extra: { meta_leads: MetaLeadsConfig };
  } | undefined;

  if (!ws) {
    console.warn('[meta-leads] ningún workspace mapeado para page_id=%s (lead ignorado)', c.page_id);
    return;
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
    return;
  }

  // 3. Traer el field_data del lead via Graph API.
  const token = Deno.env.get('META_LEADS_SYSTEM_TOKEN');
  if (!token) {
    console.error('[meta-leads] META_LEADS_SYSTEM_TOKEN no configurado');
    return;
  }
  const fields = 'field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time,platform';
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${c.leadgen_id}?fields=${fields}&access_token=${token}`,
  );
  const lead = await res.json();
  if (lead.error) {
    console.error('[meta-leads] Graph API error:', JSON.stringify(lead.error));
    return;
  }
  const fieldData: Array<{ name: string; values: string[] }> = lead.field_data ?? [];
  const getField = (names: string[]): string | null => {
    for (const n of names) {
      const f = fieldData.find((fd) => fd.name?.toLowerCase() === n.toLowerCase());
      if (f?.values?.length) return f.values[0];
    }
    return null;
  };

  const fm = cfg.field_map ?? {};
  const nombre = getField(fm.nombre ?? ['full_name', 'nombre', 'name']) ?? 'Lead sin nombre';
  const emailRaw = getField(fm.email ?? ['email', 'correo', 'correo_electronico']);
  const telefonoRaw = getField(fm.telefono ?? ['phone_number', 'telefono', 'celular', 'phone']);
  const email = norm(emailRaw);
  const telefono = norm(telefonoRaw);

  // Defaults del contacto creado desde el lead (opt-in): fuente = pauta digital,
  // rol = decisor si el lead es persona natural. Solo aplican al CREAR el contacto;
  // un contacto ya existente (dedup) no se pisa.
  const cc = cfg.contacto ?? {};
  const tipoPersona = cc.tipo_persona_field ? getField([cc.tipo_persona_field]) : null;
  const esNatural = !!tipoPersona
    && tipoPersona.trim().toLowerCase().replace(/_+$/, '') === (cc.natural_value ?? 'natural').toLowerCase();
  const contactoRol = esNatural ? (cc.rol_natural ?? null) : null;

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

  // Buscar por email normalizado.
  if (email) {
    const { data } = await supabase
      .from('contactos').select('id, email').eq('workspace_id', workspaceId).ilike('email', email).maybeSingle();
    contactoId = (data as { id: string } | null)?.id ?? null;
  }

  // Sin match por email → intentar por teléfono.
  if (!contactoId && telefono) {
    const { data } = await supabase
      .from('contactos').select('id, email').eq('workspace_id', workspaceId).eq('telefono', telefono).maybeSingle();
    const encontrado = data as { id: string; email: string | null } | null;
    if (encontrado) {
      const emailContacto = norm(encontrado.email);
      // Conflicto: teléfono igual pero email distinto → dos personas, un teléfono.
      // No fusionar; se creará (o buscará) un contacto por email y se marca duplicado.
      if (email && emailContacto && emailContacto !== email) {
        estadoInteraccion = 'posible_duplicado';
      } else {
        contactoId = encontrado.id;
      }
    }
  }

  // Crear contacto si no se resolvió por dedup.
  if (!contactoId) {
    const { data, error } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre,
        telefono: telefonoRaw ?? null,
        email: emailRaw ?? null,
        fuente_adquisicion: cc.fuente_adquisicion ?? null,
        fuente_detalle: cc.fuente_detalle ?? null,
        rol: contactoRol,
        segmento: cc.segmento_inicial ?? null,
      })
      .select('id').single();
    if (error) {
      console.error('[meta-leads] error creando contacto:', error.message);
      return;
    }
    contactoId = (data as { id: string }).id;
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
    return;
  }
  console.log(
    '[meta-leads] interacción %s (estado=%s) registrada para contacto %s desde lead %s en ws %s',
    (inter as { id: string }).id, estadoInteraccion, contactoId, c.leadgen_id, workspaceId,
  );
}
