import { describe, expect, it } from 'vitest'

import { cuerpoDeAceptar, estadoInicial, filasDelLote, fraseDeFila, menuDeFila, nombreNuevo, type CapturaLista } from './bandeja-por-pasos'
import { partirLote } from './bandeja-red'
import { grupoDeRanura } from './ranuras-cotizacion'
import type { Borrador } from './proceso-captura'
import type { LineaParaUbicar } from './ubicar-lectura'
import { onceDelCasoFijo, type Pantallazo } from '../../../test/caso-once-pantallazos'

/** C5 · la bandeja de la forma por pasos, sin DOM: la frase de cada fila, su menú y el lote. */

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
const once = onceDelCasoFijo()
const borrador = (p: Pantallazo): Borrador => ({ tipo: p.tipo, lectura: p.lectura, lecturaJson: JSON.stringify(p.lectura), firma: 'f', pistas: p.pistas })
const lista = (p: Pantallazo, titulo = p.lectura.nombre): CapturaLista => ({ id: p.id, titulo, borrador: borrador(p) })
const linea = (p: Pantallazo, grupo: string): LineaParaUbicar => ({ id: `item-${p.id}`, grupo, nombre: p.lectura.nombre, tarifa_pax: { casillas: { grupo_completo: p.lectura } } })

const LINEAS: LineaParaUbicar[] = [
  linea(once[0], grupoDeRanura({ tipo: 'vuelo', numero: null, nombre: null })),
  linea(once[2], grupoDeRanura({ tipo: 'hotel', numero: null, nombre: 'Hotel en Providencia' })),
  linea(once[6], grupoDeRanura({ tipo: 'traslado', numero: null, nombre: null })),
  linea(once[8], grupoDeRanura({ tipo: 'actividad', numero: null, nombre: 'Cayo Cangrejo' })),
]

const frase = (p: Pantallazo, extra: Partial<Parameters<typeof fraseDeFila>[0]> = {}) =>
  fraseDeFila({ captura: lista(p), lineas: LINEAS, composicion: VIAJE, destinoViaje: 'San Andrés y Providencia', modelo: null, eleccion: null, ...extra })

describe('C5 · la frase de la fila', () => {
  it('Cabañas Agua Dulce: «Otra opción de: Hotel en Providencia», con su razón', () => {
    const f = frase(once[3])
    expect(f.frase).toBe('Otra opción de: Hotel en Providencia')
    expect(f.destino.razon).toMatch(/compite con él/)
  })

  it('el hotel de San Andrés suma aparte, nombrado como el bloque que abriría', () => {
    expect(frase(once[4]).frase).toBe('Suma aparte: Hotel en San Andrés')
    expect(nombreNuevo(borrador(once[10]), 'San Andrés y Providencia')).toBe('Actividad en San Andrés')
  })

  it('lo que elige la persona manda, y la razón dice «Lo cambiaste tú.»', () => {
    const f = frase(once[9], { eleccion: { como: 'hermana', itemId: 'item-cap-caso-09' } })
    expect(f.frase).toBe('Otra opción de: Actividad · Cayo Cangrejo')
    expect(f.destino).toMatchObject({ como: 'hermana', fuente: 'asesora', razon: 'Lo cambiaste tú.' })
    expect(cuerpoDeAceptar(borrador(once[9]), f, { imagen: null, correcciones: null, idAceptacion: 'x' })).toMatchObject({ decision: 'hermana', destinoId: 'item-cap-caso-09' })
  })

  it('una elección que ya no vale (el servicio se borró) vuelve a la frase de ONE', () => {
    expect(frase(once[9], { eleccion: { como: 'hermana', itemId: 'ya-no-esta' } }).destino.fuente).toBe('reglas')
  })

  it('el modelo cambia la frase solo si pasa las guardas', () => {
    const f = frase(once[9], { modelo: { como: 'hermana', itemId: 'item-cap-caso-09', razon: 'La misma excursión en otra lancha', duda: false } })
    expect(f.frase).toBe('Otra opción de: Actividad · Cayo Cangrejo')
    expect(f.destino.fuente).toBe('modelo')
    const otroTipo = frase(once[9], { modelo: { como: 'hermana', itemId: 'item-cap-caso-07', razon: 'x', duda: false } })
    expect(otroTipo.destino.fuente).toBe('reglas')
  })
})

