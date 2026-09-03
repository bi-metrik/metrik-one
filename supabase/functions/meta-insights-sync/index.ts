// meta-insights-sync — trae de Meta el gasto de cada campana y lo guarda por mes.
//
// POR QUE EXISTE
//
// El tablero de marketing necesita inversion, CPL, CAC y ROAS. Probado contra la API
// real el 2026-09-03: el token de sistema (`META_LEADS_SYSTEM_TOKEN`, el mismo que
// usa `meta-leads-webhook`) trae `ads_read` y las 7 campanas de SOENA devuelven
// gasto. La captura manual sobra.
//
// ⚠️ LA PANTALLA LEE LA TABLA, NUNCA ESTA FUNCION. `/tableros` ya se arreglo una vez
// por lento (de 8,4-11,4 s a 5,3-8,7 s): meterle siete llamadas HTTP a Meta en el
// render lo devuelve al problema. Y si Meta responde lento o falla, la pestana pinta
// el ultimo dato bueno con su fecha de sincronizacion, que es lo que
// `sincronizado_at` existe para decir.
//
// ⚠️ EL SYSTEM USER NO PUEDE ENUMERAR CUENTAS PUBLICITARIAS. `assigned_ad_accounts`
// devuelve vacio y los endpoints del business piden `business_management`, que el
// token no tiene. Leer una campana POR SU ID si funciona, y alcanza: los ids salen de
// los leads que ya estan en la base, y eso cubre las DOS cuentas de SOENA
// (1603671527655761 y 3229968600725628) sin tener que saber cuales son.
//
// Consecuencia asumida: una campana que nunca trajo un lead a ONE es invisible para
// este sync. Su gasto existe en Meta y no aparece aqui. No hay forma de descubrirla
// con este token, y pedir `business_management` es una decision de permisos, no de
// codigo.
//
// Spec: proyectos/soena/ve/2026-09-03_spec-tablero-marketing.md (seccion 5)

import { getServiceClient } from '../_shared/supabase-client.ts';
import {
  filasParaUpsert,
  monedasEnConflicto,
  type CampanaMeta,
  type FilaInsight,
  type TramoInsights,
} from '../_shared/meta-insights.ts';

// La misma que usa `meta-leads-webhook`. Si alla sube, aca tambien: preguntarle a
// otra version puede devolver otra forma de respuesta.
const GRAPH_VERSION = 'v21.0';

// Meta pide bajar el ritmo. No es un fallo de la campana: es del ritmo al que
// preguntamos, asi que corta la corrida en vez de marcar campanas como perdidas.
const CODIGOS_RATE_LIMIT = new Set([4, 17, 32, 613]);

const PAUSA_MS = 250;

interface RespuestaGraph<T> {
  ok: boolean;
  datos?: T;
  error?: string;
  rateLimit?: boolean;
}

