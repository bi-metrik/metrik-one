import 'server-only'

import { extraerRanuraDesdeImagen } from '@/lib/ai/extraer-ranura'
import { getServerKey } from '@/lib/server-keys'
import { huellaDeImagen } from './captura-repetida'
import { construirLecturaCasilla } from './lectura-casilla'
import { evaluarLectura } from './lectura-pantallazo'
import type { DefinicionRanura } from './ranuras-pantallazo'
import type { LecturaCasilla } from './tarifa-pasajero'
import type { ViajeDelNegocio } from './viaje-negocio'

/**
 * Leer un pantallazo, SIN escribir nada. Lo usan las dos puertas:
 *
 *  · la casilla de una opción (`leerCasillaDeItem`), que después guarda la lectura en ella;
 *  · la bandeja (`leerCapturaEnBorrador`), que la devuelve como BORRADOR: lo que sigue en la
 *    bandeja no toca Componentes hasta «Aceptar» (H2 de la prueba del 2026-09-24).
 *
 * Una sola función para las dos: si cada puerta leyera a su manera, lo que se acepta desde la
 * bandeja y lo que se pega en la casilla dejarían de ser la misma lectura.
 */
export type LecturaDeImagen =
  | { ok: true; leida: LecturaCasilla }
  | { ok: false; codigo: string; mensaje: string; detalle?: string; opciones?: { nombre: string; precio: string | null }[] }

export async function leerImagenDeCaptura(args: {
  ranura: DefinicionRanura
  dataUrl: string
  viaje: ViajeDelNegocio
  monedaIndicada?: string | null
  enfoque?: { nombre: string; precio: string | null } | null
}): Promise<LecturaDeImagen> {
  const { ranura, dataUrl, viaje, monedaIndicada, enfoque } = args
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) return { ok: false, codigo: 'RX5', mensaje: 'La imagen no llegó en un formato legible. Vuelve a pegarla.' }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { ok: false, codigo: 'CONFIG', mensaje: 'Falta configurar la lectura de capturas. Avísale a MeTRIK.' }

  // Lo que llega del navegador se acota: es texto que va al prompt.
  const enfoqueLimpio = enfoque && typeof enfoque.nombre === 'string' && enfoque.nombre.trim() !== ''
    ? { nombre: enfoque.nombre.trim().slice(0, 160), precio: typeof enfoque.precio === 'string' ? enfoque.precio.trim().slice(0, 40) || null : null }
    : null
  const lectura = await extraerRanuraDesdeImagen(Buffer.from(m[2], 'base64'), m[1], ranura, apiKey, enfoqueLimpio)
  if (!lectura.data) {
    return {
      ok: false,
      codigo: 'RX6',
      mensaje: 'No se pudo leer el pantallazo. Vuelve a intentarlo.',
      detalle: lectura.error,
    }
  }

  const veredicto = evaluarLectura(ranura, lectura.data, {
    fechasViaje: viaje.fechas,
    monedaIndicada: monedaIndicada ?? null,
    soloMinimosDeCosto: true,
    // RX3 deja de ser un rechazo aquí: sin moneda visible se preselecciona COP, marcada
    // como supuesta, y `confirmarTarifaPorPasajero` no deja pasar el costo hasta que una
    // persona la acepte o la cambie. Este es el único camino con ese freno.
    monedaSiFalta: 'COP',
  })
  if (!veredicto.ok) {
    const opciones = veredicto.opciones ?? []
    return {
      ok: false,
      codigo: veredicto.codigo,
      // P8 · con opciones legibles no se manda a la persona de vuelta al proveedor: se le
      // pregunta cuál de las que se leyeron es.
      mensaje: opciones.length > 0 ? '¿Cuál de estas? La captura trae varias opciones: toca la que vas a cotizar.' : veredicto.instruccion,
      detalle: veredicto.motivo,
      ...(opciones.length > 0 ? { opciones } : {}),
    }
  }

  const leida = construirLecturaCasilla(ranura, veredicto, new Date().toISOString())
  // La huella del archivo, para que la bandeja no procese dos veces el mismo pantallazo (P10).
  const huella = await huellaDeImagen(dataUrl)
  if (huella) leida.huellaImagen = huella
  return { ok: true, leida }
}
