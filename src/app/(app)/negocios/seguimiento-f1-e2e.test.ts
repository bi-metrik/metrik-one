/**
 * F1 · Seguimiento (post-cotización, PR 5), probado LLAMANDO A LAS ACCIONES del servidor contra
 * un doble de la base que escribe. Las guardas de salida (capturas y margen mínimo) se sustituyen
 * por interruptores: lo que se prueba aquí es qué hace el seguimiento cuando pasan o no pasan.
 *
 * Criterios de Vera:
 *   · F1-1: «Enviar», o descargar con las guardas pasadas, escribe `fecha_envio`, versión y canal.
 *     Descargar bloqueado por margen o capturas no registra nada. «No lo envié» lo deshace (C3).
 *   · F1-3: el origen de la versión se pide al duplicar; la prerreserva vencida no la pone el botón.
 *   · F1-4: «Aplazar» con el plazo de la línea y sin auto-perdido al cuarto (C10); «Se perdió» con
 *     uno de los motivos de la línea, cada uno sobre un `value` global.
 *   · §7.1.6: con el interruptor apagado, todo hace lo de hoy (incluido el auto-perdido).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · `registrarEnvioCotizacion` sin `if (!cfg.activo) return` → cae «apagado: Enviar no escribe
 *     fecha_envio»;
 *   · `registrarEnvioPorDescarga` sin la guarda de margen → cae «bloqueada por margen no registra»;
 *   · `motivoPerdidaInvalido` devolviendo siempre `null` → cae «exige uno de los 5 motivos»;
 *   · quitar el `return { error: mensajeTopeAplazamientos… }` → cae «el cuarto aplazamiento no
 *     pierde el negocio»;
 *   · quitar el `.is('fecha_envio', null)` → cae «un segundo registro no corre la fecha».
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]> = {}
let seq = 0
let bloqueoCapturas: string | null = null
let bloqueoMargen: string | null = null

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const NEG = 'neg-1'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(), workspaceId: WS, userId: 'p-dani', staffId: 's-dani', role: 'operator', areas: ['comercial'],
    impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente(), createClient: async () => cliente() }))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/cotizaciones/captura-desactualizada-datos', () => ({
  motivoPorCapturasDesactualizadas: async () => bloqueoCapturas,
  MENSAJE_SIN_PASAJEROS: 'sin pasajeros',
}))
vi.mock('@/lib/cotizaciones/piso-salida-datos', () => ({
  motivoParaNoSalir: async () => bloqueoMargen,
  recortarParaLog: (s: string) => s,
  evaluarSalida: async () => null,
  revisarExcepcionTrasCambio: async () => null,
}))

function cliente() {
  return { from: (t: string) => consulta(t), rpc: async () => ({ data: `COT-2026-${++seq}`, error: null }) }
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let conteo = false
  let limite: number | null = null
  const correr = () => {
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    if (op === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `${tabla}-${++seq}`, created_at: new Date().toISOString(), ...p }))
      todas.push(...nuevas)
      return { data: nuevas, error: null, count: null }
    }
    const filas = todas.filter((f) => filtros.every((fn) => fn(f)))
    if (op === 'update') {
      filas.forEach((f) => Object.assign(f, payload))
      return { data: filas.map((f) => ({ ...f })), error: null, count: null }
    }
    if (op === 'delete') {
      tablas[tabla] = todas.filter((f) => !filas.includes(f))
      return { data: null, error: null, count: null }
    }
    const salida = limite != null ? filas.slice(0, limite) : filas
    return { data: conteo ? null : salida.map((f) => ({ ...f })), error: null, count: filas.length }
  }
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.head) conteo = true; return q },
    insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return q },
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q },
    neq: (c: string, v: unknown) => { filtros.push((f) => f[c] !== v); return q },
    is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return q },
    not: (c: string, _o: string, _v: unknown) => { filtros.push((f) => f[c] != null); return q },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
    gte: (c: string, v: string) => { filtros.push((f) => String(f[c]) >= v); return q },
    order: () => q,
    limit: (n: number) => { limite = n; return q },
    maybeSingle: async () => { const r = correr(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: null } },
    single: async () => {
      const r = correr()
      const f = (r.data as Fila[] | null)?.[0]
      return f ? { data: f, error: null } : { data: null, error: { message: 'sin fila' } }
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(correr()).then(ok, ko),
  }
  return q
}

import { reiniciarModulo, MODULES } from '../../../../test/exigir-modulo-doble'
import { enviarCotizacionNegocio, duplicarCotizacionNegocio, deshacerEnvioPorDescarga } from './[id]/cotizacion/actions'
import { perderNegocio, pausarNegocio } from './negocio-v2-actions'
import { registrarEnvioCotizacion, registrarEnvioPorDescarga } from '@/lib/negocios/seguimiento-datos'
import { evaluarGatesSeguimiento } from '@/lib/negocios/gates-seguimiento'
import { MENSAJE_GATE_COTIZACION_ENVIADA } from '@/lib/negocios/seguimiento'

function sembrar(opts: { seguimiento?: boolean; vecesPausado?: number; maxDias?: number } = {}) {
  seq = 0
  bloqueoCapturas = null
  bloqueoMargen = null
  reiniciarModulo(WS, { ...MODULES.termotech })
  const config: Fila = {}
  if (opts.seguimiento) config.seguimiento = { activo: true }
  if (opts.maxDias) config.pausa = { max_dias: opts.maxDias }
  tablas = {
    workspaces: [{ id: WS, modules: { pausa_enabled: true } }],
    lineas_negocio: [{ id: LINEA, workspace_id: WS, config_extra: config }],
    negocios: [{
      id: NEG, workspace_id: WS, linea_id: LINEA, stage_actual: 'venta', estado: 'abierto', pausado: false,
      veces_pausado: opts.vecesPausado ?? 0, metadata: { otra_cosa: 1 },
    }],
    cotizaciones: [
      { id: 'cot-1', workspace_id: WS, negocio_id: NEG, estado: 'rechazada', duplicada_de: null, fecha_envio: '2026-10-01T15:00:00Z', modo: 'rapida' },
      { id: 'cot-2', workspace_id: WS, negocio_id: NEG, estado: 'borrador', duplicada_de: 'cot-1', fecha_envio: null, modo: 'rapida' },
    ],
    activity_log: [{ id: 'a-0', workspace_id: WS, entidad_tipo: 'negocio', entidad_id: NEG, tipo: 'comentario', created_at: new Date().toISOString() }],
  }
}

const cot = (id: string) => tablas.cotizaciones.find((c) => c.id === id) as Fila
const envios = () => tablas.activity_log.filter((a) => a.campo_modificado === 'cotizacion_envio')
const enMesDias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

beforeEach(() => sembrar())

describe('apagado = como hoy (§7.1.6)', () => {
  it('apagado: Enviar no escribe fecha_envio ni la línea de envío', async () => {
    const r = await enviarCotizacionNegocio('cot-2', NEG)
    expect(r.success).toBe(true)
    expect(cot('cot-2')).toMatchObject({ estado: 'enviada', fecha_envio: null })
    expect(envios()).toHaveLength(0)
  })

  it('apagado: descargar no cuenta como envío', async () => {
    const ok = await registrarEnvioPorDescarga(cliente(), { workspaceId: WS, negocioId: NEG, cotizacionId: 'cot-2', staffId: 's-dani' }, {
      capturas: async () => null, margen: async () => null,
    })
    expect(ok).toBe(false)
    expect(cot('cot-2').fecha_envio).toBeNull()
  })

  it('apagado: el cuarto aplazamiento sigue perdiendo el negocio solo, y perder acepta los motivos de siempre', async () => {
    sembrar({ vecesPausado: 3 })
    const r = await pausarNegocio(NEG, 'silencio', enMesDias(5))
    expect(r.autoPerdido).toBe(true)
    sembrar()
    expect((await perderNegocio(NEG, 'lead_no_interesado')).error).toBeNull()
  })
})

describe('envío (F1-1, C3)', () => {
  beforeEach(() => sembrar({ seguimiento: true }))

  it('Enviar deja fecha, versión (v2 por la cadena) y canal', async () => {
    await enviarCotizacionNegocio('cot-2', NEG)
    expect(cot('cot-2').fecha_envio).toBeTruthy()
    expect(envios()).toHaveLength(1)
    expect(envios()[0]).toMatchObject({ valor_nuevo: 'enviar', autor_id: 's-dani' })
    expect(String(envios()[0].contenido)).toContain('v2')
  })

  it('descargar bloqueada por capturas o por margen no registra nada', async () => {
    const args = { workspaceId: WS, negocioId: NEG, cotizacionId: 'cot-2', staffId: 's-dani' }
    expect(await registrarEnvioPorDescarga(cliente(), args, { capturas: async () => 'pantallazo viejo', margen: async () => null })).toBe(false)
    expect(await registrarEnvioPorDescarga(cliente(), args, { capturas: async () => null, margen: async () => 'bajo el mínimo' })).toBe(false)
    expect(cot('cot-2').fecha_envio).toBeNull()
    expect(envios()).toHaveLength(0)
  })

  it('descargar con las guardas pasadas registra «descargado»; una segunda descarga no corre la fecha', async () => {
    const args = { workspaceId: WS, negocioId: NEG, cotizacionId: 'cot-2', staffId: 's-dani' }
    const guardas = { capturas: async () => null, margen: async () => null }
    expect(await registrarEnvioPorDescarga(cliente(), args, guardas)).toBe(true)
    const primera = cot('cot-2').fecha_envio
    cot('cot-2').fecha_envio = '2026-10-05T15:00:00Z'
    expect(await registrarEnvioPorDescarga(cliente(), args, guardas)).toBe(false)
    expect(cot('cot-2').fecha_envio).toBe('2026-10-05T15:00:00Z')
    expect(primera).toBeTruthy()
    expect(envios().map((e) => e.valor_nuevo)).toEqual(['descargado'])
  })

  it('un segundo registro no corre la fecha (doble clic, dos caminos a la vez)', async () => {
    cot('cot-2').fecha_envio = '2026-10-05T15:00:00Z'
    const r = await registrarEnvioCotizacion(cliente(), { workspaceId: WS, negocioId: NEG, cotizacionId: 'cot-2', staffId: 's-dani', canal: 'enviar' })
    expect(r.registrado).toBe(false)
    expect(cot('cot-2').fecha_envio).toBe('2026-10-05T15:00:00Z')
    expect(envios()).toHaveLength(0)
  })

  it('«No lo envié» deshace la descarga; no si ya salió con Enviar ni pasado el tiempo', async () => {
    const args = { workspaceId: WS, negocioId: NEG, cotizacionId: 'cot-2', staffId: 's-dani' }
    await registrarEnvioPorDescarga(cliente(), args, { capturas: async () => null, margen: async () => null })
    expect((await deshacerEnvioPorDescarga('cot-2')).success).toBe(true)
    expect(cot('cot-2').fecha_envio).toBeNull()

    cot('cot-2').fecha_envio = new Date(Date.now() - 3 * 60_000).toISOString()
    expect((await deshacerEnvioPorDescarga('cot-2')).success).toBe(false)

    cot('cot-2').fecha_envio = new Date().toISOString()
    cot('cot-2').estado = 'enviada'
    expect((await deshacerEnvioPorDescarga('cot-2')).success).toBe(false)
    expect(cot('cot-2').fecha_envio).toBeTruthy()
  })
})

describe('versiones (F1-3)', () => {
  beforeEach(() => sembrar({ seguimiento: true }))

  it('duplicar guarda el origen escogido; la prerreserva vencida no la pone el botón', async () => {
    const mal = await duplicarCotizacionNegocio('cot-1', NEG, 'prerreserva_vencida')
    expect(mal.success).toBe(false)
    const bien = await duplicarCotizacionNegocio('cot-1', NEG, 'cliente')
    expect(bien.success).toBe(true)
    const copia = cot((bien as { id: string }).id)
    expect(copia).toMatchObject({ origen_version: 'cliente', duplicada_de: 'cot-1', estado: 'borrador' })
  })

  it('el origen de la original no viaja a la copia', async () => {
    cot('cot-2').origen_version = 'proveedor'
    const r = await duplicarCotizacionNegocio('cot-2', NEG)
    expect(r.success).toBe(true)
    expect(cot((r as { id: string }).id).origen_version).toBeUndefined()
  })
})

describe('aplazar y perder (F1-4, C10)', () => {
  it('el cuarto aplazamiento no pierde el negocio: lo dice y para', async () => {
    sembrar({ seguimiento: true, vecesPausado: 3 })
    const r = await pausarNegocio(NEG, 'silencio', enMesDias(5))
    expect(r.error).toMatch(/Ya lo aplazaste 3 veces/)
    expect(tablas.negocios[0]).toMatchObject({ estado: 'abierto', pausado: false })
  })

  it('aplazar usa el plazo de la línea y deja la fecha del toque', async () => {
    sembrar({ seguimiento: true, maxDias: 60 })
    expect((await pausarNegocio(NEG, 'silencio', enMesDias(70))).error).toMatch(/60 dias/)
    expect((await pausarNegocio(NEG, 'silencio', enMesDias(45))).error).toBeNull()
    const meta = tablas.negocios[0].metadata as Fila
    expect(meta).toMatchObject({ otra_cosa: 1, seguimiento: { aplazado_para: enMesDias(45) } })
  })

  it('sin el plazo de la línea, 14 días como hoy', async () => {
    sembrar({ seguimiento: true })
    expect((await pausarNegocio(NEG, 'silencio', enMesDias(20))).error).toMatch(/14 dias/)
  })

  it('«Se perdió» exige uno de los 5 motivos y guarda el value global', async () => {
    sembrar({ seguimiento: true })
    expect((await perderNegocio(NEG, 'lead_no_interesado')).error).toMatch(/Escoge un motivo/)
    expect(tablas.negocios[0].estado).toBe('abierto')
    expect((await perderNegocio(NEG, 'competencia')).error).toBeNull()
    expect(tablas.negocios[0]).toMatchObject({ estado: 'perdido', razon_cierre: 'competencia' })
    expect(tablas.activity_log.some((a) => String(a.contenido).includes('Se fue con otra agencia'))).toBe(true)
  })

  it('perder también desde Confirmación (stage venta en el mapa nuevo)', async () => {
    sembrar({ seguimiento: true })
    // Confirmación es stage `venta`: la misma acción la cierra.
    expect((await perderNegocio(NEG, 'precio')).error).toBeNull()
  })
})

describe('gate cotizacion_enviada', () => {
  it('sin el id en la etapa no consulta nada', async () => {
    const from = vi.fn()
    expect(await evaluarGatesSeguimiento({ from }, { negocioId: NEG, gates: ['comentario_requerido'], mensajes: {} })).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('frena sin cotización enviada, con el mensaje de la etapa si lo declara', async () => {
    tablas.cotizaciones.forEach((c) => { c.fecha_envio = null })
    expect(await evaluarGatesSeguimiento(cliente(), { negocioId: NEG, gates: ['cotizacion_enviada'], mensajes: {} }))
      .toBe(MENSAJE_GATE_COTIZACION_ENVIADA)
    expect(await evaluarGatesSeguimiento(cliente(), { negocioId: NEG, gates: ['cotizacion_enviada'], mensajes: { cotizacion_enviada: 'Propio' } }))
      .toBe('Propio')
  })

  it('pasa con una cotización enviada', async () => {
    expect(await evaluarGatesSeguimiento(cliente(), { negocioId: NEG, gates: ['cotizacion_enviada'], mensajes: {} })).toBeNull()
  })
})
