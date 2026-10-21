// ============================================================
// Asistente público — aviso de bot y autorizaciones de datos, en código (§5, decisión E1)
// ------------------------------------------------------------
// Tres pasos con textos fijos que el modelo no genera:
//   1. `rf.bienvenida`: aviso de bot y términos en la primera respuesta, al volver de una persona y tras una pausa
//      larga. Solo informa: no autoriza a tomar datos.
//   2. `rf.autorizacion` (Sí / No) antes de tomar nombre, cédula y teléfono. Solo cuenta un «sí» escrito solo o el
//      botón Sí, leídos por el código. El silencio no cuenta (Decreto 1377 de 2013, arts. 7 y 8).
//   3. `rf.autorizacion_sensible` (Sí / No), aparte y facultativa, si aparece una restricción alimentaria (Anexo 5.3).
// La prueba de cada paso: fecha, canal, versión y huella sha256 del texto mostrado, el mensaje de respuesta y su id en
// Chatwoot. Queda en la traza del turno y en `chatwoot_consentimientos`.
//
// Todo se deriva de la conversación (las trazas de sus filas): sin estado aparte que se pueda desincronizar. Puro
// salvo WebCrypto.
// ============================================================

import { esSiSolo } from '../nucleo.ts';
import { respuestaFija } from '../reglamento.ts';
import type { Reglamento, Salida } from '../tipos.ts';
import type { EventoAutorizacion, FilaPublica, TipoAutorizacion, TrazaPublica } from './tipos.ts';

export const RF_BIENVENIDA = 'rf.bienvenida';
export const RF_AUTORIZACION = 'rf.autorizacion';
export const RF_AUTORIZACION_SENSIBLE = 'rf.autorizacion_sensible';
export const PREFIJO_AUTORIZACION = 'ag|a|';

export const CLAVE_TEXTO: Record<TipoAutorizacion, string> = { general: RF_AUTORIZACION, sensible: RF_AUTORIZACION_SENSIBLE };

export async function huellaTexto(t: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** «no» escrito solo. Pura. */
export function esNoSolo(texto: string | null | undefined): boolean {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '') === 'no';
}

/** La versión de una respuesta fija (en `valores.version` de su ficha) o `sin-version`. Pura. */
export function versionDe(r: Reglamento, clave: string): string {
  const v = r.fichas.find((f) => f.clave === clave)?.valores?.version;
  return typeof v === 'string' && v ? v : `v${r.version}`;
}

