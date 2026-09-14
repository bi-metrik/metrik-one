import { describe, expect, it } from 'vitest'
import { distribuirLinea, nivelesDeAtraso, secuenciaDeLinea, type EtapaDeLinea } from './linea-de-flujo'
import { LINEA_SOENA as SOENA } from '../../../test/linea-soena'

type Etapa = EtapaDeLinea & { numero: number; nombre: string; stage: string }

const nombres = (xs: ReadonlyArray<{ nombre: string }>) => xs.map((e) => e.nombre)

// El helper no puede depender del orden en que llegan las filas.
const desordenadas = [...SOENA].reverse()

describe('secuenciaDeLinea · línea real de SOENA', () => {
  const sec = secuenciaDeLinea(desordenadas)

  it('el tronco sigue el destino por defecto desde Validación hasta el cierre en Facturación', () => {
    expect(sec.porRouting).toBe(true)
    expect(nombres(sec.tronco.map((p) => p.etapa))).toEqual([
      'Validación', 'Inclusión', 'Propuesta', 'Negociación', 'Documentación', 'Cargue', 'Pago UPME',
      'Revisión radicado', 'Certificación', 'Segundo cobro', 'Cartera', 'Entrega', 'Facturación',
    ])
  })

  it('Inclusión va dentro del tronco, marcada como condicional, y es la única', () => {
    const condicionales = sec.tronco.filter((p) => p.condicional).map((p) => p.etapa.nombre)
    expect(condicionales).toEqual(['Inclusión'])
  })

  it('la rama de IVA va aparte: sale de Cartera o Entrega y vuelve a Facturación', () => {
    expect(sec.ramas).toHaveLength(1)
    const [iva] = sec.ramas
    expect(nombres(iva.etapas)).toEqual(['Cita', 'Notificación', 'Anexos', 'Generación', 'Envío', 'Seguimiento'])
    expect(nombres(iva.desde)).toEqual(['Cartera', 'Entrega'])
    expect(iva.hacia?.nombre).toBe('Facturación')
  })

  it('todas las etapas quedan en la línea, ninguna fuera del flujo', () => {
    expect(sec.fueraDelFlujo).toEqual([])
    const colocadas = sec.tronco.length + sec.ramas.reduce((s, r) => s + r.etapas.length, 0)
    expect(colocadas).toBe(SOENA.length)
  })

  it('NO es el orden por `orden`: Ejecución sale en el orden del recorrido', () => {
    // Lo que pintaba la pantalla antes (fase Ejecución ordenada por `orden`).
    const porOrden = nombres(SOENA.filter((e) => e.stage === 'ejecucion').sort((a, b) => a.orden - b.orden))
    expect(porOrden).toEqual(['Cargue', 'Certificación', 'Generación', 'Envío', 'Cita', 'Notificación', 'Revisión radicado'])

    const recorrido = [...sec.tronco.map((p) => p.etapa), ...sec.ramas.flatMap((r) => r.etapas)]
    const ejecucion = nombres(recorrido.filter((e) => e.stage === 'ejecucion'))
    expect(ejecucion).toEqual(['Cargue', 'Revisión radicado', 'Certificación', 'Cita', 'Notificación', 'Generación', 'Envío'])
    expect(ejecucion).not.toEqual(porOrden)
  })
})

