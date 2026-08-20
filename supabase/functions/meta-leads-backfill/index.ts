// meta-leads-backfill — recupera la atribucion de campana que se perdio en silencio.
//
// POR QUE EXISTE
//
// `meta-leads-webhook` pide a la Graph API `campaign_id,campaign_name,adset_id,
// adset_name` junto con el `field_data` del lead. Cuando el token NO tiene permiso
// sobre la cuenta publicitaria duena del anuncio, Meta **omite esos campos y
// responde 200 igual**. No hay error, no hay log, no hay nada: solo llega menos
// dato. Medido en SOENA (workspace 7dea141d-d4da-483d-a78d-b14ef35500c5): de 478
// leads, las 478 traen `ad_id` (o sea TODAS vinieron de un anuncio) pero 350 no
// tienen `campaign_id`.
//
// El 2026-08-18 SOENA concedio acceso a su cuenta publicitaria `SOENA (MK)`
// (3229968600725628) y el flujo se arreglo solo, sin tocar codigo: 11-17 ago 0 de
// 90 con campana, 19-20 ago 17 de 17. Esta funcion va por el pasado, que sigue
// recuperable mientras las filas no salgan de la ventana de retencion de Meta (la
// mas antigua es del 2026-07-08).
//
// De un solo uso. Corre en dry run por defecto: escribir sobre datos de produccion
// lo autoriza Mauricio con los numeros a la vista.
//
// Spec: docs/specs/2026-08-20_backfill-atribucion-meta.md

import { getServiceClient } from '../_shared/supabase-client.ts';

// La misma que usa meta-leads-webhook. Si alla sube, aca tambien: un backfill que
// pregunta por otra version puede recibir otra forma de respuesta.
const GRAPH_VERSION = 'v21.0';

const CAMPOS = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'platform',
  'form_id',
  'created_time',
].join(',');

// Claves del payload que este backfill puede rellenar. `field_data` NO esta aca a
// proposito: es el dato del lead y no se toca ni por accidente.
const CLAVES_RELLENABLES = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'platform',
] as const;

// Meta pide bajar el ritmo. No es un fallo del lead: es del ritmo al que
// preguntamos, asi que corta la corrida en vez de marcar filas como perdidas.
const CODIGOS_RATE_LIMIT = new Set([4, 17, 32, 613]);

const CONCURRENCIA = 5;
const PAUSA_MS = 350;
const LIMITE_DEFECTO = 1000;

type Resultado =
  | 'actualizado'
  | 'sin_campana_en_meta'
  | 'campana_oculta_por_permiso'
  | 'error_graph'
  | 'rate_limit';

interface Fila {
  id: string;
  workspace_id: string | null;
  fuente_ref: string | null;
  ocurrida_at: string | null;
  payload: Record<string, unknown> | null;
}

interface Veredicto {
  id: string;
  workspace_id: string | null;
  leadgen_id: string;
  resultado: Resultado;
  campaign_name?: string | null;
  motivo?: string;
  parche?: Record<string, unknown>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  let body: {
    secret?: string;
    dry_run?: boolean;
    limite?: number;
    workspace_id?: string;
  } = {};
  try {
    body = await req.json();
  } catch { /* sin body: cae en el 401 de abajo */ }

  // Secreto propio si existe; si no, el del handshake de Meta Lead Ads. Se reusa a
  // proposito y no por comodidad: crear un secreto nuevo exige entrar al dashboard
  // de Supabase, y esta funcion es de un solo uso dentro del mismo perimetro
  // (mismos datos, mismo token de Graph). Si el backfill se vuelve recurrente, lo
  // primero que hay que hacer es darle su propio secreto.
  const esperado = Deno.env.get('META_LEADS_BACKFILL_SECRET') ??
    Deno.env.get('META_LEADS_VERIFY_TOKEN');
  if (!esperado || body.secret !== esperado) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const token = Deno.env.get('META_LEADS_SYSTEM_TOKEN');
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'META_LEADS_SYSTEM_TOKEN no configurado' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  // Por defecto NO escribe. Hay que pedir la escritura de forma explicita.
  const dryRun = body.dry_run !== false;
  const limite = Math.max(1, Math.min(body.limite ?? LIMITE_DEFECTO, 5000));

