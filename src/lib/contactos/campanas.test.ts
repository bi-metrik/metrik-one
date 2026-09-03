import { describe, it, expect } from 'vitest'
import {
  resumenCampanasContacto,
  ordenarRecientesPrimero,
  acumularCampana,
  ordenarCampanas,
  atribucionDesdeCampanas,
  campanasParaFiltrar,
  contactoEnCampana,
  opcionesDeCampana,
  contarVariasCampanas,
  CAMPANA_TODAS,
  CAMPANA_VARIAS,
  type InteraccionCampana,
} from './campanas'

/**
 * La primera campaña es el dato con el que se atribuye un cierre. Estas pruebas
 * fijan las decisiones que NO son obvias leyendo el código:
 *
 *  - de dónde sale el nombre y de dónde la fecha (de la MISMA fuente, siempre)
 *  - qué pasa cuando `custom_data.origen` existe pero su `campaign_name` es null
 *  - que el orden lo pone el módulo y no quien llama
 *
 * Casos calcados de producción (workspace SOENA, medidos el 2026-09-02).
 */

function inter(campana: string | null, ocurrida: string | null, creada = '2026-01-01T00:00:00Z'): InteraccionCampana {
  return {
    payload: campana === null ? { field_data: [] } : { campaign_name: campana },
    ocurrida_at: ocurrida,
    created_at: creada,
  }
}

describe('resumenCampanasContacto', () => {
  it('sin interacciones ni origen no hay resumen', () => {
    expect(resumenCampanasContacto([], null)).toBeNull()
  })

  it('interacciones sin campaña no producen resumen', () => {
    // Un lead de WhatsApp o manual no trae `campaign_name`.
    expect(resumenCampanasContacto([inter(null, '2026-08-01T10:00:00Z')], null)).toBeNull()
  })

  it('un solo formulario: primera = última y no se muestran las dos', () => {
    const r = resumenCampanasContacto([inter('CAMPAÑA A', '2026-07-30T09:37:22Z')], null)
    expect(r).not.toBeNull()
    expect(r!.formularios).toBe(1)
    expect(r!.primeraNombre).toBe('CAMPAÑA A')
    expect(r!.primeraFecha).toBe('2026-07-30T09:37:22Z')
    expect(r!.hayVarias).toBe(false)
  })

  it('caso V0329 de producción: origen SIN campaign_name cae a la interacción más vieja', () => {
    // LAURA CATALINA LÓPEZ CALDERON: 2 formularios, y su `custom_data.origen`
    // trae `first_at` con `campaign_name` en null. La primera campaña tiene que
    // salir de la interacción más vieja, con SU fecha — no la de `origen`.
    const origen = { campaign_name: null, first_at: '2026-07-30T09:37:22.000Z' }
    const r = resumenCampanasContacto(
      [
        inter('CLIENTES POTENCIALES AGO 2026 PLUS', '2026-08-20T13:37:25Z'),
        inter('CLIENTES POTENCIALES JUL/AGO 2026', '2026-07-30T09:37:22Z'),
      ],
      origen,
    )
    expect(r!.formularios).toBe(2)
    expect(r!.primeraNombre).toBe('CLIENTES POTENCIALES JUL/AGO 2026')
    expect(r!.primeraFecha).toBe('2026-07-30T09:37:22Z')
    expect(r!.ultimaNombre).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
    expect(r!.hayVarias).toBe(true)
  })

  it('con origen poblado manda el origen, y la fecha sale de ahí también', () => {
    const r = resumenCampanasContacto(
      [inter('CAMPAÑA POSTERIOR', '2026-08-20T13:00:00Z')],
      { campaign_name: 'CAMPAÑA DEL PRIMER TOQUE', first_at: '2026-02-04T08:00:00Z' },
    )
    expect(r!.primeraNombre).toBe('CAMPAÑA DEL PRIMER TOQUE')
    expect(r!.primeraFecha).toBe('2026-02-04T08:00:00Z')
  })

  it('el origen sirve aunque el contacto ya no tenga interacciones vivas', () => {
    // Todas descartadas o convertidas antes de que se guardara el historial.
    const r = resumenCampanasContacto([], { campaign_name: 'CAMPAÑA VIEJA', first_at: '2026-03-01T00:00:00Z' })
    expect(r!.primeraNombre).toBe('CAMPAÑA VIEJA')
    expect(r!.formularios).toBe(0)
    expect(r!.hayVarias).toBe(false)
  })

  it('el resultado no depende del orden en que llegan las filas', () => {
    const viejas = inter('PRIMERA', '2026-01-10T00:00:00Z')
    const nuevas = inter('ULTIMA', '2026-05-10T00:00:00Z')
    const desc = resumenCampanasContacto([nuevas, viejas], null)
    const asc = resumenCampanasContacto([viejas, nuevas], null)
    expect(asc).toEqual(desc)
    expect(desc!.primeraNombre).toBe('PRIMERA')
    expect(desc!.ultimaNombre).toBe('ULTIMA')
  })

  it('una campaña en blanco cuenta como ausente', () => {
    expect(resumenCampanasContacto([inter('   ', '2026-01-01T00:00:00Z')], null)).toBeNull()
    expect(resumenCampanasContacto([], { campaign_name: '  ', first_at: '2026-01-01T00:00:00Z' })).toBeNull()
  })
})

