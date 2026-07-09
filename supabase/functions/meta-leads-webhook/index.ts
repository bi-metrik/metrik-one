// ============================================================
// meta-leads-webhook — Captura de leads de Meta (Lead Ads) → ONE
// ------------------------------------------------------------
// El webhook de Meta NO trae los datos del lead, solo un leadgen_id.
// Flujo: verificar firma → traer field_data via Graph API con el
// System User token → mapear page_id → workspace → crear negocio
// shell en la etapa de entrada (config-driven, opt-in por workspace).
//
// Config por workspace en workspaces.config_extra.meta_leads:
//   {
//     "page_id": "1234567890",          // Página de FB que dispara el webhook
//     "linea_id": "uuid" | null,        // null → usa linea_activa_id del ws
//     "etapa_entrada_orden": 1 | null,  // null → primera etapa activa (orden asc)
//     "field_map": {                    // opcional, override del mapeo por defecto
//       "nombre":  ["full_name"],
//       "email":   ["email"],
//       "telefono":["phone_number"],
//       "empresa": ["company_name"]     // si existe → crea empresa juridica
//     }
//   }
//
// Idempotencia: negocios.metadata->>leadgen_id. Meta reintenta el webhook.
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
  linea_id?: string | null;
  etapa_entrada_orden?: number | null;
  field_map?: Record<string, string[]>;
  // Cómo armar el nombre del negocio (opt-in por workspace). Por defecto = nombre
  // del lead tal cual. `uppercase` lo pone en MAYÚSCULAS; `append_fields` concatena
  // el valor de esos campos del formulario (ej. marca-línea-modelo del vehículo)
  // para identificar el negocio desde el pipeline: "PERSONA - MARCA MODELO".
  nombre_negocio?: { uppercase?: boolean; append_fields?: string[] };
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
    // Segmento inicial del contacto (el lead nace en la etapa de entrada). El resto
    // del ciclo lo mantiene el avance de etapa en la app (sincronizarSegmentoContacto).
    segmento_inicial?: string;
  };
};

// Arma el nombre del negocio a partir del nombre del lead y, si el workspace lo
// configura, concatena campos del formulario (ej. marca-línea-modelo) y lo pasa a
// MAYÚSCULAS. Sin config → nombre tal cual. getField resuelve un campo del field_data.
function construirNombreNegocio(
  base: string,
  cfgNombre: { uppercase?: boolean; append_fields?: string[] } | undefined,
  getField: (names: string[]) => string | null,
): string {
  let nombre = base;
  const extra = (cfgNombre?.append_fields ?? [])
    .map((name) => getField([name]))
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map((v) => v.trim());
  if (extra.length) nombre = `${base} - ${extra.join(' ')}`;
  return cfgNombre?.uppercase ? nombre.toUpperCase() : nombre;
}

