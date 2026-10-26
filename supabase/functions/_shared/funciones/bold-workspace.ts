// ============================================================
// Funciones — Bold con las llaves DEL WORKSPACE (bóveda de llaves, 26-oct). Lo comparten el panel (Next) y el
// asistente (Edge Function, Deno): sin `node:` ni `Deno.`, solo `fetch` y WebCrypto.
// ------------------------------------------------------------
// Doc oficial de Bold, consultada el 2026-10-26:
//   · API Link de pagos (https://developers.bold.co/pagos-en-linea/api-link-de-pagos): `Authorization: x-api-key
//     <llave de identidad>` contra https://integrations.api.bold.co. `reference` es opcional: sin ella Bold asigna el
//     `LNK_…`, que es lo que ONE guarda como referencia del pago. `GET /online/link/v1/{LNK}` trae `status` e
//     `is_sandbox`. `GET /online/link/v1/payment_methods` no lleva parámetros: es la prueba de conexión.
//   · Webhook (https://developers.bold.co/webhook): en un pago de link (`integration: LINK`) `data.metadata.reference`
//     es el `LNK_…`. Firma `x-bold-signature` = hex(HMAC-SHA256(llave secreta, base64(cuerpo crudo))). EN PRUEBAS la
//     llave es la cadena vacía, y el webhook de un link de prueba no sale solo: se manda con «Probar el webhook» del
//     recibo.
//
// LA REGLA: sin las llaves del workspace no hay pasarela. Nada de este archivo lee variables de entorno: la llave de
// MéTRIK (`BOLD_IDENTITY_KEY`, cuotas de las suscripciones) no tiene cómo llegar aquí.
//
// Ninguna llave sale de este archivo: no va en errores, ni en lo que se devuelve, ni en logs (`sinLlaves`).
// ============================================================

import { pasarelaBold, type CuerpoLinkBold, type PasarelaPagos } from './pasarela.ts';

export const BOLD_API_BASE = 'https://integrations.api.bold.co';

/** Las claves de Bold en la bóveda (`ws:<workspace_id>:<clave>` en Vault). */
export const CLAVES_BOLD = {
  identidad: 'bold_identity_key',
  secreta: 'bold_secret_key',
  /** La secreta que se reemplazó: solo verifica firmas de los links de la cuenta anterior, unos días. */
  secretaAnterior: 'bold_secret_key_anterior',
} as const;

/** Cuánto sigue valiendo la secreta anterior después de un cambio de cuenta (los reintentos de Bold duran ~37 h). */
export const DIAS_SECRETA_ANTERIOR = 7;

const TIMEOUT_MS = 10_000;
const RE_LINK = /^LNK_[A-Za-z0-9]+$/;

export interface LlavesBold {
  identidad?: string | null;
  secreta?: string | null;
  secretaAnterior?: string | null;
}

type Fetch = typeof fetch;

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/** Quita del texto cualquier llave conocida. Todo mensaje que sale de aquí pasa por esto. */
export function sinLlaves(mensaje: string, llaves: Array<string | null | undefined>): string {
  let m = mensaje;
  for (const l of llaves) if (l && l.length >= 4) m = m.split(l).join('[llave]');
  return m;
}

function mensajeDeErrores(cuerpo: unknown): string | null {
  const errores = (cuerpo as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errores) || errores.length === 0) return null;
  return errores
    .map((e) => (typeof e === 'string' ? e : String((e as Record<string, unknown>)?.message ?? (e as Record<string, unknown>)?.code ?? 'error')))
    .join('; ')
    .slice(0, 200);
}

