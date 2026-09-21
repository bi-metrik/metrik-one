import { describe, it, expect } from 'vitest'
import {
  CLAVE_CONFIRMACION_NIT,
  MENSAJE_NIT_AMBIGUO,
  MENSAJE_OTRO_NIT,
  MENSAJE_SIN_CONFIRMAR,
  confirmacionDe,
  digitosDeNit,
  faltaConfirmacionNit,
  leerConfirmaciones,
  mismoNit,
  motivoFaltaConfirmacionNit,
  nitAConfirmar,
  nitsDelFormulario,
  type CampoFuenteMinimo,
  type ConfirmacionesNit,
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
 * Las once caen. Los números salen del arnés, no de la estimación.
 *
 * | Mutación | Pruebas en rojo |
 * |---|---|
 * | `mismoNit` devuelve `da === db` (el vacío coincide consigo mismo) | 1 |
 * | `digitosDeNit` devuelve el texto crudo | 10 |
 * | `faltaConfirmacionNit` devuelve null en cuanto hay ALGUNA confirmación | 5 |
 * | `nitAConfirmar` devuelve `nits[0]` cuando hay dos distintos | 3 |
 * | `faltaConfirmacionNit` no exige confirmación | 8 |
 * | `leerConfirmaciones` acepta llaves sin dígitos | 2 |
 * | `nitsDelFormulario` cuenta también el NIT vacío | 4 |
 * | `motivoFaltaConfirmacionNit` no distingue el otro NIT | 5 |
 * | `motivoFaltaConfirmacionNit` trata el ambiguo como sin confirmar | 2 |
 * | `confirmacionDe` devuelve la primera entrada del mapa sin mirar la llave | 6 |
 * | `faltaConfirmacionNit` da siempre `SIN_CONFIRMAR` (pierde el otro NIT) | 5 |
 *
 * ⚠️ La de `leerConfirmaciones` sobrevivió en la primera corrida (0 rojas) y NO era código
 * muerto: el fixture de la forma vieja tenía llaves sin dígitos pero VALORES string, así
 * que los descartaba la guarda del tipo y las dos guardas se veían iguales. Hizo falta un
 * caso con llave sin dígitos y valor OBJETO para separarlas.
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

/** Arma el mapa como queda en `negocios.metadata.confirmacion_nit`. */
function mapa(...nits: string[]): ConfirmacionesNit {
  return Object.fromEntries(
    nits.map((n) => [n, { nit: n, por: 'staff-1', por_nombre: 'Deisy', at: '2026-09-21T10:00:00.000Z' }]),
  )
}

describe('la clave del mapa es un literal compartido', () => {
  it('para que el código y cualquier siembra no tengan dos copias del string', () => {
    expect(CLAVE_CONFIRMACION_NIT).toBe('confirmacion_nit')
  })
})

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

describe('confirmacionDe', () => {
  it('encuentra la entrada del NIT que este bloque va a imprimir', () => {
    expect(confirmacionDe(mapa('40771100'), '40771100')?.por_nombre).toBe('Deisy')
  })

  it('el formato no la rompe: la búsqueda normaliza', () => {
    expect(confirmacionDe(mapa('40771100'), '40.771.100')).not.toBeNull()
  })

  it('un NIT que no está en el mapa no tiene confirmación', () => {
    expect(confirmacionDe(mapa('40771100'), '52217225')).toBeNull()
  })

  it('sin mapa, o sin NIT esperado, no hay confirmación', () => {
    expect(confirmacionDe(null, '40771100')).toBeNull()
    expect(confirmacionDe(mapa('40771100'), null)).toBeNull()
  })
})

describe('faltaConfirmacionNit', () => {
  const datos = { nit: '40771100', dv: '2' }

  it('sin ninguna confirmación en el negocio, no se genera', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, datos, {})).toBe(MENSAJE_SIN_CONFIRMAR)
    expect(faltaConfirmacionNit('formulario-010', F010, datos, null)).toBe(MENSAJE_SIN_CONFIRMAR)
  })

  it('confirmado ese número, pasa', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, datos, mapa('40771100'))).toBeNull()
  })

  it('UNA confirmación del negocio cubre también al 1668: no se teclea cuatro veces', () => {
    const confs = mapa('40771100')
    expect(faltaConfirmacionNit('formulario-010', F010, datos, confs)).toBeNull()
    expect(faltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '40771100' }, confs)).toBeNull()
  })

  it('si el NIT del RUT cambia después, se cierran TODOS los bloques a la vez', () => {
    const confs = mapa('407771100') // se confirmó el valor viejo
    expect(faltaConfirmacionNit('formulario-010', F010, datos, confs)).toBe(MENSAJE_OTRO_NIT)
    expect(faltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '40771100' }, confs))
      .toBe(MENSAJE_OTRO_NIT)
  })

  it('un bloque que imprime OTRO número (override) pide lo suyo sin desconfirmar a los demás', () => {
    // El caso que obliga a que esto sea un mapa y no un solo valor: con un único valor,
    // confirmar el bloque raro dejaría a los otros tres sin confirmación — un ping-pong
    // en el que nunca se pueden generar los cuatro.
    const confs = mapa('40771100')
    // El 1668 tiene un override que lo hace imprimir otra cédula.
    expect(faltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '52217225' }, confs))
      .toBe(MENSAJE_OTRO_NIT)
    // Se confirma ESE, y ahora los dos pasan.
    const confs2 = mapa('40771100', '52217225')
    expect(faltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '52217225' }, confs2)).toBeNull()
    expect(faltaConfirmacionNit('formulario-010', F010, datos, confs2)).toBeNull()
  })

  it('un template sin NIT pasa sin confirmar: no hay nada que transcribir', () => {
    expect(faltaConfirmacionNit('declaracion-juramentada', F010, datos, {})).toBeNull()
  })

  it('el NIT todavía vacío pasa: el faltante lo reporta el control de campos faltantes', () => {
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '' }, {})).toBeNull()
  })

  it('dos NIT distintos en el mismo formulario: no se cubre con una confirmación, y se nombra', () => {
    expect(
      faltaConfirmacionNit(
        'formulario-010', F010_DOS_NIT,
        { nit: '40771100', nit_2: '52217225' },
        mapa('40771100', '52217225'),
      ),
    ).toBe(MENSAJE_NIT_AMBIGUO)
  })

  it('los tres mensajes son distintos: piden tres acciones distintas', () => {
    expect(new Set([MENSAJE_SIN_CONFIRMAR, MENSAJE_OTRO_NIT, MENSAJE_NIT_AMBIGUO]).size).toBe(3)
  })
})

