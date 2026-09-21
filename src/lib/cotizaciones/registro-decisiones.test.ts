/**
 * El registro de decisiones: las seis reglas de §3.2.1, probadas sobre el caso real.
 *
 * El viaje a Providencia: dos ranuras de vuelo que SUMAN, un hotel que compite y un
 * traslado con dos alternativas que no abre columna. Es la topología que motivó el
 * frente, y la única sobre la que estas reglas significan algo.
 *
 * ⚠️ Lo que más importa aquí es la regla 4 —el contexto y las variantes se COPIAN— y
 * se prueba de la única forma que sirve: **mutando los ítems después de armar las
 * filas**. Una prueba que solo mire los valores pasa igual con una referencia
 * compartida, y el defecto aparecería semanas después, cuando alguien borre una
 * variante y el registro empiece a decir que se decidió contra algo que nunca estuvo.
 */
import { describe, expect, it } from 'vitest'

import {
  armarFilasDeRegistro,
  contextoDelViaje,
  diasEntre,
  faltaLaTablaDeDecisiones,
} from './registro-decisiones'
import type { ContextoCotizacion, FilaItinerario, ItemDeCotizacion } from './itinerarios-datos'

// ── El caso de Providencia ───────────────────────────────────────────────────

function item(
  id: string,
  nombre: string,
  grupo: string | null,
  costo: number,
  precio: number,
  orden: number,
): ItemDeCotizacion {
  return {
    id,
    nombre,
    grupo,
    opcion_de: null,
    es_ajuste: false,
    orden,
    dia_relativo: null,
    entra_al_precio: null,
    cantidad: 1,
    // `precio_manual` fija el precio de la línea: así los números del registro se
    // pueden verificar a mano y la prueba no depende de la cascada del margen.
    subtotal: costo,
    numeroDeRubros: 0,
    costoDeRubros: 0,
    descuento_porcentaje: 0,
    margen_porcentaje: null,
    precio_venta: precio,
    precio_manual: true,
    adicionales: [],
  }
}

const VUELO_1 = 'vuelo: Bogotá a San Andrés'
const VUELO_2 = 'vuelo 2: San Andrés a Providencia'

function items(): ItemDeCotizacion[] {
  return [
    item('avianca', 'AVIANCA', VUELO_1, 1_000_000, 1_200_000, 1),
    item('wingo', 'WINGO', VUELO_1, 800_000, 900_000, 2),
    item('sat-am', 'SATENA 7:00', VUELO_2, 400_000, 500_000, 3),
    item('sat-pm', 'SATENA 15:00', VUELO_2, 350_000, 430_000, 4),
    item('occidental', 'OCCIDENTAL', 'hotel', 1_500_000, 1_800_000, 5),
    item('hard-rock', 'HARD ROCK', 'hotel', 2_000_000, 2_400_000, 6),
    // Traslado: dos alternativas que NO abren columna. Aporta el primero por orden.
    item('van', 'VAN PRIVADA', 'traslado', 100_000, 130_000, 7),
    item('bus', 'BUS COMPARTIDO', 'traslado', 40_000, 55_000, 8),
    // Componente suelto: sin grupo, entra en todas.
    item('seguro', 'SEGURO DE VIAJE', null, 60_000, 80_000, 9),
  ]
}

function ctx(lista = items()): ContextoCotizacion {
  return {
    items: lista,
    params: {
      administrativosPct: 0,
      margenPct: 0,
      descuentoComercialPct: 0,
      convencionMargen: 'sobre_venta',
    },
    umbrales: { pisoPct: 5, avisoPct: 10 },
    negocioId: 'neg-1',
    oportunidadId: null,
  }
}

function tarifa(
  id: string,
  nombre: string,
  seleccion: string[],
  extra: Partial<FilaItinerario> = {},
): FilaItinerario {
  return {
    id,
    cotizacionId: 'cot-1',
    nombre,
    orden: 1,
    vaEnPropuesta: true,
    esPrincipal: false,
    seleccion,
    motivoCodigo: null,
    motivoTexto: null,
    traeColumnasDeMotivo: true,
    ...extra,
  }
}

const CONTEXTO = contextoDelViaje(
  {
    destino: 'Providencia',
    fechas: { inicio: '2026-12-20', fin: '2026-12-27' },
    composicion: { adultos: 2, ninos: 1, infantes: 0 },
  },
  '2026-09-21',
)

