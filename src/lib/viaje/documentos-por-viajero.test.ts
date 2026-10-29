/**
 * Documentos por viajero (QA Trappvel 2026-10-29, H9-5 y H6-4).
 *
 * VISTO FALLAR (2026-10-29), una mutación a la vez:
 *   · contar el pasaporte sin asignar con varios viajeros → cae «UN pasaporte no basta para 4»;
 *   · quitar el registro civil de los menores → cae «la bebé pide registro civil»;
 *   · pedir permiso con `ambos === true` → cae «con los dos padres no pide permiso».
 */
import { describe, expect, it } from 'vitest'
import {
  documentosPorViajero,
  leerDocumentosViajero,
  mensajeDocumentosViaje,
  viajerosDelViaje,
  type DocumentosViajeroGuardados,
} from './documentos-por-viajero'
import type { DocumentoViajero } from './entrega'

const doc = (id: string, tipo: DocumentoViajero['tipo'] = 'pasaporte', vence: string | null = '2035-01-01'): DocumentoViajero =>
  ({ id, tipo, numero: id.toUpperCase(), nombre_en_documento: null, pais: null, fecha_vencimiento: vence, archivo_ref: null })

const VIAJE09 = viajerosDelViaje({ adultos: 2, ninos: 1, infantes: 1 }, 'Carolina Prueba')
const sin: DocumentosViajeroGuardados = { asignados: {}, menoresConAmbosPadres: null }

describe('viajeros del viaje', () => {
  it('salen de la composición: el titular con su nombre, los demás por tipo', () => {
    expect(VIAJE09.map(v => v.etiqueta)).toEqual(['Carolina (titular)', 'Adulto 2', 'Niño 1', 'Infante 1'])
    expect(VIAJE09.filter(v => v.menor).map(v => v.clave)).toEqual(['nino-1', 'infante-1'])
    expect(viajerosDelViaje(null, '')).toEqual([{ clave: 'adulto-1', etiqueta: 'Titular', menor: false, titular: true }])
  })
})

describe('el gate pide los documentos de cada viajero (H9-5)', () => {
  it('UN pasaporte (el de la bebé, sin decir de quién) no basta para 4', () => {
    const e = documentosPorViajero({ internacional: true, documentos: [doc('lu1')], guardados: sin, viajeros: VIAJE09, fechaRegreso: '2027-07-10' })
    expect(e.sinAsignar.map(d => d.id)).toEqual(['lu1'])
    expect(mensajeDocumentosViaje(e)).toBe(
      'Faltan el pasaporte de Carolina (titular), el pasaporte de Adulto 2, el pasaporte de Niño 1, el registro civil de Niño 1, el pasaporte de Infante 1, el registro civil de Infante 1 y saber si los menores viajan con sus dos padres.',
    )
  })

  it('todo cargado y con los dos padres: no falta nada; sin ellos, el permiso de cada menor', () => {
    const docs = [doc('p1'), doc('p2'), doc('p3'), doc('p4'), doc('rc3', 'otro'), doc('rc4', 'otro')]
    const asignados = {
      p1: { viajero: 'adulto-1', clase: 'pasaporte' as const }, p2: { viajero: 'adulto-2', clase: 'pasaporte' as const },
      p3: { viajero: 'nino-1', clase: 'pasaporte' as const }, p4: { viajero: 'infante-1', clase: 'pasaporte' as const },
      rc3: { viajero: 'nino-1', clase: 'registro_civil' as const }, rc4: { viajero: 'infante-1', clase: 'registro_civil' as const },
    }
    const base = { internacional: true, documentos: docs, viajeros: VIAJE09, fechaRegreso: '2027-07-10' }
    expect(mensajeDocumentosViaje(documentosPorViajero({ ...base, guardados: { asignados, menoresConAmbosPadres: true } }))).toBeNull()
    expect(mensajeDocumentosViaje(documentosPorViajero({ ...base, guardados: { asignados, menoresConAmbosPadres: false } })))
      .toBe('Faltan el permiso de salida de Niño 1 y el permiso de salida de Infante 1.')
  })

  it('un viajero solo: el pasaporte sin asignar cuenta y el mensaje es el de siempre', () => {
    const uno = viajerosDelViaje({ adultos: 1, ninos: 0, infantes: 0 }, 'Laura')
    expect(mensajeDocumentosViaje(documentosPorViajero({ internacional: true, documentos: [], guardados: sin, viajeros: uno, fechaRegreso: null }))).toBe('Falta el pasaporte del viajero.')
    expect(mensajeDocumentosViaje(documentosPorViajero({ internacional: true, documentos: [doc('x')], guardados: sin, viajeros: uno, fechaRegreso: null }))).toBeNull()
  })

  it('el pasaporte que vence antes de 6 meses del regreso frena con su aviso', () => {
    const uno = viajerosDelViaje({ adultos: 1, ninos: 0, infantes: 0 }, 'Laura Gómez')
    const e = documentosPorViajero({ internacional: true, documentos: [doc('x', 'pasaporte', '2027-08-01')], guardados: sin, viajeros: uno, fechaRegreso: '2027-07-10' })
    expect(mensajeDocumentosViaje(e)).toBe('El pasaporte de Laura vence el 1 ago 2027: menos de 6 meses después del regreso.')
  })

  it('viaje nacional: no pide nada', () => {
    expect(mensajeDocumentosViaje(documentosPorViajero({ internacional: false, documentos: [], guardados: sin, viajeros: VIAJE09, fechaRegreso: null }))).toBeNull()
  })
})

describe('lo guardado en el negocio', () => {
  it('lee la forma buena y descarta lo que no lo es', () => {
    const g = leerDocumentosViajero({ documentos_viajero: { asignados: { a: { viajero: 'nino-1', clase: 'registro_civil' }, b: { viajero: 'x', clase: 'licencia' }, c: null }, menores_con_ambos_padres: false } })
    expect(g).toEqual({ asignados: { a: { viajero: 'nino-1', clase: 'registro_civil' } }, menoresConAmbosPadres: false })
    expect(leerDocumentosViajero(null)).toEqual(sin)
  })
})