describe('leerConfirmaciones', () => {
  it('la LLAVE manda: se normaliza a dígitos', () => {
    expect(leerConfirmaciones({ '40.771.100': { por: 's1', por_nombre: 'Deisy', at: 'X' } }))
      .toEqual({ '40771100': { nit: '40771100', por: 's1', por_nombre: 'Deisy', at: 'X' } })
  })

  it('un `nit` dentro del valor se IGNORA: el dato en dos sitios se contradice', () => {
    expect(leerConfirmaciones({ '40771100': { nit: '99999999', por_nombre: 'Deisy' } })['40771100'].nit)
      .toBe('40771100')
  })

  it('una confirmación suelta con la forma vieja se lee como mapa VACÍO, y el control retiene', () => {
    // Sus llaves son palabras, no dígitos. Es el caso de una siembra mal formada: el lado
    // seguro es no reconocerla, nunca colarla como válida.
    expect(leerConfirmaciones({ nit: '40771100', por: 's1', at: 'X' })).toEqual({})
  })

  it('una llave SIN dígitos se descarta aunque su valor sí tenga la forma buena', () => {
    // Este caso es el que de verdad prueba el filtro de la llave. Con valores string
    // (la prueba de arriba) los descarta la guarda del tipo, así que las dos guardas se
    // ven iguales y borrar la de la llave no rompía nada: el fixture pasaba por
    // casualidad. Lo delató una mutación que sobrevivió.
    expect(leerConfirmaciones({ confirmado: { por: 's1', por_nombre: 'Deisy', at: 'X' } })).toEqual({})
  })

  it('una llave basura no cambia el mensaje que ve el operador', () => {
    // Si entrara al mapa, `faltaConfirmacionNit` contaría una confirmación que no existe
    // y diría «este bloque imprime otro NIT» en vez de «nunca se confirmó»: dos
    // explicaciones distintas que mandan al operador a dos sitios distintos.
    const basura = leerConfirmaciones({ confirmado: { por_nombre: 'Deisy' } })
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '40771100' }, basura))
      .toBe(MENSAJE_SIN_CONFIRMAR)
  })

  it('lo que no es un mapa de objetos no es una confirmación', () => {
    expect(leerConfirmaciones(null)).toEqual({})
    expect(leerConfirmaciones(undefined)).toEqual({})
    expect(leerConfirmaciones('40771100')).toEqual({})
    expect(leerConfirmaciones(['40771100'])).toEqual({})
    expect(leerConfirmaciones({ '40771100': 'si' })).toEqual({})
  })

  it('los campos de autoría opcionales caen a null sin invalidar la entrada', () => {
    expect(leerConfirmaciones({ '40771100': {} }))
      .toEqual({ '40771100': { nit: '40771100', por: null, por_nombre: null, at: '' } })
  })

  it('una siembra leída de la base pasa por el mismo criterio que la generación', () => {
    const leidas = leerConfirmaciones({ '40.771.100': { por_nombre: 'Barrido 2026-09-21', at: '2026-09-21' } })
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '40771100' }, leidas)).toBeNull()
    expect(faltaConfirmacionNit('formulario-010', F010, { nit: '407771100' }, leidas)).toBe(MENSAJE_OTRO_NIT)
  })
})

