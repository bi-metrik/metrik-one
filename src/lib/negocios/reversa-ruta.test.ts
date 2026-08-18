import { describe, it, expect } from 'vitest'
import {
  reversaActiva,
  destinoDeEtapa,
  recorridoDesde,
  divergenciaDeRuta,
  mensajePropuesta,
  type EtapaRuta,
  type ValoresPorOrden,
} from './reversa-ruta'

// Topologia REAL de SOENA VE (linea 34a0fa6b, re-leida de produccion el 2026-08-11). Es la misma que usa
// `retorno-decision.test.ts` y se usa la real a proposito: contiene el caso que destapa el
// problema (Documentacion 6 bifurca a Cargue 7 o Precobro 10) y las trampas del `orden`
// (Anexos 18 enruta a Generacion 13, asi que "orden mayor" NO es "mas adelante").
//
// `tieneCasillas` es true en todas salvo donde una prueba lo cambie a proposito.
const BASE: Omit<EtapaRuta, 'tieneCasillas' | 'puedeSaltarsePorSaldo'>[] = [
  { id: 'e0', nombre: 'Recepcion', orden: 0, numero: 99, routing: { default_etapa_orden: 1, conditional: [] } },
  { id: 'e1', nombre: 'Validacion', orden: 1, numero: 1, routing: { default_etapa_orden: 4, conditional: [{ condition: { field: 'cargado_upme', value: 'no' }, etapa_orden: 2 }] } },
  { id: 'e2', nombre: 'Inclusion', orden: 2, numero: 2, routing: { default_etapa_orden: 4, conditional: [] } },
  { id: 'e4', nombre: 'Propuesta', orden: 4, numero: 3, routing: null },
  { id: 'e5', nombre: 'Negociacion', orden: 5, numero: 4, routing: null },
  { id: 'e6', nombre: 'Documentacion', orden: 6, numero: 5, routing: { default_etapa_orden: 7, source_etapa_orden: 5, conditional: [{ condition: { field: 'servicio', value: 'solo_iva' }, etapa_orden: 10 }] } },
  { id: 'e7', nombre: 'Cargue', orden: 7, numero: 6, routing: null },
  { id: 'e8', nombre: 'Pago UPME', orden: 8, numero: 7, routing: null },
  { id: 'e9', nombre: 'Certificacion', orden: 9, numero: 8, routing: null },
  { id: 'e10', nombre: 'Precobro', orden: 10, numero: 9, routing: null },
  { id: 'e11', nombre: 'Cobro', orden: 11, numero: 10, routing: { default_etapa_orden: 12, source_etapa_orden: 6, conditional: [{ condition: { field: 'requiere_cita_dian', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e12', nombre: 'Entrega', orden: 12, numero: 11, routing: { default_etapa_orden: 15, conditional: [{ condition: { field: 'requiere_cita_dian_iva', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian_iva', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e13', nombre: 'Generacion', orden: 13, numero: 15, routing: null },
  { id: 'e14', nombre: 'Envio', orden: 14, numero: 16, routing: { default_etapa_orden: 19, conditional: [] } },
  { id: 'e15', nombre: 'Facturacion', orden: 15, numero: 18, routing: { default_etapa_orden: 15, conditional: [] } },
  { id: 'e16', nombre: 'Cita', orden: 16, numero: 12, routing: { default_etapa_orden: 17, conditional: [] } },
  { id: 'e17', nombre: 'Notificacion', orden: 17, numero: 13, routing: { default_etapa_orden: 18, conditional: [] } },
  { id: 'e18', nombre: 'Anexos', orden: 18, numero: 14, routing: { default_etapa_orden: 13, conditional: [] } },
  { id: 'e19', nombre: 'Seguimiento', orden: 19, numero: 17, routing: { default_etapa_orden: 15, conditional: [] } },
]

// Datos REALES de la linea (leidos de produccion): Precobro (10) declara
// `saltar_si_saldo_cero = true` y Cobro (11) es stage `cobro` sin flag, asi que las dos se
// saltan solas cuando el saldo esta cubierto. Pago UPME (8) lo declara en FALSE a
// proposito (ahi se le paga a la UPME, no se le cobra al cliente), asi que su ausencia si
// es una anomalia.
const SALTABLES = new Set([10, 11])

const SOENA: EtapaRuta[] = BASE.map(e => ({
  ...e,
  tieneCasillas: true,
  puedeSaltarsePorSaldo: SALTABLES.has(e.orden),
}))

/** La topologia con una etapa marcada sin casillas configuradas. */
function sinCasillas(orden: number): EtapaRuta[] {
  return SOENA.map(e => (e.orden === orden ? { ...e, tieneCasillas: false } : e))
}

const etapa = (orden: number): EtapaRuta => {
  const e = SOENA.find(x => x.orden === orden)
  if (!e) throw new Error(`etapa ${orden} no existe en el fixture`)
  return e
}

/** Todas las etapas ven el mismo bolsillo: basta para las condiciones de este fixture. */
function todas(valores: Record<string, unknown>): ValoresPorOrden {
  const out: ValoresPorOrden = {}
  for (const e of SOENA) out[e.orden] = valores
  return out
}

describe('reversaActiva', () => {
  it('sin la clave, apagada — ninguna linea cambia de comportamiento', () => {
    expect(reversaActiva(null)).toBe(false)
    expect(reversaActiva(undefined)).toBe(false)
    expect(reversaActiva({})).toBe(false)
    expect(reversaActiva({ reversa_ruta: {} })).toBe(false)
  })

  it('solo el booleano true la enciende: una config a medio escribir no mueve casos', () => {
    expect(reversaActiva({ reversa_ruta: { activa: true } })).toBe(true)
    expect(reversaActiva({ reversa_ruta: { activa: 'true' } })).toBe(false)
    expect(reversaActiva({ reversa_ruta: { activa: 1 } })).toBe(false)
  })
})

describe('destinoDeEtapa', () => {
  it('la condicion que coincide gana sobre el camino por defecto', () => {
    expect(destinoDeEtapa(etapa(6), SOENA, todas({ servicio: 'solo_iva' }))).toBe(10)
  })

  it('sin coincidencia, el camino por defecto', () => {
    expect(destinoDeEtapa(etapa(6), SOENA, todas({ servicio: 'completo' }))).toBe(7)
  })

  it('un booleano se compara como el motor: String(valor) contra el valor de la condicion', () => {
    expect(destinoDeEtapa(etapa(6), SOENA, todas({ servicio: 'solo_iva' }))).toBe(10)
    expect(destinoDeEtapa(etapa(6), SOENA, todas({ servicio: 'completo' }))).toBe(7)
  })

  it('campo VACIO cae al camino por defecto — es como el motor decide sin dato', () => {
    expect(destinoDeEtapa(etapa(6), SOENA, todas({}))).toBe(7)
  })

  it('sin routing sigue la SIGUIENTE por orden ascendente, no orden + 1', () => {
    // Propuesta (4) no tiene routing y despues del 2 hay un hueco: el 3 no existe.
    expect(destinoDeEtapa(etapa(4), SOENA, todas({}))).toBe(5)
    // Y desde el 2, la siguiente por routing es la 4, no la 3.
    expect(destinoDeEtapa(etapa(2), SOENA, todas({}))).toBe(4)
  })

  it('apuntarse a si misma es declarar el cierre', () => {
    expect(destinoDeEtapa(etapa(15), SOENA, todas({}))).toBeNull()
  })

  it('los campos se leen de la etapa FUENTE, no de la propia', () => {
    // Documentacion (6) declara `source_etapa_orden: 5` en produccion: el interruptor lo
    // responde el comercial en Negociacion. Leer la etapa propia daria la rama contraria.
    const valores: ValoresPorOrden = {
      5: { servicio: 'solo_iva' },
      6: { servicio: 'completo' },
    }
    expect(destinoDeEtapa(etapa(6), SOENA, valores)).toBe(10)
  })
})

describe('recorridoDesde', () => {
  it('el caso V0122 corregido: de Documentacion pasa por Cargue, Pago UPME y Certificacion', () => {
    const camino = recorridoDesde(SOENA, 6, todas({ servicio: 'completo' }), 10)
    expect(camino).toEqual([7, 8, 9, 10])
  })

  it('con el dato equivocado va derecho a Precobro', () => {
    expect(recorridoDesde(SOENA, 6, todas({ servicio: 'solo_iva' }), 10)).toEqual([10])
  })

  it('el orden NO ordena el recorrido: Anexos (18) enruta a Generacion (13)', () => {
    expect(recorridoDesde(SOENA, 18, todas({}))).toEqual([13, 14, 19, 15])
  })

  it('un routing ciclico se detiene en vez de colgar', () => {
    const ciclico: EtapaRuta[] = [
      { id: 'a', nombre: 'A', orden: 1, numero: 1, routing: { default_etapa_orden: 2 }, tieneCasillas: true, puedeSaltarsePorSaldo: false },
      { id: 'b', nombre: 'B', orden: 2, numero: 2, routing: { default_etapa_orden: 1 }, tieneCasillas: true, puedeSaltarsePorSaldo: false },
    ]
    expect(recorridoDesde(ciclico, 1, {})).toEqual([2])
  })

  it('el origen nunca va en el recorrido', () => {
    expect(recorridoDesde(SOENA, 6, todas({}))).not.toContain(6)
  })
})

describe('divergenciaDeRuta', () => {
  // El caso real: V0122 avanzo el 01-ago con el interruptor en false, se salto Cargue,
  // Pago UPME y Certificacion, y esta en Precobro cuando alguien corrige el dato.
  const v0122 = (etapaActualOrden: number, recorridas: number[]) =>
    divergenciaDeRuta({
      etapas: SOENA,
      decisionOrden: 6,
      valores: todas({ servicio: 'completo' }),
      recorridas: new Set(recorridas),
      etapaActualOrden,
    })

  it('detecta las tres etapas omitidas y propone volver a la PRIMERA', () => {
    const d = v0122(10, [0, 1, 4, 5, 6, 10])
    expect(d.omitidas).toEqual([7, 8, 9])
    expect(d.destino).toBe(7)
  })

  it('el caso puede estar varias etapas mas adelante y la propuesta no cambia', () => {
    const d = v0122(12, [0, 1, 4, 5, 6, 10, 11, 12])
    expect(d.omitidas).toEqual([7, 8, 9])
    expect(d.destino).toBe(7)
  })

  it('sin divergencia no propone nada: el caso recorrio lo que le tocaba', () => {
    const d = v0122(10, [0, 1, 4, 5, 6, 7, 8, 9, 10])
    expect(d.omitidas).toEqual([])
    expect(d.destino).toBeNull()
  })

  it('si el dato NO cambio la ruta, tampoco hay divergencia', () => {
    const d = divergenciaDeRuta({
      etapas: SOENA,
      decisionOrden: 6,
      valores: todas({ servicio: 'solo_iva' }),
      recorridas: new Set([0, 1, 4, 5, 6, 10]),
      etapaActualOrden: 10,
    })
    expect(d.destino).toBeNull()
  })

  it('recorrido parcial: si ya paso por Cargue, se propone la siguiente omitida', () => {
    const d = v0122(10, [0, 1, 4, 5, 6, 7, 10])
    expect(d.omitidas).toEqual([8, 9])
    expect(d.destino).toBe(8)
  })

  it('lo que viene DESPUES de donde esta el caso no esta omitido, esta por hacer', () => {
    // El caso esta en Cargue (7): Pago UPME y Certificacion todavia no le tocan.
    const d = v0122(7, [0, 1, 4, 5, 6, 7])
    expect(d.omitidas).toEqual([])
    expect(d.destino).toBeNull()
  })

  it('⚠️ una etapa SIN casillas configuradas nunca se declara omitida', () => {
    // No puede dejar prueba de haber sido recorrida: juzgarla propondria devolver casos
    // sanos para siempre.
    const d = divergenciaDeRuta({
      etapas: sinCasillas(7),
      decisionOrden: 6,
      valores: todas({ servicio: 'completo' }),
      recorridas: new Set([0, 1, 4, 5, 6, 10]),
      etapaActualOrden: 10,
    })
    expect(d.omitidas).toEqual([8, 9])
    expect(d.destino).toBe(8)
  })

  it('⚠️ caso REAL V0107/V0114: de Documentacion saltaron a Cita, y Precobro/Cobro NO cuentan', () => {
    // Medido en produccion (2026-08-11): las dos recorrieron 1, 4, 5, 6, 16 y 18. Se
    // saltaron CINCO etapas, pero dos de ellas (Precobro y Cobro) por el salto por saldo,
    // que es correcto. Contarlas propondria devolver el caso por algo que no fue un error.
    const d = divergenciaDeRuta({
      etapas: SOENA,
      decisionOrden: 6,
      valores: todas({ servicio: 'completo', requiere_cita_dian: 'true' }),
      recorridas: new Set([1, 4, 5, 6, 16, 18]),
      etapaActualOrden: 16,
    })
    expect(d.omitidas).toEqual([7, 8, 9])
    expect(d.destino).toBe(7)
  })

  it('una etapa saltable por saldo nunca se propone como destino', () => {
    // Si lo unico "faltante" fuera Precobro, no hay nada que proponer: se salto sola.
    const d = divergenciaDeRuta({
      etapas: SOENA,
      decisionOrden: 6,
      valores: todas({ servicio: 'completo' }),
      recorridas: new Set([0, 1, 4, 5, 6, 7, 8, 9, 11]),
      etapaActualOrden: 11,
    })
    expect(d.omitidas).toEqual([])
    expect(d.destino).toBeNull()
  })

  it('la etapa de decision nunca es destino: ya se recorrio por definicion', () => {
    const d = v0122(10, [0, 1, 4, 5, 6, 10])
    expect(d.omitidas).not.toContain(6)
  })

  it('el caso que sigue EN el punto de decision no diverge: el motor aun no decidio', () => {
    const d = v0122(6, [0, 1, 4, 5, 6])
    expect(d.destino).toBeNull()
  })
})

describe('mensajePropuesta', () => {
  it('nombra las etapas omitidas y el destino propuesto', () => {
    const msg = mensajePropuesta(
      [{ nombre: 'Cargue' }, { nombre: 'Pago UPME' }, { nombre: 'Certificacion' }],
      { nombre: 'Cargue' },
    )
    expect(msg).toContain('Cargue, Pago UPME y Certificacion')
    expect(msg).toContain('¿Devolverlo a Cargue?')
  })

  it('con una sola etapa no arma una lista', () => {
    expect(mensajePropuesta([{ nombre: 'Cargue' }], { nombre: 'Cargue' })).toContain('debía pasar por Cargue,')
  })

  it('la linea puede reemplazar el texto entero', () => {
    expect(mensajePropuesta([{ nombre: 'Cargue' }], { nombre: 'Cargue' }, 'Texto propio')).toBe('Texto propio')
  })
})
