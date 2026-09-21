/**
 * La tabla de combinaciones, RENDERIZADA.
 *
 * ⚠️ Por qué no basta con probar las reglas puras: `motivoDeRechazo` puede devolver el
 * bloqueo perfecto y el JSX seguir pintando el interruptor habilitado y sin explicar
 * nada. Eso ya pasó en este repo con el botón de facturar: las pruebas del helper
 * seguían verdes con el botón mal pintado, y solo la prueba de render mató la
 * mutación. Aquí lo que está en juego es si el usuario VE por qué no puede mandar un
 * itinerario al cliente.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ El interruptor deshabilitado NO es el candado. El candado es el servidor
 * (`marcarEnPropuesta`), y de eso responden las pruebas de `itinerarios-datos`. Esto
 * comprueba lo otro: que la pantalla no ofrezca una acción que va a ser rechazada, y
 * que diga el motivo.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { textoDeRechazo } from '@/lib/cotizaciones/itinerarios'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}))
// Las server actions se doblan: un import de VALOR desde un archivo `'use server'`
// arrastra `getWorkspace` y con él el runtime de Next.
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  armarTarifas: async () => ({ success: true, creadas: 3, yaExistian: 0 }),
  renombrarRanura: async () => ({ success: true, grupo: 'vuelo', lineas: 2 }),
  cambiarOpcionDeItinerario: async () => ({ success: true, desmarcados: [] }),
  marcarEnPropuesta: async () => ({ success: true }),
  marcarPrincipal: async () => ({ success: true }),
  renombrarItinerario: async () => ({ success: true }),
  eliminarItinerario: async () => ({ success: true }),
}))

const { default: TablaCombinaciones } = await import('./tabla-combinaciones')

/** La forma con la que el servidor sirve una ranura. Ver `EstadoItinerarios`. */
function ranura(
  grupo: string,
  prefijo: string,
  nombre: string,
  candidatos: { id: string; nombre: string }[],
) {
  const etiqueta = nombre === '' ? prefijo : `${prefijo} · ${nombre}`
  return { grupo, etiqueta, prefijo, nombre, renombrable: true, candidatos }
}

const RANURAS = [
  ranura('vuelo', 'Vuelo', '', [{ id: 'avianca', nombre: 'AVIANCA' }, { id: 'wingo', nombre: 'WINGO' }]),
  ranura('hotel', 'Hotel', '', [{ id: 'h1', nombre: 'OCCIDENTAL' }, { id: 'h2', nombre: 'HARD ROCK' }]),
]

/** El viaje a Providencia: DOS ranuras de vuelo que suman, más el hotel. */
const PROVIDENCIA = [
  ranura('vuelo: Bogotá a San Andrés', 'Vuelo', 'Bogotá a San Andrés', [
    { id: 'avianca', nombre: 'AVIANCA' },
    { id: 'wingo', nombre: 'WINGO' },
  ]),
  ranura('vuelo 2: San Andrés a Providencia', 'Vuelo 2', 'San Andrés a Providencia', [
    { id: 'sat-am', nombre: 'SATENA 7:00' },
    { id: 'sat-pm', nombre: 'SATENA 15:00' },
  ]),
  ranura('hotel', 'Hotel', '', [{ id: 'h1', nombre: 'OCCIDENTAL' }, { id: 'h2', nombre: 'HARD ROCK' }]),
]

/** El caso medido: la Recomendada al 13,0% y la Económica al 3,1%. */
function itinerarios() {
  return [
    {
      id: 'it-cara', nombre: 'Recomendada', orden: 1,
      vaEnPropuesta: true, esPrincipal: true,
      seleccion: ['avianca', 'h1'], ranurasFaltantes: [],
      costo: 3_350_000, precio: 3_850_000, margenRealPct: (500_000 / 3_850_000) * 100, bloqueo: null,
    },
    {
      id: 'it-barata', nombre: 'Económica', orden: 2,
      vaEnPropuesta: false, esPrincipal: false,
      seleccion: ['wingo', 'h1'], ranurasFaltantes: [],
      // ⚠️ El margen es el valor CALCULADO (100.000 / 3.275.000), no un 3,05 escrito
      // a mano: `(3.05).toFixed(1)` da «3,0» por el redondeo binario y el real da
      // «3,1». Con el valor a mano, la columna decía 3,0% mientras el mensaje de al
      // lado decía 3,1% — dos cifras del mismo dinero en la misma fila. Se vio en la
      // captura, no en la prueba.
      costo: 3_175_000, precio: 3_275_000, margenRealPct: (100_000 / 3_275_000) * 100,
      bloqueo: 'Margen 3,1%, por debajo del piso de 5,0%',
    },
  ]
}