  const supabase = getServiceClient();

  // Las mas viejas primero: son las que estan mas cerca de salirse de la ventana
  // de retencion de Meta, y despues de eso no hay backfill que valga.
  let q = supabase
    .from('contacto_interacciones')
    .select('id, workspace_id, fuente_ref, ocurrida_at, payload')
    .eq('fuente', 'meta')
    .is('payload->>campaign_id', null)
    .not('fuente_ref', 'is', null)
    .order('ocurrida_at', { ascending: true })
    .limit(limite);
  if (body.workspace_id) q = q.eq('workspace_id', body.workspace_id);

  const { data, error } = await q;
  if (error) {
    return new Response(
      JSON.stringify({ error: `consulta: ${error.message}` }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const filas = (data ?? []) as Fila[];
  const veredictos: Veredicto[] = [];
  let cortadoPorRateLimit = false;
  let procesadas = 0;

  for (let i = 0; i < filas.length; i += CONCURRENCIA) {
    if (cortadoPorRateLimit) break;
    const tanda = filas.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.all(
      tanda.map((f) => resolverUna(f, token)),
    );
    for (const v of resultados) {
      veredictos.push(v);
      procesadas++;
      if (v.resultado === 'rate_limit') cortadoPorRateLimit = true;
    }
    if (i + CONCURRENCIA < filas.length) await dormir(PAUSA_MS);
  }

  // Escritura, solo si se pidio. Secuencial a proposito: son pocas y un update que
  // falla tiene que quedar visible, no ahogado en un Promise.all.
  let escritas = 0;
  const erroresEscritura: Array<{ id: string; motivo: string }> = [];
  if (!dryRun) {
    for (const v of veredictos) {
      if (v.resultado !== 'actualizado' || !v.parche) continue;
      const { error: e } = await supabase
        .from('contacto_interacciones')
        .update({ payload: v.parche })
        .eq('id', v.id);
      if (e) {
        erroresEscritura.push({ id: v.id, motivo: e.message });
        // El veredicto ya no es 'actualizado': no se escribio nada.
        v.resultado = 'error_graph';
        v.motivo = `update: ${e.message}`;
      } else {
        escritas++;
      }
    }
  }

  const conteo = (r: Resultado) =>
    veredictos.filter((v) => v.resultado === r).length;

  const porWorkspace: Record<string, Record<string, number>> = {};
  for (const v of veredictos) {
    const w = v.workspace_id ?? 'sin_workspace';
    porWorkspace[w] ??= {};
    porWorkspace[w][v.resultado] = (porWorkspace[w][v.resultado] ?? 0) + 1;
  }

  const resumen = {
    dry_run: dryRun,
    candidatas: filas.length,
    procesadas,
    // Lo que quedo sin mirar por el corte. Se dice, no se calla: una corrida
    // truncada en silencio se lee igual que una completa.
    sin_procesar: filas.length - procesadas,
    cortado_por_rate_limit: cortadoPorRateLimit,
    actualizado: conteo('actualizado'),
    sin_campana_en_meta: conteo('sin_campana_en_meta'),
    campana_oculta_por_permiso: conteo('campana_oculta_por_permiso'),
    error_graph: conteo('error_graph'),
    rate_limit: conteo('rate_limit'),
    escritas,
    por_workspace: porWorkspace,
    errores: veredictos
      .filter((v) => v.resultado === 'error_graph' || v.resultado === 'rate_limit')
      .slice(0, 10)
      .map((v) => ({ leadgen_id: v.leadgen_id, motivo: v.motivo })),
    errores_escritura: erroresEscritura.slice(0, 10),
    muestra: veredictos
      .filter((v) => v.resultado === 'actualizado')
      .slice(0, 5)
      .map((v) => ({ leadgen_id: v.leadgen_id, campaign_name: v.campaign_name })),
  };

  console.log(
    '[meta-leads-backfill] dry_run=%s candidatas=%d actualizado=%d oculta_por_permiso=%d sin_campana=%d error=%d escritas=%d',
    dryRun,
    filas.length,
    resumen.actualizado,
    resumen.campana_oculta_por_permiso,
    resumen.sin_campana_en_meta,
    resumen.error_graph,
    escritas,
  );

  return new Response(JSON.stringify(resumen, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

async function resolverUna(fila: Fila, token: string): Promise<Veredicto> {
  const leadgenId = String(fila.fuente_ref);
  const base: Veredicto = {
    id: fila.id,
    workspace_id: fila.workspace_id,
    leadgen_id: leadgenId,
    resultado: 'error_graph',
  };

  let lead: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?fields=${CAMPOS}&access_token=${token}`,
    );
    lead = await res.json();
  } catch (e) {
    return { ...base, motivo: `fetch: ${e instanceof Error ? e.message : String(e)}` };
  }

  const err = lead.error as
    | { code?: number; error_subcode?: number; message?: string; type?: string }
    | undefined;
  if (err) {
    const code = Number(err.code ?? 0);
    const motivo = `code=${code} subcode=${err.error_subcode ?? '-'} type=${err.type ?? '-'}: ${err.message ?? ''}`;
    if (CODIGOS_RATE_LIMIT.has(code)) return { ...base, resultado: 'rate_limit', motivo };
    return { ...base, motivo };
  }

  const campaignId = lead.campaign_id ? String(lead.campaign_id) : null;
  const adId = lead.ad_id ? String(lead.ad_id) : null;

  if (!campaignId) {
    // AQUI ESTA EL PUNTO DE TODO ESTO. Meta respondio 200 sin campana, y eso
    // significa dos cosas OPUESTAS que no se pueden meter en el mismo balde:
    //
    //   - Si el lead NO tiene `ad_id`, no vino de un anuncio: no hay campana que
    //     buscar y la fila esta correcta como esta.
    //   - Si el lead SI tiene `ad_id`, vino de un anuncio y por definicion tiene
    //     campana. Que Meta no la entregue significa que el token sigue sin
    //     permiso sobre ESA cuenta publicitaria. Es el mismo fallo mudo que este
    //     backfill viene a reparar, y reportarlo como "no hay campana" seria
    //     repetirlo desde adentro.
    const adIdConocido = adId ?? (fila.payload?.ad_id ? String(fila.payload.ad_id) : null);
    if (adIdConocido) {
      return {
        ...base,
        resultado: 'campana_oculta_por_permiso',
        motivo: `ad_id=${adIdConocido} sin campaign_id: falta permiso sobre la cuenta publicitaria dueña del anuncio`,
      };
    }
    return { ...base, resultado: 'sin_campana_en_meta', motivo: 'lead sin ad_id (no vino de un anuncio)' };
  }

  // Merge conservador: solo lo que hoy esta vacio y Meta si devolvio.
  const payload = { ...(fila.payload ?? {}) } as Record<string, unknown>;
  for (const clave of CLAVES_RELLENABLES) {
    const actual = payload[clave];
    const nuevo = lead[clave];
    if ((actual === null || actual === undefined) && nuevo !== null && nuevo !== undefined) {
      payload[clave] = nuevo;
    }
  }
  // Deja la huella de que esta fila la completo un backfill y no el webhook. Sin
  // esto, dentro de un mes nadie sabe por que unas filas tienen campana y otras no.
  payload.backfill = { en: new Date().toISOString(), version: 1 };

  return {
    ...base,
    resultado: 'actualizado',
    campaign_name: lead.campaign_name ? String(lead.campaign_name) : null,
    parche: payload,
  };
}
