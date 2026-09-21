import { describe, it, expect } from 'vitest'
import {
  MENSAJE_CONFIRMACION_VENCIDA,
  MENSAJE_NIT_AMBIGUO,
  MENSAJE_SIN_CONFIRMAR,
  confirmacionVigente,
  digitosDeNit,
  faltaConfirmacionNit,
  leerConfirmacion,
  mismoNit,
  nitAConfirmar,
  nitsDelFormulario,
  type CampoFuenteMinimo,
  type ConfirmacionNit,
} from './confirmacion-nit'

/**
 * Fixtures volcados de la configuración REAL de SOENA (2026-09-21, bloques
 * `formulario_dian` y `formulario_1668` de la línea GIT EV/HEV):
 *
 *  - El 010 llama `nit` a la casilla; el 1668 la llama `numero_identificacion`.
 *  - Las dos salen de `rut.nit`, así que el criterio no puede ser el nombre de la
 *    casilla. Es el mismo `casillasConNit` que usa la guarda del DV pegado.
 *
 * Los números vienen del banco de pruebas (`proyectos/soena/ve/qa/extraccion-rut-2026-09-21/`):
 * `40771100` es el NIT real de V0446 y `407771100` es lo que ONE tenía guardado — un 7
 * repetido que el DV, el cruce entre campos y la confianza del modelo daban por bueno.
 *
 * ## Mutaciones corridas contra este archivo (2026-09-21) — conteos MEDIDOS
 *
 * Las ocho caen. Los números salen del arnés, no de la estimación: de seis estimadas
 * antes de correrlo, tres estaban mal.
 *
 * | Mutación | Pruebas en rojo |
 * |---|---|
 * | `mismoNit` devuelve `da === db` (el vacío coincide consigo mismo) | 1 |
 * | `digitosDeNit` devuelve el texto crudo | 8 |
 * | `faltaConfirmacionNit` no mira `confirmacionVigente` (basta que exista la confirmación) | 2 |
 * | `nitAConfirmar` devuelve `nits[0]` cuando hay dos distintos | 2 |
 * | `faltaConfirmacionNit` devuelve null cuando no hay confirmación | 2 |
 * | `leerConfirmacion` acepta `nit` vacío | 1 |
 * | `nitsDelFormulario` cuenta también el NIT vacío | 3 |
 * | `confirmacionVigente` devuelve true sin comparar | 3 |
 */
const RUT = { bloque_slug: 'rut', etapa_orden: 6, bloque_orden: 2, tipo: 'ai' }

const F010: CampoFuenteMinimo[] = [
  { slug: 'nit', source: { ...RUT, campo_slug: 'nit' } },
  { slug: 'dv', source: { ...RUT, campo_slug: 'dv' } },
  { slug: 'primer_apellido', source: { ...RUT, campo_slug: 'primer_apellido' } },
]

const F1668: CampoFuenteMinimo[] = [
  { slug: 'numero_identificacion', source: { ...RUT, campo_slug: 'nit' } },
  { slug: 'dv', source: { ...RUT, campo_slug: 'dv' } },
]

/** Un template hipotético con DOS comparecientes: hoy no existe en producción. */
const RUT2 = { bloque_slug: 'rut_solicitante_2', etapa_orden: 6, bloque_orden: 3, tipo: 'ai' }
const F010_DOS_NIT: CampoFuenteMinimo[] = [
  ...F010,
  { slug: 'nit_2', source: { ...RUT2, campo_slug: 'nit' } },
]

function confirmacion(nit: string): ConfirmacionNit {
  return { nit, por: 'staff-1', por_nombre: 'Deisy', at: '2026-09-21T10:00:00.000Z' }
}

describe('digitosDeNit', () => {
  it('el formato no es el dato: puntos, espacios y guiones se van', () => {
    expect(digitosDeNit('40.771.100')).toBe('40771100')
    expect(digitosDeNit('40 771 100')).toBe('40771100')
    expect(digitosDeNit('40771100-2')).toBe('407711002')
  })

  it('un valor sin dígitos queda vacío', () => {
    expect(digitosDeNit(null)).toBe('')
    expect(digitosDeNit(undefined)).toBe('')
    expect(digitosDeNit('   ')).toBe('')
  })
})

describe('mismoNit', () => {
  it('compara el número, no el texto', () => {
    expect(mismoNit('40.771.100', '40771100')).toBe(true)
  })

  it('un dígito de más NO es el mismo NIT (caso V0446)', () => {
    expect(mismoNit('40771100', '407771100')).toBe(false)
  })

  it('el DV pegado tampoco: identifica a otra persona ante la DIAN', () => {
    expect(mismoNit('40771100', '407711002')).toBe(false)
  })

  it('un vacío no coincide con nada, ni con otro vacío', () => {
    expect(mismoNit('', '')).toBe(false)
    expect(mismoNit(null, null)).toBe(false)
    expect(mismoNit('', '40771100')).toBe(false)
    expect(mismoNit('40771100', null)).toBe(false)
  })
})