function pintar(estado: Parameters<typeof TablaCombinaciones>[0]['estado'], editable = true) {
  return renderToStaticMarkup(
    React.createElement(TablaCombinaciones, { cotizacionId: 'cot-1', estado, editable }),
  )
}

const BASE = { umbrales: { pisoPct: 5, avisoPct: 10 }, tablasAusentes: false, fijosConAlternativas: [] }

describe('R6 · una cotización sin opciones no gana una sección', () => {
  it('no pinta absolutamente nada', () => {
    // Termotech, Arca y WMC abren su cotización exactamente igual que antes. Si esto
    // devolviera un contenedor vacío, el editor tendría un hueco donde antes no había
    // nada, y R6 dice «ni de precio ni de comportamiento».
    const html = pintar({ ...BASE, ranuras: [], itinerarios: [] })
    expect(html).toBe('')
  })

  it('sí pinta si hay ranuras aunque todavía no haya combinaciones', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: [] })
    expect(html).toContain('Armar las tres tarifas')
    expect(html).toContain('Vuelo')
  })
})

describe('§2.6.4 · el bloqueo se VE, no solo se rechaza', () => {
  it('dice el motivo completo, con las dos cifras, en TEXTO VISIBLE', () => {
    // ⚠️ «visible» hay que exigirlo: el motivo viaja también en el `title` del
    // interruptor, así que un `toContain` sobre el HTML entero sigue en verde con el
    // mensaje borrado. Medido: al quitar el div de motivo, esa versión de la prueba
    // NO cayó. Se afirma sobre el nodo de texto, quitando primero los atributos.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    const soloTexto = html.replace(/<[^>]*>/g, ' ')
    expect(soloTexto).toContain('por debajo del piso')
    expect(soloTexto).toContain('3,1%')
    expect(soloTexto).toContain('5,0%')
  })

  it('el interruptor del bloqueado llega DESHABILITADO', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    // Dos checkboxes: el de la Recomendada habilitado, el de la Económica no.
    const checkboxes = html.match(/<input type="checkbox"[^>]*>/g) ?? []
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).not.toContain('disabled')
    expect(checkboxes[1]).toContain('disabled')
  })

  it('un itinerario que YA está en la propuesta conserva su interruptor activo', () => {
    // Desmarcar siempre se puede: sacar algo de la propuesta no pide nada. Si el
    // atributo se pusiera por «hay bloqueo» a secas, quedaría atrapado dentro.
    const conBloqueoYMarcado = itinerarios().map(i =>
      i.id === 'it-barata' ? { ...i, vaEnPropuesta: true } : i,
    )
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: conBloqueoYMarcado })
    const checkboxes = html.match(/<input type="checkbox"[^>]*>/g) ?? []
    expect(checkboxes[1]).not.toContain('disabled')
  })

  it('la fila bajo el piso sale marcada y su margen en rojo (T4)', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).toContain('bg-red-50/60')
    expect(html).toContain('text-red-600')
  })
})

describe('la tabla dice lo que hay', () => {
  it('una columna por ranura y un desplegable con SUS candidatos', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).toContain('AVIANCA')
    expect(html).toContain('WINGO')
    expect(html).toContain('OCCIDENTAL')
    expect(html).toContain('HARD ROCK')
  })

  it('cada fila trae SU costo, SU precio y SU margen, en la COLUMNA de margen', () => {
    // ⚠️ Se afirma sobre la celda de margen, no sobre el HTML entero: «3,1%» aparece
    // también dentro del mensaje de bloqueo y del `title`, así que un `toContain`
    // global seguiría en verde con la columna en blanco o con otra cifra. Ese falso
    // verde existió y lo destapó la captura.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    const celdas = [...html.matchAll(/<td class="px-3 py-2 text-right tabular-nums[^"]*">([^<]*)<\/td>/g)]
      .map(m => m[1])
      .filter(t => t.includes('%') || t === '—')
    expect(celdas).toEqual(['13,0%', '3,1%'])
    // Los dos precios, distintos, en la misma pantalla: es el punto del frente.
    expect(html).toMatch(/3\.850\.000/)
    expect(html).toMatch(/3\.275\.000/)
  })

  it('T6 · el itinerario sin nombre ofrece el número que le tocaría', () => {
    const sinNombre = itinerarios().map(i => ({ ...i, nombre: null }))
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: sinNombre })
    expect(html).toContain('Opción 1')
    expect(html).toContain('Opción 2')
  })

  it('sin margen medible pinta una raya, NUNCA un 0%', () => {
    // Un cero ahí afirma que se vende a costo; lo único cierto es que todavía no hay
    // con qué medirlo.
    const sinMargen = [{ ...itinerarios()[0], margenRealPct: null, bloqueo: 'sin margen' }]
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: sinMargen })
    expect(html).toContain('—')
    expect(html).not.toMatch(/>0,0%</)
  })

  it('nombra las ranuras que le faltan al incompleto', () => {
    const incompleto = [{
      ...itinerarios()[0],
      vaEnPropuesta: false,
      ranurasFaltantes: ['hotel'],
      bloqueo: 'Falta elegir hotel: un itinerario incompleto no puede ir en la propuesta',
    }]
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: incompleto })
    expect(html).toContain('Falta elegir')
    expect(html).toContain('hotel')
  })
})

