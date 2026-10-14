/**
 * Lo que la pantalla muestra del perfil de un contacto (`contacto_perfil_hechos`): en la ficha del
 * directorio (sección «Perfil», con Confirmar / Descartar / Agregar) y en el viaje (bloque «Ficha del
 * cliente», solo lo confirmado, de lectura). Puro.
 *
 * El vocabulario (dimensiones, estados, orígenes) es el mismo del bot: vive en
 * `supabase/functions/_shared/perfil-contacto.ts` y Next lo importa con su `.ts`.
 *
 * Los permisos son los de la sección de autorización (#1138): ver, todos menos `contador`; escribir
 * (agregar, confirmar, descartar), owner/admin/supervisor y el `operator` responsable del contacto o de
 * uno de sus viajes. Aquí se reusan, no se copian.
 */

import {
  DIMENSIONES_PERFIL,
  ETIQUETA_DIMENSION,
  esDimension,
  MAX_TEXTO_PERFIL,
  type DimensionPerfil,
  type EstadoPerfil,
  type OrigenPerfil,
} from '../../../supabase/functions/_shared/perfil-contacto.ts'
import { formatFecha } from '@/lib/dates/bogota'
import { puedePedirAutorizacion, puedeVerAutorizacion } from '@/lib/autorizacion-datos/vista'

export interface HechoPerfilVista {
  id: string
  dimension: DimensionPerfil
  texto: string
  estado: Exclude<EstadoPerfil, 'descartado'>
  origen: OrigenPerfil
  creadoAt: string
  confirmadoAt: string | null
}

/** Una fila de la tabla, tolerante: lo que no tiene la forma esperada no se muestra. */
export function hechoDeFila(f: Record<string, unknown>): HechoPerfilVista | null {
  if (typeof f.id !== 'string' || typeof f.texto !== 'string' || !esDimension(f.dimension)) return null
  if (f.estado !== 'sugerido' && f.estado !== 'confirmado') return null
  const origen = f.origen_tipo === 'bot_explicito' || f.origen_tipo === 'bot_conversacion' || f.origen_tipo === 'manual' ? f.origen_tipo : 'manual'
  return {
    id: f.id,
    dimension: f.dimension,
    texto: f.texto,
    estado: f.estado,
    origen,
    creadoAt: String(f.created_at ?? ''),
    confirmadoAt: typeof f.confirmado_at === 'string' ? f.confirmado_at : null,
  }
}

export interface GrupoPerfil {
  dimension: DimensionPerfil
  titulo: string
  hechos: HechoPerfilVista[]
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Agrupado por dimensión, en el orden del vocabulario; dentro, lo sugerido primero (espera a alguien) y luego por fecha. */
export function agruparPerfil(hechos: ReadonlyArray<HechoPerfilVista>): GrupoPerfil[] {
  return DIMENSIONES_PERFIL.map(dimension => ({
    dimension,
    titulo: mayuscula(ETIQUETA_DIMENSION[dimension]),
    hechos: hechos
      .filter(h => h.dimension === dimension)
      .sort((a, b) => (a.estado === b.estado ? a.creadoAt.localeCompare(b.creadoAt) : a.estado === 'sugerido' ? -1 : 1)),
  })).filter(g => g.hechos.length > 0)
}

const ORIGEN: Record<OrigenPerfil, string> = {
  bot_explicito: 'por el bot',
  bot_conversacion: 'de una conversación con el bot',
  manual: 'a mano',
}

const fecha = (iso: string | null) => (iso ? formatFecha(iso, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '' : '')

/** «por el bot · 12 oct 2026» / «de una conversación con el bot · sugerido el 12 oct 2026». */
export function lineaOrigen(h: HechoPerfilVista): string {
  if (h.estado === 'sugerido') return `${ORIGEN[h.origen]} · sugerido el ${fecha(h.creadoAt)}`
  return `${ORIGEN[h.origen]} · ${fecha(h.confirmadoAt ?? h.creadoAt)}`
}

/** Lo que una persona escribe a mano: la dimensión existe y el texto cabe (el mismo CHECK de la tabla). */
export function validarHechoManual(dimension: unknown, texto: unknown): { ok: true; dimension: DimensionPerfil; texto: string } | { ok: false; error: string } {
  if (!esDimension(dimension)) return { ok: false, error: 'Elige de qué se trata (preferencias, con quién viaja…).' }
  const t = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : ''
  if (!t) return { ok: false, error: 'Escribe qué quieres que se recuerde.' }
  if ([...t].length > MAX_TEXTO_PERFIL) return { ok: false, error: `Máximo ${MAX_TEXTO_PERFIL} caracteres.` }
  return { ok: true, dimension, texto: t }
}

/** Ver el perfil: los mismos roles que ven la autorización. */
export const puedeVerPerfil = puedeVerAutorizacion

/** Escribir en el perfil: los mismos que piden la autorización. */
export const puedeEditarPerfil = puedePedirAutorizacion

/** Las opciones del «Agregar», en el orden del vocabulario. */
export const OPCIONES_DIMENSION = DIMENSIONES_PERFIL.map(d => ({ value: d, label: mayuscula(ETIQUETA_DIMENSION[d]) }))
