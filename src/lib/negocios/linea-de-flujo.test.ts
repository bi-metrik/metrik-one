import { describe, expect, it } from 'vitest'
import { etapasEnOrdenDeOcurrencia, secuenciaDeLinea, type EtapaDeLinea } from './linea-de-flujo'
import { LINEA_SOENA as SOENA } from '../../../test/linea-soena'

type Etapa = EtapaDeLinea & { numero: number; nombre: string; stage: string }

const nombres = (xs: ReadonlyArray<{ nombre: string }>) => xs.map((e) => e.nombre)

/** Lo que pinta el segmentador al poner una fase: sus etapas, en el orden que salga. */
const deLaFase = <T extends { stage: string; nombre: string }>(orden: readonly T[], fase: string) =>
  nombres(orden.filter((e) => e.stage === fase))

// El helper no puede depender del orden en que llegan las filas.
const desordenadas = [...SOENA].reverse()

// Orden de ocurrencia por fase en la línea real de SOENA. Tronco primero; la rama de IVA
// (Cita, Notificación, Anexos, Generación, Envío, Seguimiento) después, dentro de su fase.
const VENTA = ['Validación', 'Inclusión', 'Propuesta', 'Negociación', 'Documentación', 'Segundo cobro', 'Entrega', 'Anexos', 'Seguimiento']
const EJECUCION = ['Cargue', 'Revisión radicado', 'Certificación', 'Cita', 'Notificación', 'Generación', 'Envío']
const COBRO = ['Pago UPME', 'Cartera', 'Facturación']

describe('etapasEnOrdenDeOcurrencia · línea real de SOENA', () => {
  const orden = etapasEnOrdenDeOcurrencia(desordenadas)

  it('cada fase sale en el orden en que un caso pisa sus etapas', () => {
    expect(deLaFase(orden, 'venta')).toEqual(VENTA)
    expect(deLaFase(orden, 'ejecucion')).toEqual(EJECUCION)
    expect(deLaFase(orden, 'cobro')).toEqual(COBRO)
  })

  it('las etapas de la rama de IVA van después de las del tronco, dentro de su fase', () => {
    expect(deLaFase(orden, 'venta').slice(-2)).toEqual(['Anexos', 'Seguimiento'])
    expect(deLaFase(orden, 'ejecucion').slice(-4)).toEqual(['Cita', 'Notificación', 'Generación', 'Envío'])
  })

  it('no pierde ni repite etapas', () => {
    expect(orden).toHaveLength(SOENA.length)
    expect(new Set(orden.map((e) => e.numero)).size).toBe(SOENA.length)
  })

  it('NO es el orden por `orden`: así salía Ejecución antes', () => {
    const porOrden = deLaFase([...SOENA].sort((a, b) => a.orden - b.orden), 'ejecucion')
    expect(porOrden).toEqual(['Cargue', 'Certificación', 'Generación', 'Envío', 'Cita', 'Notificación', 'Revisión radicado'])
    expect(deLaFase(orden, 'ejecucion')).not.toEqual(porOrden)
  })

  it('NO es el orden por `numero`: con los números barajados el orden no se mueve', () => {
    // En SOENA el `numero` coincide hoy con el recorrido en las tres fases, así que con los
    // números reales ordenar por `numero` pasaría esta prueba por la razón equivocada. El
    // `numero` es solo un identificador: se invierte (20 - numero) y la ruta queda igual.
    const renumerada = SOENA.map((e) => ({ ...e, numero: 20 - e.numero }))
    const porNumero = [...renumerada].sort((a, b) => a.numero - b.numero)
    // Guarda del instrumento: con esta renumeración, ordenar por `numero` SÍ cambia cada fase.
    expect(deLaFase(porNumero, 'venta')).not.toEqual(VENTA)
    expect(deLaFase(porNumero, 'ejecucion')).not.toEqual(EJECUCION)
    expect(deLaFase(porNumero, 'cobro')).not.toEqual(COBRO)

    const orden = etapasEnOrdenDeOcurrencia([...renumerada].reverse())
    expect(deLaFase(orden, 'venta')).toEqual(VENTA)
    expect(deLaFase(orden, 'ejecucion')).toEqual(EJECUCION)
    expect(deLaFase(orden, 'cobro')).toEqual(COBRO)
  })
})

