/**
 * Calificación diaria (spec 2026-10-26, §4.4): el juez guionado lee el texto que de verdad se le manda, así que las
 * pruebas de privacidad van sobre ese texto, no sobre una función aparte.
 */
import { describe, expect, it } from 'vitest'
import {
  calificaConTexto,
  calificarDia,
  costoJuez,
  leerJuez,
  textoJuez,
  type FichaLeida,
  type FilaCalificacion,
  type Juez,
  type PuertoCalificacion,
} from './calificacion'
import { fechaAyerBogota, limitesDiaBogota, type FilaChatwoot, type FilaWa } from './conversaciones'
import { tieneNumeroLargo } from './seudonimizar'

const WS_SABOR = '11111111-1111-1111-1111-111111111111'
const WS_ONE = '22222222-2222-2222-2222-222222222222'
const FECHA = '2026-10-25'
const REGLAMENTO = 'rrrrrrrr-0000-0000-0000-000000000001'

const hora = (hhmm: string) => new Date(Date.parse(`${FECHA}T${hhmm}:00.000Z`) + 5 * 3600 * 1000).toISOString()

function wa(p: Partial<FilaWa> & { created_at: string }): FilaWa {
  return {
    workspace_id: WS_SABOR, phone: '573001234567', direccion: 'entrante', clase: 'escrito', texto: null, opciones: null,
    toque_id: null, turno_id: null, traza: null, ...p,
  }
}

function cw(p: Partial<FilaChatwoot> & { created_at: string }): FilaChatwoot {
  return {
    workspace_id: WS_SABOR, cuenta_id: 7, conversacion_id: 901, direccion: 'entrante', clase: 'escrito', texto: null,
    enmascarado: false, opciones: null, toque_id: null, turno_id: null, estado: null, traza: null, ...p,
  }
}

/** Conversación de WhatsApp con un toque caducado (F6 del diagnóstico). */
function conversacionF6(): FilaWa[] {
  const t1 = 'aaaaaaaa-0000-0000-0000-000000000001'
  const t2 = 'aaaaaaaa-0000-0000-0000-000000000002'
  return [
    wa({ created_at: hora('09:00'), texto: 'gasto de 85.000 en gasolina para la obra', turno_id: t1 }),
    wa({
      created_at: hora('09:00'), direccion: 'saliente', clase: 'bot', texto: '¿Registro el gasto de $85.000 en gasolina?',
      opciones: [{ id: 'si', titulo: 'Sí, registrar' }, { id: 'no', titulo: 'No' }], turno_id: t1,
      traza: { tipo: 'modelo', bot: 'one', rol: { clave: 'mano_derecha', reglamento_id: REGLAMENTO }, propuesta: { accion: 'registrar_gasto', resumen: 'Gasto $85.000 gasolina' } },
    }),
    wa({ created_at: hora('11:30'), clase: 'toque', texto: 'Sí, registrar', toque_id: 'si', turno_id: t2 }),
    wa({
      created_at: hora('11:30'), direccion: 'saliente', clase: 'bot', texto: 'Ese botón ya no está vigente: no hice nada.', turno_id: t2,
      traza: { tipo: 'toque_propuesta', bot: 'one', rol: { clave: 'mano_derecha', reglamento_id: REGLAMENTO }, ejecucion: { huella: 'h', resultado: 'vieja' } },
    }),
  ]
}

/** Conversación de Chatwoot sin fallas, con un cliente que da su nombre y su celular. */
function conversacionLimpia(): FilaChatwoot[] {
  const t1 = 'bbbbbbbb-0000-0000-0000-000000000001'
  return [
    cw({ created_at: hora('15:00'), texto: 'Hola, soy Mariana Restrepo, mi cel es 315 950 9103 y mi correo mari@ejemplo.com. ¿Hay cupo el viernes?', turno_id: t1 }),
    cw({
      created_at: hora('15:00'), direccion: 'saliente', clase: 'bot', estado: 'publicado', turno_id: t1,
      texto: 'Hola Mariana, sí hay cupo el viernes a las 8 p. m. Carlos Gómez te confirma la mesa.',
      traza: {
        tipo: 'modelo', bot: 'asistente-publico', reglamento: { id: REGLAMENTO, version: 3, huella: 'x' },
        herramientas: [{ nombre: 'consultar_funciones', args: {}, ok: true, datos: { reservas: [{ cliente: 'Carlos Gómez', telefono: '573104445566' }] }, ms: 20 }],
        candados: [{ candado: 'precio_autorizado', detalle: 'precio de Mariana Restrepo no autorizado' }],
      },
    }),
  ]
}

const FICHAS: FichaLeida[] = [
  { clave: 'alc.temas', tipo: 'alcance', hacer: 'Reservas de funciones y cupos. Si piden una persona, pasar a Chatwoot.' },
  { clave: 'inv.precio', tipo: 'invariante', hacer: 'Solo precios de la base. Oficina: 601 555 1234.' },
]

