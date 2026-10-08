import { describe, it, expect } from 'vitest'
import { formulariosOrigenDeCopias, historialSinOrigenesGenerables, slugsDeCopiasSinOrigen } from './copia-de-formulario'
import { copiaDeSoloLectura } from './copia-heredada'

/**
 * La copia readonly de la carta de autorización (documento) lee el PDF de su origen, que es
 * un FORMULARIO (`carta_autorizacion_generar`). Ver `copia-de-formulario.ts`.
 */

const COPIA_CARTA = {
  readonly: true,
  label: '008_CARTA_AUTORIZACION_BORRADOR',
  source_etapa_orden: 6,
  source_bloque_slug: 'carta_autorizacion_generar',
}

describe('slugsDeCopiasSinOrigen', () => {
  it('pide el origen de la copia de la carta cuando no está entre los documentos', () => {
    expect(slugsDeCopiasSinOrigen([{ tipo: 'documento', configExtra: COPIA_CARTA }], new Map()))
      .toEqual(['carta_autorizacion_generar'])
  })

  it('no consulta nada para las copias que ya encontraron su documento (factura, RUT, UPME, notariada)', () => {
    const docs = new Map([['carta_autorizacion_notariada', { drive_url: 'u' }], ['rut', {}]])
    expect(slugsDeCopiasSinOrigen([
      { tipo: 'documento', configExtra: { readonly: true, source_etapa_orden: 18, source_bloque_slug: 'carta_autorizacion_notariada' } },
      { tipo: 'documento', configExtra: { readonly: true, source_etapa_orden: 6, source_bloque_slug: 'rut' } },
    ], docs)).toEqual([])
  })

  it('ignora lo que no es copia de documento', () => {
    expect(slugsDeCopiasSinOrigen([
      // Un documento original con slug no es copia.
      { tipo: 'documento', configExtra: { source_bloque_slug: 'x' } },
      // El espejo de datos (fecha de la cita) tiene su propio mecanismo.
      { tipo: 'datos', configExtra: { compartido_con_origen: true, source_bloque_slug: 'fecha_cita_dian', source_etapa_orden: 16 } },
      { tipo: 'formulario', configExtra: COPIA_CARTA },
      { tipo: 'documento', configExtra: { source_etapa_orden: 6 } },
    ], new Map())).toEqual([])
  })
})

describe('formulariosOrigenDeCopias', () => {
  function cliente(filas: unknown[], error: unknown = null) {
    const llamadas: Array<[string, ...unknown[]]> = []
    const q = {
      select: (...a: unknown[]) => { llamadas.push(['select', ...a]); return q },
      eq: (...a: unknown[]) => { llamadas.push(['eq', ...a]); return q },
      in: (...a: unknown[]) => { llamadas.push(['in', ...a]); return q },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas, error }).then(ok),
    }
    return { llamadas, from: (t: string) => { llamadas.push(['from', t]); return q } }
  }

  it('sin slugs no toca la base', async () => {
    const c = cliente([])
    expect((await formulariosOrigenDeCopias(c, 'neg', [])).size).toBe(0)
    expect(c.llamadas).toEqual([])
  })

  it('trae SOLO formularios del negocio, por slug', async () => {
    const c = cliente([{ data: { drive_url: 'https://drive/carta' }, bloque_configs: { slug: 'carta_autorizacion_generar' } }])
    const m = await formulariosOrigenDeCopias(c, 'neg-1', ['carta_autorizacion_generar'])
    expect(m.get('carta_autorizacion_generar')).toEqual({ drive_url: 'https://drive/carta' })
    expect(c.llamadas).toContainEqual(['eq', 'negocio_id', 'neg-1'])
    expect(c.llamadas).toContainEqual(['eq', 'bloque_configs.bloque_definitions.tipo', 'formulario'])
    expect(c.llamadas).toContainEqual(['in', 'bloque_configs.slug', ['carta_autorizacion_generar']])
  })

  it('si la consulta falla, la copia queda sin origen (vacía), no con otro archivo', async () => {
    const m = await formulariosOrigenDeCopias(cliente([], { message: 'x' }), 'neg', ['carta_autorizacion_generar'])
    expect(m.size).toBe(0)
  })
})

describe('la copia de la carta es de solo lectura', () => {
  it('sin `editable_siempre` no escribe: el servidor la rechaza con este mismo criterio', () => {
    expect(copiaDeSoloLectura(COPIA_CARTA)).toBe(true)
  })
})

describe('historialSinOrigenesGenerables', () => {
  const historial = [
    { slug: 'rut' },
    { slug: 'carta_autorizacion_generar' },
    { slug: null },
  ]

  it('con la copia generable en la etapa actual, el origen no se repite en el historial', () => {
    expect(historialSinOrigenesGenerables(historial, [{ ...COPIA_CARTA, genera_en_origen: true }, null]))
      .toEqual([{ slug: 'rut' }, { slug: null }])
  })

  it('con la copia de solo lectura el historial queda igual (es el único lugar para generar)', () => {
    expect(historialSinOrigenesGenerables(historial, [COPIA_CARTA])).toBe(historial)
    expect(historialSinOrigenesGenerables(historial, [])).toBe(historial)
  })
})
