/**
 * La carpeta del cerebro de un negocio (`negocios.metadata.carpeta_local`), lado de la
 * captura: formato, lectura, fusión con la metadata y quién puede escribirla.
 *
 * El GATE no vive aquí (ver `gate-carpeta-local.ts` y el trigger
 * `trg_zz_gate_carpeta_local`): la base solo exige que la clave tenga texto. Este módulo
 * pone la regla de FORMATO, que es de la aplicación, para que lo que se escribe desde la
 * pantalla sea una ruta del cerebro y no cualquier texto que destrabe el gate.
 *
 * Todo es puro para probarlo sin base. La lectura y la escritura contra Supabase están en
 * `carpeta-local-servidor.ts`.
 */
import { canAdvanceStage, type Area, type Stage, type UserContext } from '@/lib/permissions/can-edit'
import { puedeCorregirDocumentos } from '@/lib/roles'
import { CLAVE_EXIGIR_CARPETA_LOCAL, TIPO_BLOQUEO_CARPETA_LOCAL } from './gate-carpeta-local'

/** Clave dentro de `negocios.metadata`. Es la que lee el trigger. */
export const CLAVE_CARPETA_LOCAL = 'carpeta_local'

/**
 * Forma de la ruta: `proyectos/{cliente}/{proyecto}/`, dos niveles, minúsculas, dígitos y
 * guiones, con la barra final. Medido el 2026-09-14: los 42 valores vivos (todos de
 * `metrik`) ya la cumplen, así que no deja ninguno existente como inválido.
 */
export const FORMATO_CARPETA_LOCAL = /^proyectos\/[a-z0-9-]+\/[a-z0-9-]+\/$/

export const EJEMPLO_CARPETA_LOCAL = 'proyectos/cliente/proyecto/'

export const MENSAJE_FORMATO_CARPETA_LOCAL =
  'La carpeta debe tener la forma proyectos/{cliente}/{proyecto}/, con minúsculas, números y guiones.'

export type ResultadoCarpetaLocal =
  | { ok: true; carpeta: string | null }
  | { ok: false; error: string }

/**
 * Normaliza y valida lo que se escribió en el campo.
 *
 * - Vacío (o solo espacios) = borrar: `carpeta: null`, que quita la clave. Nunca se guarda
 *   un texto vacío.
 * - Sin barra final, se le agrega. Es lo único que se corrige: una mayúscula o un nivel de
 *   más no se "arreglan" en silencio, porque la ruta corregida podría ser otra carpeta.
 */
export function normalizarCarpetaLocal(entrada: string | null | undefined): ResultadoCarpetaLocal {
  const limpia = (entrada ?? '').trim()
  if (limpia === '') return { ok: true, carpeta: null }
  const conBarra = limpia.endsWith('/') ? limpia : `${limpia}/`
  if (!FORMATO_CARPETA_LOCAL.test(conBarra)) {
    return { ok: false, error: MENSAJE_FORMATO_CARPETA_LOCAL }
  }
  return { ok: true, carpeta: conBarra }
}

/**
 * La carpeta guardada, o `null` si no hay. Mismo criterio de "vacía" que el trigger: un
 * valor que no es texto, o un texto solo con espacios, no es una carpeta.
 */
export function leerCarpetaLocal(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const valor = (metadata as Record<string, unknown>)[CLAVE_CARPETA_LOCAL]
  if (typeof valor !== 'string') return null
  const limpia = valor.trim()
  return limpia === '' ? null : limpia
}

/**
 * La metadata con la carpeta puesta (o QUITADA si `carpeta` es null). El resto de las
 * claves se conserva tal cual: `metadata` guarda marcas de otros procesos (Siigo,
 * reproceso, desenlaces, avisos) y ninguna escritura de la carpeta puede tocarlas.
 */
export function conCarpetaLocal(metadata: unknown, carpeta: string | null): Record<string, unknown> {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  if (carpeta === null) {
    delete base[CLAVE_CARPETA_LOCAL]
    return base
  }
  base[CLAVE_CARPETA_LOCAL] = carpeta
  return base
}

/**
 * El modal del gate ofrece escribir la carpeta en vez de solo decir "no se puede omitir".
 *
 * Gana sobre el aviso de no omitible a propósito: este bloqueo TAMBIÉN es no omitible, y si
 * esa rama se evaluara primero el modal volvería a quedarse sin salida.
 */
export function gateSeResuelveConCarpeta(bloques: ReadonlyArray<{ tipo?: string }>): boolean {
  return bloques.some(b => b.tipo === TIPO_BLOQUEO_CARPETA_LOCAL)
}

/** El workspace pide la carpeta. Solo el booleano JSON `true`, igual que el trigger. */
export function exigeCarpetaLocal(configExtra: unknown): boolean {
  if (!configExtra || typeof configExtra !== 'object' || Array.isArray(configExtra)) return false
  return (configExtra as Record<string, unknown>)[CLAVE_EXIGIR_CARPETA_LOCAL] === true
}

export type NegocioParaCarpetaLocal = {
  /** `negocios.stage_actual`. */
  stage: Stage | null
  /** `negocio_responsables.staff_id`. */
  responsables: string[]
  /** `config_extra.areas_que_avanzan` de la etapa actual. */
  areasQueAvanzan?: Area[]
}

/**
 * Quién puede escribir la carpeta: quien puede avanzar el negocio desde su etapa actual
 * (el mismo predicado del guard de `cambiarEtapaNegocioConGate`), más los roles que
 * corrigen datos del negocio (owner/admin/supervisor, como el nombre).
 *
 * La primera mitad no es opcional: el modal del gate se le abre justo a quien pasó ese
 * guard, y ofrecerle una carpeta que después no puede guardar dejaría el gate sin salida.
 */
export function puedeEditarCarpetaLocal(user: UserContext, negocio: NegocioParaCarpetaLocal): boolean {
  if (puedeCorregirDocumentos(user.role)) return true
  // Mismo respaldo que el guard del avance: un negocio sin stage se juzga como venta.
  return canAdvanceStage(user, negocio.stage ?? 'venta', negocio.responsables, negocio.areasQueAvanzan)
}
