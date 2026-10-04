import { describe, it, expect } from 'vitest'
import {
  decidirAccion,
  esNavegacionInterna,
  leerEpoca,
  motivoParaRecargar,
  navegarConCargaCompleta,
  TECHO_EDAD_MS,
  type Momento,
  type Motivo,
} from './decidir'

const UNA_HORA = 60 * 60 * 1000
const MOMENTOS: Momento[] = ['intervalo', 'volver']

describe('motivoParaRecargar', () => {
  // El cambio del 2026-10-03: un deploy normal ya no recarga. La version del deployment
  // ni siquiera entra a la decision; solo la epoca y la edad.
  it('misma epoca y poca edad: ningun motivo (aunque haya habido 25 deploys)', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: 3, edadMs: UNA_HORA })).toBeNull()
  })

  it('subio la epoca: motivo "epoca", aunque la pestaña sea reciente', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: 4, edadMs: 1 })).toBe('epoca')
  })

  // Una reversion de deploy deja la epoca viva por debajo de la cargada. Recargar mandaria
  // la pestaña al codigo viejo: no es motivo.
  it('epoca viva menor (reversion): ningun motivo', () => {
    expect(motivoParaRecargar({ epocaCargada: 4, epocaViva: 3, edadMs: UNA_HORA })).toBeNull()
  })

  it('el techo de 8 horas da motivo "techo" con la misma epoca', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: 3, edadMs: TECHO_EDAD_MS })).toBe('techo')
  })

  it('justo por debajo del techo todavia no', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: 3, edadMs: TECHO_EDAD_MS - 1 })).toBeNull()
  })

  // Si /api/version falla, la epoca viva queda en null. No es motivo...
  it('epoca viva nula no es motivo', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: null, edadMs: UNA_HORA })).toBeNull()
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: undefined, edadMs: UNA_HORA })).toBeNull()
  })

  // ...salvo el techo, que manda aunque el endpoint no responda: la pestaña de dieciseis
  // dias de Daniela tiene que reciclarse igual.
  it('el techo manda aunque la epoca viva sea nula', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: null, edadMs: TECHO_EDAD_MS + 1 })).toBe('techo')
  })

  it('si hay epoca nueva Y techo, gana la epoca (es la que actua sin esperar)', () => {
    expect(motivoParaRecargar({ epocaCargada: 3, epocaViva: 4, edadMs: TECHO_EDAD_MS + 1 })).toBe('epoca')
  })

  it('el techo se puede acortar por parametro', () => {
    expect(
      motivoParaRecargar({ epocaCargada: 3, epocaViva: 3, edadMs: 2 * UNA_HORA, techoMs: UNA_HORA }),
    ).toBe('techo')
  })
})

describe('leerEpoca: /api/version falla o devuelve basura → nada', () => {
  it('lee un entero no negativo', () => {
    expect(leerEpoca({ version: 'dpl_x', epoca: 4 })).toBe(4)
    expect(leerEpoca({ epoca: 0 })).toBe(0)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un string', 'epoca'],
    ['un numero suelto', 4],
    ['sin epoca (deployment viejo que no la publica)', { version: 'dpl_x' }],
    ['epoca como texto', { epoca: '5' }],
    ['epoca decimal', { epoca: 4.5 }],
    ['epoca negativa', { epoca: -1 }],
    ['epoca NaN', { epoca: Number.NaN }],
    ['epoca infinita', { epoca: Number.POSITIVE_INFINITY }],
    ['epoca null', { epoca: null }],
  ])('%s → null', (_nombre, cuerpo) => {
    expect(leerEpoca(cuerpo)).toBeNull()
  })

  it('basura de /api/version no produce motivo con la pestaña joven', () => {
    const epocaViva = leerEpoca({ epoca: 'muchas' })
    expect(motivoParaRecargar({ epocaCargada: 1, epocaViva, edadMs: UNA_HORA })).toBeNull()
  })
})

