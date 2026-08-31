import { describe, it, expect } from 'vitest'
import { resolverPlantillaCampo } from './plantilla-campo'
import { SECCIONALES_DIAN } from '@/lib/dian/seccionales'

describe('resolverPlantillaCampo', () => {
  it('sustituye los campos del bloque, como siempre', () => {
    expect(resolverPlantillaCampo('Hola {{nombre}}', { nombre: 'Deisy' })).toBe('Hola Deisy')
  })

  it('un placeholder sin valor queda visible, no como hueco', () => {
    expect(resolverPlantillaCampo('Seccional: {{seccional_ref}}', {})).toBe(
      'Seccional: [seccional_ref]',
    )
  })

  it('la lista de seccionales con cita se DERIVA del catalogo, no se transcribe', () => {
    // Este era el defecto: la ayuda decia "Solo Bogota, Medellin, Cali y
    // Bucaramanga" escrito a mano, mientras el motor decidia con el flag `cita`.
    // La comprobacion se calcula desde el catalogo, para que agregar una
    // seccional con cita rompa este test en vez de dejar la ayuda mintiendo.
    const esperadas = SECCIONALES_DIAN.filter(s => s.cita).map(s => s.label.split('—')[0].trim())
    const texto = resolverPlantillaCampo('Exigen cita: {{seccionales_con_cita}}.', {})
    for (const ciudad of new Set(esperadas)) {
      expect(texto).toContain(ciudad)
    }
    expect(texto).not.toContain('[seccionales_con_cita]')
  })

  it('un valor del bloque gana sobre el derivado', () => {
    // El derivado es el default de la linea, no una imposicion: si alguna
    // declara el suyo, manda el suyo.
    expect(
      resolverPlantillaCampo('{{seccionales_con_cita}}', { seccionales_con_cita: 'Solo Tuluá' }),
    ).toBe('Solo Tuluá')
  })
})
