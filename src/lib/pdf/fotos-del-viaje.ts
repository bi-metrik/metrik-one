/**
 * Qué fotos lleva el documento de un viaje: la de portada y una por ciudad.
 *
 * Reglas del brief del 22-sep (`brief-max-2026-09-22-fotos-provisionales.md`):
 *
 * 1. **Portada**: la de la ciudad destino del NEGOCIO. Si esa ciudad no tiene foto, no hay
 *    portada con foto y la plantilla pone la banda de marca de siempre. No se «rellena»
 *    con la foto de otra ciudad del viaje: la portada dice a dónde va el cliente.
 * 2. **Una foto por ciudad** del viaje, sacada del destino del negocio, del destino de los
 *    vuelos y de la ciudad del hotel. El origen y las escalas no cuentan: son de paso.
 * 3. **Sin repetir la de portada**: la ciudad de portada entra al cuerpo solo si el banco
 *    tiene OTRA foto suya. Con una sola, ya está en la portada y no se imprime dos veces.
 * 4. **Máximo 4 fotos en todo el documento**, portada incluida.
 *
 * Es puro a propósito: el banco entra por parámetro. Así se prueba sin disco y, el día
 * que llegue el banco real, esta regla no cambia.
 */

import type { FotoCiudad } from './fotos-ciudad'
import type { FotoPDF } from './cotizacion-props'

export const MAXIMO_FOTOS_POR_DOCUMENTO = 4

export interface EntradaFotos {
  destino: string | null
  vuelos: { destino: string | null }[]
  hoteles: { ciudad: string | null }[]
}

export interface FotosDelViaje {
  portada: FotoPDF | null
  ciudades: FotoPDF[]
}

/**
 * Las ciudades que nombra un texto libre. El destino del negocio puede traer varias
 * («Madrid, Roma y París») y el que se deriva del itinerario las une con « · ».
 *
 * ⚠️ «y» se parte solo como palabra suelta: partir por la letra rompería «Guayaquil».
 */
export function ciudadesEnTexto(texto: string | null | undefined): string[] {
  if (!texto) return []
  return texto
    .split(/\s*(?:[,·/|;+&–—]|\s-\s|\sy\s|\se\s)\s*/i)
    .map(t => t.trim())
    .filter(Boolean)
}

function aFotoPDF(f: FotoCiudad, lugares: string[] = []): FotoPDF {
  return { url: f.ruta, rotulo: f.rotulo, credito: f.credito, lugares, foco: f.foco, proporcion: f.proporcion }
}

export function fotosDelViaje(
  entrada: EntradaFotos,
  buscar: (ciudad: string) => FotoCiudad[],
): FotosDelViaje {
  // Portada: la primera ciudad del DESTINO que tenga foto.
  let portada: FotoCiudad | null = null
  for (const c of ciudadesEnTexto(entrada.destino)) {
    const fotos = buscar(c)
    if (fotos.length > 0) {
      portada = fotos[0]
      break
    }
  }

  const candidatas = [
    ...ciudadesEnTexto(entrada.destino),
    ...entrada.vuelos.flatMap(v => ciudadesEnTexto(v.destino)),
    ...entrada.hoteles.flatMap(h => ciudadesEnTexto(h.ciudad)),
  ]

  const cupo = MAXIMO_FOTOS_POR_DOCUMENTO - (portada ? 1 : 0)
  const ciudades: FotoCiudad[] = []
  // Se deduplica por la ciudad DEL BANCO, no por el texto: «Providencia» y «PVA» son una.
  const vistas = new Set<string>()
  for (const c of candidatas) {
    if (ciudades.length >= cupo) break
    const fotos = buscar(c)
    if (fotos.length === 0) continue
    const ciudad = fotos[0].ciudad
    if (vistas.has(ciudad)) continue
    vistas.add(ciudad)
    const foto = fotos.find(f => f.ruta !== portada?.ruta)
    if (foto) ciudades.push(foto)
  }

  // Todos los nombres con que el viaje llama a cada ciudad: la plantilla los usa para
  // poner la foto en el capítulo de su ciudad.
  const lugaresDe = (ciudad: string) => candidatas.filter(c => buscar(c)[0]?.ciudad === ciudad)
  return {
    portada: portada ? aFotoPDF(portada, lugaresDe(portada.ciudad)) : null,
    ciudades: ciudades.map(f => aFotoPDF(f, lugaresDe(f.ciudad))),
  }
}

/**
 * Los créditos de las fotos que se IMPRIMEN, sin repetir: dos fotos del mismo autor con
 * la misma licencia se nombran una vez. Sin fotos, vacío, y la plantilla no imprime la
 * línea.
 */
export function creditosDeFotos(fotos: (FotoPDF | null | undefined)[]): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const f of fotos) {
    const c = f?.credito
    if (!c || vistos.has(c)) continue
    vistos.add(c)
    salida.push(c)
  }
  return salida
}