describe('decidirAccion', () => {
  const base = { trabajoEnCurso: false, enLinea: true }

  it('sin motivo (solo cambio el deploy): nada, en ningun momento', () => {
    for (const momento of MOMENTOS) {
      expect(decidirAccion({ ...base, motivo: null, momento })).toBe('nada')
      expect(decidirAccion({ ...base, motivo: null, momento, trabajoEnCurso: true })).toBe('nada')
    }
  })

  describe('epoca nueva: igual que antes', () => {
    it('sin nada que perder, recarga sola (en cualquier momento)', () => {
      for (const momento of MOMENTOS) {
        expect(decidirAccion({ ...base, motivo: 'epoca', momento })).toBe('recargar')
      }
    })

    it('con trabajo en curso, avisa y espera', () => {
      for (const momento of MOMENTOS) {
        expect(decidirAccion({ ...base, motivo: 'epoca', momento, trabajoEnCurso: true })).toBe('avisar')
      }
    })
  })

  describe('techo: nunca a alguien que esta leyendo', () => {
    it('en la revision periodica NO recarga, aunque no haya trabajo: queda pendiente', () => {
      expect(decidirAccion({ ...base, motivo: 'techo', momento: 'intervalo' })).toBe('nada')
    })

    it('al volver a la pestaña y sin trabajo, recarga', () => {
      expect(decidirAccion({ ...base, motivo: 'techo', momento: 'volver' })).toBe('recargar')
    })

    it('al volver con trabajo en curso, no recarga ni avisa: espera a la navegacion', () => {
      expect(decidirAccion({ ...base, motivo: 'techo', momento: 'volver', trabajoEnCurso: true })).toBe('nada')
    })

    it('el techo pendiente se resuelve en la siguiente navegacion interna', () => {
      expect(navegarConCargaCompleta({ motivo: 'techo', enLinea: true })).toBe(true)
    })
  })

  // Recargar sin red cambia una pantalla que funciona a medias por una que no carga.
  it('sin conexion no se hace nada, ni siquiera avisar', () => {
    for (const motivo of ['epoca', 'techo'] as Motivo[]) {
      for (const momento of MOMENTOS) {
        for (const trabajoEnCurso of [false, true]) {
          expect(decidirAccion({ motivo, momento, trabajoEnCurso, enLinea: false })).toBe('nada')
        }
      }
    }
  })
})

describe('navegarConCargaCompleta', () => {
  it('sin motivo, la navegacion sigue suave', () => {
    expect(navegarConCargaCompleta({ motivo: null, enLinea: true })).toBe(false)
  })

  it('con epoca nueva pendiente (habia trabajo y se aviso), la navegacion carga completo', () => {
    expect(navegarConCargaCompleta({ motivo: 'epoca', enLinea: true })).toBe(true)
  })

  it('sin red, nunca: la carga completa sin red deja la pantalla en blanco', () => {
    expect(navegarConCargaCompleta({ motivo: 'techo', enLinea: false })).toBe(false)
    expect(navegarConCargaCompleta({ motivo: 'epoca', enLinea: false })).toBe(false)
  })
})

describe('esNavegacionInterna', () => {
  const clic = {
    ubicacion: 'https://soena.metrikone.co/negocios?vista=mias',
    target: null,
    descarga: false,
    boton: 0,
    modificadora: false,
    yaPrevenido: false,
  }

  it('un enlace relativo del mismo sitio es interno', () => {
    expect(esNavegacionInterna({ ...clic, href: '/negocios/abc' })?.href).toBe(
      'https://soena.metrikone.co/negocios/abc',
    )
  })

  it('un enlace absoluto al mismo origen es interno', () => {
    expect(esNavegacionInterna({ ...clic, href: 'https://soena.metrikone.co/tableros' })).not.toBeNull()
  })

  it('target _self cuenta como interno', () => {
    expect(esNavegacionInterna({ ...clic, href: '/x', target: '_self' })).not.toBeNull()
  })

  it.each([
    ['otro dominio', { href: 'https://drive.google.com/x' }],
    ['otro subdominio (otro workspace)', { href: 'https://metrik.metrikone.co/negocios' }],
    ['pestaña nueva', { href: '/x', target: '_blank' }],
    ['descarga', { href: '/api/revision/export', descarga: true }],
    ['boton central', { href: '/x', boton: 1 }],
    ['con tecla modificadora', { href: '/x', modificadora: true }],
    ['ya prevenido por otro manejador', { href: '/x', yaPrevenido: true }],
    ['solo cambia el ancla', { href: '#seccion' }],
    ['mailto', { href: 'mailto:a@b.co' }],
    ['tel', { href: 'tel:+573000000000' }],
    ['javascript:', { href: 'javascript:void(0)' }],
    ['sin href', { href: null }],
  ])('%s → no se toca', (_nombre, extra) => {
    expect(esNavegacionInterna({ ...clic, href: '/x', ...(extra as object) })).toBeNull()
  })

  it('misma ruta con otra busqueda SI es navegacion (Next la resolveria suave)', () => {
    expect(esNavegacionInterna({ ...clic, href: '/negocios?vista=todas' })).not.toBeNull()
  })
})