describe('secuenciaDeLinea · casos límite', () => {
  it('línea sin routing: una sola fila por `orden`, igual que antes', () => {
    const sinRouting: Etapa[] = [
      { orden: 3, numero: 3, nombre: 'C', stage: 'venta', routing: null },
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta' },
      { orden: 2, numero: 2, nombre: 'B', stage: 'ejecucion', routing: null },
    ]
    const sec = secuenciaDeLinea(sinRouting)
    expect(sec.porRouting).toBe(false)
    expect(nombres(sec.tronco.map((p) => p.etapa))).toEqual(['A', 'B', 'C'])
    expect(sec.tronco.every((p) => !p.condicional)).toBe(true)
    expect(sec.ramas).toEqual([])
    expect(sec.fueraDelFlujo).toEqual([])
  })

  it('línea vacía no revienta', () => {
    expect(secuenciaDeLinea([])).toEqual({ porRouting: false, tronco: [], ramas: [], fueraDelFlujo: [] })
  })

  it('lo que no se alcanza desde la primera etapa queda al final, por `orden`', () => {
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'Inicio', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 3, numero: 3, nombre: 'Cierre', stage: 'cobro', routing: { default_etapa_orden: 3 } },
      { orden: 9, numero: 9, nombre: 'Huérfana 9', stage: 'venta', routing: { default_etapa_orden: 9 } },
      { orden: 5, numero: 5, nombre: 'Huérfana 5', stage: 'venta', routing: { default_etapa_orden: 5 } },
    ]
    const sec = secuenciaDeLinea(linea)
    expect(nombres(sec.tronco.map((p) => p.etapa))).toEqual(['Inicio', 'Cierre'])
    expect(nombres(sec.fueraDelFlujo)).toEqual(['Huérfana 5', 'Huérfana 9'])
  })

  it('un desvío de UNA etapa que no vuelve a la siguiente del tronco va en su propia fila', () => {
    // A → B → C por defecto; A también puede ir a X, que vuelve a C (se salta B).
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta', routing: { default_etapa_orden: 2, conditional: [{ condition: { field: 'f', value: 'x' }, etapa_orden: 9 }] } },
      { orden: 2, numero: 2, nombre: 'B', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 3, numero: 3, nombre: 'C', stage: 'venta', routing: { default_etapa_orden: 3 } },
      { orden: 9, numero: 9, nombre: 'X', stage: 'venta', routing: { default_etapa_orden: 3 } },
    ]
    const sec = secuenciaDeLinea(linea)
    expect(nombres(sec.tronco.map((p) => p.etapa))).toEqual(['A', 'B', 'C'])
    expect(sec.ramas).toHaveLength(1)
    expect(nombres(sec.ramas[0].etapas)).toEqual(['X'])
    expect(sec.ramas[0].hacia?.nombre).toBe('C')
  })

  it('un routing que se enrosca no cuelga el recorrido', () => {
    const linea: Etapa[] = [
      { orden: 1, numero: 1, nombre: 'A', stage: 'venta', routing: { default_etapa_orden: 2 } },
      { orden: 2, numero: 2, nombre: 'B', stage: 'venta', routing: { default_etapa_orden: 1 } },
    ]
    const sec = secuenciaDeLinea(linea)
    expect(nombres(sec.tronco.map((p) => p.etapa))).toEqual(['A', 'B'])
  })
})

describe('distribuirLinea', () => {
  const nodos = distribuirLinea(secuenciaDeLinea(SOENA))
  const nodo = (nombre: string) => {
    const n = nodos.find((x) => x.etapa.nombre === nombre)
    if (!n) throw new Error(`sin nodo ${nombre}`)
    return n
  }

  it('la rama arranca en la columna siguiente a Entrega, en su propia fila', () => {
    expect(nodo('Entrega').fila).toBe(1)
    expect(nodo('Cita').fila).toBe(2)
    expect(nodo('Cita').columna).toBe(nodo('Entrega').columna + 1)
    expect(nodo('Cita').abreRama).toBe(true)
    expect(nodo('Seguimiento').cierraRama).toBe(true)
  })

  it('Facturación se corre hasta quedar después de Seguimiento, no debajo de Cita', () => {
    expect(nodo('Facturación').fila).toBe(1)
    expect(nodo('Facturación').columna).toBe(nodo('Seguimiento').columna + 1)
    // Y su conector parte de Entrega: el hueco se dibuja como línea continua.
    expect(nodo('Facturación').columnaAnterior).toBe(nodo('Entrega').columna)
  })

  it('una columna por etapa: ninguna se encima con otra de la misma fila', () => {
    const vistas = new Set(nodos.map((n) => `${n.fila}:${n.columna}`))
    expect(vistas.size).toBe(nodos.length)
    expect(nodos).toHaveLength(SOENA.length)
  })
})