describe('C5 · M3 · el menú de la frase', () => {
  it('solo servicios del mismo tipo, y las otras filas de la bandeja que suman aparte', () => {
    const fila11 = { captura: lista(once[10], 'Buceo de bautismo'), frase: frase(once[10]) }
    const fila5 = { captura: lista(once[4], 'Verde Mar'), frase: frase(once[4]) }
    const menu = menuDeFila(lista(once[9]), LINEAS, [fila11, fila5])
    expect(menu.map(m => m.etiqueta)).toEqual([
      'Suma aparte (servicio nuevo)',
      'Otra opción de: Actividad · Cayo Cangrejo',
      'Otra opción de: Buceo de bautismo (en la bandeja)',
    ])
  })
})

describe('C5 · P11 · el estado con que llega', () => {
  it('solo traslado o actividad NUEVOS; lo marcado como opcional llega Opcional', () => {
    const buceoOpcional = onceDelCasoFijo({ buceoOpcional: true })[10]
    expect(estadoInicial(borrador(buceoOpcional), frase(buceoOpcional).destino)).toEqual({ estado: 'opcional', motivo: 'Es opcional: el cliente decide (no suma)' })
    expect(estadoInicial(borrador(once[10]), frase(once[10]).destino)).toEqual({ estado: 'incluido', motivo: null })
    expect(estadoInicial(borrador(once[4]), frase(once[4]).destino)).toBeNull()
    // Una opción que se suma a otro servicio toma el estado del servicio: no hay desplegable.
    expect(estadoInicial(borrador(once[9]), frase(once[9], { eleccion: { como: 'hermana', itemId: 'item-cap-caso-09' } }).destino)).toBeNull()
  })
})

describe('C5 · «Aceptar los N»', () => {
  it('va en el orden en que se pegaron, y la opción de una captura de la bandeja va detrás de ella', () => {
    // La bandeja muestra lo nuevo arriba: la lancha privada (pegada después) va primero en la lista.
    const privada = { id: once[9].id, borrador: borrador(once[9]), frase: frase(once[9], { eleccion: { como: 'hermana_de_captura', capturaId: once[8].id, titulo: 'Cayo Cangrejo' } }), estado: null, imagen: null }
    const compartida = { id: once[8].id, borrador: borrador(once[8]), frase: frase(once[8]), estado: 'incluido' as const, imagen: null }
    const filas = filasDelLote([privada, compartida])
    expect(filas.map(f => f.id)).toEqual([once[8].id, once[9].id])
    expect(filas[1]).toMatchObject({ destinoCaptura: once[8].id, borrador: { decision: 'hermana', destinoId: null } })
    expect(filas[0].estado).toBe('incluido')
  })

  it('si la captura de la que es opción ya se aceptó, apunta a su opción', () => {
    const privada = { id: once[9].id, borrador: borrador(once[9]), frase: frase(once[9], { eleccion: { como: 'hermana_de_captura', capturaId: once[8].id, titulo: 'Cayo Cangrejo' } }), estado: null, imagen: null, destinoAceptado: 'item-real' }
    expect(filasDelLote([privada])[0]).toMatchObject({ borrador: { decision: 'hermana', destinoId: 'item-real' } })
    expect(filasDelLote([privada])[0]).not.toHaveProperty('destinoCaptura')
  })

  it('se parte en envíos que quepan en el borde; sin imágenes pesadas, uno solo', () => {
    const filas = once.map(p => ({ id: p.id, borrador: cuerpoDeAceptar(borrador(p), frase(p), { imagen: null, correcciones: null, idAceptacion: p.id }) }))
    expect(partirLote(filas)).toHaveLength(1)
    const pesada = 'data:image/png;base64,' + 'A'.repeat(1_500_000)
    const conImagen = filas.map(f => ({ ...f, borrador: { ...f.borrador, imagen: pesada } }))
    const envios = partirLote(conImagen)
    expect(envios.length).toBeGreaterThan(1)
    expect(envios.flat().map(f => f.id)).toEqual(filas.map(f => f.id))
    for (const e of envios) expect(JSON.stringify(e).length).toBeLessThan(4_400_000)
  })
})