const QUIEN = { staffId: 'staff-1', nombre: 'Alejandra' }

function armar(filas: FilaItinerario[], contexto = ctx()) {
  return armarFilasDeRegistro({
    workspaceId: 'ws-1',
    cotizacionId: 'cot-1',
    negocioId: 'neg-1',
    ctx: contexto,
    filas,
    contexto: CONTEXTO,
    quien: QUIEN,
    salidaAt: '2026-09-21T15:00:00.000Z',
  })
}

// ── R6 · una cotización sin tarifas no escribe nada ──────────────────────────

describe('R6 · sin tarifas no hay registro', () => {
  it('cero filas de entrada, cero filas de salida', () => {
    // Termotech, Arca y WMC nunca llegan aquí con nada: sin tarifas que salgan al
    // cliente no hay decisión que guardar, y el insert no se ejecuta.
    expect(armar([])).toEqual([])
  })
})

// ── Verificación 1 · las tres tarifas producen tres filas ────────────────────

describe('una fila por tarifa, con su precio y sus descartadas', () => {
  const filas = armar([
    tarifa('it-eco', 'Económica', ['wingo', 'sat-pm', 'occidental']),
    tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental']),
    tarifa('it-pre', 'Premium', ['avianca', 'sat-am', 'hard-rock']),
  ])

  it('son tres, una por tarifa, y conservan su nombre', () => {
    expect(filas).toHaveLength(3)
    expect(filas.map(f => f.tarifa_nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])
  })

  it('cada una lleva su precio y su costo, sumando los DOS vuelos', () => {
    // Económica: WINGO 900.000 + SATENA 15:00 430.000 + OCCIDENTAL 1.800.000
    //            + VAN 130.000 (traslado por supuesto) + SEGURO 80.000
    const eco = filas[0]
    expect(eco.precio_elegida).toBe(900_000 + 430_000 + 1_800_000 + 130_000 + 80_000)
    expect(eco.costo_elegida).toBe(800_000 + 350_000 + 1_500_000 + 100_000 + 60_000)
    // Premium: AVIANCA + SATENA 7:00 + HARD ROCK + VAN + SEGURO
    expect(filas[2].precio_elegida).toBe(1_200_000 + 500_000 + 2_400_000 + 130_000 + 80_000)
  })

  it('el margen de la tarifa viaja calculado, no null', () => {
    for (const f of filas) expect(typeof f.margen_elegida_pct).toBe('number')
  })

  it('la elegida dice QUÉ variante entró por cada ranura', () => {
    const rec = filas[1]
    expect(rec.elegida.map(v => v.item_id).sort()).toEqual(['avianca', 'occidental', 'sat-am', 'van'])
    // Y con su nombre, que es lo que hace legible el registro sin volver a la base.
    expect(rec.elegida.find(v => v.ranura === VUELO_2)?.nombre).toBe('SATENA 7:00')
  })

  it('las descartadas dicen CONTRA QUÉ se eligió, con nombre y precio', () => {
    const rec = filas[1]
    const porId = new Map(rec.descartadas.map(v => [v.item_id, v]))
    expect([...porId.keys()].sort()).toEqual(['bus', 'hard-rock', 'sat-pm', 'wingo'])
    expect(porId.get('wingo')).toMatchObject({ nombre: 'WINGO', precio: 900_000, ranura: VUELO_1 })
    expect(porId.get('hard-rock')).toMatchObject({ nombre: 'HARD ROCK', precio: 2_400_000 })
  })

  it('el componente SUELTO no es una variante: no aparece en ninguna de las dos listas', () => {
    // El seguro entra en las tres y no hay nada que decidir sobre él. Meterlo como
    // «elegido» diría que alguien lo prefirió sobre otra cosa, y no hubo otra cosa.
    const todos = filas.flatMap(f => [...f.elegida, ...f.descartadas]).map(v => v.item_id)
    expect(todos).not.toContain('seguro')
  })

  it('la ranura que NO abre columna también queda registrada, marcada como tal', () => {
    // El traslado se resuelve por supuesto permanente: nadie va a elegir por él nunca.
    // Registrarlo es lo que permite después ver que la VAN se cobró siempre sin que
    // nadie lo decidiera.
    const rec = filas[1]
    expect(rec.elegida.find(v => v.item_id === 'van')?.combinable).toBe(false)
    expect(rec.elegida.find(v => v.item_id === 'avianca')?.combinable).toBe(true)
  })
})