describe('secuenciaDeLinea · línea real de SOENA', () => {
  const sec = secuenciaDeLinea(desordenadas)

  it('el tronco sigue el destino por defecto desde Validación hasta el cierre en Facturación, con Inclusión en su lugar', () => {
    expect(nombres(sec.tronco)).toEqual([
      'Validación', 'Inclusión', 'Propuesta', 'Negociación', 'Documentación', 'Cargue', 'Pago UPME',
      'Revisión radicado', 'Certificación', 'Segundo cobro', 'Cartera', 'Entrega', 'Facturación',
    ])
  })

  it('la rama de IVA es la única rama', () => {
    expect(sec.ramas.map(nombres)).toEqual([['Cita', 'Notificación', 'Anexos', 'Generación', 'Envío', 'Seguimiento']])
    expect(sec.fueraDelFlujo).toEqual([])
  })
})

describe('secuenciaDeLinea · casos límite', () => {
  it('línea sin routing: el `orden` de siempre', () => {
    const sinRouting: Etapa[] = [
      { orden: 3, numero: 3, nombre: 'C', stage: 'venta', routing: null },
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta' },
      { orden: 2, numero: 2, nombre: 'B', stage: 'ejecucion', routing: null },
    ]
    expect(nombres(etapasEnOrdenDeOcurrencia(sinRouting))).toEqual(['A', 'B', 'C'])
    const sec = secuenciaDeLinea(sinRouting)
    expect(sec.ramas).toEqual([])
    expect(sec.fueraDelFlujo).toEqual([])
  })

  it('línea vacía no revienta', () => {
    expect(secuenciaDeLinea([])).toEqual({ tronco: [], ramas: [], fueraDelFlujo: [] })
    expect(etapasEnOrdenDeOcurrencia([])).toEqual([])
  })

  it('lo que no se alcanza desde la primera etapa va al final, por `orden`', () => {
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'Inicio', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 3, numero: 3, nombre: 'Cierre', stage: 'cobro', routing: { default_etapa_orden: 3 } },
      { orden: 9, numero: 9, nombre: 'Huérfana 9', stage: 'venta', routing: { default_etapa_orden: 9 } },
      { orden: 5, numero: 5, nombre: 'Huérfana 5', stage: 'venta', routing: { default_etapa_orden: 5 } },
    ]
    const sec = secuenciaDeLinea(linea)
    expect(nombres(sec.tronco)).toEqual(['Inicio', 'Cierre'])
    expect(nombres(sec.fueraDelFlujo)).toEqual(['Huérfana 5', 'Huérfana 9'])
    expect(nombres(etapasEnOrdenDeOcurrencia(linea))).toEqual(['Inicio', 'Cierre', 'Huérfana 5', 'Huérfana 9'])
  })

  it('un desvío de UNA etapa que no vuelve a la siguiente del tronco es una rama, y va después', () => {
    // A → B → C por defecto; A también puede ir a X, que vuelve a C (se salta B).
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta', routing: { default_etapa_orden: 2, conditional: [{ condition: { field: 'f', value: 'x' }, etapa_orden: 9 }] } },
      { orden: 2, numero: 2, nombre: 'B', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 3, numero: 3, nombre: 'C', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 9, numero: 9, nombre: 'X', stage: 'venta', routing: { default_etapa_orden: 3 } },
    ]
    const sec = secuenciaDeLinea(linea)
    expect(nombres(sec.tronco)).toEqual(['A', 'B', 'C'])
    expect(sec.ramas.map(nombres)).toEqual([['X']])
    expect(nombres(etapasEnOrdenDeOcurrencia(linea))).toEqual(['A', 'B', 'C', 'X'])
  })

  it('un desvío de UNA etapa que vuelve a la siguiente del tronco queda en su lugar', () => {
    // A → C por defecto; A también puede ir a X, que vuelve a C.
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta', routing: { default_etapa_orden: 3, conditional: [{ condition: { field: 'f', value: 'x' }, etapa_orden: 9 }] } },
      { orden: 3, numero: 3, nombre: 'C', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 9, numero: 9, nombre: 'X', stage: 'venta', routing: { default_etapa_orden: 3 } },
    ]
    expect(nombres(etapasEnOrdenDeOcurrencia(linea))).toEqual(['A', 'X', 'C'])
  })

  it('un routing que se enrosca no cuelga el recorrido', () => {
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta', routing: { default_etapa_orden: 2 } },
      { orden: 2, numero: 2, nombre: 'B', stage: 'venta', routing: { default_etapa_orden: 1 } },
    ]
    expect(nombres(etapasEnOrdenDeOcurrencia(linea))).toEqual(['A', 'B'])
  })
})
