/**
 * La vista de la tabla. Lo que se prueba es lo que la referencia decidió y que un rediseño rompería
 * sin darse cuenta: que un proceso que coincide y queda negativo SE MUESTRA, que el orden no se
 * mueve solo entre renders, y qué hace cada filtro con un proceso sin fecha de cierre.
 */
import { describe, expect, it } from 'vitest'
import { BIBLIOTECA, PRESETS, temasActivos } from './biblioteca'
import {
  FILTROS_VACIOS,
  ORDEN_INICIAL,
  conteoPorTema,
  opcionesDe,
  ordenar,
  parsearConsulta,
  pasaFiltros,
  puntuarTodos,
  resumir,
  type Filtros,
  type ProcesoBase,
} from './vista'

const HOY = '2026-09-28'
const METRIK = temasActivos({ seleccionados: PRESETS.metrik.temas, pesos: PRESETS.metrik.pesos })

function proceso(p: Partial<ProcesoBase> & { noticeUid: string }): ProcesoBase {
  return {
    referencia: 'REF',
    entidad: 'ENTIDAD',
    departamento: 'Antioquia',
    modalidad: 'Licitación pública',
    tipoContrato: 'Prestación de servicios',
    objeto: 'OBJETO SIN TEMAS',
    valor: 1_000_000,
    fechaCierre: '2026-10-06',
    duracion: null,
    url: null,
    sinRup: false,
    ...p,
  }
}

const UNIVERSO: ProcesoBase[] = [
  // Fit 8: el caso real de $5.528M.
  proceso({
    noticeUid: 'A',
    referencia: 'SDP-LP-003-2026',
    objeto: 'CONTRATAR UNA FÁBRICA DE SOFTWARE Y MANTENIMIENTO DE LOS SISTEMAS DE INFORMACIÓN',
    valor: 5_528_513_061,
    fechaCierre: '2026-10-06',
    departamento: 'Distrito Capital de Bogotá',
  }),
  // Coincide (interoperabilidad, +6) y queda en -2 por el dominio férreo.
  proceso({
    noticeUid: 'B',
    referencia: 'SIP-DTE-SRT-043-2026',
    objeto: 'MANUAL DE INTEROPERABILIDAD FÉRREA',
    valor: 0,
    modalidad: 'Solicitud de información a los Proveedores',
    sinRup: true,
    fechaCierre: '2026-09-30',
    tipoContrato: 'No Especificado',
  }),
  // No coincide con nada y cierra sin fecha.
  proceso({ noticeUid: 'C', objeto: 'ARRENDAMIENTO DE UN PREDIO RURAL', fechaCierre: null, valor: 50_000_000 }),
  // Cae en una exclusión de MeTRIK.
  proceso({ noticeUid: 'D', objeto: 'JORNADA DE VACUNACION ANTIRRABICA', fechaCierre: '2026-09-29' }),
]

function puntuados(op: Partial<Parameters<typeof puntuarTodos>[1]> = {}) {
  return puntuarTodos(UNIVERSO, {
    temas: METRIK,
    senalFuerte: BIBLIOTECA.senalFuerte,
    exclusiones: PRESETS.metrik.exclusiones,
    seguidos: [],
    ocultos: [],
    hoy: HOY,
    ...op,
  })
}

const visibles = (xs: ReturnType<typeof puntuados>, f: Partial<Filtros> = {}) => {
  const filtros = { ...FILTROS_VACIOS, ...f }
  const q = parsearConsulta(filtros.q)
  return xs.filter((x) => pasaFiltros(x, filtros, q))
}

describe('puntuar el universo', () => {
  const xs = puntuados()
  const porId = Object.fromEntries(xs.map((x) => [x.noticeUid, x]))

  it('los fits son los mismos que fija puntuar.test.ts', () => {
    expect(porId.A.fit).toBe(8)
    expect(porId.B.fit).toBe(-2)
    expect(porId.C.fit).toBe(0)
  })

  it('un proceso que coincide y queda NEGATIVO se marca como coincidencia', () => {
    // El fit ordena; la coincidencia filtra. Esconderlo sería decidir por el cliente.
    expect(porId.B.coincide).toBe(true)
    expect(porId.B.fit).toBeLessThan(0)
    expect(porId.C.coincide).toBe(false)
  })

  it('los días para el cierre salen de la fecha, y sin fecha quedan en null', () => {
    expect(porId.A.dias).toBe(8)
    expect(porId.B.dias).toBe(2)
    expect(porId.C.dias).toBeNull()
  })

  it('la exclusión que saca un proceso se dice, no se calla', () => {
    expect(porId.D.excluidoPor).toBe('vacun')
    expect(porId.A.excluidoPor).toBeNull()
  })
})

