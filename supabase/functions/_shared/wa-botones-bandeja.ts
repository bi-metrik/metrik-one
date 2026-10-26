// ============================================================
// Botones de respuesta de la bandeja — las reglas, sin I/O
// ------------------------------------------------------------
// Pedido de Mauricio en su prueba del 2026-10-05: «El sí sea un botón y haya otro de descartar». El resumen de la
// tanda (y las confirmaciones de sí/no de la bandeja) salen con botones de respuesta de WhatsApp. El id del botón
// dice a qué pregunta pertenece, para que un toque viejo (de un resumen ya reemplazado por una corrección, de otra
// tanda o de una tanda que ya se cerró) no confirme nada:
//
//   bdj|r|<accion>|<entregaId>|<versión>   el resumen de una entrega; la versión es la huella del reparto
//   bdj|p|<accion>|<entendimientoId>|-     una confirmación del entendimiento («¿Seguro que van en …?»,
//                                          «¿Es una solicitud de viaje?», «¿Es la misma persona?»)
//   bdj|t|<accion>|<entregaId>|<versión>   lo que espera la caja abierta («¿Es la misma persona?» de la llave)
//
// Un toque vigente se contesta EXACTAMENTE como su texto escrito («sí», «no», «descartar») por el mismo camino de
// hoy: no pasa por el modelo ni por la lectura del «sí» escrito (no hay reservas que leer en un botón).
// ============================================================

/** Lo que dice un botón. `si` y `no` contestan la pregunta; `des` la descarta. */
export type AccionBoton = 'si' | 'no' | 'des';
export type CapaBoton = 'r' | 'p' | 't';

export interface BotonBandeja { id: string; title: string }

export interface ToqueBandeja { capa: CapaBoton; accion: AccionBoton; ref: string; version: string }

/** Límites de Meta para los botones de respuesta. */
export const MAX_CUERPO_BOTONES = 1024;
export const MAX_TITULO_BOTON = 20;
const MAX_ID_BOTON = 256;

/** Los títulos (cortos y claros; caben en los 20 caracteres de Meta). */
export const TITULO_CARGAR = '✅ Cargar';
export const TITULO_DESCARTAR = '🗑 Descartar';
export const TITULO_SI_ES = '✅ Sí, es la misma';
export const TITULO_NO_ES = '❌ No, es otra';
export const TITULO_SI_CARGARLOS = '✅ Sí, cargarlos';
export const TITULO_SI_CREALO = '✅ Sí, créalo';

const PREFIJO = 'bdj';

/** El id de un botón de la bandeja. */
export function idBoton(capa: CapaBoton, accion: AccionBoton, ref: string, version = '-'): string {
  const id = [PREFIJO, capa, accion, ref, version || '-'].join('|');
  return id.length <= MAX_ID_BOTON ? id : id.slice(0, MAX_ID_BOTON);
}

/** ¿Es un botón de la bandeja? (Lo demás sigue por donde va hoy.) */
export function esBotonDeBandeja(id: string | null | undefined): boolean {
  return String(id ?? '').startsWith(`${PREFIJO}|`);
}

/** Lee el id de un botón de la bandeja. `null`: no es uno, o está mal formado. */
export function leerToque(id: string | null | undefined): ToqueBandeja | null {
  const partes = String(id ?? '').split('|');
  if (partes.length !== 5 || partes[0] !== PREFIJO) return null;
  const [, capa, accion, ref, version] = partes;
  if (!['r', 'p', 't'].includes(capa) || !['si', 'no', 'des'].includes(accion) || !ref) return null;
  return { capa: capa as CapaBoton, accion: accion as AccionBoton, ref, version };
}

/** El texto escrito que equivale a un toque: el mismo que ya lee el código de hoy. */
export function canonicoDelToque(accion: AccionBoton): string {
  return accion === 'si' ? 'sí' : accion === 'no' ? 'no' : 'descartar';
}

/**
 * La huella de un reparto: cambia con cualquier corrección («el 3 es de Luisa», «quita el 2»). Con las claves
 * ordenadas, porque la base (jsonb) no guarda el orden en que se escribieron.
 */
export function huella(valor: unknown): string {
  const s = estable(valor);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function estable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${estable(o[k])}`).join(',')}}`;
}

/** Botones de una confirmación de sí/no (`p` o `t`): el «sí» con su título y, si va, el «no» o el «descartar». */
export function botonesSiNo(capa: 'p' | 't', ref: string, titulos: { si: string; no?: string; des?: boolean }, version = '-'): BotonBandeja[] {
  const b: BotonBandeja[] = [{ id: idBoton(capa, 'si', ref, version), title: titulos.si }];
  if (titulos.no) b.push({ id: idBoton(capa, 'no', ref, version), title: titulos.no });
  if (titulos.des) b.push({ id: idBoton(capa, 'des', ref, version), title: TITULO_DESCARTAR });
  return b;
}

/** Cuando el resumen no cabe en el cuerpo de los botones: el resumen va como texto y los botones en un mensaje corto. */
export const TEXTO_BOTONES_APARTE = '¿Lo cargo?';
export const TEXTO_BOTONES_APARTE_SIN_CARGAR = 'Si no va, descártalo:';

/** Lo que se dice ante un toque viejo. Nada se confirma ni se descarta. */
export const TEXTO_TOQUE_VIEJO = 'Ese botón es de un resumen anterior: no cargué ni descarté nada.';
export const TEXTO_TOQUE_CERRADO = 'Esa tanda ya se cerró: no cargué ni descarté nada.';
export const TEXTO_TOQUE_SIN_PREGUNTA = 'Ese botón es de una pregunta que ya no está abierta: no hice nada.';
