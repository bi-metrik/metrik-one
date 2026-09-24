import { describe, expect, it } from 'vitest'
import type { CampoFuenteMinimo } from './guarda-nit-formulario'
import {
  identificacionConPrefijoEnFormulario,
  separarSondasDeContraparte,
  sondasDeContraparte,
} from './guarda-prefijo-formulario'

// `campos_fuente` de producción (SOENA, 2026-09-24): la declaración juramentada y la relación
// de facturas imprimen la casilla 26 de los dos RUT; el 010 imprime la casilla 5.
const DECLARACION: CampoFuenteMinimo[] = [
  { slug: 'numero_identificacion', source: { tipo: 'ai', campo_slug: 'numero_identificacion', bloque_slug: 'rut', etapa_orden: 6, bloque_orden: 2 } },
  { slug: 'numero_identificacion_2', optional: true, source: { tipo: 'ai', campo_slug: 'numero_identificacion', bloque_slug: 'rut_solicitante_2', etapa_orden: 6, bloque_orden: 4 } },
  { slug: 'nombre_solicitante', source: { tipo: 'ai', campo_slug: 'razon_social', bloque_slug: 'rut', etapa_orden: 6, bloque_orden: 2 } },
]
const F010: CampoFuenteMinimo[] = [
  { slug: 'nit', source: { tipo: 'ai', campo_slug: 'nit', bloque_slug: 'rut', etapa_orden: 6, bloque_orden: 2 } },
]

/** Lo que devolvería `resolverCamposFuente` con las sondas incluidas. */
function resolver(campos: CampoFuenteMinimo[], valores: Record<string, Record<string, string>>) {
  const datos: Record<string, string | null> = {}
  for (const c of [...campos, ...sondasDeContraparte(campos)]) {
    datos[c.slug] = valores[c.source.bloque_slug as string]?.[c.source.campo_slug as string] ?? null
  }
  const sondas = separarSondasDeContraparte(datos)
  return { datos, sondas }
}

describe('la declaración y la relación no salen con el «13» pegado', () => {
  it('V0177: la casilla 26 decía 132747706 con la 5 en 32747706 → se niega, con el número limpio', () => {
    const { datos, sondas } = resolver(DECLARACION, { rut: { numero_identificacion: '132747706', nit: '32747706', razon_social: 'X' } })
    const msg = identificacionConPrefijoEnFormulario(DECLARACION, datos, sondas)
    expect(msg).toContain('132747706')
    expect(msg).toContain('32747706')
    // Las sondas no llegan al PDF.
    expect(Object.keys(datos).some(k => k.startsWith('__'))).toBe(false)
  })

  it('el segundo titular también', () => {
    const { datos, sondas } = resolver(DECLARACION, {
      rut: { numero_identificacion: '80180688', nit: '80180688' },
      rut_solicitante_2: { numero_identificacion: '1379907467', nit: '79907467' },
    })
    expect(identificacionConPrefijoEnFormulario(DECLARACION, datos, sondas)).toContain('79907467')
  })

  it('un override escrito a mano con el prefijo también se niega (se mira lo que se imprime)', () => {
    const { datos, sondas } = resolver(DECLARACION, { rut: { numero_identificacion: '80180688', nit: '80180688' } })
    datos.numero_identificacion = '1380180688'
    expect(identificacionConPrefijoEnFormulario(DECLARACION, datos, sondas)).not.toBeNull()
  })

  it('limpio, o cédula de extranjería (la 26 difiere de la 5 por diseño): se genera', () => {
    const limpio = resolver(DECLARACION, { rut: { numero_identificacion: '80180688', nit: '80180688' } })
    expect(identificacionConPrefijoEnFormulario(DECLARACION, limpio.datos, limpio.sondas)).toBeNull()
    const ce = resolver(DECLARACION, { rut: { numero_identificacion: '90611', nit: '650107146' } })
    expect(identificacionConPrefijoEnFormulario(DECLARACION, ce.datos, ce.sondas)).toBeNull()
  })

  it('sin testigo no se adivina', () => {
    const { datos, sondas } = resolver(DECLARACION, { rut: { numero_identificacion: '1380180688' } })
    expect(identificacionConPrefijoEnFormulario(DECLARACION, datos, sondas)).toBeNull()
  })

  it('el 010 imprime la casilla 5: su testigo es la 26', () => {
    const { datos, sondas } = resolver(F010, { rut: { nit: '1380180688', numero_identificacion: '80180688' } })
    expect(identificacionConPrefijoEnFormulario(F010, datos, sondas)).not.toBeNull()
  })
})