function puertoEnMemoria(p: { wa?: FilaWa[]; chatwoot?: FilaChatwoot[]; conTexto?: string[] }) {
  const filas: FilaCalificacion[] = []
  const puerto: PuertoCalificacion = {
    filasDelDia: async () => ({ wa: p.wa ?? [], chatwoot: p.chatwoot ?? [] }),
    conTexto: async (ids) => new Set(ids.filter((id) => (p.conTexto ?? []).includes(id))),
    fichas: async (_ws, ids) => new Map(ids.map((id) => [id, FICHAS])),
    yaCalificadas: async (fecha) => new Set(filas.filter((f) => f.fecha === fecha).map((f) => `${f.workspace_id}|${f.conversacion}`)),
    // La llave única de la tabla: (workspace_id, fecha, conversacion).
    guardar: async (fila) => {
      if (filas.some((f) => f.workspace_id === fila.workspace_id && f.fecha === fila.fecha && f.conversacion === fila.conversacion)) return 'duplicada'
      filas.push(fila)
      return 'guardada'
    },
    precios: async () => [{ modelo: 'claude-haiku-5-5', entrada: 1, salida: 5, cache: null }],
  }
  return { puerto, filas }
}

/**
 * El modelo guionado: lee el texto que recibe como lo haría el juez. Marca F6 en el turno donde aparece «ya no está
 * vigente» y nada en lo demás. Guarda cada pedido para revisarlo.
 */
