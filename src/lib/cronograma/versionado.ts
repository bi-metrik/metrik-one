/**
 * Versionado del cronograma: QUÉ corta una versión y QUÉ no.
 *
 * La regla, en una línea: una versión se publica cuando cambia la PLANEACIÓN, nunca
 * cuando se registra AVANCE.
 *
 * Importa la distinción porque el documento que se le manda al cliente vive de ella.
 * Si mover la fecha de un paso atrasado no cortara versión, el plan se reescribiría
 * solo y la obra se vería puntual siempre. Y si marcar el inicio real de un paso
 * cortara versión, cada mañana de obra publicaría un documento nuevo y el cliente
 * recibiría veinte "cronogramas" que dicen lo mismo.
 *
 * Planeación: el paso (alta, baja, nombre), sus fechas planeadas, su responsable.
 * Avance:     las fechas reales y el completado.
 */

/** Un paso del cronograma, reducido a lo que define el plan. */
export interface PasoPlan {
  id: string
  orden: number
  label: string
  fecha_inicio: string | null
  fecha_fin: string | null
  responsable_id: string | null
  responsable_nombre?: string | null
}

/** Los campos que un guardado puede tocar. */
export interface CambioItem {
  label?: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
  responsable_id?: string | null
  fecha_inicio_real?: string | null
  fecha_fin_real?: string | null
  link_url?: string | null
  completado?: boolean
}

const CAMPOS_DE_PLANEACION = ['label', 'fecha_inicio', 'fecha_fin', 'responsable_id'] as const

/**
 * ¿Este guardado toca la planeación?
 *
 * Mira los campos PRESENTES, no los que cambiaron de valor: quien envía `fecha_fin` en
 * el payload está editando el plan aunque teclee la misma fecha. Un campo ausente no
 * dice nada, y `undefined` es ausente.
 */
export function tocaLaPlaneacion(cambio: CambioItem): boolean {
  return CAMPOS_DE_PLANEACION.some(c => cambio[c] !== undefined)
}

/** El plan congelado que se guarda en la versión. Ordenado, para que el diff sea estable. */
export function snapshotDePasos(pasos: PasoPlan[]): PasoPlan[] {
  return [...pasos]
    .sort((a, b) => a.orden - b.orden || a.label.localeCompare(b.label, 'es'))
    .map(p => ({
      id: p.id,
      orden: p.orden,
      label: p.label,
      fecha_inicio: p.fecha_inicio ?? null,
      fecha_fin: p.fecha_fin ?? null,
      responsable_id: p.responsable_id ?? null,
      responsable_nombre: p.responsable_nombre ?? null,
    }))
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// A mano y no con Intl: el mismo `es-CO` devuelve "6 de oct" o "06 oct" según el ICU
// que traiga el runtime, y estas frases terminan impresas en el documento del cliente.
const fmt = (f: string | null): string => {
  if (!f) return 'sin fecha'
  const [a, m, d] = f.slice(0, 10).split('-')
  const mes = MESES[Number(m) - 1]
  return a && mes && d ? `${d} ${mes}` : f
}

/**
 * Qué cambió entre dos versiones del plan, en frases que se puedan leer al pie del
 * documento. Sin adornos: quien lo lee es el cliente que recibe el cronograma nuevo y
 * quiere saber qué le movieron.
 */
export function describirCambios(antes: PasoPlan[], despues: PasoPlan[]): string[] {
  const previos = new Map(antes.map(p => [p.id, p]))
  const actuales = new Map(despues.map(p => [p.id, p]))
  const frases: string[] = []

  for (const paso of despues) {
    const previo = previos.get(paso.id)
    if (!previo) {
      frases.push(`Se agregó "${paso.label}"`)
      continue
    }
    if (previo.label !== paso.label) frases.push(`"${previo.label}" se renombró a "${paso.label}"`)
    if (previo.fecha_inicio !== paso.fecha_inicio) {
      frases.push(`"${paso.label}" arranca el ${fmt(paso.fecha_inicio)} (antes ${fmt(previo.fecha_inicio)})`)
    }
    if (previo.fecha_fin !== paso.fecha_fin) {
      frases.push(`"${paso.label}" termina el ${fmt(paso.fecha_fin)} (antes ${fmt(previo.fecha_fin)})`)
    }
    if (previo.responsable_id !== paso.responsable_id) {
      frases.push(`"${paso.label}" cambió de responsable`)
    }
  }

  for (const paso of antes) {
    if (!actuales.has(paso.id)) frases.push(`Se quitó "${paso.label}"`)
  }

  return frases
}

/** La versión vigente, tal como vive en la base. */
export interface VersionVigente {
  numero: number
  creado_por: string | null
  abierta_hasta: string | null
}

export type DecisionVersion =
  | { accion: 'crear'; numero: number }
  | { accion: 'acumular'; numero: number }

/**
 * ¿El cambio entra en la versión abierta o corta una nueva?
 *
 * Acumula mientras la ventana del mismo autor siga abierta. Crear los ocho pasos de una
 * obra es UNA sesión de planeación, no ocho publicaciones; pero mover una fecha la
 * semana siguiente sí es una versión nueva, porque el cliente ya recibió la anterior.
 */
export function decidirVersion(opciones: {
  vigente: VersionVigente | null
  autorId: string | null
  ahora: Date
}): DecisionVersion {
  const { vigente, autorId, ahora } = opciones
  if (!vigente) return { accion: 'crear', numero: 1 }

  const ventanaViva =
    vigente.abierta_hasta !== null && new Date(vigente.abierta_hasta).getTime() > ahora.getTime()
  const mismoAutor = vigente.creado_por === autorId

  return ventanaViva && mismoAutor
    ? { accion: 'acumular', numero: vigente.numero }
    : { accion: 'crear', numero: vigente.numero + 1 }
}

/** Cuánto dura abierta una sesión de planeación. */
export const VENTANA_EDICION_MIN = 30

export function cierreDeVentana(ahora: Date): string {
  return new Date(ahora.getTime() + VENTANA_EDICION_MIN * 60_000).toISOString()
}