async function graph<T>(ruta: string, params: Record<string, string>, token: string): Promise<RespuestaGraph<T>> {
  const q = new URLSearchParams({ ...params, access_token: token });
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ruta}?${q}`);
    const cuerpo = await r.json();
    if (!r.ok || cuerpo?.error) {
      const code = cuerpo?.error?.code;
      return {
        ok: false,
        error: cuerpo?.error?.message ?? `HTTP ${r.status}`,
        rateLimit: typeof code === 'number' && CODIGOS_RATE_LIMIT.has(code),
      };
    }
    return { ok: true, datos: cuerpo as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const dormir = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: { secret?: string; workspace_id?: string } = {};
  try {
    body = await req.json();
  } catch { /* sin body: cae en el 401 de abajo */ }

  // Secreto propio si existe; si no, el del handshake de Meta Lead Ads. Mismo
  // criterio que `meta-leads-backfill`: mismo perimetro (mismos datos, mismo token
  // de Graph). En cuanto esta funcion quede en un cron, lo primero es darle el suyo.
  const esperado = Deno.env.get('META_INSIGHTS_SYNC_SECRET') ??
    Deno.env.get('META_LEADS_VERIFY_TOKEN');
  if (!esperado || body.secret !== esperado) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  // ⚠️ El token NUNCA viaja en el cuerpo ni se registra: sale del secreto del
  // proyecto, igual que en `meta-leads-webhook`.
  const token = Deno.env.get('META_LEADS_SYSTEM_TOKEN');
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'META_LEADS_SYSTEM_TOKEN no configurado' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const supabase = getServiceClient();

  // Las campanas a sincronizar salen de la MISMA vista que pinta el tablero, no de
  // una segunda consulta sobre `contacto_interacciones`: escrita dos veces, el sync
  // podria traer el gasto de una campana que la pantalla no muestra, o al reves.
  let q = supabase
    .from('v_marketing_campana')
    .select('workspace_id, campaign_id')
    .not('campaign_id', 'is', null);
  if (body.workspace_id) q = q.eq('workspace_id', body.workspace_id);
  const { data, error } = await q;

  if (error) {
    return new Response(JSON.stringify({ error: `lectura de campanas: ${error.message}` }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  // La vista tiene una fila por campana Y MES; aqui se pregunta una vez por campana.
  const pares = new Map<string, { workspaceId: string; campaignId: string }>();
  for (const f of (data ?? []) as Array<{ workspace_id: string; campaign_id: string }>) {
    pares.set(`${f.workspace_id}|${f.campaign_id}`, {
      workspaceId: f.workspace_id,
      campaignId: f.campaign_id,
    });
  }

  const ahoraISO = new Date().toISOString();
  const monedaPorCuenta = new Map<string, string | null>();
  const filas: FilaInsight[] = [];
  const errores: Array<{ campaign_id: string; motivo: string }> = [];
  let cortadoPorRateLimit = false;

  for (const { workspaceId, campaignId } of pares.values()) {
    if (cortadoPorRateLimit) break;

    const meta = await graph<CampanaMeta>(campaignId, { fields: 'name,account_id,status' }, token);
    if (!meta.ok) {
      if (meta.rateLimit) { cortadoPorRateLimit = true; break; }
      errores.push({ campaign_id: campaignId, motivo: meta.error ?? 'sin detalle' });
      continue;
    }

    const ins = await graph<{ data: TramoInsights[] }>(
      `${campaignId}/insights`,
      {
        fields: 'spend,impressions,clicks',
        date_preset: 'maximum',
        // El grano de la tabla es el mes, y es lo que alimenta la lente MES del
        // tablero. La cohorte se obtiene sumando los meses, no pidiendo otro total:
        // dos fuentes para la misma cifra terminan discrepando.
        time_increment: 'monthly',
      },
      token,
    );
    if (!ins.ok) {
      if (ins.rateLimit) { cortadoPorRateLimit = true; break; }
      errores.push({ campaign_id: campaignId, motivo: ins.error ?? 'sin detalle' });
      continue;
    }

    const cuenta = meta.datos?.account_id ?? null;
    if (cuenta && !monedaPorCuenta.has(cuenta)) {
      const acc = await graph<{ currency?: string }>(`act_${cuenta}`, { fields: 'currency' }, token);
      monedaPorCuenta.set(cuenta, acc.ok ? (acc.datos?.currency ?? null) : null);
    }

    filas.push(...filasParaUpsert({
      workspaceId,
      campaignId,
      meta: meta.datos ?? {},
      tramos: ins.datos?.data ?? [],
      currency: cuenta ? (monedaPorCuenta.get(cuenta) ?? null) : null,
      ahoraISO,
    }));

    await dormir(PAUSA_MS);
  }

  // ⚠️ `upsert` por (workspace, campana, mes): el mes se REESCRIBE entero, nunca se
  // suma sobre lo que habia. Meta ajusta cifras de dias ya cerrados, asi que acumular
  // produciria un gasto que crece solo en cada corrida.
  let escritas = 0;
  if (filas.length > 0) {
    const { error: errUp } = await supabase
      .from('campana_insights')
      .upsert(filas, { onConflict: 'workspace_id,campaign_id,mes' });
    if (errUp) {
      return new Response(
        JSON.stringify({ error: `upsert: ${errUp.message}`, filas: filas.length }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
    escritas = filas.length;
  }

  const conflicto = monedasEnConflicto([...monedaPorCuenta.values()]);

  return new Response(
    JSON.stringify({
      ok: true,
      campanas: pares.size,
      filas_escritas: escritas,
      cuentas: Object.fromEntries(monedaPorCuenta),
      // Si sale con algo dentro, la pantalla estaria sumando pesos con dolares.
      monedas_en_conflicto: conflicto,
      corte_por_rate_limit: cortadoPorRateLimit,
      errores,
      sincronizado_at: ahoraISO,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
