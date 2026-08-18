import { describe, it, expect } from 'vitest'
import {
  leerDeclaraciones,
  destinosDeEtapa,
  etapasAguasAbajo,
  bloqueArchivable,
  debeRetornar,
  mensajeAviso,
  type EtapaRetorno,
} from './retorno-decision'

// Topologia REAL de SOENA VE (linea 34a0fa6b, leida de produccion el 2026-08-03). Se usa
// la real porque es la que destapa el problema: el `orden` NO ordena el recorrido (Anexos
// 18 enruta a Generacion 13), y Cita 16 se alcanza desde DOS decisiones distintas.
const SOENA: EtapaRetorno[] = [
  { id: 'e0', nombre: 'Recepcion', orden: 0, numero: 99, routing: { default_etapa_orden: 1, conditional: [] } },
  { id: 'e1', nombre: 'Validacion', orden: 1, numero: 1, routing: { default_etapa_orden: 4, conditional: [{ condition: { field: 'cargado_upme', value: 'no' }, etapa_orden: 2 }] } },
  { id: 'e2', nombre: 'Inclusion', orden: 2, numero: 2, routing: { default_etapa_orden: 4, conditional: [] } },
  { id: 'e4', nombre: 'Propuesta', orden: 4, numero: 3, routing: null },
  { id: 'e5', nombre: 'Negociacion', orden: 5, numero: 4, routing: null },
  { id: 'e6', nombre: 'Documentacion', orden: 6, numero: 5, routing: { default_etapa_orden: 7, conditional: [{ condition: { field: 'servicio', value: 'solo_iva' }, etapa_orden: 10 }] } },
  { id: 'e7', nombre: 'Cargue', orden: 7, numero: 6, routing: null },
  { id: 'e8', nombre: 'Pago UPME', orden: 8, numero: 7, routing: null },
  { id: 'e9', nombre: 'Certificacion', orden: 9, numero: 8, routing: null },
  { id: 'e10', nombre: 'Precobro', orden: 10, numero: 9, routing: null },
  { id: 'e11', nombre: 'Cobro', orden: 11, numero: 10, routing: { default_etapa_orden: 12, conditional: [{ condition: { field: 'requiere_cita_dian', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e12', nombre: 'Entrega', orden: 12, numero: 11, routing: { default_etapa_orden: 15, conditional: [{ condition: { field: 'requiere_cita_dian_iva', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian_iva', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e13', nombre: 'Generacion', orden: 13, numero: 15, routing: null },
  { id: 'e14', nombre: 'Envio', orden: 14, numero: 16, routing: { default_etapa_orden: 19, conditional: [] } },
  { id: 'e15', nombre: 'Facturacion', orden: 15, numero: 18, routing: { default_etapa_orden: 15, conditional: [] } },
  { id: 'e16', nombre: 'Cita', orden: 16, numero: 12, routing: { default_etapa_orden: 17, conditional: [] } },
  { id: 'e17', nombre: 'Notificacion', orden: 17, numero: 13, routing: { default_etapa_orden: 18, conditional: [] } },
  { id: 'e18', nombre: 'Anexos', orden: 18, numero: 14, routing: { default_etapa_orden: 13, conditional: [] } },
  { id: 'e19', nombre: 'Seguimiento', orden: 19, numero: 17, routing: { default_etapa_orden: 15, conditional: [] } },
]

const etapa = (orden: number): EtapaRetorno => {
  const e = SOENA.find(x => x.orden === orden)
  if (!e) throw new Error(`etapa ${orden} no existe en el fixture`)
  return e
}

describe('leerDeclaraciones', () => {
  it('sin la clave, no hay declaraciones — el comportamiento no cambia para nadie', () => {
    expect(leerDeclaraciones(null)).toEqual([])
    expect(leerDeclaraciones({})).toEqual([])
    expect(leerDeclaraciones({ punto_de_decision: 'si' })).toEqual([])
  })

  it('descarta entradas sin campo: devolver un caso es demasiado caro para hacerlo por una config a medias', () => {
    expect(leerDeclaraciones({ punto_de_decision: [{ depende: { etapas: [12] } }, null, 7] })).toEqual([])
    expect(leerDeclaraciones({ punto_de_decision: [{ campo: '  ' }] })).toEqual([])
  })

  it('lee campo, aviso y dependencias', () => {
    const d = leerDeclaraciones({
      punto_de_decision: [{ campo: 'requiere_cita_dian', aviso: 'Ojo', depende: { etapas: [12, 'x'], bloques: ['via_solicitud_cita', 3] } }],
    })
    expect(d).toHaveLength(1)
    expect(d[0].campo).toBe('requiere_cita_dian')
    expect(d[0].aviso).toBe('Ojo')
    expect(d[0].depende?.etapas).toEqual([12])
    expect(d[0].depende?.bloques).toEqual(['via_solicitud_cita'])
  })
})

describe('destinosDeEtapa', () => {
  it('devuelve el default y TODAS las ramas condicionales', () => {
    expect(destinosDeEtapa(etapa(11), SOENA).sort((a, b) => a - b)).toEqual([12, 16, 18])
  })

  it('sin routing sigue la siguiente por orden ascendente, no orden+1 (el orden tiene huecos)', () => {
    expect(destinosDeEtapa(etapa(2), SOENA)).toEqual([4])
    expect(destinosDeEtapa(etapa(4), SOENA)).toEqual([5])
  })

  it('una etapa que se apunta a si misma cierra: no tiene salidas', () => {
    expect(destinosDeEtapa(etapa(15), SOENA)).toEqual([])
  })
})

describe('etapasAguasAbajo', () => {
  it('recorre las ramas, no compara ordenes', () => {
    // Anexos (18) enruta a Generacion (13): un orden MENOR que si esta aguas abajo.
    expect(etapasAguasAbajo(SOENA, 12).has(13)).toBe(true)
    expect(etapasAguasAbajo(SOENA, 12).has(14)).toBe(true)
  })

  it('lo que esta antes NO queda aguas abajo aunque el numero de orden confunda', () => {
    const abajoDeCobro = etapasAguasAbajo(SOENA, 11)
    expect(abajoDeCobro.has(7)).toBe(false)   // Cargue: orden 7 < 11, y ademas es anterior
    expect(abajoDeCobro.has(10)).toBe(false)  // Precobro
  })

  it('Entrega (12) NO alcanza a Cobro (11): corregir la decision de Entrega no puede devolver a Cobro', () => {
    expect(etapasAguasAbajo(SOENA, 12).has(11)).toBe(false)
  })

  // Estos cuatro conjuntos son los que se usaron para MEDIR el alcance contra produccion
  // (194 / 163 / 15 / 9 negocios abiertos elegibles). Se fijan aqui para que la medicion y
  // el codigo no puedan separarse: si el recorrido cambia, la prueba lo dice.
  it('los conjuntos aguas abajo de los cuatro puntos de decision de SOENA VE', () => {
    const orden = (s: Set<number>) => [...s].sort((a, b) => a - b)
    expect(orden(etapasAguasAbajo(SOENA, 1))).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(orden(etapasAguasAbajo(SOENA, 6))).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(orden(etapasAguasAbajo(SOENA, 11))).toEqual([12, 13, 14, 15, 16, 17, 18, 19])
    expect(orden(etapasAguasAbajo(SOENA, 12))).toEqual([13, 14, 15, 16, 17, 18, 19])
  })

  it('no cicla con routings que se devuelven entre si', () => {
    const ciclo: EtapaRetorno[] = [
      { id: 'a', nombre: 'A', orden: 1, numero: 1, routing: { default_etapa_orden: 2, conditional: [] } },
      { id: 'b', nombre: 'B', orden: 2, numero: 2, routing: { default_etapa_orden: 1, conditional: [] } },
    ]
    expect([...etapasAguasAbajo(ciclo, 1)].sort()).toEqual([2])
  })
})

describe('bloqueArchivable', () => {
  it('un bloque normal se archiva', () => {
    expect(bloqueArchivable({})).toBe(true)
    expect(bloqueArchivable(null)).toBe(true)
  })

  it('un heredado readonly NO: su dato vive en otra etapa que no se esta rehaciendo', () => {
    expect(bloqueArchivable({ source_etapa_orden: 5 })).toBe(false)
  })

  it('conservar_en_reproceso NO: mismo criterio que el reproceso, o dos mecanismos vecinos discrepan', () => {
    expect(bloqueArchivable({ conservar_en_reproceso: true })).toBe(false)
  })

  it('un bloque que mueve plata NO se archiva NUNCA, este o no declarado', () => {
    expect(bloqueArchivable({ es_pagos_epayco: true })).toBe(false)
    expect(bloqueArchivable({ es_pago_externo: true })).toBe(false)
    expect(bloqueArchivable({ triggers: [{ event: 'complete', action: 'auto_cobros' }] })).toBe(false)
    expect(bloqueArchivable({ triggers: [{ event: 'complete', action: 'auto_cobros_multi' }] })).toBe(false)
  })

  it('un trigger que no crea cobros no impide archivar', () => {
    expect(bloqueArchivable({ triggers: [{ event: 'complete', action: 'otra_cosa' }] })).toBe(true)
  })
})

describe('debeRetornar', () => {
  const base = {
    etapaActualId: 'e16',
    etapaActualOrden: 16,
    decisionEtapaId: 'e12',
    decisionEtapaOrden: 12,
    pasoPorLaEtapa: true,
    aguasAbajo: etapasAguasAbajo(SOENA, 12),
  }

  it('devuelve cuando el caso paso el punto y esta aguas abajo', () => {
    expect(debeRetornar(base)).toBe(true)
  })

  it('NO devuelve si el caso sigue en la etapa de decision: el motor aun no ha decidido', () => {
    expect(debeRetornar({ ...base, etapaActualId: 'e12', etapaActualOrden: 12 })).toBe(false)
  })

  it('NO devuelve si el caso nunca paso por la etapa — 108 de los 116 casos en Cita', () => {
    expect(debeRetornar({ ...base, pasoPorLaEtapa: false })).toBe(false)
  })

  it('NO devuelve si el caso esta ANTES del punto: volvera a pasar por el solo', () => {
    expect(debeRetornar({ ...base, etapaActualId: 'e7', etapaActualOrden: 7 })).toBe(false)
  })
})

describe('mensajeAviso', () => {
  it('redacta con el nombre de la etapa destino y la pregunta', () => {
    expect(mensajeAviso({ campo: 'requiere_cita_dian_iva' }, 'Entrega', '¿Requiere cita previa en la DIAN?'))
      .toBe('"¿Requiere cita previa en la DIAN?" define la ruta del caso: cambiarlo lo devuelve a Entrega para volver a decidir.')
  })

  it('cae al slug si el campo no tiene etiqueta', () => {
    expect(mensajeAviso({ campo: 'cargado_upme' }, 'Validacion')).toContain('"cargado_upme"')
  })

  it('la etapa puede reemplazar el texto entero', () => {
    expect(mensajeAviso({ campo: 'x', aviso: 'Texto propio' }, 'Entrega')).toBe('Texto propio')
  })
})
