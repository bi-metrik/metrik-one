// ============================================================
// La memoria corta de la bandeja: el viaje en foco de cada remitente (2026-10-05)
// ------------------------------------------------------------
// Prueba de Mauricio (12:15–12:21): el bot cargó D1 26 1, y a las preguntas «¿qué faltaría para entregarlo completo?» y
// «pero faltan 4 puntos…» contestó «¿De qué viaje?», aunque era el único viaje de la conversación. El viaje en foco es
// el último que el bot cargó, mostró o nombró con ese remitente (o que el remitente nombró), dentro de una ventana
// corta (`minutosFoco` del workspace). Una pregunta o un dato sin referencia va a ese viaje; con dos en la ventana y
// un texto que no desempata, se pregunta una vez nombrando los dos.
//
// Tabla `wa_bandeja_conversacion` (una fila por remitente). Si no se puede leer o escribir, el bot sigue como hoy: la
// memoria nunca bloquea una respuesta.
// ============================================================

import type { SupabaseClient } from './types.ts';

/** Por qué un viaje quedó en foco. */
export type PorQueFoco = 'carga' | 'consulta' | 'nombrado';

export interface FocoViaje {
  negocio_id: string;
  /** ISO. */
  at: string;
  por: PorQueFoco;
  /** En una carga: cuántos datos del mínimo quedaron faltando (la respuesta a «me falta» va directo a este viaje). */
  faltan?: number;
}

/** El alcance de una pregunta por lo que falta: lo del mínimo para cotizar, lo de completo, o los dos. */
export type AlcanceConsulta = 'minimo' | 'completo' | 'ambos';

export interface ConsultaPendiente {
  /** Lo que preguntó: por lo que falta (con su alcance), o un dato que no se supo a qué viaje iba. */
  tipo: 'viaje' | 'dato';
  alcance?: AlcanceConsulta;
  /** Con `dato`: el escrito que espera su viaje, y los viajes entre los que se preguntó. */
  texto?: string;
  wamid?: string;
  enviadoAt?: string | null;
  candidatos?: string[];
  at: string;
}

const MAX_FOCOS = 5;
/** Una consulta que quedó esperando su viaje vale unos minutos: después, el siguiente escrito es otra cosa. */
export const MINUTOS_CONSULTA_PENDIENTE = 10;

/** El foco nuevo, primero; sin repetir el viaje; los últimos `MAX_FOCOS`. */
export function agregarFoco(focos: ReadonlyArray<FocoViaje>, nuevo: FocoViaje): FocoViaje[] {
  // Lo que faltaba tras la última carga se conserva cuando el mismo viaje vuelve a foco por una consulta.
  const antes = focos.find(f => f.negocio_id === nuevo.negocio_id);
  const conFaltan = nuevo.faltan === undefined && antes?.faltan !== undefined ? { ...nuevo, faltan: antes.faltan } : nuevo;
  return [conFaltan, ...focos.filter(f => f.negocio_id !== nuevo.negocio_id)].slice(0, MAX_FOCOS);
}

/** Los focos dentro de la ventana, del más reciente al más viejo. */
export function focosVigentes(focos: ReadonlyArray<FocoViaje>, ahora: number, minutos: number): FocoViaje[] {
  return focos.filter(f => ahora - Date.parse(f.at) <= minutos * 60_000).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** El viaje en foco: uno solo en la ventana, dos (se pregunta), o ninguno. */
export function viajeEnFoco(
  focos: ReadonlyArray<FocoViaje>, ahora: number, minutos: number,
): { tipo: 'uno'; foco: FocoViaje } | { tipo: 'dos'; focos: [FocoViaje, FocoViaje] } | { tipo: 'ninguno' } {
  const v = focosVigentes(focos, ahora, minutos);
  if (v.length === 0) return { tipo: 'ninguno' };
  if (v.length === 1) return { tipo: 'uno', foco: v[0] };
  return { tipo: 'dos', focos: [v[0], v[1]] };
}

/** ¿La consulta pendiente sigue viva? */
export function consultaVigente(c: ConsultaPendiente | null | undefined, ahora: number): ConsultaPendiente | null {
  return c && ahora - Date.parse(c.at) <= MINUTOS_CONSULTA_PENDIENTE * 60_000 ? c : null;
}

// ── I/O ─────────────────────────────────────────────────────────────────────

export interface Conversacion { focos: FocoViaje[]; consulta: ConsultaPendiente | null }

/** La memoria del remitente. Si no se puede leer, vacía (la memoria nunca bloquea). */
export async function leerConversacion(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<Conversacion> {
  try {
    const { data, error } = await supabase.from('wa_bandeja_conversacion').select('focos, consulta_pendiente')
      .eq('workspace_id', workspaceId).eq('remitente_phone', phone).maybeSingle();
    if (error || !data) return { focos: [], consulta: null };
    return {
      focos: Array.isArray(data.focos) ? (data.focos as FocoViaje[]).filter(f => f && typeof f.negocio_id === 'string' && typeof f.at === 'string') : [],
      consulta: (data.consulta_pendiente ?? null) as ConsultaPendiente | null,
    };
  } catch (err) {
    console.error('[wa-foco] no se pudo leer la conversación:', err);
    return { focos: [], consulta: null };
  }
}

async function guardar(supabase: SupabaseClient, workspaceId: string, phone: string, cambios: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.from('wa_bandeja_conversacion').upsert({
      workspace_id: workspaceId, remitente_phone: phone, ...cambios, updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,remitente_phone' });
    if (error) console.error('[wa-foco] no se pudo guardar la conversación:', error.message);
  } catch (err) {
    console.error('[wa-foco] no se pudo guardar la conversación:', err);
  }
}

/** Pone un viaje en foco (lo cargó, lo mostró o lo nombró). */
export async function anotarFoco(
  supabase: SupabaseClient, workspaceId: string, phone: string, foco: Omit<FocoViaje, 'at'> & { at?: string },
): Promise<void> {
  const actual = await leerConversacion(supabase, workspaceId, phone);
  await guardar(supabase, workspaceId, phone, { focos: agregarFoco(actual.focos, { ...foco, at: foco.at ?? new Date().toISOString() }) });
}

/** Deja (o quita, con `null`) la consulta que espera saber de qué viaje es. */
export async function anotarConsultaPendiente(supabase: SupabaseClient, workspaceId: string, phone: string, consulta: ConsultaPendiente | null): Promise<void> {
  await guardar(supabase, workspaceId, phone, { consulta_pendiente: consulta });
}
