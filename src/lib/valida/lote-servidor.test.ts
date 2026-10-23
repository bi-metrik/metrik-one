/**
 * El trabajador del cargue masivo de Valida (2026-10-15).
 *
 * Lo que se fija:
 *   1. CALIDAD: una fila del lote llama a Valida EXACTAMENTE como la consulta puntual de siempre
 *      (`consultarValida` con `lote_id`, que era la ruta del navegador): mismo endpoint, mismo
 *      método, mismo cuerpo, misma llave; y deja la MISMA fila en `valida_consultas`. Lo único que
 *      agrega es la `Idempotency-Key` y la columna `lote_fila_id`;
 *   2. IDEMPOTENCIA: una fila reclamada otra vez no se cobra dos veces ni deja dos consultas;
 *   3. CORTE: la bolsa agotada no guarda ni cobra la fila y detiene el lote;
 *   4. CONCURRENCIA real (8 en vuelo, no en serie) y EQUIDAD entre lotes de distintos espacios;
 *   5. ACCESO: la puerta se mira una vez por turno, y si el espacio la pierde, el lote se pausa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDobleLotes, type DobleLotes, type Fila } from '../../../test/valida-lotes-doble'

let doble: DobleLotes
let reloj = Date.parse('2026-10-15T15:00:00Z')
const ahora = () => reloj
const dormir = async (ms: number) => {
  reloj += ms
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble }))

const llave: { valor: string | undefined } = { valor: 'llave-ws' }
vi.mock('@/lib/secretos/workspace', () => ({
  leerSecretosWorkspace: async () => ({}),
  secretoConRespaldo: () => llave.valor,
}))

const recalculos: string[] = []
vi.mock('@/lib/valida/calculo-score', () => ({
  calcularScoreNegocio: async (i: { negocioId: string }) => {
    recalculos.push(i.negocioId)
    return { ok: true, resultado: { puntaje: 1 } }
  },
  persistirScore: async () => ({ ok: true }),
}))

// Para la ruta de siempre (`consultarValida`): sesión, módulo y puerta abiertos.
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/valida-cda/puerta', () => ({
  validaCdaPermiteOperar: async () => ({ ok: true }),
  validaCdaPermiteConsultar: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/_usuarios', () => ({ resolverNombresUsuarios: async () => new Map() }))

import { consultarValida, type ValidaConsultaInput } from '@/lib/actions/valida-consultas'
import { correrTrabajadorLotes, correrTurno, procesarFilaLote, avisarLote, type FilaLote, type Lote } from './lote-servidor'
import { filasDesdeXlsx } from './lote'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

// ─── Valida de mentira ───────────────────────────────────────────────────────────

type Llamada = { url: string; init: { method: string; headers: Record<string, string>; body: string } }
let llamadas: Llamada[] = []
let enVuelo = 0
let maxEnVuelo = 0
let responder: (cuerpo: Record<string, unknown>, n: number) => { status: number; body: unknown } = respuestaNormal
let alLlamar: ((cuerpo: Record<string, unknown>) => void) | null = null

function respuestaNormal(cuerpo: Record<string, unknown>): { status: number; body: unknown } {
  if (!cuerpo.nombre && !cuerpo.documento) return { status: 400, body: { error: 'validation_error' } }
  const nombre = String(cuerpo.nombre ?? (cuerpo.documento as { numero: string }).numero)
  const alto = nombre.includes('Pablo')
  return {
    status: 200,
    body: {
      consulta_id: `val-${nombre.replace(/\W/g, '')}`,
      severidad: alto ? 'alto' : 'sin_hallazgo',
      total_matches: alto ? 1 : 0,
      matches: alto ? [{ lista: 'onu', score: 0.97 }] : [],
      hash_reporte: `h-${nombre}`,
      fecha_reporte: '2026-10-15',
    },
  }
}

const fetchFalso = vi.fn(async (url: string, init: Llamada['init']) => {
  llamadas.push({ url, init })
  const n = llamadas.length
  if (url.includes('resend')) return { ok: true, status: 200, json: async () => ({ id: 'correo-1' }) }
  enVuelo += 1
  maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
  await new Promise((r) => setTimeout(r, 5))
  reloj += 500
  const cuerpo = JSON.parse(init.body) as Record<string, unknown>
  alLlamar?.(cuerpo)
  const r = responder(cuerpo, n)
  enVuelo -= 1
  return { ok: r.status < 300, status: r.status, json: async () => r.body }
})

// ─── Datos ───────────────────────────────────────────────────────────────────────

function sembrarLote(opts: {
  ws?: string
  filas: ValidaConsultaInput[]
  errores?: Array<string | null>
  negocios?: Array<string | null>
  creado?: string
  estado?: string
}): Lote {
  const ws = opts.ws ?? 'ws-1'
  const lote: Fila = {
    id: `lote-${ws}-${doble.tablas.valida_lotes?.length ?? 0}`,
    workspace_id: ws,
    created_by: 'user-1',
    titulo: null,
    estado: opts.estado ?? 'en_cola',
    total: opts.filas.length,
    procesadas: 0,
    omitidas: 0,
    severidades: {},
    concurrencia: null,
    autorizado_hasta: new Date(reloj + 2 * 3600_000).toISOString(),
    huella_acceso: '',
    created_at: opts.creado ?? '2026-10-15T14:00:00Z',
  }
  ;(doble.tablas.valida_lotes ??= []).push(lote)
  opts.filas.forEach((entrada, i) =>
    (doble.tablas.valida_lote_filas ??= []).push({
      id: `${lote.id}-f${i + 1}`,
      lote_id: lote.id,
      workspace_id: ws,
      posicion: i + 1,
      entrada,
      negocio_id: opts.negocios?.[i] ?? null,
      error_parseo: opts.errores?.[i] ?? null,
      estado: 'pendiente',
      intentos: 0,
    }),
  )
  return lote as unknown as Lote
}

async function reclamar(lote: Lote): Promise<FilaLote> {
  const l = doble.tablas.valida_lotes.find((x) => x.id === lote.id)!
  Object.assign(l, { estado: 'procesando', trabajador: 't-prueba' })
  const { data } = await doble.rpc('valida_lote_reclamar_fila', { p_lote: lote.id, p_trabajador: 't-prueba', p_reclamo_s: 120 })
  return (data as FilaLote[])[0]
}

const ctx = (lote: Lote) => ({ svc: doble, lote, llave: 'llave-ws', prueba: null, dormir })

const consultas = () => doble.tablas.valida_consultas ?? []
const sinIds = (f: Fila) => {
  const { id: _id, created_at: _c, lote_fila_id: _l, ...resto } = f
  return resto
}

beforeEach(() => {
  reloj = Date.parse('2026-10-15T15:00:00Z')
  doble = crearDobleLotes({
    ahora,
    tablas: {
      workspaces: [
        { id: 'ws-1', config_extra: {}, modules: { valida_consulta: true }, slug: 'cda-uno' },
        { id: 'ws-2', config_extra: {}, modules: { valida_consulta: true }, slug: 'cda-dos' },
      ],
      profiles: [{ id: 'user-1', platform_admin: false, workspace_id: 'ws-1', home_workspace_id: null, email: 'ana@cda.co' }],
      negocios: [{ id: 'neg-1', workspace_id: 'ws-1', codigo: 'C1 26 1' }],
      valida_sarlaft_datos_negocio: [{ negocio_id: 'neg-1', universo: 'contraparte' }],
    },
  })
  llamadas = []
  enVuelo = 0
  maxEnVuelo = 0
  responder = respuestaNormal
  alLlamar = null
  recalculos.length = 0
  llave.valor = 'llave-ws'
  reiniciarModulo('ws-1', { ...MODULES.cda })
  fetchFalso.mockClear()
  vi.stubGlobal('fetch', fetchFalso)
  delete process.env.VALIDA_LOTE_CONCURRENCIA
  delete process.env.VALIDA_LOTES_SIMULTANEOS
  delete process.env.RESEND_API_KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── 1. Calidad: igual que la ruta de siempre ───────────────────────────────────

describe('una fila del lote da EXACTAMENTE lo que daba la ruta del navegador', () => {
  // Las filas del XLSX pasan por el mismo parseo de siempre (`filasDesdeXlsx`), incluidas las malas.
  const XLSX_FILAS = [
    { tipo_persona: 'natural', nombre_completo: 'Juan Pérez Gómez', tipo_documento: 'CC', numero_documento: '1077089147' },
    { tipo_persona: 'juridica', nombre_completo: 'Acme Trading SAS', tipo_documento: 'nit', numero_documento: '900123456' },
    { tipo_persona: 'natural', nombre_completo: 'Pablo Escobar', tipo_documento: '', numero_documento: '' },
    { tipo_persona: 'NATURAL', nombre_completo: '', tipo_documento: 'CE', numero_documento: '445566' },
    // Mal escritas: tipo inválido con nombre (se consulta como natural, como siempre) y fila vacía.
    { tipo_persona: 'empresa', nombre_completo: 'Maria Rodriguez', tipo_documento: '', numero_documento: '' },
    { tipo_persona: 'natural', nombre_completo: '', tipo_documento: '', numero_documento: '' },
  ]

  it('mismo endpoint, método, cuerpo y llave; misma fila en el historial', async () => {
    const preparadas = filasDesdeXlsx(XLSX_FILAS, new Map(), null)

    // La ruta de siempre: el navegador mandaba cada `input` a `consultarValida(input, { lote_id })`.
    for (const f of preparadas) await consultarValida(f.input, { lote_id: 'lote-viejo' })
    const viejas = { llamadas: [...llamadas], filas: consultas().map((c) => ({ ...c })) }
    llamadas = []
    doble.tablas.valida_consultas = []

    // La ruta nueva: las mismas filas, por el trabajador.
    const lote = sembrarLote({ filas: preparadas.map((f) => f.input), errores: preparadas.map((f) => f.error) })
    for (let i = 0; i < preparadas.length; i++) await procesarFilaLote(ctx(lote), await reclamar(lote))
    const nuevas = { llamadas: [...llamadas], filas: consultas().map((c) => ({ ...c })) }

    expect(nuevas.llamadas).toHaveLength(viejas.llamadas.length)
    nuevas.llamadas.forEach((n, i) => {
      const v = viejas.llamadas[i]
      expect(n.url).toBe(v.url)
      expect(n.init.method).toBe(v.init.method)
      expect(n.init.body).toBe(v.init.body)
      const { 'Idempotency-Key': clave, ...cabeceras } = n.init.headers
      expect(cabeceras).toEqual(v.init.headers)
      expect(clave).toBe(`one-lote-fila-${lote.id}-f${i + 1}`)
      expect(v.init.headers['Idempotency-Key']).toBeUndefined()
    })

    expect(nuevas.filas.map((f) => ({ ...sinIds(f), lote_id: 'x' }))).toEqual(viejas.filas.map((f) => ({ ...sinIds(f), lote_id: 'x' })))
    expect(nuevas.filas.every((f, i) => f.lote_fila_id === `${lote.id}-f${i + 1}` && f.lote_id === lote.id)).toBe(true)
  })

  it('el contador del lote cuenta como la pantalla de siempre: la fila mal escrita es error', async () => {
    const preparadas = filasDesdeXlsx(XLSX_FILAS, new Map(), null)
    const lote = sembrarLote({ filas: preparadas.map((f) => f.input), errores: preparadas.map((f) => f.error) })
    for (let i = 0; i < preparadas.length; i++) await procesarFilaLote(ctx(lote), await reclamar(lote))
    const l = doble.tablas.valida_lotes[0]
    expect(l.procesadas).toBe(6)
    // 3 sin hallazgo, 1 alto (Pablo), y 2 error (la de tipo inválido y la vacía).
    expect(l.severidades).toEqual({ sin_hallazgo: 3, alto: 1, error: 2 })
    // La de tipo inválido quedó en el historial con su resultado real, como siempre.
    const maria = consultas().find((c) => c.nombre_consultado === 'Maria Rodriguez')
    expect(maria?.severidad).toBe('sin_hallazgo')
  })
})

describe('el tipo de documento del XLSX llega a Valida con su código', () => {
  // Datos inventados. Hasta el 2026-10-23 «CEDULA» o «PP» iban tal cual y Valida respondía 400.
  const XLSX_TIPOS = [
    { tipo_persona: 'natural', nombre_completo: 'Ana Prueba Uno', tipo_documento: 'CÉDULA', numero_documento: '10000001' },
    { tipo_persona: 'natural', nombre_completo: 'Beto Prueba Dos', tipo_documento: 'pp', numero_documento: 'AB123456' },
    { tipo_persona: 'natural', nombre_completo: 'Caro Prueba Tres', tipo_documento: 'TI', numero_documento: '10000003' },
    { tipo_persona: 'natural', nombre_completo: 'Dani Prueba Cuatro', tipo_documento: 'X', numero_documento: '10000004' },
  ]

  it('CÉDULA va como CC y PP como PAS; TI y X no se mandan, no van al historial y dicen por qué', async () => {
    const preparadas = filasDesdeXlsx(XLSX_TIPOS, new Map(), null)
    const lote = sembrarLote({ filas: preparadas.map((f) => f.input), errores: preparadas.map((f) => f.error) })
    for (let i = 0; i < preparadas.length; i++) await procesarFilaLote(ctx(lote), await reclamar(lote))

    const cuerpos = llamadas.map((l) => JSON.parse(l.init.body) as { documento: { tipo: string } })
    expect(cuerpos.map((c) => c.documento.tipo)).toEqual(['CC', 'PAS'])
    expect(consultas().map((c) => c.documento_tipo)).toEqual(['CC', 'PAS'])

    const filas = doble.tablas.valida_lote_filas
    expect(filas.map((f) => f.estado)).toEqual(['hecha', 'hecha', 'error', 'error'])
    expect(String(filas[2].resultado_error)).toContain('tarjeta de identidad (TI)')
    expect(String(filas[3].resultado_error)).toContain('Tipo de documento no reconocido: usa CC, CE, NIT o PAS')
    expect(doble.tablas.valida_lotes[0].severidades).toEqual({ sin_hallazgo: 2, error: 2 })
  })
})

// ─── 2. Idempotencia ─────────────────────────────────────────────────────────────

describe('una fila nunca se cobra ni se guarda dos veces', () => {
  it('reclamada otra vez después de guardar: no llama a Valida, toma la guardada', async () => {
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    const primera = await reclamar(lote)
    ;(doble.tablas.valida_consultas ??= []).push({
      id: 'c-previa', lote_fila_id: primera.id, severidad: 'sin_hallazgo', valida_consulta_id: 'val-AnaRuiz', total_matches: 0,
    })
    // El trabajador murió antes de terminar la fila: el reclamo vence y otro la toma.
    doble.tablas.valida_lote_filas[0].reclamada_hasta = new Date(reloj - 1).toISOString()
    const segunda = await reclamar(lote)
    expect(segunda.intentos).toBe(2)
    await procesarFilaLote(ctx(lote), segunda)
    expect(llamadas).toHaveLength(0)
    expect(doble.tablas.valida_lote_filas[0]).toMatchObject({ estado: 'hecha', consulta_local_id: 'c-previa' })
    expect(doble.tablas.valida_lotes[0].procesadas).toBe(1)
  })

  it('otro trabajador la guardó mientras tanto (23505): se toma la suya y cuenta una vez', async () => {
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    const fila = await reclamar(lote)
    alLlamar = () => {
      ;(doble.tablas.valida_consultas ??= []).push({
        id: 'c-del-otro', lote_fila_id: fila.id, severidad: 'sin_hallazgo', valida_consulta_id: 'val-AnaRuiz', total_matches: 0,
      })
    }
    const r = await procesarFilaLote(ctx(lote), fila)
    expect(r.tipo).toBe('hecha')
    expect(consultas()).toHaveLength(1)
    expect(doble.tablas.valida_lote_filas[0].consulta_local_id).toBe('c-del-otro')
    expect(doble.tablas.valida_lotes[0].procesadas).toBe(1)
  })

  it('un 5xx se reintenta UNA vez con la misma llave de idempotencia', async () => {
    responder = (c, n) => (n === 1 ? { status: 503, body: { error: 'persistencia_error' } } : respuestaNormal(c))
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0].init.headers['Idempotency-Key']).toBe(llamadas[1].init.headers['Idempotency-Key'])
    expect(consultas()[0].severidad).toBe('sin_hallazgo')
  })

  it('un tope de tiempo NO se reintenta (Valida pudo seguir y cobrar): queda en error, como siempre', async () => {
    fetchFalso.mockImplementationOnce(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    expect(consultas()[0].severidad).toBe('error')
    expect(doble.tablas.valida_lote_filas[0]).toMatchObject({ estado: 'error', resultado_error: 'valida_tiempo_agotado' })
  })
})

// ─── 2b. Búsqueda incompleta (503 de metrik-valida#66) ───────────────────────────

describe('búsqueda incompleta: Valida no la registró, ONE tampoco la guarda como resultado', () => {
  const incompleta = () => ({ status: 503, body: { error: 'busqueda_incompleta' } })

  it('consulta puntual: devuelve el código para la pantalla y no deja fila en el historial', async () => {
    responder = incompleta
    const r = await consultarValida({ tipo: 'natural', nombre: 'Ana Ruiz' })
    expect(r).toEqual({ ok: false, error: 'busqueda_incompleta' })
    expect(consultas()).toHaveLength(0)
  })

  it('CONTROL — otro error del motor sí se sigue guardando como siempre', async () => {
    responder = () => ({ status: 500, body: { error: 'db_error' } })
    await consultarValida({ tipo: 'natural', nombre: 'Ana Ruiz' })
    expect(consultas()).toHaveLength(1)
    expect(consultas()[0].severidad).toBe('error')
  })

  it('cargue masivo: tras el reintento, la fila queda en error con el código y sin consulta en el historial', async () => {
    responder = incompleta
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(llamadas).toHaveLength(2)
    expect(consultas()).toHaveLength(0)
    expect(doble.tablas.valida_lote_filas[0]).toMatchObject({ estado: 'error', resultado_error: 'busqueda_incompleta' })
    expect(doble.tablas.valida_lotes[0].procesadas).toBe(1)
  })

  it('si el reintento sí completa, la fila tiene su resultado', async () => {
    responder = (c, n) => (n === 1 ? incompleta() : respuestaNormal(c))
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(consultas()[0].severidad).toBe('sin_hallazgo')
  })
})

// ─── 3. Corte de la bolsa y rechazo ──────────────────────────────────────────────

describe('corte y rechazo de Valida', () => {
  it('bolsa agotada: la fila vuelve a la cola, no se guarda ni cuenta', async () => {
    responder = () => ({ status: 402, body: { error: 'bolsa_agotada' } })
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    const r = await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(r).toEqual({ tipo: 'corte', motivo: 'bolsa_agotada' })
    expect(consultas()).toHaveLength(0)
    expect(doble.tablas.valida_lote_filas[0].estado).toBe('pendiente')
    expect(doble.tablas.valida_lotes[0].procesadas).toBe(0)
  })

  it('llave revocada (401): detiene el lote en vez de guardar una fila en error por cada fila', async () => {
    responder = () => ({ status: 401, body: { error: 'invalid_api_key' } })
    const lote = sembrarLote({ filas: [{ tipo: 'natural', nombre: 'Ana Ruiz' }] })
    const r = await procesarFilaLote(ctx(lote), await reclamar(lote))
    expect(r).toEqual({ tipo: 'rechazo', error: 'invalid_api_key' })
    expect(consultas()).toHaveLength(0)
  })

  it('a mitad del lote, el corte pausa el lote; lo que no arrancó no se consulta', async () => {
    responder = (c, n) => (n > 12 ? { status: 402, body: { error: 'bolsa_agotada' } } : respuestaNormal(c))
    const filas = Array.from({ length: 40 }, (_, i) => ({ tipo: 'natural' as const, nombre: `Persona ${i}` }))
    sembrarLote({ filas })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    const l = doble.tablas.valida_lotes[0]
    expect(l).toMatchObject({ estado: 'pausado', motivo_pausa: 'bolsa_agotada', procesadas: 12 })
    expect(consultas()).toHaveLength(12)
    // Se detuvo: no siguió llamando por cada fila (a lo sumo las que estaban en vuelo).
    expect(llamadas.length).toBeLessThanOrEqual(12 + 8)
    expect(doble.tablas.valida_lote_filas.filter((f) => f.estado === 'pendiente')).toHaveLength(28)
  })
})

// ─── 4. Concurrencia y equidad ───────────────────────────────────────────────────

describe('concurrencia real y equidad', () => {
  it('8 filas en vuelo a la vez (no en serie) y el lote completo', async () => {
    const filas = Array.from({ length: 30 }, (_, i) => ({ tipo: 'natural' as const, nombre: `Persona ${i}` }))
    sembrarLote({ filas, negocios: filas.map(() => 'neg-1') })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(maxEnVuelo).toBe(8)
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'completado', procesadas: 30 })
    expect(consultas()).toHaveLength(30)
    // El score del negocio se recalcula una vez por turno, no 30 veces.
    expect(recalculos).toEqual(['neg-1'])
  })

  it('la concurrencia se configura (entorno y por lote)', async () => {
    process.env.VALIDA_LOTE_CONCURRENCIA = '3'
    sembrarLote({ filas: Array.from({ length: 12 }, (_, i) => ({ tipo: 'natural' as const, nombre: `P ${i}` })) })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(maxEnVuelo).toBe(3)
  })

  it('un lote chico de otro espacio no espera a que termine uno grande', async () => {
    process.env.VALIDA_LOTES_SIMULTANEOS = '1'
    // 500 ms por fila y 8 a la vez: un turno de 60 s procesa ~1.000 filas de reloj; con 2.000 hay varios turnos.
    sembrarLote({ ws: 'ws-1', filas: Array.from({ length: 2000 }, (_, i) => ({ tipo: 'natural' as const, nombre: `Grande ${i}` })) })
    sembrarLote({ ws: 'ws-2', creado: '2026-10-15T14:30:00Z', filas: Array.from({ length: 10 }, (_, i) => ({ tipo: 'natural' as const, nombre: `Chico ${i}` })) })
    await correrTrabajadorLotes({ presupuestoMs: 3_000_000, svc: doble, dormir, ahora })
    const orden = llamadas.map((l) => String(JSON.parse(l.init.body).nombre))
    const ultimoChico = orden.map((n, i) => (n.startsWith('Chico') ? i : -1)).reduce((a, b) => Math.max(a, b))
    const ultimoGrande = orden.map((n, i) => (n.startsWith('Grande') ? i : -1)).reduce((a, b) => Math.max(a, b))
    expect(ultimoChico).toBeLessThan(ultimoGrande)
    // El chico entró en el SEGUNDO turno, no después de las 2.000 filas del grande.
    expect(orden.slice(0, ultimoChico).filter((n) => n.startsWith('Grande')).length).toBeLessThan(1500)
    expect(doble.tablas.valida_lotes.map((l) => l.estado)).toEqual(['completado', 'completado'])
  }, 60_000)
})

// ─── 5. Acceso por turno ─────────────────────────────────────────────────────────

describe('si el espacio pierde el acceso, el lote se pausa sin consultar', () => {
  const unaFila = [{ tipo: 'natural' as const, nombre: 'Ana Ruiz' }]

  it('el módulo Valida apagado', async () => {
    doble.tablas.workspaces[0].modules = { valida_api: true }
    sembrarLote({ filas: unaFila })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'pausado', motivo_pausa: 'acceso' })
    expect(llamadas).toHaveLength(0)
  })

  it('un contrato de Valida que cambió (huella distinta): vuelve a pedir autorización', async () => {
    doble.huellas.set('ws-1', 'contrato-cancelado')
    sembrarLote({ filas: unaFila })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'pausado', motivo_pausa: 'reautorizar' })
    expect(llamadas).toHaveLength(0)
  })

  it('la autorización de la sesión venció', async () => {
    const lote = sembrarLote({ filas: unaFila })
    doble.tablas.valida_lotes[0].autorizado_hasta = new Date(reloj - 1).toISOString()
    await correrTurno(doble, { ...lote, autorizado_hasta: new Date(reloj - 1).toISOString() }, 't', reloj + 60_000, { dormir, ahora })
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'pausado', motivo_pausa: 'reautorizar' })
    expect(llamadas).toHaveLength(0)
  })

  it('sin llave del espacio', async () => {
    llave.valor = undefined
    sembrarLote({ filas: unaFila })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'pausado', motivo_pausa: 'sin_llave' })
    expect(llamadas).toHaveLength(0)
  })

  it('CONTROL — con todo en regla, consulta, y la puerta se lee una vez por turno, no por fila', async () => {
    sembrarLote({ filas: Array.from({ length: 20 }, (_, i) => ({ tipo: 'natural' as const, nombre: `P ${i}` })) })
    await correrTrabajadorLotes({ presupuestoMs: 300_000, svc: doble, dormir, ahora })
    expect(llamadas).toHaveLength(20)
    expect(doble.rpcs.filter((r) => r.fn === 'valida_lote_huella_acceso')).toHaveLength(1)
  })
})

// ─── Aviso por correo ────────────────────────────────────────────────────────────

describe('aviso por correo al terminar', () => {
  it('una vez por final, a quien cargó el lote, con el enlace al lote', async () => {
    process.env.RESEND_API_KEY = 're_prueba'
    const lote = sembrarLote({ filas: [] })
    Object.assign(doble.tablas.valida_lotes[0], { estado: 'completado', total: 150, procesadas: 150, severidades: { alto: 2, sin_hallazgo: 148 } })
    await avisarLote(doble, lote.id)
    await avisarLote(doble, lote.id)
    const correos = llamadas.filter((l) => l.url.includes('resend'))
    expect(correos).toHaveLength(1)
    const cuerpo = JSON.parse(correos[0].init.body)
    expect(cuerpo.to).toEqual(['ana@cda.co'])
    expect(cuerpo.text).toContain(`https://cda-uno.metrikone.co/valida?lote=${lote.id}`)
    expect(cuerpo.text).toContain('alto: 2')
  })

  it('un lote chico no manda correo (termina mientras la persona mira)', async () => {
    process.env.RESEND_API_KEY = 're_prueba'
    const lote = sembrarLote({ filas: [] })
    Object.assign(doble.tablas.valida_lotes[0], { estado: 'completado', total: 20, procesadas: 20 })
    await avisarLote(doble, lote.id)
    expect(llamadas.filter((l) => l.url.includes('resend'))).toHaveLength(0)
  })
})