describe('estados de la pantalla', () => {
  it('la migración sin aplicar se DICE, y no se ofrece el botón que va a fallar', () => {
    const html = pintar({ ...BASE, tablasAusentes: true, ranuras: RANURAS, itinerarios: [] })
    expect(html).toContain('20260914200000_cotizacion_itinerarios.sql')
    expect(html).not.toContain('Generar combinaciones')
  })

  it('una cotización NO editable no ofrece generar ni borrar', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() }, false)
    expect(html).not.toContain('Generar combinaciones')
    // Los desplegables siguen visibles —se puede leer qué se cotizó— pero cerrados.
    expect(html).toContain('disabled')
  })

  it('el principal se distingue en la fila', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).toContain('Principal')
  })

  it('sin combinaciones AVISA que el total sale de un supuesto', () => {
    // El texto anterior decía «suma todas las alternativas a la vez», y desde R-A1 eso
    // es FALSO: cada ranura aporta una sola vez. Una pantalla sana que miente sobre el
    // cálculo es peor que una rota, porque no se ve.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: [] })
    expect(html).toContain('por supuesto')
    expect(html).not.toContain('suma todas las')
  })

  it('con combinaciones pero SIN principal, avisa lo mismo', () => {
    const sinPrincipal = itinerarios().map(i => ({ ...i, esPrincipal: false }))
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: sinPrincipal })
    expect(html).toContain('Ninguna tarifa está marcada como principal')
    expect(html).not.toContain('suma todas las alternativas')
  })

  it('con un principal marcado, el aviso NO aparece', () => {
    // El control que hace válidas las dos pruebas de arriba: sin él, un aviso pintado
    // siempre las pasaría igual.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).not.toContain('Ninguna tarifa está marcada como principal')
  })
})


// ── Regla 1 (reunión 2026-09-14): solo se cruzan vuelos y hoteles ────────────
//
// Lo que estas pruebas fijan es el JSX. La regla en sí vive probada en
// `combinaciones-vuelo-hotel.test.ts`; aquí se comprueba que la pantalla la DIGA —
// un usuario que no ve por qué su traslado perdió la columna asume que se perdió el
// traslado.

describe('Regla 1 · la tabla explica qué se cruza y qué no', () => {
  it('el encabezado explica que las columnas SUMAN y las opciones compiten', () => {
    // Es la distinción que abrió este frente: dos vuelos suman, dos aerolíneas del
    // mismo vuelo compiten. Sin decirlo, «¿por qué el segundo vuelo no está en el
    // total?» no tiene respuesta en pantalla.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    const t = html.replace(/<[^>]*>/g, ' ')
    expect(t).toContain('todas suman')
    expect(t).toContain('compiten')
    expect(html).toContain('Tours, traslados y planes no abren')
  })

  it('nombra el grupo que no se cruza, qué suma y qué queda fuera', () => {
    const html = pintar({
      ...BASE,
      ranuras: RANURAS,
      itinerarios: itinerarios(),
      fijosConAlternativas: [
        { grupo: 'traslado', aporta: 'Traslado privado', fuera: ['Traslado compartido'] },
      ],
    })
    expect(html).toContain('traslado')
    expect(html).toContain('Traslado privado')
    expect(html).toContain('Traslado compartido')
    expect(html).toContain('no se cruza')
  })

  it('sin grupos fuera de la tabla, no inventa el aviso', () => {
    // El control: sin el, un bloque pintado siempre pasaria la prueba de arriba.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).not.toContain('no se cruza')
  })
})

// ── Las tres tarifas con nombre (2026-09-21) ───────────────────────
//
// La tabla dejó de enumerar el producto completo. Lo que estas pruebas fijan es lo que
// se ve: los tres nombres tal cual, las columnas de las ranuras con su nombre propio, y
// que una tarifa incompleta se VEA incompleta y diga qué le falta.

/** Una fila mínima, con el nombre y la selección que se quieran. */
function tarifa(nombre: string, seleccion: string[], faltantes: string[] = []) {
  return {
    id: `it-${nombre}`, nombre, orden: 1,
    vaEnPropuesta: false, esPrincipal: false,
    seleccion, ranurasFaltantes: faltantes,
    costo: 1_000_000, precio: 1_200_000, margenRealPct: 16.7,
    // El bloqueo se arma con el MISMO helper que usa el servidor: escrito a mano, el
    // fixture podría nombrar la ranura de una forma que el producto no usa.
    bloqueo: faltantes.length > 0
      ? textoDeRechazo({ tipo: 'incompleto', grupos: faltantes })
      : null,
  }
}

