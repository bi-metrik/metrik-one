/**
 * El cierre automático, sobre la función real con la base doblada.
 *
 * Lo que se fija aquí, y que la prueba pura NO puede fijar:
 * - la marca queda `activo: false` con `cerrado_por: 'sistema'`, y **conserva todo lo demás**
 *   (`abierto_at`, `causa`, `tipo`, `detalle`, quién la abrió): el indicador cuenta por
 *   `abierto_at` y cerrar no borra el reproceso del mes en que ocurrió;
 * - el resto de `metadata` sobrevive: el update se arma sobre la metadata recién leída, no
 *   sobre una copia vieja (el read-modify-write que ya costó 12 facturas con el tercero malo);
 * - `reproceso_eventos` se escribe con el cliente de **SERVICIO**, nunca con el de sesión:
 *   `authenticated` solo tiene SELECT ahí y el UPDATE muere con 42501 en silencio (PR #440);
 * - se cierra SOLO la fila del ciclo vigente y solo si sigue abierta, así el ciclo 0
 *   (`CICLO_SIN_RETORNO`, que nace cerrado) queda intacto;
 * - la traza va con `tipo: 'sistema'` — el CHECK de `activity_log` NO acepta `reproceso`;
 * - y si la base falla, NO lanza: el avance ya ocurrió.
 *
 * Mutaciones medidas, cada una tumba al menos una prueba: cerrar con el cliente de sesión,
 * escribir la marca sin `cerrado_por`, pisar la metadata en vez de extenderla, quitar el
 * filtro por ciclo, quitar `is('cerrado_at', null)`, y usar `tipo: 'reproceso'`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>
type Escritura = {
  cliente: 'sesion' | 'servicio'
  tabla: string
  payload: Fila
  filtros: Array<[string, unknown]>
  nulos: string[]
}

let tablas: Record<string, Fila[]> = {}
let escrituras: Escritura[] = []
let fallaTabla: string | null = null

const registrarActividad = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: null }))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente('servicio') }))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: (...a: unknown[]) => registrarActividad(...a),
}))

function cliente(nombre: 'sesion' | 'servicio') {
  return { from: (tabla: string) => constructor(nombre, tabla) }
}

function constructor(nombre: 'sesion' | 'servicio', tabla: string) {
  const filtros: Array<[string, unknown]> = []
  const nulos: string[] = []
  let payload: Fila = {}

  const ejecutar = () => {
    if (fallaTabla === tabla) return { data: [], error: { message: 'boom' } }
    escrituras.push({ cliente: nombre, tabla, payload, filtros: [...filtros], nulos: [...nulos] })
    // El doble aplica los filtros de verdad: un update que no acota por ciclo toca filas
    // que no debía, y eso tiene que verse.
    const filas = (tablas[tabla] ?? []).filter(
      (f) => filtros.every(([k, v]) => f[k] === v) && nulos.every((k) => f[k] === null || f[k] === undefined),
    )
    for (const f of filas) Object.assign(f, payload)
    return { data: filas, error: null }
  }

  const api = {
    update: (p: Fila) => { payload = p; return api },
    eq: (k: string, v: unknown) => { filtros.push([k, v]); return api },
    is: (k: string, v: unknown) => { if (v === null) nulos.push(k); return api },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (res: (v: any) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(ejecutar()).then(res, rej),
  }
  return api
}

const { cerrarReprocesoSiSeRehizoElTramo } = await import('./cierre-reproceso-servidor')

const ETAPAS = [
  { id: 'e13', nombre: 'Generación', orden: 13, config_extra: {} },
  { id: 'e14', nombre: 'Envío', orden: 14, config_extra: { routing: { default_etapa_orden: 19 } } },
  { id: 'e15', nombre: 'Facturación', orden: 15, config_extra: { routing: { default_etapa_orden: 15 } } },
  { id: 'e19', nombre: 'Seguimiento', orden: 19, config_extra: { routing: { default_etapa_orden: 15 } } },
]

const MARCA_VIVA = {
  activo: true,
  ciclo: 2,
  tipo: 'devolucion_dian',
  causa: 'error_propio',
  detalle: 'La DIAN rechazó por la firma.',
  abierto_at: '2026-09-01T10:00:00.000Z',
  abierto_por: 'staff-deisy',
  abierto_por_nombre: 'Deisy',
  etapa_retorno: 'Cita',
  etapa_origen: 'Seguimiento',
}

const METADATA = { seccional: 'Bogotá', siigo_cliente: { identificacion: '123' }, reproceso: MARCA_VIVA }

beforeEach(() => {
  escrituras = []
  fallaTabla = null
  registrarActividad.mockClear()
  tablas = {
    negocios: [{ id: 'neg-1', workspace_id: 'ws-soena', metadata: structuredClone(METADATA) }],
    reproceso_eventos: [
      { id: 'ev-0', workspace_id: 'ws-soena', negocio_id: 'neg-1', ciclo: 0, abierto_at: 'x', cerrado_at: 'x' },
      { id: 'ev-1', workspace_id: 'ws-soena', negocio_id: 'neg-1', ciclo: 1, abierto_at: 'y', cerrado_at: 'y' },
      { id: 'ev-2', workspace_id: 'ws-soena', negocio_id: 'neg-1', ciclo: 2, abierto_at: 'z', cerrado_at: null },
    ],
  }
})

const correr = (ordenDestino: number, metadata: Fila | null = structuredClone(METADATA)) =>
  cerrarReprocesoSiSeRehizoElTramo({
    workspaceId: 'ws-soena',
    negocioId: 'neg-1',
    metadata,
    etapas: ETAPAS,
    ordenDestino,
    staffId: 'staff-quien-avanzo',
  })

describe('cerrarReprocesoSiSeRehizoElTramo — cuando el tramo se rehizo', () => {
  it('cierra la marca con cerrado_por sistema y conserva lo que traía', async () => {
    const r = await correr(15)
    expect(r).toEqual({ cerrado: true, ciclo: 2, etapaOrigen: 'Seguimiento' })

    const marca = (tablas.negocios[0].metadata as Fila).reproceso as Fila
    expect(marca.activo).toBe(false)
    expect(marca.cerrado_por).toBe('sistema')
    expect(marca.cerrado_at).toEqual(expect.any(String))
    // Nada de lo que alimenta el indicador se toca.
    expect(marca.abierto_at).toBe(MARCA_VIVA.abierto_at)
    expect(marca.causa).toBe('error_propio')
    expect(marca.tipo).toBe('devolucion_dian')
    expect(marca.detalle).toBe(MARCA_VIVA.detalle)
    expect(marca.abierto_por).toBe('staff-deisy')
  })

  it('no pisa el resto de la metadata del negocio', async () => {
    await correr(15)
    const meta = tablas.negocios[0].metadata as Fila
    expect(meta.seccional).toBe('Bogotá')
    expect(meta.siigo_cliente).toEqual({ identificacion: '123' })
  })

  it('cierra el evento de calidad con el cliente de SERVICIO', async () => {
    await correr(15)
    const ev = escrituras.filter((e) => e.tabla === 'reproceso_eventos')
    expect(ev).toHaveLength(1)
    expect(ev[0].cliente).toBe('servicio')
  })

  it('la marca también se escribe con el cliente de servicio', async () => {
    await correr(15)
    const neg = escrituras.filter((e) => e.tabla === 'negocios')
    expect(neg).toHaveLength(1)
    expect(neg[0].cliente).toBe('servicio')
  })

  it('cierra SOLO el ciclo vigente y solo si sigue abierto', async () => {
    await correr(15)
    const ev = escrituras.find((e) => e.tabla === 'reproceso_eventos')!
    expect(ev.filtros).toContainEqual(['ciclo', 2])
    expect(ev.filtros).toContainEqual(['workspace_id', 'ws-soena'])
    expect(ev.nulos).toContain('cerrado_at')
    // El ciclo 0 (error sin retorno, nace cerrado) y el 1 quedan como estaban.
    expect(tablas.reproceso_eventos.find((f) => f.ciclo === 0)!.cerrado_at).toBe('x')
    expect(tablas.reproceso_eventos.find((f) => f.ciclo === 1)!.cerrado_at).toBe('y')
    expect(tablas.reproceso_eventos.find((f) => f.ciclo === 2)!.cerrado_at).toEqual(expect.any(String))
  })

  it('deja traza con un tipo que el CHECK de activity_log acepta', async () => {
    await correr(15)
    expect(registrarActividad).toHaveBeenCalledTimes(1)
    const payload = registrarActividad.mock.calls[0][1] as Fila
    expect(payload.tipo).toBe('sistema')
    expect(payload.entidad_tipo).toBe('negocio')
    expect(String(payload.contenido)).toContain('Reproceso 2 cerrado automáticamente')
    expect(String(payload.contenido)).toContain('Seguimiento')
  })
})

describe('cerrarReprocesoSiSeRehizoElTramo — cuando no corresponde', () => {
  it('no escribe nada si el caso todavía no alcanzó su origen', async () => {
    const r = await correr(13) // Generación: Seguimiento no la alcanza
    expect(r).toEqual({ cerrado: false, motivo: 'no_alcanzado' })
    expect(escrituras).toHaveLength(0)
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('no escribe nada si el reproceso no trae etapa_origen (los 22 vivos de hoy)', async () => {
    const meta = structuredClone(METADATA) as Fila
    delete ((meta.reproceso as Fila).etapa_origen)
    const r = await correr(15, meta)
    expect(r).toEqual({ cerrado: false, motivo: 'sin_origen' })
    expect(escrituras).toHaveLength(0)
  })

  it('un negocio sin reproceso no paga ninguna escritura', async () => {
    const r = await correr(15, { seccional: 'Bogotá' })
    expect(r).toEqual({ cerrado: false, motivo: 'sin_marca' })
    expect(escrituras).toHaveLength(0)
  })
})

describe('cerrarReprocesoSiSeRehizoElTramo — nunca tumba el avance', () => {
  it('si la marca no se puede escribir, lo reporta y no lanza', async () => {
    fallaTabla = 'negocios'
    await expect(correr(15)).resolves.toEqual({ cerrado: false, motivo: 'error_marca' })
    // Sin marca cerrada no se toca el evento: quedarían en desacuerdo.
    expect(escrituras.filter((e) => e.tabla === 'reproceso_eventos')).toHaveLength(0)
  })

  it('si el evento no se puede cerrar, la marca ya cerrada se conserva y no lanza', async () => {
    fallaTabla = 'reproceso_eventos'
    await expect(correr(15)).resolves.toEqual({ cerrado: true, ciclo: 2, etapaOrigen: 'Seguimiento' })
    expect(((tablas.negocios[0].metadata as Fila).reproceso as Fila).activo).toBe(false)
  })
})