/**
 * Los dos contactos que el 360 (`directorio/contacto/[id]`) pinta en el bloque
 * "Campañas", con las filas COPIADAS de producción el 2026-09-03 — payload con la
 * forma real del webhook, y `origen` tal cual está en `custom_data`.
 *
 * Están aquí porque desde este día el 360 dejó de tener la regla escrita en línea
 * y consume `resumenCampanasContacto`: si alguien la cambia, lo que se rompe es
 * una pantalla, y estas dos pruebas son las que lo dicen.
 */

/** Payload de Meta con la forma de producción (11 llaves; solo dos se leen). */
function interMeta(
  campana: string,
  adName: string,
  ocurrida: string,
  creada: string,
): InteraccionCampana {
  return {
    payload: {
      ad_id: '120248098468680215',
      ad_name: adName,
      adset_id: '120248098468660215',
      adset_name: 'Nuevo conjunto de anuncios de Clientes potenciales',
      campaign_id: '120248098468670215',
      campaign_name: campana,
      created_time: ocurrida,
      field_data: [{ name: '¿qué_tipo_de_vehículo_adquiriste?', values: ['Vehículo eléctrico'] }],
      form_id: '4106143956347737',
      leadgen_id: '1234567890123456',
      platform: 'fb',
    },
    ocurrida_at: ocurrida,
    created_at: creada,
  }
}

