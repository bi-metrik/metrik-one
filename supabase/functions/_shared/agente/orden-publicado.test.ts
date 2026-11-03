import { describe, expect, it } from 'vitest'
import { ordenPublicado, huellaPublicable } from './reglamento'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { conPerfil } from './bandeja/reglamento-perfil'
import { fichasDelRol } from './bandeja/roles-trappvel'

/**
 * El arnés corre con las fichas en el orden de una versión publicada (`bot_publicar_reglamento`: `order by clave`), no
 * en el del código. La bandeja publicada de Trappvel (v3, 2026-10-14) es el reglamento del código ordenado así, y con el
 * orden del código el arnés probaba un prompt que producción no ve (2026-10-29).
 */
describe('ordenPublicado', () => {
  it('ordena por clave como la base, carácter por carácter («g.» antes de «glo.», «p.» antes de «perfil»)', () => {
    const claves = ordenPublicado(conPerfil(REGLAMENTO_ANEXO_A)).map((f) => f.clave)
    expect(claves.indexOf('g.viaje_nuevo_existente')).toBeLessThan(claves.indexOf('glo.cliente_nuevo'))
    expect(claves.indexOf('p.solicitud_nueva')).toBeLessThan(claves.indexOf('perfil'))
    expect(claves[0]).toBe('alc.clientes_finales')
    expect(claves).toEqual([...claves].sort())
  })

  it('no cambia el contenido ni la huella que se publica, y no muta la entrada', async () => {
    const fichas = fichasDelRol('mano_derecha')
    const antes = fichas.map((f) => f.clave)
    const ordenadas = ordenPublicado(fichas)
    expect(fichas.map((f) => f.clave)).toEqual(antes)
    expect(new Set(ordenadas)).toEqual(new Set(fichas))
    expect(await huellaPublicable(ordenadas)).toBe(await huellaPublicable(fichas))
  })
})
