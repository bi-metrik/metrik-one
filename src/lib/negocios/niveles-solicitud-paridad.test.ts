/**
 * La copia de `niveles-solicitud.ts` que usan las edge functions (el paso de entendimiento de
 * la bandeja de WhatsApp) dice lo mismo que la fuente. Mismo patrón que `dias-habiles`: la
 * copia existe porque las funciones de Deno no alcanzan `src/`, y esta prueba es la que
 * impide que las dos se separen en silencio.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as fuente from './niveles-solicitud'
import * as copiaEdge from '../../../supabase/functions/_shared/niveles-solicitud'
import { parsearNumeroColombiano } from './numero-colombiano'

const MARCA = '// ── Copia de `niveles-solicitud.ts` (desde aquí, idéntica a la fuente)'

describe('la copia de Deno', () => {
  it('el cuerpo es texto idéntico a la fuente, desde el tipo NivelCampo', () => {
    const src = readFileSync(path.join(__dirname, 'niveles-solicitud.ts'), 'utf8')
    const edge = readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/niveles-solicitud.ts'), 'utf8')
    const desde = (t: string) => t.slice(t.indexOf('export type NivelCampo'))
    expect(edge).toContain(MARCA)
    expect(desde(edge)).toBe(desde(src))
  })

  const fields: fuente.CampoConNivel[] = [
    { slug: 'destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde?' },
    { slug: 'adultos', tipo: 'numero', nivel: 'minimo', no_cero: true },
    { slug: 'ninos', tipo: 'numero', nivel: 'minimo' },
    { slug: 'edades', tipo: 'texto', nivel: 'minimo', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
    { slug: 'tipo', tipo: 'select', nivel: 'deseable', pedir_si: { field: 'destino_tipo', value_in: ['Internacional'] } },
    { slug: 'acomodacion', tipo: 'texto', nivel: 'deseable', pedir_si: { field: 'total', al_menos: 6 } },
    { slug: 'ok', tipo: 'toggle', nivel: 'deseable', showIf: { field: 'x', equals: 'si' } },
    { slug: 'roto', tipo: 'texto', nivel: 'deseable', pedir_si: 'ninos > 0' },
    { slug: 'raro', tipo: 'texto', nivel: 'obligatorio' },
    { slug: 'flex', tipo: 'select', nivel: 'deseable', pedir_si: { field: 'fecha_salida', vacio: true } },
    { slug: 'hay_menores', tipo: 'texto', nivel: 'deseable', pedir_si: { suma_de: ['ninos', 'infantes'], vacio: false } },
  ]

  it.each([
    ['vacío', {}],
    ['con menores', { destino: 'Madrid', adultos: 2, ninos: '1.000', destino_tipo: 'internacional' }],
    ['grupo', { adultos: '17', ninos: 5, total: 22, x: 'si', ok: 'true' }],
    ['cero', { adultos: 0, ninos: 0 }],
    ['con fecha', { fecha_salida: '2026-11-15', infantes: '1' }],
  ])('mismo resultado: %s', (_n, valores) => {
    expect(copiaEdge.calcularNiveles(fields, valores)).toEqual(fuente.calcularNiveles(fields, valores))
  })

  it('las dependencias copiadas leen igual los números', () => {
    for (const v of ['769.898', '1.234,56', '45.5', '$ 1.000', 'abc', '', 12, null]) {
      expect(copiaEdge.parsearNumeroColombiano(v)).toBe(parsearNumeroColombiano(v))
    }
  })
})
