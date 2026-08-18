import { describe, it, expect } from 'vitest'
import {
  exigeDatoDeDecision,
  camposDeDecision,
  esRespuesta,
  decisionesSinResponder,
  mensajeDatoFaltante,
  type RoutingEtapa,
} from './dato-de-decision'

// Routing real de la etapa Entrega (SOENA VE, orden 12): el que mandó 17 casos al cierre.
const ENTREGA: RoutingEtapa = {
  default_etapa_orden: 15,
  label_default: 'Si no requiere devolución de IVA',
  conditional: [
    { condition: { field: 'requiere_cita_dian_iva', value: 'true' }, etapa_orden: 16 },
    { condition: { field: 'requiere_cita_dian_iva', value: 'false' }, etapa_orden: 18 },
  ],
}

describe('opt-in de la exigencia', () => {
  it('sin flag, ninguna etapa cambia de comportamiento', () => {
    expect(exigeDatoDeDecision({})).toBe(false)
    expect(exigeDatoDeDecision(null)).toBe(false)
    expect(exigeDatoDeDecision(undefined)).toBe(false)
    expect(exigeDatoDeDecision({ routing: ENTREGA })).toBe(false)
  })

  it('solo el booleano verdadero enciende: una config a medio escribir no frena avances', () => {
    expect(exigeDatoDeDecision({ exigir_dato_de_decision: true })).toBe(true)
    expect(exigeDatoDeDecision({ exigir_dato_de_decision: 'true' })).toBe(false)
    expect(exigeDatoDeDecision({ exigir_dato_de_decision: 1 })).toBe(false)
    expect(exigeDatoDeDecision({ exigir_dato_de_decision: false })).toBe(false)
  })
})

describe('qué campos gobiernan la bifurcación', () => {
  it('las dos ramas de Entrega leen el mismo campo: se exige una sola vez', () => {
    expect(camposDeDecision(ENTREGA)).toEqual(['requiere_cita_dian_iva'])
  })

  it('un routing sin condiciones no decide nada: no hay dato que exigir', () => {
    expect(camposDeDecision({ default_etapa_orden: 7 })).toEqual([])
    expect(camposDeDecision({ default_etapa_orden: 7, conditional: [] })).toEqual([])
    expect(camposDeDecision(null)).toEqual([])
  })

  it('varias condiciones sobre campos distintos se exigen todas, en orden', () => {
    expect(camposDeDecision({
      default_etapa_orden: 9,
      conditional: [
        { condition: { field: 'servicio', value: 'solo_iva' }, etapa_orden: 10 },
        { condition: { field: 'requiere_devolucion_iva', value: 'true' }, etapa_orden: 11 },
      ],
    })).toEqual(['servicio', 'requiere_devolucion_iva'])
  })
})

describe('qué cuenta como respuesta', () => {
  // El motor compara String(valor ?? ''); se mide exactamente eso.
  it('el vacío no es una respuesta', () => {
    expect(esRespuesta(undefined)).toBe(false)
    expect(esRespuesta(null)).toBe(false)
    expect(esRespuesta('')).toBe(false)
    expect(esRespuesta('   ')).toBe(false)
    expect(esRespuesta([])).toBe(false)
  })

  // Clave: el routing puede tener una rama para "false". Confundir "respondió que no" con
  // "no respondió" es justo el error que esta regla existe para impedir.
  it('un no explícito SÍ es una respuesta', () => {
    expect(esRespuesta(false)).toBe(true)
    expect(esRespuesta('false')).toBe(true)
    expect(esRespuesta('no')).toBe(true)
    expect(esRespuesta(0)).toBe(true)
  })

  it('cualquier valor con contenido es una respuesta', () => {
    expect(esRespuesta('true')).toBe(true)
    expect(esRespuesta(true)).toBe(true)
    expect(esRespuesta(12)).toBe(true)
  })
})

describe('qué se frena y qué no', () => {
  const CITA = {
    campo: 'requiere_cita_dian_iva',
    label: '¿Requiere cita previa en la DIAN?',
    bloque: 'Cita DIAN',
    etapa: 'Entrega',
  }

  it('con el dato respondido no frena nada', () => {
    expect(decisionesSinResponder([CITA], { requiere_cita_dian_iva: 'true' })).toEqual([])
    expect(decisionesSinResponder([CITA], { requiere_cita_dian_iva: 'false' })).toEqual([])
  })

  // Los 5 casos de Entrega (V0049, V0066, V0070, V0071, V0080) que sí requieren devolución
  // de IVA y no tienen ni la instancia del bloque creada.
  it('con el dato ausente frena, aunque el bloque ni exista en el negocio', () => {
    expect(decisionesSinResponder([CITA], {})).toHaveLength(1)
    expect(decisionesSinResponder([CITA], { requiere_cita_dian_iva: '' })).toHaveLength(1)
  })

  // V0022 y V0023: sin devolución de IVA el bloque no les aplica, así que el vacío es
  // deliberado y el default (Facturación) es su ruta correcta. Frenarlos los dejaría sin
  // salida: el bloque es de solo lectura, no hay dónde responder.
  it('si la pregunta no le aplica al caso, el vacío es legítimo y no frena', () => {
    expect(decisionesSinResponder([{ ...CITA, aplica: false }], {})).toEqual([])
  })

  it('un bloque sin condición aplica a todos', () => {
    expect(decisionesSinResponder([{ campo: 'cargado_upme', bloque: 'Registro UPME' }], {})).toHaveLength(1)
  })

  it('frena una sola vez por campo faltante, no por rama', () => {
    const faltantes = decisionesSinResponder(
      [CITA, { campo: 'requiere_devolucion_iva', bloque: 'Devolución de IVA' }],
      { requiere_devolucion_iva: 'true' },
    )
    expect(faltantes.map(f => f.campo)).toEqual(['requiere_cita_dian_iva'])
  })
})

describe('el rechazo es legible', () => {
  it('dice QUÉ falta y DÓNDE se responde', () => {
    const msg = mensajeDatoFaltante({
      campo: 'requiere_cita_dian_iva',
      label: '¿Requiere cita previa en la DIAN?',
      bloque: 'Cita DIAN',
      etapa: 'Entrega',
    })
    expect(msg).toContain('¿Requiere cita previa en la DIAN?')
    expect(msg).toContain('Cita DIAN')
    expect(msg).toContain('Entrega')
  })

  it('sin label cae al slug, para no quedarse mudo', () => {
    expect(mensajeDatoFaltante({ campo: 'cargado_upme', bloque: 'Registro UPME' }))
      .toContain('cargado_upme')
  })

  // Distinto problema, distinto mensaje: no falta la respuesta, falta dónde responderla.
  it('si ningún bloque pide el campo, lo dice en vez de mandar a buscar una casilla que no existe', () => {
    const msg = mensajeDatoFaltante({ campo: 'requiere_cita_dian_iva', bloque: null })
    expect(msg).toContain('Ningún bloque de la etapa lo pide')
  })

  it('la etapa puede reemplazar el texto entero, como cualquier gate', () => {
    expect(mensajeDatoFaltante(
      { campo: 'requiere_cita_dian_iva', bloque: 'Cita DIAN' },
      'Abre el caso para que el sistema resuelva la seccional del RUT.',
    )).toBe('Abre el caso para que el sistema resuelva la seccional del RUT.')
  })

  it('un mensaje configurado vacío no deja al equipo sin explicación', () => {
    expect(mensajeDatoFaltante({ campo: 'x', label: 'Pregunta', bloque: 'B' }, '   '))
      .toContain('Pregunta')
  })
})
