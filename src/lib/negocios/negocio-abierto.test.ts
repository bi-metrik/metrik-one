/**
 * `bloqueoPorNegocioCerrado`: el corte para las acciones de dinero que NO pasan por
 * `guardEditarBloque` (emitir factura, adoptar una de Siigo).
 *
 * EL CASO QUE IMPORTA: qué hace cuando NO encuentra el negocio. Devuelve "no
 * bloquea", a propósito. Esta función responde una sola pregunta —¿está cerrado?— y
 * sobre un negocio que no existe no la puede responder; decir "está cerrado" mandaría
 * al operador a reabrir algo que no está. La existencia la valida cada acción.
 *
 * El doble ACOTA por workspace de verdad (no devuelve lo mismo para cualquier filtro):
 * sin eso, la prueba del negocio de otro workspace pasaría por la razón equivocada.
 *
 * MUTACIONES MEDIDAS el 2026-09-10 (26 verdes en la linea base de las 4 suites):
 *   · devolver el mensaje también cuando `data` es null → 2 rojas ("no existe" y
 *     "otro workspace")
 *   · `negocioCerrado` con `estado !== 'abierto'`       → 6 rojas (aquí, "`activo` pasa")
 *   · `negocioCerrado` siempre `false`                  → 6 rojas (aquí, los 3 desenlaces)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { bloqueoPorNegocioCerrado } from './negocio-abierto'
import { MENSAJE_NEGOCIO_CERRADO } from './motivo-cierre'

const WS = 'ws-soena'

type Fila = { id: string; workspace_id: string; estado: string | null }
let negocios: Fila[]

/** Doble mínimo de PostgREST: honra los `.eq()` que la función encadena. */
function servicioFalso() {
  return {
    from(_tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      const chain = {
        select: () => chain,
        eq: (campo: keyof Fila, valor: unknown) => {
          filtros.push((f) => f[campo] === valor)
          return chain
        },
        maybeSingle: async () => ({
          data: negocios.filter((f) => filtros.every((p) => p(f)))[0] ?? null,
          error: null,
        }),
      }
      return chain
    },
  }
}

beforeEach(() => {
  negocios = [
    { id: 'n-abierto', workspace_id: WS, estado: 'abierto' },
    { id: 'n-activo', workspace_id: WS, estado: 'activo' },
    { id: 'n-completado', workspace_id: WS, estado: 'completado' },
    { id: 'n-perdido', workspace_id: WS, estado: 'perdido' },
    { id: 'n-cancelado', workspace_id: WS, estado: 'cancelado' },
    { id: 'n-ajeno', workspace_id: 'ws-otro', estado: 'completado' },
  ]
})

describe('bloqueoPorNegocioCerrado', () => {
  it('bloquea los tres desenlaces, con el mensaje único', async () => {
    for (const id of ['n-completado', 'n-perdido', 'n-cancelado']) {
      expect(await bloqueoPorNegocioCerrado(servicioFalso(), WS, id)).toBe(MENSAJE_NEGOCIO_CERRADO)
    }
  })

  it('un negocio abierto pasa', async () => {
    expect(await bloqueoPorNegocioCerrado(servicioFalso(), WS, 'n-abierto')).toBeNull()
  })

  it('⚠️ `activo` pasa: no es uno de los tres cierres', async () => {
    expect(await bloqueoPorNegocioCerrado(servicioFalso(), WS, 'n-activo')).toBeNull()
  })

  it('un negocio que no existe NO bloquea — la existencia la valida quien llama', async () => {
    expect(await bloqueoPorNegocioCerrado(servicioFalso(), WS, 'n-inventado')).toBeNull()
  })

  it('un negocio cerrado de OTRO workspace tampoco bloquea aquí', async () => {
    // No es indulgencia: acotado por workspace, esta sesión no lo ve, así que la
    // respuesta honesta es "no sé", no "está cerrado".
    expect(await bloqueoPorNegocioCerrado(servicioFalso(), WS, 'n-ajeno')).toBeNull()
    // Control de que el doble sí filtra: desde su propio workspace, bloquea.
    expect(await bloqueoPorNegocioCerrado(servicioFalso(), 'ws-otro', 'n-ajeno'))
      .toBe(MENSAJE_NEGOCIO_CERRADO)
  })
})
