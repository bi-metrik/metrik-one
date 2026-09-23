/**
 * Los términos con los que nace una cotización (C5): copia del texto base de la línea, solo
 * con la plantilla de Trappvel; `null` en cualquier otro caso o si una lectura falla.
 */
import { describe, expect, it } from 'vitest'

import { terminosAlCrear, terminosInicialesDeCotizacion } from './terminos-al-crear'
import { terminosAlAbrir } from './terminos-cotizacion'
import { TERMINOS_BASE_TRAPPVEL } from './__fixtures__/terminos-base-trappvel'

describe('terminosAlCrear', () => {
  it('con la plantilla de Trappvel copia el texto base tal cual (saltos y sub-lista incluidos)', () => {
    expect(terminosAlCrear({ plantillaSlug: 'trappvel', configExtraLinea: { terminos_base: TERMINOS_BASE_TRAPPVEL } }))
      .toBe(TERMINOS_BASE_TRAPPVEL)
  })

  it('⚠️ otra plantilla no copia nada aunque su línea tenga texto base (R6)', () => {
    for (const slug of [null, undefined, 'default', 'soena', 'termotech']) {
      expect(terminosAlCrear({ plantillaSlug: slug, configExtraLinea: { terminos_base: 'Algo.' } })).toBeNull()
    }
  })

  it('sin texto base, en blanco o con otra forma: null, como antes', () => {
    for (const cfg of [null, {}, { terminos_base: '' }, { terminos_base: '   \n ' }, { terminos_base: 42 }, []]) {
      expect(terminosAlCrear({ plantillaSlug: 'trappvel', configExtraLinea: cfg })).toBeNull()
    }
  })

  it('lo que nace guardado es lo que el panel muestra: no lo vuelve a proponer', () => {
    const guardado = terminosAlCrear({ plantillaSlug: 'trappvel', configExtraLinea: { terminos_base: TERMINOS_BASE_TRAPPVEL } })
    expect(terminosAlAbrir({ terminos: guardado, terminosBase: TERMINOS_BASE_TRAPPVEL, editable: true }))
      .toEqual({ valor: TERMINOS_BASE_TRAPPVEL, propuesto: false })
  })
})

// ── La lectura, con un doble de Supabase ─────────────────────────────────────

function doble(p: {
  slug?: string | null
  configExtra?: unknown
  embedComoArray?: boolean
  errorEn?: 'workspaces' | 'negocios'
  lanza?: boolean
}) {
  const consultas: string[] = []
  return {
    consultas,
    from(tabla: string) {
      consultas.push(tabla)
      if (p.lanza) throw new Error('red caída')
      const b = {
        select() { return b },
        eq() { return b },
        async maybeSingle() {
          if (p.errorEn === tabla) return { data: null, error: { message: 'falló' } }
          if (tabla === 'workspaces') return { data: { cotizacion_template_slug: p.slug ?? null }, error: null }
          if (tabla === 'negocios') {
            const linea = { config_extra: p.configExtra ?? null }
            return { data: { lineas_negocio: p.embedComoArray ? [linea] : linea }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return b
    },
  }
}

describe('terminosInicialesDeCotizacion', () => {
  const args = { workspaceId: 'ws-1', negocioId: 'neg-1' }

  it('Trappvel con texto base: la copia', async () => {
    const sb = doble({ slug: 'trappvel', configExtra: { terminos_base: TERMINOS_BASE_TRAPPVEL } })
    expect(await terminosInicialesDeCotizacion(sb, args)).toBe(TERMINOS_BASE_TRAPPVEL)
  })

  it('el embed de la línea como array de uno también sirve', async () => {
    const sb = doble({ slug: 'trappvel', configExtra: { terminos_base: 'Base.' }, embedComoArray: true })
    expect(await terminosInicialesDeCotizacion(sb, args)).toBe('Base.')
  })

  it('otro workspace: null y ni siquiera lee la línea', async () => {
    const sb = doble({ slug: 'default', configExtra: { terminos_base: 'Base.' } })
    expect(await terminosInicialesDeCotizacion(sb, args)).toBeNull()
    expect(sb.consultas).toEqual(['workspaces'])
  })

  it('sin negocio: null sin consultar nada', async () => {
    const sb = doble({ slug: 'trappvel', configExtra: { terminos_base: 'Base.' } })
    expect(await terminosInicialesDeCotizacion(sb, { workspaceId: 'ws-1', negocioId: null })).toBeNull()
    expect(sb.consultas).toEqual([])
  })

  it('una lectura que falla o lanza deja la cotización sin términos, no la tumba', async () => {
    expect(await terminosInicialesDeCotizacion(doble({ slug: 'trappvel', errorEn: 'workspaces' }), args)).toBeNull()
    expect(await terminosInicialesDeCotizacion(
      doble({ slug: 'trappvel', configExtra: { terminos_base: 'Base.' }, errorEn: 'negocios' }), args,
    )).toBeNull()
    expect(await terminosInicialesDeCotizacion(doble({ lanza: true }), args)).toBeNull()
  })
})