// ── R1 · la propuesta nace nula ──────────────────────────────────────────────

describe('R1 · la propuesta nace vacía y no se inventa', () => {
  it('los tres campos de la propuesta son null, siempre', () => {
    // «Un valor puesto por defecto es indistinguible de una propuesta real y el día que
    // se mida al motor, se le estaría midiendo contra sí mismo.» Si alguien llenara
    // `propuesta` con lo más barato, o con la elegida, esta prueba cae.
    for (const f of armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'hard-rock'])])) {
      expect(f.propuesta).toBeNull()
      expect(f.precio_propuesta).toBeNull()
      expect(f.propuesta_origen).toBeNull()
    }
  })
})

// ── R4 · el contexto y las variantes se CONGELAN ─────────────────────────────

describe('R4 · lo guardado es una copia, no una referencia', () => {
  it('borrar o renombrar una variante DESPUÉS no cambia el registro', () => {
    // Verificación 4 del encargo. Esto es lo que una llave foránea no puede dar: la
    // fila tiene que seguir diciendo contra qué se eligió aunque la opción ya no exista.
    const lista = items()
    const filas = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'])], ctx(lista))
    const antes = JSON.parse(JSON.stringify(filas[0].descartadas))

    // El equipo borra HARD ROCK y le cambia el precio a WINGO.
    const wingo = lista.find(i => i.id === 'wingo')!
    wingo.nombre = 'WINGO (otro nombre)'
    wingo.precio_venta = 1
    lista.splice(lista.findIndex(i => i.id === 'hard-rock'), 1)

    expect(filas[0].descartadas).toEqual(antes)
    const porId = new Map(filas[0].descartadas.map(v => [v.item_id, v]))
    expect(porId.get('wingo')?.nombre).toBe('WINGO')
    expect(porId.get('wingo')?.precio).toBe(900_000)
    expect(porId.get('hard-rock')?.nombre).toBe('HARD ROCK')
  })

  it('el contexto del viaje queda copiado con números, no con prosa', () => {
    const f = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'])])[0]
    expect(f.contexto).toEqual({
      destino: 'Providencia',
      fecha_salida: '2026-12-20',
      fecha_regreso: '2026-12-27',
      noches: 7,
      adultos: 2,
      ninos: 1,
      infantes: 0,
      pasajeros: 3,
      dias_anticipacion: 90,
      medido_el: '2026-09-21',
    })
  })

  it('quién eligió queda escrito, con su nombre congelado (R6 de §3.2.1)', () => {
    const f = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'])])[0]
    expect(f.decidido_por).toBe('staff-1')
    expect(f.decidido_por_nombre).toBe('Alejandra')
  })
})

// ── R3 · una segunda salida agrega, no pisa ──────────────────────────────────

describe('R3 · una segunda salida agrega fila', () => {
  it('la misma tarifa con otra combinación produce una fila NUEVA e independiente', () => {
    // El builder no emite un `id` ni ninguna llave con la que un `upsert` pudiera
    // colapsar las dos: el insert siempre crea. Que la tabla tampoco tenga índice
    // único sobre `itinerario_id` lo fija la migración, no esto.
    const primera = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'])])[0]
    const segunda = armar([tarifa('it-rec', 'Recomendada', ['wingo', 'sat-pm', 'hard-rock'])])[0]

    expect(segunda.itinerario_id).toBe(primera.itinerario_id)
    expect(Object.hasOwn(primera, 'id')).toBe(false)
    expect(segunda.precio_elegida).not.toBe(primera.precio_elegida)
    expect(segunda.elegida.map(v => v.item_id)).not.toEqual(primera.elegida.map(v => v.item_id))
  })
})

// ── R5 · el motivo, opcional ─────────────────────────────────────────────────