describe('la tabla arma TRES tarifas con nombre', () => {
  it('el botón ofrece armar las tres y las nombra en el encabezado', () => {
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: [] })
    expect(html).toContain('Armar las tres tarifas')
    for (const n of ['Económica', 'Recomendada', 'Premium']) expect(html).toContain(n)
    // Y ya NO ofrece enumerar el producto completo.
    expect(html).not.toContain('Generar combinaciones')
  })

  it('con las tres puestas, el botón desaparece: no hay nada que crear', () => {
    // El control de la prueba de arriba. Un botón que se pinta siempre la pasaría igual.
    const html = pintar({
      ...BASE,
      ranuras: RANURAS,
      itinerarios: ['Económica', 'Recomendada', 'Premium'].map(n => tarifa(n, ['avianca', 'h1'])),
    })
    expect(html).not.toContain('Armar las tres tarifas')
  })

  it('con dos puestas, el botón dice cuál falta', () => {
    const html = pintar({
      ...BASE,
      ranuras: RANURAS,
      itinerarios: ['Económica', 'Recomendada'].map(n => tarifa(n, ['avianca', 'h1'])),
    })
    expect(html).toContain('Crear Premium')
  })

  it('una fila que NO es una de las tres se marca como tal', () => {
    // Pasa en las cotizaciones que venían del enumerado cartesiano: sus filas no se
    // borran, y sin marca se confundirían con lo que va al cliente.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: [tarifa('Opción 4', ['avianca', 'h1'])] })
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('No es una de las tres tarifas')
  })
})

describe('el viaje a Providencia, en la tabla', () => {
  it('los DOS vuelos son columnas, cada una con su nombre propio', () => {
    // El bloqueo que abrió el frente: hasta hoy «Vuelo 2» no abría columna, así que el
    // segundo tramo no se podía elegir por tarifa.
    const html = pintar({
      ...BASE,
      ranuras: PROVIDENCIA,
      itinerarios: [tarifa('Recomendada', ['avianca', 'sat-am', 'h1'])],
    })
    const t = html.replace(/<[^>]*>/g, ' ')
    // El prefijo del tipo va como texto y el nombre libre como valor del input que lo
    // renombra: las dos mitades del encabezado, cada una donde se puede tocar.
    expect(t).toContain('Vuelo 2')
    expect(html).toMatch(/aria-label="Nombre de la ranura Vuelo"[^>]*value="Bogotá a San Andrés"/)
    expect(html).toMatch(/aria-label="Nombre de la ranura Vuelo 2"[^>]*value="San Andrés a Providencia"/)
    // Las dos variantes de horario del segundo tramo están para elegir.
    expect(html).toContain('SATENA 7:00')
    expect(html).toContain('SATENA 15:00')
  })

  it('⚠️ una tarifa INCOMPLETA se ve incompleta y dice qué le falta, por su nombre', () => {
    const html = pintar({
      ...BASE,
      ranuras: PROVIDENCIA,
      itinerarios: [tarifa('Premium', ['avianca', 'h2'], ['vuelo 2: San Andrés a Providencia'])],
    })
    const t = html.replace(/<[^>]*>/g, ' ')
    expect(t).toContain('Incompleta: falta elegir')
    // ⚠️ El nombre de la COLUMNA, no el grupo crudo: «vuelo 2: san andrés a
    // providencia» manda a buscar algo que la tabla no llama así.
    expect(t).toContain('Vuelo 2 · San Andrés a Providencia')
    expect(t).not.toContain('vuelo 2: San Andrés')
  })

  it('el encabezado de la ranura es EDITABLE y renombra la ranura completa', () => {
    // Sin esto, «Vuelo» y «Vuelo 2» no dicen cuál es cuál. ⚠️ Solo se edita la parte
    // libre: dejar escribir el ordinal fundiría dos ranuras.
    const html = pintar({
      ...BASE,
      ranuras: PROVIDENCIA,
      itinerarios: [tarifa('Recomendada', ['avianca', 'sat-am', 'h1'])],
    })
    expect(html).toContain('aria-label="Nombre de la ranura Vuelo 2"')
    expect(html).toMatch(/aria-label="Nombre de la ranura Vuelo 2"[^>]*value="San Andrés a Providencia"/)
    expect(html).toContain('sus 2 opciones')
  })

  it('en solo lectura el encabezado NO es editable', () => {
    const html = pintar(
      { ...BASE, ranuras: PROVIDENCIA, itinerarios: [tarifa('Recomendada', ['avianca', 'sat-am', 'h1'])] },
      false,
    )
    expect(html).not.toContain('aria-label="Nombre de la ranura')
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('San Andrés a Providencia')
  })
})