/** El texto de una respuesta fija con sus marcas reemplazadas (`{nombre}`, `{link}`). Pura. */
export function textoFijo(r: Reglamento, clave: string, vars: Record<string, string> = {}): string {
  return respuestaFija(r, clave).replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** La salida con botones Sí / No de una autorización. Los ids los lee el código, nunca el modelo. Pura. */
export function salidaAutorizacion(r: Reglamento, tipo: TipoAutorizacion, vars: Record<string, string>): Salida {
  return {
    tipo: 'botones',
    texto: textoFijo(r, CLAVE_TEXTO[tipo], vars),
    opciones: [
      { id: `${PREFIJO_AUTORIZACION}${tipo}|si`, titulo: 'Sí' },
      { id: `${PREFIJO_AUTORIZACION}${tipo}|no`, titulo: 'No' },
    ],
  };
}

const trazas = (filas: FilaPublica[]): Array<{ f: FilaPublica; t: TrazaPublica }> =>
  filas.filter((f) => f.traza).map((f) => ({ f, t: f.traza as TrazaPublica }));

export type EstadoAutorizacion =
  | { estado: 'no_pedida' }
  | { estado: 'pedida'; at: string }
  | { estado: 'si'; at: string; evento: EventoAutorizacion }
  | { estado: 'no'; at: string };

/** El estado de una autorización en la conversación: la última respuesta leída manda. Pura. */
export function estadoAutorizacion(filas: FilaPublica[], tipo: TipoAutorizacion): EstadoAutorizacion {
  let e: EstadoAutorizacion = { estado: 'no_pedida' };
  for (const { f, t } of trazas(filas)) {
    if (t.autorizacion?.tipo === tipo) {
      e = t.autorizacion.respuesta === 'si' ? { estado: 'si', at: t.autorizacion.at, evento: t.autorizacion } : { estado: 'no', at: t.autorizacion.at };
    }
    if (t.pide_autorizacion === tipo && e.estado !== 'si') e = { estado: 'pedida', at: f.created_at };
  }
  return e;
}

/** La autorización que espera respuesta: la que pidió el ÚLTIMO turno que publicó algo. Pura. */
export function autorizacionEnEspera(filas: FilaPublica[]): TipoAutorizacion | null {
  const ultimo = trazas(filas).filter(({ t }) => t.salida || t.pide_autorizacion).at(-1);
  return ultimo?.t.pide_autorizacion ?? null;
}

/** ¿El mensaje responde sí o no a una autorización? Solo el botón o «sí»/«no» escrito solo. Pura. */
export function respuestaA(tipo: TipoAutorizacion, f: Pick<FilaPublica, 'clase' | 'texto' | 'toque_id'>): 'si' | 'no' | null {
  if (f.toque_id?.startsWith(PREFIJO_AUTORIZACION)) {
    const [t, r] = f.toque_id.slice(PREFIJO_AUTORIZACION.length).split('|');
    if (t === tipo && (r === 'si' || r === 'no')) return r;
    return null;
  }
  if (f.clase !== 'escrito' && f.clase !== 'toque') return null;
  if (esSiSolo(f.texto)) return 'si';
  if (esNoSolo(f.texto)) return 'no';
  return null;
}

/** El evento de autorización con su prueba (versión y huella del texto que se mostró). */
export async function eventoAutorizacion(p: {
  r: Reglamento; tipo: TipoAutorizacion; respuesta: 'si' | 'no'; fila: FilaPublica; vars: Record<string, string>; ahoraIso: string;
}): Promise<EventoAutorizacion> {
  const clave = CLAVE_TEXTO[p.tipo];
  return {
    tipo: p.tipo, respuesta: p.respuesta, mensaje_id: p.fila.wa_message_id ?? null, mensaje_texto: String(p.fila.texto ?? '').slice(0, 200),
    texto_clave: clave, texto_version: versionDe(p.r, clave), texto_huella: await huellaTexto(textoFijo(p.r, clave, p.vars)), at: p.ahoraIso,
  };
}

// ── El aviso de bot ──────────────────────────────────────────────────────────

/**
 * ¿Va el aviso de bot en esta respuesta? En la primera respuesta, cuando vuelve de una persona y tras una pausa larga
 * (Meta lo exige en esos tres momentos). `pendientes`: las filas que este turno atiende. Pura.
 */
export function motivoAviso(filas: FilaPublica[], pendientes: Set<string>, ahoraMs: number, pausaHoras: number): 'primero' | 'vuelve_de_persona' | 'pausa_larga' | null {
  const ts = trazas(filas);
  const ultimoAviso = ts.filter(({ t }) => t.aviso).at(-1);
  if (!ultimoAviso) return 'primero';
  const persona = ts.filter(({ t }) => t.persona).at(-1);
  if (persona && Date.parse(persona.f.created_at) >= Date.parse(ultimoAviso.f.created_at)) return 'vuelve_de_persona';
  const previos = filas.filter((f) => !pendientes.has(f.id));
  const ultimoPrevio = previos.at(-1);
  const primeroNuevo = filas.find((f) => pendientes.has(f.id));
  if (ultimoPrevio && primeroNuevo && Date.parse(primeroNuevo.created_at) - Date.parse(ultimoPrevio.created_at) > pausaHoras * 3600 * 1000) return 'pausa_larga';
  void ahoraMs;
  return null;
}

/** Junta el aviso con la respuesta en un solo mensaje (en WhatsApp cada mensaje se cobra). Pura. */
export function conAviso(aviso: string, s: Salida): Salida {
  return { ...s, texto: [aviso, s.texto].filter(Boolean).join('\n\n') };
}