function juezGuionado() {
  const pedidos: string[] = []
  const juez: Juez = async ({ usuario }) => {
    pedidos.push(usuario)
    const linea = usuario.split('\n').find((l) => l.includes('ya no está vigente'))
    const turno = linea?.match(/^\[(T\d+)/)?.[1]
    const fallas = turno ? [{ tipo: 'F6', turno, evidencia: 'Ese botón ya no está vigente: no hice nada.' }, { tipo: 'F99', turno, evidencia: 'fuera de la lista' }] : []
    return {
      ok: true,
      texto: JSON.stringify({ fallas, resuelta: !turno, nota: turno ? 2 : 5 }),
      modelo: 'claude-haiku-5-5',
      entrada: 1000,
      salida: 100,
    }
  }
  return { juez, pedidos }
}

describe('días de Bogotá', () => {
  it('el cron de las 6:30 de Bogotá califica el día anterior', () => {
    expect(fechaAyerBogota(new Date('2026-10-26T11:30:00Z'))).toBe('2026-10-25')
    // 23:00 del 25 en Bogotá = 04:00 UTC del 26: el día anterior es el 24.
    expect(fechaAyerBogota(new Date('2026-10-26T04:00:00Z'))).toBe('2026-10-24')
    expect(limitesDiaBogota('2026-10-25')).toEqual({ desde: '2026-10-25T05:00:00.000Z', hasta: '2026-10-26T05:00:00.000Z' })
  })
})

describe('el interruptor de la calificación con texto', () => {
  it('apagado por defecto; solo `true` lo prende', () => {
    expect(calificaConTexto(null)).toBe(false)
    expect(calificaConTexto({ bot_conversacional: { chatwoot: { activo: true } } })).toBe(false)
    expect(calificaConTexto({ bot_conversacional: { calificacion: { con_texto: 'true' } } })).toBe(false)
    expect(calificaConTexto({ bot_conversacional: { calificacion: { con_texto: true } } })).toBe(true)
  })
})

describe('calificarDia', () => {
  it('una conversación con un toque caducado sale marcada F6, en su turno', async () => {
    const { puerto, filas } = puertoEnMemoria({ wa: conversacionF6(), conTexto: [WS_SABOR] })
    const { juez, pedidos } = juezGuionado()
    const r = await calificarDia(FECHA, { puerto, juez })
    expect(r).toMatchObject({ ok: true, conversaciones: 1, calificadas: 1, fallidas: 0 })
    expect(pedidos).toHaveLength(1)
    expect(filas).toHaveLength(1)
    const f = filas[0]
    expect(f.rol_clave).toBe('mano_derecha')
    expect(f.conversacion).toMatch(/^wa-[0-9a-f]{10}$/)
    // Solo F6: el tipo fuera de la lista se descarta. El turno es el id real (el juez solo vio «T2»).
    expect(f.fallas).toEqual([{ tipo: 'F6', turno: 'aaaaaaaa-0000-0000-0000-000000000002', evidencia: 'Ese botón ya no está vigente: no hice nada.' }])
    expect(f.resuelta).toBe(false)
    expect(f.nota).toBe(2)
    expect(f.juez).toBe('claude-haiku-5-5 · fallas-v1 · tokens 1000/100')
    // El juez recibió la ficha del rol y la traza del toque.
    expect(pedidos[0]).toContain('Reservas de funciones y cupos')
    expect(pedidos[0]).toContain('ejecución: acción → vieja')
  })

  it('una conversación sin fallas sale limpia', async () => {
    const { puerto, filas } = puertoEnMemoria({ chatwoot: conversacionLimpia(), conTexto: [WS_SABOR] })
    const { juez } = juezGuionado()
    await calificarDia(FECHA, { puerto, juez })
    expect(filas).toEqual([
      { workspace_id: WS_SABOR, rol_clave: 'asistente-publico', fecha: FECHA, conversacion: 'cw:7:901', fallas: [], resuelta: true, nota: 5, juez: 'claude-haiku-5-5 · fallas-v1 · tokens 1000/100' },
    ])
  })

  it('el juez nunca recibe un teléfono, un correo ni el nombre de un cliente final', async () => {
    const { puerto } = puertoEnMemoria({ wa: conversacionF6(), chatwoot: conversacionLimpia(), conTexto: [WS_SABOR] })
    const { juez, pedidos } = juezGuionado()
    await calificarDia(FECHA, { puerto, juez })
    expect(pedidos).toHaveLength(2)
    for (const texto of pedidos) {
      for (const prohibido of ['Mariana', 'Restrepo', 'Carlos', 'Gómez', 'Gomez', '573001234567', '3001234567', '315 950 9103', '3159509103', '573104445566', '601 555 1234', 'mari@ejemplo.com']) {
        expect(texto).not.toContain(prohibido)
      }
      expect(tieneNumeroLargo(texto)).toBe(false)
    }
    const chat = pedidos.find((t) => t.includes('Cliente'))!
    // Los nombres quedan en alias, uno por persona, y los montos con puntos siguen legibles.
    expect(chat).toMatch(/soy Persona \d/)
    expect(chat).toContain('[número]')
    expect(chat).toContain('[correo]')
    expect(pedidos.find((t) => t.includes('Persona del equipo'))).toContain('85.000')
  })

  it('un reintento del cron no duplica ni vuelve a llamar al juez', async () => {
    const { puerto, filas } = puertoEnMemoria({ wa: conversacionF6(), chatwoot: conversacionLimpia(), conTexto: [WS_SABOR] })
    const { juez, pedidos } = juezGuionado()
    await calificarDia(FECHA, { puerto, juez })
    const r2 = await calificarDia(FECHA, { puerto, juez })
    expect(filas).toHaveLength(2)
    expect(pedidos).toHaveLength(2)
    expect(r2).toMatchObject({ ya_estaban: 2, calificadas: 0 })
  })

  it('dos corridas cruzadas: la llave única deja una sola fila', async () => {
    const { puerto, filas } = puertoEnMemoria({ wa: conversacionF6(), conTexto: [WS_SABOR] })
    const { juez: guionado } = juezGuionado()
    // El juez tarda: las dos corridas leen «sin calificar» antes de que la otra guarde.
    const juez: Juez = async (p) => { await new Promise((r) => setTimeout(r, 10)); return guionado(p) }
    const [a, b] = await Promise.all([calificarDia(FECHA, { puerto, juez }), calificarDia(FECHA, { puerto, juez })])
    expect(filas).toHaveLength(1)
    expect(a.calificadas + b.calificadas).toBe(1)
    expect(a.duplicadas + b.duplicadas).toBe(1)
  })

  it('un workspace sin el interruptor no llama al juez ni escribe fila', async () => {
    const otros = conversacionF6().map((f) => ({ ...f, workspace_id: WS_ONE }))
    const { puerto, filas } = puertoEnMemoria({ wa: otros, conTexto: [WS_SABOR] })
    const { juez, pedidos } = juezGuionado()
    const r = await calificarDia(FECHA, { puerto, juez })
    expect(pedidos).toHaveLength(0)
    expect(filas).toHaveLength(0)
    expect(r).toMatchObject({ conversaciones: 1, solo_metricas: 1, calificadas: 0 })
  })

  it('si el juez falla, la conversación queda sin fila y la corrida lo dice', async () => {
    const { puerto, filas } = puertoEnMemoria({ wa: conversacionF6(), conTexto: [WS_SABOR] })
    const r = await calificarDia(FECHA, { puerto, juez: async () => ({ ok: false, error: 'juez 529' }) })
    expect(filas).toHaveLength(0)
    expect(r).toMatchObject({ ok: false, fallidas: 1 })
    expect(r.errores[0]).toContain('juez 529')
  })

  it('el costo del juez sale de bot_modelo_precios', async () => {
    const { puerto } = puertoEnMemoria({ wa: conversacionF6(), conTexto: [WS_SABOR] })
    const { juez } = juezGuionado()
    const r = await calificarDia(FECHA, { puerto, juez })
    // 1000 × 1 + 100 × 5 = 1500 por millón.
    expect(r.costo_juez_usd).toBeCloseTo(0.0015, 10)
    expect(costoJuez([textoJuez('otro-modelo', 10, 10)], [])).toEqual({ costo_usd: null, sin_precio: ['otro-modelo'] })
  })
})

describe('la columna juez', () => {
  it('guarda modelo, versión y tokens, y se lee de vuelta', () => {
    expect(leerJuez(textoJuez('claude-haiku-5-5', 1234.4, 56))).toEqual({ modelo: 'claude-haiku-5-5', version: 'fallas-v1', entrada: 1234, salida: 56 })
    expect(leerJuez('escrita a mano')).toEqual({ modelo: 'escrita a mano', version: null, entrada: 0, salida: 0 })
  })
})
