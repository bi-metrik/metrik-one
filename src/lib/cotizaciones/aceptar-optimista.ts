/**
 * «Aceptar» UNO en la cotización por pasos: el bloque se pinta en el acto (V2 de la verificación
 * D de Vera: del clic al bloque visible, p50 < 1 s; antes 2,07 s, porque el bloque esperaba al
 * servidor y al refresco de la página).
 *
 *  · Lo que se pinta sale de lo que ya trae la lectura: el tipo, el nombre del servicio que
 *    abriría (`nombreNuevo`, la misma frase de la bandeja) y la ficha de la opción. El PRECIO no:
 *    lo calcula el servidor (costo confirmado, margen, tarifas), y una cifra adivinada que luego
 *    cambia es peor que «Guardando…». El total tampoco se toca hasta que el servidor responde.
 *  · D1: si el servidor falla, el bloque se quita y se dice por qué. Si responde bien, el bloque
 *    provisional se queda hasta que la página trae la opción de verdad (sin un cuadro vacío).
 *  · Solo un servicio NUEVO: una opción que se suma a un servicio que ya está se ve en su bloque.
 *
 * Puro: lo usan el editor (el estado), la vista (los bloques) y la prueba.
 */

import type { FilaDeLinea } from './por-pasos-vista'
import type { ItemConLectura } from './detalle-viaje'
import { normalizarGrupo } from './itinerarios'
import type { LecturaCasilla } from './tarifa-pasajero'
import type { TipoRanura } from './ranuras-cotizacion'

/** El prefijo del id de una fila que todavía no existe en la base. */
export const PREFIJO_PROVISIONAL = 'provisional:'

export type FilaProvisional = FilaDeLinea & ItemConLectura & { provisional: true }

export interface Provisional {
  /** La fila de la bandeja que se está aceptando. */
  capturaId: string
  fila: FilaProvisional
  /** El id que dejó el servidor al aceptar. `null` mientras no responde. */
  itemId: string | null
}

export function esProvisional(id: string): boolean {
  return id.startsWith(PREFIJO_PROVISIONAL)
}

/**
 * La fila que se pinta mientras el servidor acepta: un servicio nuevo con el nombre que dijo la
 * bandeja. Si ya hay un servicio con ese grupo, va numerado («hotel 2: …»), como lo numeraría el
 * servidor: nunca se mete dentro de un bloque que ya existe.
 */
export function filaProvisional(args: {
  capturaId: string
  tipo: TipoRanura
  lectura: LecturaCasilla
  nombreServicio: string
  filas: readonly { grupo?: string | null; orden?: number | null }[]
}): FilaProvisional {
  const { capturaId, tipo, lectura, nombreServicio, filas } = args
  const ocupados = new Set(filas.map(f => normalizarGrupo(f.grupo ?? null)).filter((g): g is string => !!g))
  let grupo = `${tipo}: ${nombreServicio}`
  for (let n = 2; ocupados.has(normalizarGrupo(grupo) ?? grupo); n++) grupo = `${tipo} ${n}: ${nombreServicio}`
  const orden = filas.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0) + 1
  return {
    id: `${PREFIJO_PROVISIONAL}${capturaId}`,
    provisional: true,
    nombre: (lectura.nombre || nombreServicio).toUpperCase(),
    grupo,
    orden,
    es_ajuste: false,
    entra_al_precio: true,
    cantidad: 1,
    precio_venta: 0,
    rubros: [],
    tarifa_pax: { casillas: { grupo_completo: lectura } },
  }
}

/**
 * Las provisionales que todavía se pintan: las que no tienen respuesta, y las aceptadas cuya opción
 * la página todavía no trae.
 */
export function provisionalesVigentes(provisionales: readonly Provisional[], idsDeLaPagina: ReadonlySet<string>): Provisional[] {
  return provisionales.filter(p => !p.itemId || !idsDeLaPagina.has(p.itemId))
}

/** Lo que la bandeja le dice al editor de un «Aceptar» con bloque provisional. */
export type EventoProvisional =
  | { tipo: 'inicio'; capturaId: string; tipoRanura: TipoRanura; lectura: LecturaCasilla; nombreServicio: string }
  | { tipo: 'aceptada'; capturaId: string; itemId: string }
  /** El servidor no la aceptó (`avisar`: con un error que decir) o la dejó esperando una decisión. */
  | { tipo: 'revertir'; capturaId: string; mensaje: string | null; avisar: boolean }

/**
 * El estado de las provisionales después de un evento. `aviso` = lo que hay que decir al quitar
 * un bloque porque el servidor no lo aceptó (D1).
 */
export function aplicarEvento(
  provisionales: readonly Provisional[],
  e: EventoProvisional,
  filas: readonly { grupo?: string | null; orden?: number | null }[],
): { provisionales: Provisional[]; aviso: string | null } {
  if (e.tipo === 'inicio') {
    const fila = filaProvisional({ capturaId: e.capturaId, tipo: e.tipoRanura, lectura: e.lectura, nombreServicio: e.nombreServicio, filas: [...filas, ...provisionales.map(p => p.fila)] })
    return { provisionales: [...provisionales.filter(p => p.capturaId !== e.capturaId), { capturaId: e.capturaId, fila, itemId: null }], aviso: null }
  }
  if (e.tipo === 'aceptada') {
    return { provisionales: provisionales.map(p => (p.capturaId === e.capturaId ? { ...p, itemId: e.itemId } : p)), aviso: null }
  }
  const quitada = provisionales.find(p => p.capturaId === e.capturaId)
  const nombre = quitada ? (quitada.fila.grupo ?? '').replace(/^[^:]*:\s*/, '') : ''
  return {
    provisionales: provisionales.filter(p => p.capturaId !== e.capturaId),
    aviso: quitada && e.avisar ? textoDeReversion(nombre || 'El servicio', e.mensaje) : null,
  }
}

/** Lo que dice el aviso cuando el servidor no aceptó: el bloque se quitó y por qué. */
export function textoDeReversion(nombreServicio: string, mensaje: string | null): string {
  const motivo = (mensaje ?? '').trim().replace(/[.\s]+$/, '')
  return `${nombreServicio} no se guardó${motivo ? `: ${motivo}` : ''}. Sigue en la bandeja.`
}
