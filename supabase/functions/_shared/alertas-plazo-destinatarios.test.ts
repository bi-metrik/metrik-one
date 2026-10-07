import { describe, expect, it } from 'vitest'
import { destinatariosDelHito } from './alertas-plazo-destinatarios'

const DEISY = '6f107e73-cfb7-4869-acd3-73195173f249'

// La config que va a quedar en SOENA (SOE-001), reducida a lo que decide.
const CONFIG = {
  areas: ['operaciones'],
  hitos: [
    { slug: 'radicado_5', dias_habiles: 5 },
    { slug: 'acto_30', dias_habiles: 30 },
    { slug: 'acto_45', dias_habiles: 45, destinatarios: { staff_ids: [DEISY] } },
    { slug: 'solo_financiera', dias_habiles: 10, destinatarios: { areas: ['financiera'] } },
  ],
}

describe('destinatariosDelHito', () => {
  it('un hito sin destinatarios propios usa las áreas de la línea', () => {
    expect(destinatariosDelHito(CONFIG, 'acto_30')).toEqual({ areas: ['operaciones'], staffIds: [] })
  })

  it('escalar a una persona SUMA a las áreas heredadas, no las reemplaza', () => {
    expect(destinatariosDelHito(CONFIG, 'acto_45')).toEqual({ areas: ['operaciones'], staffIds: [DEISY] })
  })

  it('áreas propias del hito reemplazan a las de la línea', () => {
    expect(destinatariosDelHito(CONFIG, 'solo_financiera')).toEqual({ areas: ['financiera'], staffIds: [] })
  })

  it('una config vieja (sin destinatarios en ningún hito) se lee igual que antes', () => {
    const vieja = { areas: ['comercial'], hitos: [{ slug: 'inadmisorio_15', dias_habiles: 15 }] }
    expect(destinatariosDelHito(vieja, 'inadmisorio_15')).toEqual({ areas: ['comercial'], staffIds: [] })
  })

  it('un slug que no está en la config cae a la línea', () => {
    expect(destinatariosDelHito(CONFIG, 'no_existe')).toEqual({ areas: ['operaciones'], staffIds: [] })
  })

  it('basura en la config no revienta: se descarta lo que no es texto y se deduplica', () => {
    const sucia = {
      areas: ['operaciones', 7, '', 'operaciones'],
      hitos: [null, { slug: 'x', destinatarios: { staff_ids: [DEISY, null, DEISY], areas: 'operaciones' } }],
    }
    expect(destinatariosDelHito(sucia, 'x')).toEqual({ areas: ['operaciones'], staffIds: [DEISY] })
    expect(destinatariosDelHito(null, 'x')).toEqual({ areas: [], staffIds: [] })
  })
})