describe('R5 · el motivo no bloquea y se guarda limpio', () => {
  it('una tarifa aceptada sin motivo deja los dos campos en null', () => {
    // Verificación 3 del encargo. La fila EXISTE igual: una aceptación es señal.
    const f = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'])])[0]
    expect(f.motivo_codigo).toBeNull()
    expect(f.motivo_texto).toBeNull()
  })

  it('una cadena vacía guardada en la tarifa no pasa como respuesta', () => {
    const f = armar([
      tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'], {
        motivoCodigo: '',
        motivoTexto: '   ',
      }),
    ])[0]
    expect(f.motivo_codigo).toBeNull()
    expect(f.motivo_texto).toBeNull()
  })

  it('el motivo escrito viaja tal cual', () => {
    const f = armar([
      tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am', 'occidental'], {
        motivoCodigo: 'horario',
        motivoTexto: 'salía 5:20 a.m. con un infante',
      }),
    ])[0]
    expect(f.motivo_codigo).toBe('horario')
    expect(f.motivo_texto).toBe('salía 5:20 a.m. con un infante')
  })
})

// ── Una tarifa incompleta ────────────────────────────────────────────────────

describe('una tarifa a la que le falta una ranura', () => {
  it('registra las variantes de esa ranura como descartadas, no inventa una elegida', () => {
    // Una tarifa incompleta no puede ir en la propuesta —lo frena el servidor— pero si
    // llegara aquí, el registro no puede afirmar que alguien eligió un hotel.
    const f = armar([tarifa('it-rec', 'Recomendada', ['avianca', 'sat-am'])])[0]
    expect(f.elegida.map(v => v.item_id)).not.toContain('occidental')
    expect(f.descartadas.map(v => v.item_id)).toEqual(
      expect.arrayContaining(['occidental', 'hard-rock']),
    )
  })
})

// ── El contexto, en sus bordes ───────────────────────────────────────────────

describe('el contexto del viaje cuando falta el dato', () => {
  it('sin viaje, todo null: un cero diría «sale hoy» y «sin pasajeros»', () => {
    const c = contextoDelViaje(null, '2026-09-21')
    expect(c).toEqual({
      destino: null,
      fecha_salida: null,
      fecha_regreso: null,
      noches: null,
      adultos: null,
      ninos: null,
      infantes: null,
      pasajeros: null,
      dias_anticipacion: null,
      medido_el: '2026-09-21',
    })
  })

  it('una fecha incompleta no se adivina', () => {
    const c = contextoDelViaje(
      { destino: null, fechas: { inicio: '2026-12', fin: null }, composicion: null },
      '2026-09-21',
    )
    expect(c.fecha_salida).toBeNull()
    expect(c.dias_anticipacion).toBeNull()
  })

  it('un viaje que YA salió guarda anticipación negativa, no cero', () => {
    // Recotizar un viaje pasado es un caso real. Redondearlo escondería justo el raro.
    const c = contextoDelViaje(
      { destino: 'Cartagena', fechas: { inicio: '2026-09-01', fin: null }, composicion: null },
      '2026-09-21',
    )
    expect(c.dias_anticipacion).toBe(-20)
  })

  it('`diasEntre` no se corre un día por la zona del runtime', () => {
    // La trampa que este repo ya documenta para las fechas de los recibos: un
    // `new Date('2026-10-01')` se lee como UTC y en Bogotá cae el día anterior.
    expect(diasEntre('2026-10-01', '2026-10-02')).toBe(1)
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1)
    expect(diasEntre('2026-03-01', '2026-03-01')).toBe(0)
  })
})

// ── La tolerancia de despliegue ──────────────────────────────────────────────

describe('la tabla que todavía no existe', () => {
  it('reconoce el 42P01 y el PGRST205 que la nombran', () => {
    expect(faltaLaTablaDeDecisiones({
      code: '42P01',
      message: 'relation "public.decisiones_combinacion" does not exist',
    })).toBe(true)
    expect(faltaLaTablaDeDecisiones({
      code: 'PGRST205',
      message: "Could not find the table 'public.decisiones_combinacion' in the schema cache",
    })).toBe(true)
  })

  it('un 42P01 de OTRA tabla no se lee como «falta la migración»', () => {
    // Si no, un `from()` mal escrito se reportaría como pendiente de aplicar y el
    // defecto real quedaría invisible. Es el mismo criterio de `tolerar-itinerarios`.
    expect(faltaLaTablaDeDecisiones({
      code: '42P01',
      message: 'relation "public.otra_cosa" does not exist',
    })).toBe(false)
  })

  it('un error de permisos NO es la migración pendiente', () => {
    expect(faltaLaTablaDeDecisiones({
      code: '42501',
      message: 'permission denied for table decisiones_combinacion',
    })).toBe(false)
    expect(faltaLaTablaDeDecisiones(null)).toBe(false)
  })
})