/** El `enviar` del adaptador: crea el link con la llave de identidad del workspace. Lanza con un mensaje sin la llave. */
export function enviarConLlave(identidad: string, f: Fetch = fetch) {
  return async (cuerpo: CuerpoLinkBold): Promise<{ referencia: string; url: string } | null> => {
    let res: Response;
    try {
      res = await f(`${BOLD_API_BASE}/online/link/v1`, {
        method: 'POST',
        headers: { Authorization: `x-api-key ${identidad}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(sinLlaves(`bold_sin_conexion: ${(e as Error).message}`, [identidad]));
    }
    const json = await res.json().catch(() => null);
    const errores = mensajeDeErrores(json);
    if (!res.ok || errores) throw new Error(sinLlaves(`bold_rechazo HTTP ${res.status}${errores ? `: ${errores}` : ''}`, [identidad]));
    const payload = (json as { payload?: { payment_link?: unknown; url?: unknown } } | null)?.payload;
    const referencia = typeof payload?.payment_link === 'string' ? payload.payment_link : '';
    const url = typeof payload?.url === 'string' ? payload.url : '';
    if (!RE_LINK.test(referencia) || !/^https:\/\/\S+$/.test(url) || url.length > 1000) return null;
    return { referencia, url };
  };
}

/** La pasarela con estas llaves, o `null` si no hay llave de identidad. Nunca otra llave. */
export function pasarelaConLlaves(llaves: LlavesBold, f: Fetch = fetch): PasarelaPagos | null {
  const identidad = texto(llaves.identidad);
  return identidad ? pasarelaBold(enviarConLlave(identidad, f)) : null;
}

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

/** Las llaves de Bold del workspace, leídas de Vault con service role. `{}` si no tiene. Lanza si la base falla. */
export async function llavesBoldDelWorkspace(cliente: ClienteRpc, workspaceId: string): Promise<LlavesBold> {
  const { data, error } = await cliente.rpc('leer_secretos_workspace', { p_workspace_id: workspaceId });
  if (error) {
    if (error.code === 'PGRST202') return {};
    throw new Error(`no se pudieron leer las llaves del workspace ${workspaceId}: ${error.code ?? 'error'}`);
  }
  const crudo = (data ?? {}) as Record<string, unknown>;
  return {
    identidad: texto(crudo[CLAVES_BOLD.identidad]),
    secreta: texto(crudo[CLAVES_BOLD.secreta]),
    secretaAnterior: texto(crudo[CLAVES_BOLD.secretaAnterior]),
  };
}

/**
 * LA pasarela de un workspace, para el panel y para el asistente: la de SUS llaves, o `null`. Se lee en cada llamada
 * (sin caché): borrar la llave en la bóveda desconecta de inmediato.
 */
export async function pasarelaDeWorkspace(cliente: ClienteRpc, workspaceId: string, f: Fetch = fetch): Promise<PasarelaPagos | null> {
  return pasarelaConLlaves(await llavesBoldDelWorkspace(cliente, workspaceId), f);
}

/** «Probar conexión»: ¿Bold acepta esta llave de identidad? Solo sí o no; nunca el detalle (podría traer la llave). */
export async function probarConexionBold(identidad: string, f: Fetch = fetch): Promise<boolean> {
  try {
    const res = await f(`${BOLD_API_BASE}/online/link/v1/payment_methods`, {
      headers: { Authorization: `x-api-key ${identidad}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Estado de un link (`ACTIVE`, `PAID`, `EXPIRED`…) y si es del ambiente de pruebas. `null` si Bold no lo devuelve. */
export async function consultarLinkBold(
  identidad: string,
  link: string,
  f: Fetch = fetch,
): Promise<{ estado: string; sandbox: boolean; total: number | null } | null> {
  if (!RE_LINK.test(link)) return null;
  try {
    const res = await f(`${BOLD_API_BASE}/online/link/v1/${encodeURIComponent(link)}`, {
      headers: { Authorization: `x-api-key ${identidad}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) return null;
    const d = (json.payload && typeof json.payload === 'object' ? json.payload : json) as Record<string, unknown>;
    return { estado: String(d.status ?? ''), sandbox: d.is_sandbox === true, total: typeof d.total === 'number' ? d.total : null };
  } catch {
    return null;
  }
}

// ── Firma del webhook ────────────────────────────────────────────────────────

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** hex(HMAC-SHA256(llave, base64(cuerpo crudo))). La llave puede ser vacía: así firma Bold en pruebas. */
export async function firmaBold(cuerpoCrudo: string, llave: string): Promise<string> {
  const enc = new TextEncoder();
  // WebCrypto no acepta una llave HMAC de largo cero; HMAC rellena con ceros hasta el bloque, así que un byte 0 da
  // exactamente la misma firma que la llave vacía.
  const material = llave.length > 0 ? enc.encode(llave) : new Uint8Array([0]);
  const k = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(base64Utf8(cuerpoCrudo))));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante (sobre dos hex de 64). */
function igualesSinFiltrarTiempo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function firmaBoldValida(cuerpoCrudo: string, recibida: string | null | undefined, llave: string): Promise<boolean> {
  if (!recibida) return false;
  return igualesSinFiltrarTiempo(await firmaBold(cuerpoCrudo, llave), recibida.trim().toLowerCase());
}