describe('motivoFaltaConfirmacionNit', () => {
  // El motivo es lo ÚNICO que separa «nunca confirmaste» de «este bloque imprime otro
  // número». La pantalla redacta desde aquí, así que si el criterio se moviera, el
  // mensaje del servidor y el del panel dejarían de decir lo mismo.
  it('sin ninguna confirmación en el negocio, el motivo es que nunca se hizo', () => {
    expect(motivoFaltaConfirmacionNit('formulario-010', F010, { nit: '40771100' }, {}))
      .toBe('sin_confirmar')
  })

  it('con el negocio ya confirmado en OTRO número, el motivo es el otro NIT', () => {
    // Es el caso del override: el operador confirmó hace un minuto en el 010 y aquí se le
    // vuelve a pedir. Sin este motivo, la pantalla no puede explicar por qué.
    expect(motivoFaltaConfirmacionNit('formulario-1668', F1668, { numero_identificacion: '900123456' }, mapa('40771100')))
      .toBe('otro_nit')
  })

  it('el formulario con dos NIT distintos no se puede confirmar con un número', () => {
    expect(motivoFaltaConfirmacionNit('formulario-010', F010_DOS_NIT, { nit: '40771100', nit_2: '900123456' }, {}))
      .toBe('ambiguo')
  })

  it('confirmado o sin NIT, no falta nada', () => {
    expect(motivoFaltaConfirmacionNit('formulario-010', F010, { nit: '40771100' }, mapa('40771100')))
      .toBeNull()
    expect(motivoFaltaConfirmacionNit('formulario-010', F010, { nit: '' }, {})).toBeNull()
  })

  it('el mensaje del servidor sale del MISMO motivo, no de un criterio paralelo', () => {
    const casos: Array<[Record<string, string | null>, ConfirmacionesNit, string | null]> = [
      [{ nit: '40771100' }, {}, MENSAJE_SIN_CONFIRMAR],
      [{ nit: '900123456' }, mapa('40771100'), MENSAJE_OTRO_NIT],
      [{ nit: '40771100' }, mapa('40771100'), null],
    ]
    for (const [datos, confs, esperado] of casos) {
      const motivo = motivoFaltaConfirmacionNit('formulario-010', F010, datos, confs)
      const mensaje = faltaConfirmacionNit('formulario-010', F010, datos, confs)
      expect(mensaje).toBe(esperado)
      expect(motivo === null).toBe(mensaje === null)
    }
  })
})