describe('resumenCampanasContacto sobre filas reales del 360', () => {
  // Recientes primero, que es como las sirve `getInteraccionesPorContacto`.
  const madeleine: InteraccionCampana[] = [
    interMeta('CLIENTES POTENCIALES AGO ($50)', 'Primer Video de Clientes Potenciales', '2026-08-27T11:50:55+00:00', '2026-08-27T11:51:05.281104+00:00'),
    interMeta('CLIENTES POTENCIALES AGO 2026 PLUS', 'Nuevo anuncio de Clientes potenciales', '2026-08-09T19:58:48+00:00', '2026-08-09T19:58:54.878795+00:00'),
    interMeta('CLIENTES POTENCIALES JUL/AGO 2026', 'Nuevo anuncio de Clientes potenciales', '2026-08-01T17:26:39+00:00', '2026-08-01T17:26:52.988242+00:00'),
    interMeta('CAMPAÑA JUNIO 2026 DJ - VIDEO', 'CAMPAÑA JUNIO - DANIELA', '2026-07-29T03:21:40+00:00', '2026-07-29T03:21:49.899169+00:00'),
  ]

  const carlos: InteraccionCampana[] = [
    interMeta('CLIENTES POTENCIALES AGO ($50)', 'Primer Video de Clientes Potenciales', '2026-08-29T22:32:07+00:00', '2026-08-29T22:32:17.447537+00:00'),
    interMeta('CLIENTES POTENCIALES AGO 2026 PLUS', 'Nuevo anuncio de Clientes potenciales', '2026-08-20T23:42:17+00:00', '2026-08-20T23:42:24.294325+00:00'),
    interMeta('CLIENTES POTENCIALES JUL/AGO 2026', 'Nuevo anuncio de Clientes potenciales', '2026-07-31T22:31:39+00:00', '2026-07-31T22:31:48.919307+00:00'),
  ]

  it('MADELEINE PEREZ RUA: 4 formularios y el `origen` manda sobre la interacción más vieja', () => {
    // `123a7b24-334a-4016-93b2-08710eed0159`. Su `origen` SÍ trae campaign_name,
    // así que nombre y fecha de la primera salen los dos de ahí.
    const origen = { campaign_name: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', first_at: '2026-07-29T03:21:40.000Z' }
    const r = resumenCampanasContacto(madeleine, origen)
    expect(r).toEqual({
      formularios: 4,
      primeraNombre: 'CAMPAÑA JUNIO 2026 DJ - VIDEO',
      primeraFecha: '2026-07-29T03:21:40.000Z',
      ultimaNombre: 'CLIENTES POTENCIALES AGO ($50)',
      ultimaFecha: '2026-08-27T11:50:55+00:00',
      hayVarias: true,
    })
    // El 360 pinta "Primera" + "Última" solo cuando `hayVarias`.
    expect(r!.hayVarias).toBe(true)
    // Y da lo mismo aunque la base sirviera las filas al revés.
    expect(resumenCampanasContacto([...madeleine].reverse(), origen)).toEqual(r)
  })

  it('CARLOS F PAZ: `origen` con first_at y campaign_name en null cae a la más vieja, con SU fecha', () => {
    // `6cd1bb49-8aa2-41b7-977e-a35ab48490f8`. Es la rama que un refactor rompe sin
    // que se note: la llave `campaign_name` EXISTE en `custom_data.origen`, con
    // valor null. Mezclar el nombre de la interacción con la fecha de `origen`
    // fecharía mal la campaña con la que se atribuye el cierre.
    const origen = {
      campaign_name: null,
      first_at: '2026-07-31T22:31:39.000Z',
    }
    const r = resumenCampanasContacto(carlos, origen)
    expect(r).toEqual({
      formularios: 3,
      primeraNombre: 'CLIENTES POTENCIALES JUL/AGO 2026',
      primeraFecha: '2026-07-31T22:31:39+00:00',
      ultimaNombre: 'CLIENTES POTENCIALES AGO ($50)',
      ultimaFecha: '2026-08-29T22:32:07+00:00',
      hayVarias: true,
    })
    // La fecha sale de la INTERACCIÓN, no de `origen.first_at`. Los dos apuntan al
    // mismo instante pero se escriben distinto, y es esa diferencia la que delata
    // de cuál de las dos fuentes vino.
    expect(r!.primeraFecha).not.toBe(origen.first_at)
    expect(resumenCampanasContacto([...carlos].reverse(), origen)).toEqual(r)
  })

  it('un solo formulario: el 360 dice "Origen" y no pinta la fila de Última', () => {
    // WILLIAM CARREÑO, `00175fb8-525e-4f07-9b4f-5720c8717956`: 622 de los 983
    // contactos del workspace están así (medido el 2026-09-03).
    const r = resumenCampanasContacto(
      [interMeta('CAMPAÑA JUNIO 2026 DJ - VIDEO', 'CAMPAÑA JUNIO - DANIELA', '2026-07-17T17:39:18+00:00', '2026-07-17T17:39:28.062+00:00')],
      { campaign_name: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', first_at: '2026-07-17T17:39:18.000Z' },
    )
    expect(r!.formularios).toBe(1)
    // `hayVarias` en false es lo que hace que la etiqueta diga "Origen".
    expect(r!.hayVarias).toBe(false)
  })

  it('un contacto sin ninguna campaña no pinta el bloque', () => {
    // 315 de los 983 (medido el 2026-09-03): sin interacciones de Meta y sin
    // `origen`, o con interacciones que no declaran campaña.
    expect(resumenCampanasContacto([], null)).toBeNull()
    expect(resumenCampanasContacto([], { campaign_name: null, first_at: null })).toBeNull()
  })

  it('una interacción sin campaña NO suma al conteo de formularios', () => {
    // El "N formularios" del 360 cuenta las interacciones que declaran campaña,
    // no todas las del contacto. Hoy en SOENA no se puede ver (las 720 son de
    // Meta y las 720 declaran campaña, medido el 2026-09-03), pero el timeline
    // del 360 también pinta WhatsApp, web y manual: el día que entre una por ahí,
    // sin esta regla el bloque diría un formulario de más.
    const manual: InteraccionCampana = {
      payload: { nota: 'llamada de seguimiento' },
      ocurrida_at: '2026-08-15T10:00:00+00:00',
      created_at: '2026-08-15T10:00:03+00:00',
    }
    const r = resumenCampanasContacto([...carlos.slice(0, 1), manual, ...carlos.slice(1)], null)
    expect(r!.formularios).toBe(3)
    expect(r!.ultimaNombre).toBe('CLIENTES POTENCIALES AGO ($50)')
    expect(r!.primeraNombre).toBe('CLIENTES POTENCIALES JUL/AGO 2026')
  })
})

describe('ordenarRecientesPrimero', () => {
  it('deja las filas sin ocurrida_at al final y desempata por created_at', () => {
    const sinFecha = inter('C', null, '2026-06-01T00:00:00Z')
    const media = inter('B', '2026-04-01T00:00:00Z')
    const nueva = inter('A', '2026-09-01T00:00:00Z')
    const orden = ordenarRecientesPrimero([media, sinFecha, nueva])
    expect(orden.map((i) => i.payload?.campaign_name)).toEqual(['A', 'B', 'C'])
  })

  it('no muta el arreglo que recibe', () => {
    const entrada = [inter('B', '2026-01-01T00:00:00Z'), inter('A', '2026-09-01T00:00:00Z')]
    ordenarRecientesPrimero(entrada)
    expect(entrada[0].payload?.campaign_name).toBe('B')
  })
})

/**
 * Casos calcados de producción (workspace SOENA, medidos el 2026-09-02 contra la
 * base: 988 contactos, 703 interacciones, 6 campañas, 44 contactos con más de una).
 *
 * Lo que estas pruebas fijan y NO se lee del código:
 *  - que el primer toque sale de `custom_data.origen` y no de la interacción más vieja
 *  - que "más de una campaña" cuenta CAMPAÑAS distintas, no formularios
 *  - que los conteos del selector no se filtran a sí mismos ni cuentan de más
 *  - que una campaña que ya no está en los datos sigue siendo quitable
 */

describe('atribucionDesdeCampanas', () => {
  it('manda `origen` sobre `campanas[0]` — es el primer toque inmutable del webhook', () => {
    // Caso REAL (ORLANDO MANTILLITA, el único de 988 que discrepa): su origen dice
    // SEP DANIELA y sus interacciones arrancan en AGO ($50).
    const a = atribucionDesdeCampanas({
      campanas: ['CLIENTES POTENCIALES AGO ($50)', 'CAMPAÑA SEP DANIELA'],
      origen: { campaign_name: 'CAMPAÑA SEP DANIELA' },
    })
    expect(a.primera).toBe('CAMPAÑA SEP DANIELA')
    // Y por eso la última queda vacía: coincide con la primera. La columna de
    // formularios es la que delata que hubo más de un toque.
    expect(a.ultima).toBeNull()
  })

  it('sin `origen` cae a la interacción más vieja', () => {
    const a = atribucionDesdeCampanas({
      campanas: ['CAMPAÑA JUNIO 2026 DJ - VIDEO', 'CLIENTES POTENCIALES AGO 2026 PLUS'],
      origen: null,
    })
    expect(a.primera).toBe('CAMPAÑA JUNIO 2026 DJ - VIDEO')
    expect(a.ultima).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
  })

  it('con UNA sola campaña la última queda vacía, no repite el texto', () => {
    const a = atribucionDesdeCampanas({ campanas: ['CLIENTES POTENCIALES AGO 2026 PLUS'], origen: null })
    expect(a.primera).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
    expect(a.ultima).toBeNull()
  })

  it('un contacto sin campañas no tiene atribución', () => {
    expect(atribucionDesdeCampanas({ campanas: [], origen: null })).toEqual({ primera: null, ultima: null })
  })

  it('un `origen` en blanco cuenta como ausente', () => {
    const a = atribucionDesdeCampanas({ campanas: ['A', 'B'], origen: { campaign_name: '   ' } })
    expect(a.primera).toBe('A')
    expect(a.ultima).toBe('B')
  })

  it('el origen sirve aunque el contacto se haya quedado sin interacciones', () => {
    const a = atribucionDesdeCampanas({ campanas: [], origen: { campaign_name: 'CAMPAÑA VIEJA' } })
    expect(a.primera).toBe('CAMPAÑA VIEJA')
    expect(a.ultima).toBeNull()
  })
})

describe('campanasParaFiltrar', () => {
  it('agrega la campaña de `origen` cuando no está entre las interacciones', () => {
    // Hoy no le pasa a nadie (medido: 0 de 988), pero el origen sobrevive a que
    // las interacciones se fusionen, se conviertan o se descarten.
    expect(campanasParaFiltrar({ campanas: ['A'], origen: { campaign_name: 'B' } })).toEqual(['A', 'B'])
  })

  it('no la duplica cuando ya está', () => {
    expect(campanasParaFiltrar({ campanas: ['A', 'B'], origen: { campaign_name: 'B' } })).toEqual(['A', 'B'])
  })

  it('sin origen devuelve las de las interacciones tal cual', () => {
    expect(campanasParaFiltrar({ campanas: ['A'], origen: null })).toEqual(['A'])
  })
})

describe('contactoEnCampana', () => {
  const conDos = { campanas: ['A', 'B'], origen: null }
  const conUna = { campanas: ['A'], origen: null }
  const sinNinguna = { campanas: [], origen: null }

  it('"todas" deja pasar a todos, incluido el que no tiene ninguna campaña', () => {
    // 337 contactos de SOENA no tienen interacción: no pueden desaparecer de la
    // lista solo porque el filtro de campaña exista.
    expect(contactoEnCampana(sinNinguna, CAMPANA_TODAS)).toBe(true)
  })

  it('empata contra CUALQUIERA de sus campañas, no solo la primera', () => {
    expect(contactoEnCampana(conDos, 'B')).toBe(true)
    expect(contactoEnCampana(conUna, 'B')).toBe(false)
  })

  it('empata también por `origen` cuando la interacción ya no está', () => {
    expect(contactoEnCampana({ campanas: [], origen: { campaign_name: 'B' } }, 'B')).toBe(true)
  })

  it('"más de una campaña" exige campañas DISTINTAS, no formularios', () => {
    expect(contactoEnCampana(conDos, CAMPANA_VARIAS)).toBe(true)
    // Dos formularios de la misma campaña son UNA campaña: no entra.
    expect(contactoEnCampana(conUna, CAMPANA_VARIAS)).toBe(false)
    expect(contactoEnCampana(sinNinguna, CAMPANA_VARIAS)).toBe(false)
  })
})

describe('opcionesDeCampana', () => {
  const contactos = [
    { campanas: ['AGO PLUS'], origen: null },
    { campanas: ['AGO PLUS'], origen: null },
    { campanas: ['AGO PLUS', 'SEP DANIELA'], origen: null },
    { campanas: ['SEP DANIELA'], origen: null },
    { campanas: [], origen: null },
  ]

  it('cuenta CONTACTOS, no formularios, y ordena por volumen', () => {
    expect(opcionesDeCampana(contactos, CAMPANA_TODAS)).toEqual([
      { value: 'AGO PLUS', label: 'AGO PLUS', count: 3 },
      { value: 'SEP DANIELA', label: 'SEP DANIELA', count: 2 },
    ])
  })

  it('un contacto con la misma campaña repetida cuenta una vez', () => {
    const [op] = opcionesDeCampana([{ campanas: ['A', 'A'], origen: null }], CAMPANA_TODAS)
    expect(op.count).toBe(1)
  })

  it('conserva la seleccionada aunque ya no exista en los datos', () => {
    // Enlace viejo o campaña cuyos contactos se fusionaron: sin esto el filtro
    // sigue recortando la lista y el selector no puede mostrarlo para quitarlo.
    const ops = opcionesDeCampana(contactos, 'CAMPAÑA QUE YA NO ESTÁ')
    expect(ops.at(-1)).toEqual({ value: 'CAMPAÑA QUE YA NO ESTÁ', label: 'CAMPAÑA QUE YA NO ESTÁ', count: 0 })
  })

  it('los centinelas no se agregan como opción de campaña', () => {
    expect(opcionesDeCampana(contactos, CAMPANA_VARIAS)).toHaveLength(2)
    expect(opcionesDeCampana(contactos, CAMPANA_TODAS)).toHaveLength(2)
  })

  it('desempata alfabéticamente para que el orden no baile entre cargas', () => {
    const ops = opcionesDeCampana(
      [{ campanas: ['B'], origen: null }, { campanas: ['A'], origen: null }],
      CAMPANA_TODAS,
    )
    expect(ops.map((o) => o.value)).toEqual(['A', 'B'])
  })
})

describe('contarVariasCampanas', () => {
  it('cuenta los contactos con más de una campaña distinta', () => {
    expect(
      contarVariasCampanas([
        { campanas: ['A', 'B'], origen: null },
        { campanas: ['A'], origen: null },
        { campanas: [], origen: null },
        // Una sola interacción, pero su origen aporta otra campaña.
        { campanas: ['A'], origen: { campaign_name: 'C' } },
      ]),
    ).toBe(2)
  })
})

// ============================================================
// QA con filas REALES de producción (SOENA, 2026-09-02)
// ============================================================
// Las filas de abajo se copiaron tal cual de `contacto_interacciones`. Prueban la
// reducción completa —de filas crudas a lo que la pantalla pinta— sobre los casos
// que el brief pide verificar, y no sobre datos inventados que casualmente pasen.

type FilaCruda = { campaign_name: string; ocurrida_at: string | null; created_at: string }

/** Espeja el recorrido de `getContactos` sobre las interacciones de UN contacto. */
function reducir(filas: FilaCruda[]): { interacciones_meta: number; campanas: string[] } {
  const acumulado = new Map<string, string>()
  for (const f of filas) {
    acumularCampana(acumulado, { campaign_name: f.campaign_name }, f.ocurrida_at ?? f.created_at)
  }
  return { interacciones_meta: filas.length, campanas: ordenarCampanas(acumulado) }
}

describe('reducción sobre filas reales de producción', () => {
  it('QA 1 — MADELEINE PEREZ RUA: 4 formularios, 4 campañas, en orden cronológico', () => {
    // El brief decía 3 y 3; medido el 2026-09-02 son 4 y 4 (la fusión de
    // duplicados de la sesión paralela le sumó una interacción). Se afirma lo
    // que la base dice hoy, no lo que el brief heredó.
    const c = reducir([
      { campaign_name: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', ocurrida_at: '2026-07-29T03:21:40+00:00', created_at: '2026-07-29T03:21:49.899169+00:00' },
      { campaign_name: 'CLIENTES POTENCIALES JUL/AGO 2026', ocurrida_at: '2026-08-01T17:26:39+00:00', created_at: '2026-08-01T17:26:52.988242+00:00' },
      { campaign_name: 'CLIENTES POTENCIALES AGO 2026 PLUS', ocurrida_at: '2026-08-09T19:58:48+00:00', created_at: '2026-08-09T19:58:54.878795+00:00' },
      { campaign_name: 'CLIENTES POTENCIALES AGO ($50)', ocurrida_at: '2026-08-27T11:50:55+00:00', created_at: '2026-08-27T11:51:05.281104+00:00' },
    ])
    expect(c.interacciones_meta).toBe(4)
    expect(c.campanas).toEqual([
      'CAMPAÑA JUNIO 2026 DJ - VIDEO',
      'CLIENTES POTENCIALES JUL/AGO 2026',
      'CLIENTES POTENCIALES AGO 2026 PLUS',
      'CLIENTES POTENCIALES AGO ($50)',
    ])
    // Su `origen.campaign_name` coincide con la más vieja, así que la fila muestra
    // primera y última sin contradicción.
    const a = atribucionDesdeCampanas({ ...c, origen: { campaign_name: 'CAMPAÑA JUNIO 2026 DJ - VIDEO' } })
    expect(a.primera).toBe('CAMPAÑA JUNIO 2026 DJ - VIDEO')
    expect(a.ultima).toBe('CLIENTES POTENCIALES AGO ($50)')
  })

  it('QA 2 — DAVID URBANO: 3 formularios y solo 2 campañas, sin inventar una tercera', () => {
    const c = reducir([
      { campaign_name: 'CLIENTES POTENCIALES JUL/AGO 2026', ocurrida_at: '2026-08-04T00:24:09+00:00', created_at: '2026-08-04T00:24:18.88597+00:00' },
      { campaign_name: 'CLIENTES POTENCIALES AGO 2026', ocurrida_at: '2026-08-04T21:34:46+00:00', created_at: '2026-08-04T21:34:51.583609+00:00' },
      // Segundo formulario de la MISMA campaña: suma interacción, no campaña.
      { campaign_name: 'CLIENTES POTENCIALES AGO 2026', ocurrida_at: '2026-08-05T18:29:01+00:00', created_at: '2026-08-05T18:29:06.719674+00:00' },
    ])
    expect(c.interacciones_meta).toBe(3)
    expect(c.campanas).toEqual(['CLIENTES POTENCIALES JUL/AGO 2026', 'CLIENTES POTENCIALES AGO 2026'])
    expect(contactoEnCampana({ ...c, origen: null }, CAMPANA_VARIAS)).toBe(true)
  })

  it('QA 3 — un contacto con 1 formulario: la última campaña queda vacía', () => {
    // GLADYS ELENA GUTIERREZ BLANCO.
    const c = reducir([
      { campaign_name: 'CLIENTES POTENCIALES AGO 2026 PLUS', ocurrida_at: '2026-08-09T12:00:00+00:00', created_at: '2026-08-09T12:00:01+00:00' },
    ])
    expect(c.interacciones_meta).toBe(1)
    const a = atribucionDesdeCampanas({ ...c, origen: { campaign_name: 'CLIENTES POTENCIALES AGO 2026 PLUS' } })
    expect(a.primera).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
    expect(a.ultima).toBeNull()
    // Y la tarjeta NO pinta el conteo: la condición es `> 1`.
    expect(c.interacciones_meta > 1).toBe(false)
  })

  it('QA 8 — un contacto sin ninguna interacción: 0 formularios y ninguna campaña', () => {
    // 337 del workspace están así. No pueden desaparecer de la lista salvo que el
    // filtro de campaña esté puesto.
    const c = reducir([])
    expect(c).toEqual({ interacciones_meta: 0, campanas: [] })
    expect(contactoEnCampana({ ...c, origen: null }, CAMPANA_TODAS)).toBe(true)
    expect(contactoEnCampana({ ...c, origen: null }, 'CAMPAÑA SEP DANIELA')).toBe(false)
  })

  it('ORLANDO MANTILLITA — el único contacto cuyo origen discrepa de su interacción más vieja', () => {
    const c = reducir([
      { campaign_name: 'CLIENTES POTENCIALES AGO ($50)', ocurrida_at: '2026-08-25T16:53:05+00:00', created_at: '2026-08-25T16:53:10.863251+00:00' },
      { campaign_name: 'CAMPAÑA SEP DANIELA', ocurrida_at: '2026-08-29T01:59:35+00:00', created_at: '2026-08-29T01:59:52.774402+00:00' },
    ])
    expect(c.campanas).toEqual(['CLIENTES POTENCIALES AGO ($50)', 'CAMPAÑA SEP DANIELA'])
    const contacto = { ...c, origen: { campaign_name: 'CAMPAÑA SEP DANIELA' } }
    // Manda el origen, así que primera y última coinciden y la columna de última
    // queda vacía. La columna de formularios (2) es la que delata el otro toque.
    expect(atribucionDesdeCampanas(contacto)).toEqual({ primera: 'CAMPAÑA SEP DANIELA', ultima: null })
    // Aun así sigue apareciendo al filtrar por la campaña que NO se pinta.
    expect(contactoEnCampana(contacto, 'CLIENTES POTENCIALES AGO ($50)')).toBe(true)
    expect(contactoEnCampana(contacto, CAMPANA_VARIAS)).toBe(true)
  })

  it('el orden no depende de cómo lleguen las filas de la base', () => {
    const filas: FilaCruda[] = [
      { campaign_name: 'B', ocurrida_at: '2026-08-09T19:58:48+00:00', created_at: '2026-08-09T19:58:54+00:00' },
      { campaign_name: 'A', ocurrida_at: '2026-07-29T03:21:40+00:00', created_at: '2026-07-29T03:21:49+00:00' },
    ]
    expect(reducir(filas).campanas).toEqual(['A', 'B'])
    expect(reducir([...filas].reverse()).campanas).toEqual(['A', 'B'])
  })

  it('una campaña que vuelve a aparecer conserva su lugar de PRIMERA, no salta al final', () => {
    // A → B → A otra vez. Es el único caso en que "primera vez" y "última vez"
    // ordenan distinto, y es justo lo que produce un retargeting: el contacto
    // vuelve a una campaña vieja. Medido en SOENA el 2026-09-02: hoy no le pasa a
    // nadie (0 contactos con campañas intercaladas, aunque 3 sí repiten campaña),
    // así que sin esta prueba la regla del módulo sería una intención y no un
    // hecho — cambiarla a "última vez" no rompería nada visible hasta que
    // apareciera el primer caso, y entonces la fila diría que lo trajo la
    // campaña equivocada.
    const c = reducir([
      { campaign_name: 'A', ocurrida_at: '2026-01-01T00:00:00+00:00', created_at: '2026-01-01T00:00:01+00:00' },
      { campaign_name: 'B', ocurrida_at: '2026-02-01T00:00:00+00:00', created_at: '2026-02-01T00:00:01+00:00' },
      { campaign_name: 'A', ocurrida_at: '2026-03-01T00:00:00+00:00', created_at: '2026-03-01T00:00:01+00:00' },
    ])
    expect(c.interacciones_meta).toBe(3)
    expect(c.campanas).toEqual(['A', 'B'])
    expect(atribucionDesdeCampanas({ ...c, origen: null })).toEqual({ primera: 'A', ultima: 'B' })
  })

  it('sin `ocurrida_at` manda `created_at`, que es lo que hace el servidor', () => {
    const c = reducir([
      { campaign_name: 'VIEJA', ocurrida_at: null, created_at: '2026-01-01T00:00:00+00:00' },
      { campaign_name: 'NUEVA', ocurrida_at: null, created_at: '2026-08-01T00:00:00+00:00' },
    ])
    expect(c.campanas).toEqual(['VIEJA', 'NUEVA'])
  })

  it('una campaña vacía o en blanco no entra al acumulador', () => {
    const acumulado = new Map<string, string>()
    acumularCampana(acumulado, { campaign_name: '   ' }, '2026-01-01T00:00:00Z')
    acumularCampana(acumulado, { campaign_name: 42 }, '2026-01-01T00:00:00Z')
    acumularCampana(acumulado, null, '2026-01-01T00:00:00Z')
    expect(ordenarCampanas(acumulado)).toEqual([])
  })
})