describe('nitsDelFormulario', () => {
  it('lee la casilla del 010, que se llama `nit`', () => {
    expect(nitsDelFormulario('formulario-010', F010, { nit: '40771100', dv: '2' })).toEqual(['40771100'])
  })

  it('y la del 1668, que se llama distinto pero sale de la misma fuente', () => {
    expect(nitsDelFormulario('formulario-1668', F1668, { numero_identificacion: '40.771.100' }))
      .toEqual(['40771100'])
  })

  it('un template sin NIT no devuelve nada', () => {
    expect(nitsDelFormulario('declaracion-juramentada', F010, { nit: '40771100' })).toEqual([])
  })

  it('el NIT vacío no cuenta: no hay nada que transcribir todavía', () => {
    expect(nitsDelFormulario('formulario-010', F010, { nit: '' })).toEqual([])
    expect(nitsDelFormulario('formulario-010', F010, {})).toEqual([])
  })

  it('dos casillas con el MISMO número son un solo NIT', () => {
    expect(nitsDelFormulario('formulario-010', F010_DOS_NIT, { nit: '40771100', nit_2: '40.771.100' }))
      .toEqual(['40771100'])
  })
})

describe('nitAConfirmar', () => {
  it('un solo NIT: ese es el que hay que teclear', () => {
    expect(nitAConfirmar('formulario-010', F010, { nit: '40771100' }))
      .toEqual({ nit: '40771100', ambiguo: false })
  })

  it('sin NIT: no aplica, y NO es ambigüedad', () => {
    expect(nitAConfirmar('formulario-010', F010, {})).toEqual({ nit: null, ambiguo: false })
  })

  it('dos NIT distintos: ninguno se elige en silencio', () => {
    expect(nitAConfirmar('formulario-010', F010_DOS_NIT, { nit: '40771100', nit_2: '52217225' }))
      .toEqual({ nit: null, ambiguo: true })
  })
})

describe('confirmacionVigente', () => {
  it('vale mientras el NIT sea el mismo, por viejo que sea', () => {
    const vieja = { ...confirmacion('40771100'), at: '2026-01-01T00:00:00.000Z' }
    expect(confirmacionVigente(vieja, '40771100')).toBe(true)
  })

  it('el formato no la rompe', () => {
    expect(confirmacionVigente(confirmacion('40.771.100'), '40771100')).toBe(true)
  })

  it('deja de valer en cuanto cambia el NIT: el candado se cierra solo', () => {
    expect(confirmacionVigente(confirmacion('407771100'), '40771100')).toBe(false)
  })

  it('sin confirmación, o sin NIT esperado, no hay vigencia', () => {
    expect(confirmacionVigente(null, '40771100')).toBe(false)
    expect(confirmacionVigente(confirmacion('40771100'), null)).toBe(false)
  })
})

describe('faltaConfirmacionNit', () => {
  const datos = { nit: '40771100', dv: '2' }

  it('sin confirmar, no se genera', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, datos, null)).toBe(MENSAJE_SIN_CONFIRMAR)
  })

  it('confirmado y vigente, pasa', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, datos, confirmacion('40771100'))).toBeNull()
  })

  it('confirmado ANTES de que el NIT cambiara: se vuelve a pedir, y lo dice', () => {
    // El caso real: alguien confirma, después se corrige el bloque `rut`, y la
    // confirmación anterior describe un número que ya no se va a imprimir.
    expect(faltaConfirmacionNit('formulario-010', F010, datos, confirmacion('407771100')))
      .toBe(MENSAJE_CONFIRMACION_VENCIDA)
  })

  it('el 1668 se frena igual aunque su casilla se llame distinto', () => {
    expect(faltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '40771100' }, null))
      .toBe(MENSAJE_SIN_CONFIRMAR)
  })

  it('un template sin NIT pasa sin confirmar: no hay nada que transcribir', () => {
    expect(faltaConfirmacionNit('declaracion-juramentada', F010, datos, null)).toBeNull()
  })

  it('el NIT todavía vacío pasa: el faltante lo reporta el control de campos faltantes', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '' }, null)).toBeNull()
  })

  it('dos NIT distintos: no se puede cubrir con una sola confirmación, y se nombra', () => {
    expect(
      faltaConfirmacionNit(
        'formulario-010', F010_DOS_NIT,
        { nit: '40771100', nit_2: '52217225' },
        confirmacion('40771100'),
      ),
    ).toBe(MENSAJE_NIT_AMBIGUO)
  })

  it('los tres mensajes son distintos: piden tres acciones distintas', () => {
    expect(new Set([MENSAJE_SIN_CONFIRMAR, MENSAJE_CONFIRMACION_VENCIDA, MENSAJE_NIT_AMBIGUO]).size).toBe(3)
  })
})

describe('leerConfirmacion', () => {
  it('normaliza el NIT guardado a dígitos', () => {
    expect(leerConfirmacion({ nit: '40.771.100', por: 's1', por_nombre: 'Deisy', at: 'X' }))
      .toEqual({ nit: '40771100', por: 's1', por_nombre: 'Deisy', at: 'X' })
  })

  it('una fila sin NIT utilizable NO es una confirmación', () => {
    expect(leerConfirmacion({ nit: '', por: 's1' })).toBeNull()
    expect(leerConfirmacion({ por_nombre: 'Deisy' })).toBeNull()
    expect(leerConfirmacion(null)).toBeNull()
    expect(leerConfirmacion('40771100')).toBeNull()
    expect(leerConfirmacion(undefined)).toBeNull()
  })

  it('los campos de autoría opcionales caen a null sin invalidar la confirmación', () => {
    expect(leerConfirmacion({ nit: '40771100' }))
      .toEqual({ nit: '40771100', por: null, por_nombre: null, at: '' })
  })

  it('una confirmación leída de la base sigue el mismo criterio de vigencia', () => {
    const leida = leerConfirmacion({ nit: '40.771.100', at: '2026-09-21T10:00:00.000Z' })
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '40771100' }, leida)).toBeNull()
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '407771100' }, leida))
      .toBe(MENSAJE_CONFIRMACION_VENCIDA)
  })
})