describe('nivelesDeAtraso', () => {
  // Conteos de SOENA medidos el 2026-09-14 sobre los 415 abiertos, con el mismo criterio de
  // atraso de la lista (`slaHorasVigentes` + `horasHabilesEntre`). Por `numero` de etapa.
  const MEDIDO: Record<string, [number, number]> = {
    Validación: [22, 22], Inclusión: [0, 0], Propuesta: [72, 65], Negociación: [3, 3],
    Documentación: [7, 4], Cargue: [2, 1], 'Pago UPME': [0, 0], 'Revisión radicado': [1, 0],
    Certificación: [11, 2], 'Segundo cobro': [1, 0], Cartera: [0, 0], Entrega: [0, 0],
    Facturación: [2, 2], Cita: [57, 25], Notificación: [34, 25], Anexos: [14, 7],
    Generación: [10, 5], Envío: [1, 1], Seguimiento: [178, 130],
  }
  const conteos = new Map(
    SOENA.map((e) => [e.numero, { total: MEDIDO[e.nombre][0], atrasados: MEDIDO[e.nombre][1] }]),
  )
  const nivelDe = (niveles: Map<number, string>, nombre: string) =>
    niveles.get(SOENA.find((e) => e.nombre === nombre)!.numero)

  it('con los conteos reales marca solo las etapas que juntan la mitad de los atrasados', () => {
    const niveles = nivelesDeAtraso(SOENA, conteos)
    const concentran = SOENA.filter((e) => niveles.get(e.numero) === 'concentra').map((e) => e.nombre)
    expect(concentran.sort()).toEqual(['Propuesta', 'Seguimiento'])
    expect(nivelDe(niveles, 'Cita')).toBe('con_atrasados')
    expect(nivelDe(niveles, 'Inclusión')).toBe('al_dia')
  })

  it('no es la proporción: una etapa chica con todo vencido no pesa como una grande', () => {
    const niveles = nivelesDeAtraso(SOENA, conteos)
    // Envío: 1 de 1 vencido (100 %). Seguimiento: 130 de 178 (73 %).
    expect(nivelDe(niveles, 'Envío')).toBe('con_atrasados')
    expect(nivelDe(niveles, 'Seguimiento')).toBe('concentra')
  })

  it('no es el volumen: más casos con menos atrasados no se pinta más fuerte', () => {
    const linea = [
      { numero: 1, sla_horas: 24 },
      { numero: 2, sla_horas: 24 },
    ]
    const niveles = nivelesDeAtraso(linea, new Map([[1, { total: 200, atrasados: 3 }], [2, { total: 10, atrasados: 9 }]]))
    expect(niveles.get(1)).toBe('con_atrasados')
    expect(niveles.get(2)).toBe('concentra')
  })

  it('una etapa sin SLA nunca se pinta de alerta, aunque le lleguen atrasados', () => {
    const sinSla = SOENA.map((e) => (e.nombre === 'Seguimiento' ? { ...e, sla_horas: null } : e))
    const niveles = nivelesDeAtraso(sinSla, conteos)
    expect(nivelDe(niveles, 'Seguimiento')).toBe('sin_sla')
  })

  it('los empates con la última que entra entran todos: el desempate no puede ser arbitrario', () => {
    const linea = [1, 2, 3].map((numero) => ({ numero, sla_horas: 24 }))
    const niveles = nivelesDeAtraso(linea, new Map([1, 2, 3].map((n) => [n, { total: 5, atrasados: 5 }])))
    expect([...niveles.values()]).toEqual(['concentra', 'concentra', 'concentra'])
  })

  it('sin atrasados en la línea, nada se marca', () => {
    const niveles = nivelesDeAtraso(SOENA, new Map())
    expect([...niveles.values()].every((n) => n === 'al_dia')).toBe(true)
  })
})
