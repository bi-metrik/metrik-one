import type { Area } from '@/lib/permissions/can-edit'
import { getAreasEfectivas, type Role } from '@/lib/permissions/can-edit'

/**
 * Un gate que puede quedar en "no aplica" cuando su paso perdió su objeto.
 *
 * Opt-in por bloque: `config_extra.omitible_por = { areas, motivo, label }`.
 * Sin la marca, el gate se comporta como siempre: retiene hasta completarse.
 *
 * POR QUÉ EXISTE, y por qué NO es "saltarse un control". Caso que lo motivó
 * (SOENA, etapa Notificación): el comercial avisa al cliente que la DIAN le
 * enviará un enlace para agendar. Si la DIAN asigna la cita ANTES de que ese
 * aviso salga, avisar del enlace ya no le sirve de nada a nadie: el paso venció.
 * Operaciones, que es quien registra la fecha, puede seguir adelante.
 *
 * ⚠️ El pendiente NO se borra ni se da por hecho: queda marcado como "no aplica"
 * con motivo, autor y fecha. Si quedara como pendiente eterno, después nadie
 * puede distinguir un incumplimiento de un proceso que se adelantó, y el
 * indicador de "avisos al cliente" deja de medir algo.
 *
 * ⚠️ Y NO todo gate es omitible: el de la fecha de la cita no lo es. Un dato que
 * el proceso necesita aguas abajo no vence nunca — la diferencia está en si el
 * paso perdió su objeto o simplemente no se hizo.
 */

export type OmitiblePor = {
  areas?: Area[]
  /** Clave estable del motivo, para poder contarlos después. */
  motivo?: string
  /** Lo que ve el usuario en el bloque y en el timeline. */
  label?: string
}

export type MarcaOmitido = {
  motivo: string
  label: string
  por_id: string | null
  por_nombre: string | null
  fecha: string
}

/** Clave donde vive la marca dentro de `negocio_bloques.data`. */
export const CLAVE_OMITIDO = '_omitido' as const

/**
 * ¿Este usuario puede dejar ESTE gate en "no aplica"?
 *
 * Se decide por ÁREA, no por rol: quien puede declarar vencido el paso es quien
 * trabaja el hecho que lo vence (aquí, quien ya tiene la cita en la mano).
 */
export function puedeOmitirGate(
  configExtra: Record<string, unknown> | null | undefined,
  usuario: { role: Role; areas: Area[] },
): boolean {
  const cfg = (configExtra as { omitible_por?: OmitiblePor } | null)?.omitible_por
  if (!cfg?.areas?.length) return false
  // read_only y contador están fuera del modelo de edición: tampoco omiten.
  if (usuario.role === 'read_only' || usuario.role === 'contador') return false
  const efectivas = getAreasEfectivas({ id: '', role: usuario.role, areas: usuario.areas })
  return cfg.areas.some(a => efectivas.has(a))
}

/** Texto y motivo declarados por el bloque, con respaldo si la config viene corta. */
export function describirOmision(
  configExtra: Record<string, unknown> | null | undefined,
): { motivo: string; label: string } {
  const cfg = (configExtra as { omitible_por?: OmitiblePor } | null)?.omitible_por
  return {
    motivo: cfg?.motivo ?? 'no_aplica',
    label: cfg?.label ?? 'No aplica',
  }
}

/** Construye la marca que se guarda en el `data` del bloque. */
export function marcaOmitido(
  configExtra: Record<string, unknown> | null | undefined,
  autor: { id: string | null; nombre: string | null },
  ahora: string,
): MarcaOmitido {
  const { motivo, label } = describirOmision(configExtra)
  return { motivo, label, por_id: autor.id, por_nombre: autor.nombre, fecha: ahora }
}

/** ¿Este bloque quedó marcado como "no aplica"? (para pintarlo distinto de "completo"). */
export function estaOmitido(data: Record<string, unknown> | null | undefined): MarcaOmitido | null {
  const m = (data as Record<string, unknown> | null)?.[CLAVE_OMITIDO]
  if (!m || typeof m !== 'object') return null
  return m as MarcaOmitido
}
