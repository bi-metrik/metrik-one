// Reglas puras del sync de gasto de Meta. Viven aparte de `index.ts` para poder
// probarlas sin red y sin base: lo que decide si una cifra de dinero queda bien
// guardada es esto, no la llamada HTTP.

export interface TramoInsights {
  /** Primer dia del tramo que Meta reporta. Con `time_increment=monthly` nunca cruza de mes. */
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
}

export interface CampanaMeta {
  name?: string;
  account_id?: string;
  status?: string;
}

export interface FilaInsight {
  workspace_id: string;
  campaign_id: string;
  campaign_name: string | null;
  account_id: string | null;
  status: string | null;
  currency: string | null;
  mes: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  sincronizado_at: string;
}

/**
 * El mes al que pertenece un tramo.
 *
 * Meta arranca el primer tramo el dia que la campana empezo a gastar
 * (`2026-06-09`), no el primero del mes. El grano de `campana_insights` es el MES,
 * asi que se trunca. Con `time_increment=monthly` un tramo nunca cruza de mes, de
 * modo que truncar por `date_start` no pierde ni mezcla gasto.
 */
export function mesDeTramo(dateStart: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStart);
  if (!m) throw new Error(`fecha de tramo inesperada: ${dateStart}`);
  return `${m[1]}-${m[2]}-01`;
}

/** Un numero de Meta llega como cadena. Vacio, ausente o ilegible NO es cero. */
export function numeroDeMeta(v: string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Las filas que hay que escribir para una campana.
 *
 * ⚠️ El gasto se RE-LEE, no se acumula: cada corrida reescribe el mes completo,
 * porque Meta ajusta cifras de dias ya cerrados. Por eso esto devuelve el estado
 * que debe quedar, no un delta.
 *
 * ⚠️ Un tramo sin `spend` legible se descarta en vez de guardarse como 0: un cero
 * en una columna de dinero se lee como "no gasto", que es una afirmacion, y aqui
 * lo unico cierto seria "no se pudo leer".
 */
export function filasParaUpsert(args: {
  workspaceId: string;
  campaignId: string;
  meta: CampanaMeta;
  tramos: TramoInsights[];
  currency: string | null;
  ahoraISO: string;
}): FilaInsight[] {
  const { workspaceId, campaignId, meta, tramos, currency, ahoraISO } = args;
  const filas: FilaInsight[] = [];
  for (const t of tramos) {
    if (!t.date_start) continue;
    const spend = numeroDeMeta(t.spend);
    if (spend === null) continue;
    filas.push({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      campaign_name: meta.name ?? null,
      account_id: meta.account_id ?? null,
      status: meta.status ?? null,
      currency,
      mes: mesDeTramo(t.date_start),
      spend,
      impressions: numeroDeMeta(t.impressions),
      clicks: numeroDeMeta(t.clicks),
      sincronizado_at: ahoraISO,
    });
  }
  return filas;
}

/**
 * Si quien llama puede correr el sync.
 *
 * DOS credenciales validas, cualquiera abre:
 *
 * 1. El secreto compartido en el cuerpo (`META_INSIGHTS_SYNC_SECRET`, o el del
 *    handshake de Meta Lead Ads si aquel no existe).
 * 2. La service role key en `Authorization: Bearer`, que es la del cron.
 *
 * ⚠️ La (2) NO afloja la puerta: quien tenga la service role key ya puede escribir
 * `campana_insights` directo contra la base sin pasar por la funcion. Existe porque
 * el secreto compartido vive en los secretos del PROYECTO, que solo se escriben
 * desde el panel o con el CLI autenticado: sin ella, arrancar el sync depende de que
 * una persona entre a una pantalla, y el sync estuvo desplegado sin poder correr
 * exactamente por eso.
 *
 * ⚠️ Un valor ausente NUNCA autoriza. Si el secreto esperado no esta configurado, un
 * cuerpo sin `secret` tiene `undefined === undefined` y entraria: por eso cada rama
 * exige primero que el lado del servidor exista.
 */
export function credencialValida(args: {
  esperado: string | null | undefined;
  serviceKey: string | null | undefined;
  secretoEnCuerpo: string | null | undefined;
  authorization: string | null | undefined;
}): boolean {
  const { esperado, serviceKey, secretoEnCuerpo, authorization } = args;
  const bearer = authorization ? authorization.replace(/^Bearer\s+/i, '') : null;
  const porSecreto = Boolean(esperado) && secretoEnCuerpo === esperado;
  const porServiceKey = Boolean(serviceKey) && bearer === serviceKey;
  return porSecreto || porServiceKey;
}

/**
 * Las monedas de las cuentas que participan.
 *
 * SOENA tiene DOS cuentas publicitarias. Si una estuviera en USD y la otra en COP,
 * sumar sus gastos daria un numero sin significado — y la suma la hace la pantalla,
 * que no ve la moneda de cada fila. Por eso el sync lo declara y quien mira decide.
 */
export function monedasEnConflicto(monedas: Array<string | null>): string[] {
  const distintas = new Set(monedas.filter((m): m is string => Boolean(m)));
  return distintas.size > 1 ? [...distintas].sort() : [];
}
