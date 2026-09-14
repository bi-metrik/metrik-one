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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}))
// Las server actions se doblan: un import de VALOR desde un archivo `'use server'`
// arrastra `getWorkspace` y con él el runtime de Next.
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  generarCombinaciones: async () => ({ success: true, creadas: 0, yaExistian: 0, aviso: null }),
  cambiarOpcionDeItinerario: async () => ({ success: true, desmarcados: [] }),
  marcarEnPropuesta: async () => ({ success: true }),
  marcarPrincipal: async () => ({ success: true }),
  renombrarItinerario: async () => ({ success: true }),
  eliminarItinerario: async () => ({ success: true }),
}))

const { default: TablaCombinaciones } = await import('./tabla-combinaciones')

const RANURAS = [
  { grupo: 'vuelo', candidatos: [{ id: 'avianca', nombre: 'AVIANCA' }, { id: 'wingo', nombre: 'WINGO' }] },
  { grupo: 'hotel', candidatos: [{ id: 'h1', nombre: 'OCCIDENTAL' }, { id: 'h2', nombre: 'HARD ROCK' }] },
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

const BASE = { umbrales: { pisoPct: 5, avisoPct: 10 }, tablasAusentes: false }

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
    expect(html).toContain('Generar combinaciones')
    expect(html).toContain('vuelo')
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

  it('sin combinaciones AVISA que el total suma todas las alternativas', () => {
    // Salió del QA en pantalla, no de una prueba: con dos vuelos declarados y ningún
    // itinerario, el total de la cotización sumaba AVIANCA y WINGO a la vez. No se
    // corrige eligiendo uno por nuestra cuenta —eso es lo que el principal decide—
    // así que se dice.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: [] })
    expect(html).toContain('suma todas las')
  })

  it('con combinaciones pero SIN principal, avisa lo mismo', () => {
    const sinPrincipal = itinerarios().map(i => ({ ...i, esPrincipal: false }))
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: sinPrincipal })
    expect(html).toContain('Ningún itinerario está marcado como principal')
  })

  it('con un principal marcado, el aviso NO aparece', () => {
    // El control que hace válidas las dos pruebas de arriba: sin él, un aviso pintado
    // siempre las pasaría igual.
    const html = pintar({ ...BASE, ranuras: RANURAS, itinerarios: itinerarios() })
    expect(html).not.toContain('Ningún itinerario está marcado como principal')
  })
})