async function handleLead(c: LeadgenChange): Promise<void> {
  const supabase = getServiceClient();

  // 1. Routing page_id → workspace (config-driven, opt-in).
  const { data: wss, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, linea_activa_id, stages_activos, config_extra');
  if (wsErr) {
    console.error('[meta-leads] error consultando workspaces:', wsErr.message);
    return;
  }
  const ws = (wss ?? []).find((w) => {
    const cfg = (w as { config_extra?: { meta_leads?: MetaLeadsConfig } }).config_extra?.meta_leads;
    return cfg && String(cfg.page_id) === String(c.page_id);
  }) as {
    id: string;
    linea_activa_id: string | null;
    stages_activos: string[] | null;
    config_extra: { meta_leads: MetaLeadsConfig };
  } | undefined;

  if (!ws) {
    console.warn('[meta-leads] ningún workspace mapeado para page_id=%s (lead ignorado)', c.page_id);
    return;
  }
  const cfg = ws.config_extra.meta_leads;
  const workspaceId = ws.id;
  const lineaId = cfg.linea_id ?? ws.linea_activa_id;
  if (!lineaId) {
    console.error('[meta-leads] workspace %s sin línea configurada', workspaceId);
    return;
  }

  // 2. Idempotencia por leadgen_id.
  const { data: existing } = await supabase
    .from('negocios')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('metadata->>leadgen_id', c.leadgen_id)
    .maybeSingle();
  if (existing) {
    console.log('[meta-leads] lead %s ya ingerido (negocio %s)', c.leadgen_id, (existing as { id: string }).id);
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
  const email = getField(fm.email ?? ['email', 'correo', 'correo_electronico']);
  const telefono = getField(fm.telefono ?? ['phone_number', 'telefono', 'celular', 'phone']);
  const empresaNombre = fm.empresa ? getField(fm.empresa) : null;

  // Nombre del negocio (opt-in): persona + campos extra (ej. marca-modelo del
  // vehículo), en MAYÚSCULAS si se pide. El contacto conserva el nombre de la
  // persona; solo el negocio lleva el nombre compuesto para identificarlo en el pipeline.
  const negocioNombre = construirNombreNegocio(nombre, cfg.nombre_negocio, getField);

  // Defaults del contacto creado desde el lead (opt-in): fuente = pauta digital,
  // rol = decisor si el lead es persona natural. Solo aplican al CREAR el contacto;
  // un contacto ya existente (dedup) no se pisa.
  const cc = cfg.contacto ?? {};
  const tipoPersona = cc.tipo_persona_field ? getField([cc.tipo_persona_field]) : null;
  const esNatural = !!tipoPersona
    && tipoPersona.trim().toLowerCase().replace(/_+$/, '') === (cc.natural_value ?? 'natural').toLowerCase();
  const contactoRol = esNatural ? (cc.rol_natural ?? null) : null;

  // 4. Dedup de contacto (por teléfono, luego email).
  let contactoId: string | null = null;
  if (telefono) {
    const { data } = await supabase
      .from('contactos').select('id').eq('workspace_id', workspaceId).eq('telefono', telefono).maybeSingle();
    contactoId = (data as { id: string } | null)?.id ?? null;
  }
  if (!contactoId && email) {
    const { data } = await supabase
      .from('contactos').select('id').eq('workspace_id', workspaceId).eq('email', email).maybeSingle();
    contactoId = (data as { id: string } | null)?.id ?? null;
  }
  if (!contactoId) {
    const { data, error } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre,
        telefono: telefono ?? null,
        email: email ?? null,
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

  // 5. Empresa opcional (solo si el field_map la mapea).
  let empresaId: string | null = null;
  if (empresaNombre) {
    const { data } = await supabase
      .from('empresas')
      .insert({ workspace_id: workspaceId, nombre: empresaNombre, tipo_persona: 'juridica' })
      .select('id').single();
    empresaId = (data as { id: string } | null)?.id ?? null;
  }

  // 6. Etapa de entrada (default: primera etapa activa por orden asc = Validación).
  const stagesActivos = ws.stages_activos ?? ['venta', 'ejecucion', 'cobro'];
  const { data: etapas } = await supabase
    .from('etapas_negocio')
    .select('id, stage, orden')
    .eq('linea_id', lineaId)
    .in('stage', stagesActivos)
    .order('orden', { ascending: true });
  const etapasList = (etapas ?? []) as Array<{ id: string; stage: string; orden: number }>;
  let etapa = etapasList[0];
  if (cfg.etapa_entrada_orden != null) {
    const match = etapasList.find((e) => e.orden === cfg.etapa_entrada_orden);
    if (match) etapa = match;
  }
  if (!etapa) {
    console.error('[meta-leads] no se encontró etapa de entrada para línea %s', lineaId);
    return;
  }

  // 7. Crear el negocio shell. El código (V000N) lo auto-genera el trigger.
  const metadata = {
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
    fuente_cargue: 'meta_lead',
    field_data: fieldData,
  };
  const { data: neg, error: negErr } = await supabase
    .from('negocios')
    .insert({
      workspace_id: workspaceId,
      linea_id: lineaId,
      contacto_id: contactoId,
      empresa_id: empresaId,
      nombre: negocioNombre,
      etapa_actual_id: etapa.id,
      stage_actual: etapa.stage,
      estado: 'abierto',
      metadata,
    })
    .select('id, codigo').single();
  if (negErr) {
    console.error('[meta-leads] error creando negocio:', negErr.message);
    return;
  }
  const created = neg as { id: string; codigo: string | null };
  console.log(
    '[meta-leads] negocio creado %s (%s) desde lead %s en ws %s',
    created.codigo ?? created.id, nombre, c.leadgen_id, workspaceId,
  );
}