describe('filtros', () => {
  const xs = puntuados()

  it('las exclusiones se aplican por defecto y se pueden apagar', () => {
    expect(visibles(xs).map((x) => x.noticeUid)).toEqual(['A', 'B', 'C'])
    // Apagarlas devuelve el excluido: el cliente tiene que poder ver qué le están sacando.
    expect(visibles(xs, { aplicarExclusiones: false }).map((x) => x.noticeUid)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('un oculto se va SIEMPRE, incluso con las exclusiones apagadas', () => {
    const conOculto = puntuados({ ocultos: ['A'] })
    expect(visibles(conOculto, { aplicarExclusiones: false }).map((x) => x.noticeUid)).not.toContain('A')
  })

  it('«solo los que sigo» y «coincide con mis temas»', () => {
    const conSeguido = puntuados({ seguidos: ['C'] })
    expect(visibles(conSeguido, { soloSeguidos: true }).map((x) => x.noticeUid)).toEqual(['C'])
    // C no coincide con ningún tema: con el filtro encendido se cae, aunque su fit sea 0 y no −7.
    expect(visibles(xs, { soloCoincide: true }).map((x) => x.noticeUid)).toEqual(['A', 'B'])
  })

  it('sin RUP filtra por la bandera del barrido', () => {
    expect(visibles(xs, { soloSinRup: true }).map((x) => x.noticeUid)).toEqual(['B'])
  })

  it('un proceso SIN fecha de cierre no pasa un filtro por fecha, pero sí aparece sin él', () => {
    // No se puede afirmar que cierre dentro de 30 días: el dato no existe.
    expect(visibles(xs, { cierraEn: 30 }).map((x) => x.noticeUid)).toEqual(['A', 'B'])
    expect(visibles(xs).map((x) => x.noticeUid)).toContain('C')
  })

  it('el rango de valor incluye los extremos y el 0 del sondeo', () => {
    expect(visibles(xs, { min: 1_000_000 }).map((x) => x.noticeUid)).toEqual(['A', 'C'])
    expect(visibles(xs, { max: 0 }).map((x) => x.noticeUid)).toEqual(['B'])
    expect(visibles(xs, { min: 0, max: 5_528_513_061 }).map((x) => x.noticeUid)).toEqual(['A', 'B', 'C'])
  })

  it('región y área son listas: vacía = todas', () => {
    expect(visibles(xs, { regiones: ['Distrito Capital de Bogotá'] }).map((x) => x.noticeUid)).toEqual(['A'])
    expect(visibles(xs, { areas: ['No Especificado'] }).map((x) => x.noticeUid)).toEqual(['B'])
    expect(visibles(xs, { regiones: [] })).toHaveLength(3)
  })
})

describe('la búsqueda con operadores', () => {
  const xs = puntuados()

  it('varias palabras son Y, y no distinguen tildes', () => {
    expect(parsearConsulta('fabrica software').si).toEqual(['FABRICA', 'SOFTWARE'])
    expect(visibles(xs, { q: 'fábrica software' }).map((x) => x.noticeUid)).toEqual(['A'])
    expect(visibles(xs, { q: 'fabrica predio' })).toEqual([])
  })

  it('una frase entre comillas se busca completa', () => {
    expect(visibles(xs, { q: '"fabrica de software"' }).map((x) => x.noticeUid)).toEqual(['A'])
    expect(visibles(xs, { q: '"software de fabrica"' })).toEqual([])
  })

  it('el guion excluye y la barra es O', () => {
    expect(visibles(xs, { q: '-mantenimiento' }).map((x) => x.noticeUid)).toEqual(['B', 'C'])
    expect(visibles(xs, { q: 'predio|ferrea' }).map((x) => x.noticeUid)).toEqual(['B', 'C'])
  })

  it('busca también en la entidad y en la referencia, no solo en el objeto', () => {
    expect(visibles(xs, { q: 'SDP-LP-003-2026' }).map((x) => x.noticeUid)).toEqual(['A'])
  })

  it('un guion solo no es un operador', () => {
    const q = parsearConsulta('-')
    expect(q.no).toEqual([])
    expect(q.si).toEqual(['-'])
  })
})

describe('orden', () => {
  const xs = puntuados()

  it('el orden inicial es el mejor fit primero: es la razón de ser del Radar', () => {
    expect(ORDEN_INICIAL).toEqual({ col: 'fit', asc: false })
    expect(ordenar(xs, ORDEN_INICIAL).map((x) => x.noticeUid)).toEqual(['A', 'C', 'D', 'B'])
  })

  it('por «vence en» ascendente, lo que no tiene fecha va AL FINAL', () => {
    // Sin fecha es lo que menos se sabe, no lo más urgente: ponerlo primero sería inventar urgencia.
    expect(ordenar(xs, { col: 'dias', asc: true }).map((x) => x.noticeUid)).toEqual(['D', 'B', 'A', 'C'])
  })

  it('el desempate es estable: dos fits iguales no se intercambian entre renders', () => {
    const empatados = puntuarTodos(
      [proceso({ noticeUid: 'Z', objeto: 'NADA' }), proceso({ noticeUid: 'Y', objeto: 'NADA' })],
      { temas: METRIK, senalFuerte: BIBLIOTECA.senalFuerte, exclusiones: null, seguidos: [], ocultos: [], hoy: HOY },
    )
    expect(ordenar(empatados, ORDEN_INICIAL).map((x) => x.noticeUid)).toEqual(['Y', 'Z'])
    // Y al revés del arreglo de entrada, el resultado es el mismo.
    expect(ordenar([...empatados].reverse(), ORDEN_INICIAL).map((x) => x.noticeUid)).toEqual(['Y', 'Z'])
  })

  it('el texto se ordena en español y el número como número', () => {
    expect(ordenar(xs, { col: 'valor', asc: false })[0].noticeUid).toBe('A')
    expect(ordenar(xs, { col: 'entidad', asc: true })).toHaveLength(4)
  })
})

describe('resumen y opciones', () => {
  it('las cifras de las tarjetas se cuentan sobre lo VISIBLE, no sobre el universo', () => {
    const xs = puntuados()
    const r = resumir(visibles(xs))
    expect(r.vigentes).toBe(3)
    expect(r.sinRup).toBe(1)
    expect(r.coinciden).toBe(2)
    expect(r.valorTotal).toBe(5_528_513_061 + 0 + 50_000_000)
    // B cierra en 2 días; A en 8 y C no tiene fecha.
    expect(r.pronto).toBe(1)
  })

  it('las opciones de un filtro vienen con su conteo, más frecuente primero', () => {
    // Tres del universo quedan en Antioquia (el valor por defecto de la fábrica de fixtures) y
    // solo A lo cambia.
    expect(opcionesDe(UNIVERSO, 'departamento')).toEqual([
      { valor: 'Antioquia', n: 3 },
      { valor: 'Distrito Capital de Bogotá', n: 1 },
    ])
    // El área sí tiene tres valores distintos.
    expect(opcionesDe(UNIVERSO, 'tipoContrato')).toEqual([
      { valor: 'Prestación de servicios', n: 3 },
      { valor: 'No Especificado', n: 1 },
    ])
  })

  it('el conteo por tema dice cuántos procesos lo mencionan HOY', () => {
    const acrilico = BIBLIOTECA.temas.find((t) => t.id === 'acrilico')!
    const fabrica = BIBLIOTECA.temas.find((t) => t.id === 'fabrica-software')!
    // «acrílico — 0 procesos» vale más que una casilla: es el riesgo medido del trial de Fabri.
    expect(conteoPorTema(UNIVERSO, acrilico, BIBLIOTECA.senalFuerte)).toBe(0)
    expect(conteoPorTema(UNIVERSO, fabrica, BIBLIOTECA.senalFuerte)).toBe(1)
  })
})
