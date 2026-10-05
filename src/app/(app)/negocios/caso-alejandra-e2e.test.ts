/**
 * El caso de Alejandra, prueba fija (brief del 2026-10-05, «la bandeja dejó de recibir los
 * pantallazos de Alejandra»). Negocio N1 26 1: San Andrés - Providencia, 23–28 nov 2026,
 * 6 adultos, 1 niño y 1 infante. Sus 8 pantallazos: el vuelo Avianca BOG–ADZ, el SATENA
 * ADZ–PVA y seis habitaciones de dos hoteles de Providencia (Cabañas Agua Dulce y Posada
 * Enilda, tres habitaciones cada uno: 2A + 1 infante, 2A, 2A + 1 niño).
 *
 * ## Qué corre
 *
 * La bandeja tal cual: `procesarCaptura` (lo que corre al pegar), los envíos de `bandeja-red.ts`
 * y `desenlaceDeAceptacion`, contra las RUTAS reales (`detectar-captura`, `leer-captura`,
 * `aceptar-captura`) y las acciones reales (`detectarCaptura`, `leerCapturaEnBorrador`,
 * `aceptarCapturaDeBandeja`, `crearRanuraConOpcion`…) sobre un doble de Supabase que persiste.
 * Entre la bandeja y las rutas va un `fetch` local que se puede cortar: así se reproduce lo que
 * vio Alejandra el 2026-10-05, cuando sus peticiones no llegaron a Vercel.
 *
 * ## Las respuestas del lector
 *
 * Grabadas de Gemini real (`__fixtures__/caso-alejandra-n1-26-1.json`): en CI no se llama a
 * nadie. A mano, contra Gemini real con los pantallazos de la carpeta del proyecto:
 *
 *     CASO_ALEJANDRA=gemini npx vitest run caso-alejandra          # lee de verdad
 *     CASO_ALEJANDRA=gemini GRABAR=1 npx vitest run caso-alejandra # y regraba el fixture
 *
 * (necesita `GEMINI_API_KEY` en `.env.local` y la carpeta `CASO_ALEJANDRA_DIR`, por defecto la
 * del proyecto de Trappvel junto al repo).
 *
 * Lo que NO se puede afirmar sin navegador: el pegado con Ctrl+V, el corte de red de verdad
 * (aquí es un `fetch` que lanza `TypeError: Failed to fetch`, como Chromium) y la línea en el
 * log de Vercel (aquí se ve el cuerpo que sale hacia `/api/errores-cliente`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'

type Fila = Record<string, unknown>

// ── El caso ───────────────────────────────────────────────────────────────────

const GRUPO: Composicion = { adultos: 6, ninos: 1, infantes: 1 }
const FECHAS = { inicio: '2026-11-23', fin: '2026-11-28' }
const DESTINO = 'San Andrés - Providencia'
const COT = 'cot-alejandra'

const MODO_GEMINI = process.env.CASO_ALEJANDRA === 'gemini'
const GRABAR = MODO_GEMINI && process.env.GRABAR === '1'
const DIR_CAPTURAS = process.env.CASO_ALEJANDRA_DIR
  ?? path.resolve(__dirname, '../../../../../proyectos/trappvel/clarity/docs/entrada/capturas/2026-10-05-alejandra-n1-26-1')
const RUTA_FIXTURE = path.resolve(__dirname, '../../../lib/cotizaciones/__fixtures__/caso-alejandra-n1-26-1.json')

interface Grabada {
  archivo: string
  bytes: number
  deteccion: unknown
  extraccion: unknown
}
const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, 'utf8')) as { _fuente: string; capturas: Grabada[] }

/** El data URL de un pantallazo: el archivo real con Gemini, un marcador con su nombre en CI. */
function dataUrlDe(archivo: string): string {
  if (MODO_GEMINI) return `data:image/jpeg;base64,${readFileSync(path.join(DIR_CAPTURAS, archivo)).toString('base64')}`
  return `data:image/jpeg;base64,${Buffer.from(`caso-alejandra:${archivo}`).toString('base64')}`
}

/** De qué pantallazo es un buffer que llegó al lector. */
const archivoPorHuella = new Map<string, string>()
function archivoDe(buffer: Buffer): string {
  const marca = /^caso-alejandra:(.+)$/.exec(buffer.subarray(0, 80).toString('latin1'))
  if (marca) return marca[1]
  const clave = buffer.subarray(0, 4096).toString('base64')
  const a = archivoPorHuella.get(clave)
  if (!a) throw new Error('la prueba no reconoce este pantallazo')
  return a
}
const grabado = new Map<string, Partial<Grabada>>()

// ── Dobles ────────────────────────────────────────────────────────────────────

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-trappvel', userId: 'p-alejandra', error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/server-keys', () => ({
  getServerKey: () => (MODO_GEMINI ? llaveGemini() : 'llave-de-prueba'),
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({ viaje: { composicion: GRUPO, fechas: FECHAS, destino: DESTINO }, error: null }),
}))
vi.mock('@/lib/ai/detectar-tipo-captura', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ai/detectar-tipo-captura')>()
  return {
    ...real,
    detectarTipoDeCaptura: async (buffer: Buffer, mime: string, llave: string) => {
      const archivo = archivoDe(buffer)
      if (MODO_GEMINI) {
        const r = await real.detectarTipoDeCaptura(buffer, mime, llave)
        grabado.set(archivo, { ...grabado.get(archivo), deteccion: r.data })
        return r
      }
      return { data: structuredClone(grabadaDe(archivo).deteccion) }
    },
  }
})
vi.mock('@/lib/ai/extraer-ranura', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ai/extraer-ranura')>()
  return {
    ...real,
    extraerRanuraDesdeImagen: async (buffer: Buffer, mime: string, ranura: Parameters<typeof real.extraerRanuraDesdeImagen>[2], llave: string, enfoque: Parameters<typeof real.extraerRanuraDesdeImagen>[4]) => {
      const archivo = archivoDe(buffer)
      if (MODO_GEMINI) {
        const r = await real.extraerRanuraDesdeImagen(buffer, mime, ranura, llave, enfoque)
        grabado.set(archivo, { ...grabado.get(archivo), extraccion: r.data })
        return r
      }
      return { data: structuredClone(grabadaDe(archivo).extraccion) }
    },
  }
})
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  getCotizacionItems: async (cotizacionId: string) => (tablas.items ?? []).filter(i => i.cotizacion_id === cotizacionId).map(i => structuredClone(i)),
  recalcularTotales: async () => ({ success: true }),
  deleteItem: async (id: string) => {
    tablas.items = (tablas.items ?? []).filter(i => i.id !== id)
    return { success: true }
  },
}))
vi.mock('@/lib/cotizaciones/imagen-captura', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/imagen-captura')>()),
  guardarImagenDeCaptura: async () => null,
  borrarImagenesDeCaptura: async () => {},
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso() }))

function llaveGemini(): string {
  const env = readFileSync(path.resolve(__dirname, '../../../../.env.local'), 'utf8')
  return env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? ''
}

function grabadaDe(archivo: string): Grabada {
  const g = fixture.capturas.find(c => c.archivo === archivo)
  if (!g) throw new Error(`sin grabación de ${archivo}`)
  return g
}

// ── El doble de la base (mismo patrón que `actividades-tras-limpieza-e2e.test.ts`) ──

let tablas: Record<string, Fila[]> = {}
let secuencia = 0

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  const enLista: [string, unknown[]][] = []
  let operacion: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  const aplica = (f: Fila) => filtros.every(([c, v]) => f[c] === v) && enLista.every(([c, vs]) => vs.includes(f[c]))
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload as Fila))
      return { data: filas.map(f => structuredClone(f)), error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      return { data: null, error: null }
    }
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: `${tabla}-${++secuencia}`, created_at: new Date(Date.UTC(2026, 9, 5, 21, 39, secuencia)).toISOString(), ...structuredClone(p) }))
      tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas]
      return { data: nuevas.map(f => structuredClone(f)), error: null }
    }
    return { data: filas.map(f => structuredClone(f)), error: null }
  }
  const api = {
    select() { return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    eq(c: string, v: unknown) { filtros.push([c, v]); return api },
    in(c: string, vs: unknown[]) { enLista.push([c, vs]); return api },
    is(c: string, v: unknown) { filtros.push([c, v]); return api },
    neq() { return api },
    order() { return api },
    limit() { return api },
    async maybeSingle() { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error } },
    async single() { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error } },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej) },
  }
  return api
}

// ── Lo real ───────────────────────────────────────────────────────────────────

const { POST: detectarPOST } = await import('@/app/api/cotizaciones/[id]/detectar-captura/route')
const { POST: leerPOST } = await import('@/app/api/cotizaciones/[id]/leer-captura/route')
const { POST: aceptarPOST } = await import('@/app/api/cotizaciones/[id]/aceptar-captura/route')
const { procesarCaptura } = await import('@/lib/cotizaciones/proceso-captura')
const red = await import('@/lib/cotizaciones/bandeja-red')
const { revisarBorrador } = await import('@/lib/cotizaciones/revisar-borrador')
const { desenlaceDeAceptacion, opcionesParaComparar } = await import('./bandeja-capturas')
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')
const { habitacionesDeTarifa } = await import('@/lib/cotizaciones/habitaciones')
const { etiquetaDeRanura } = await import('@/lib/cotizaciones/ranuras-pantallazo')

type Captura = import('./bandeja-capturas').Captura
type CambioDeCaptura = import('@/lib/cotizaciones/proceso-captura').CambioDeCaptura

// ── La red entre la bandeja y Vercel ─────────────────────────────────────────

const RUTAS = { 'detectar-captura': detectarPOST, 'leer-captura': leerPOST, 'aceptar-captura': aceptarPOST } as const
type Accion = keyof typeof RUTAS

/** Lo que llegó a «Vercel» (las rutas), en orden. */
let llegadas: { accion: Accion; bytes: number }[] = []
/** Cuántas peticiones de cada ruta se cortan ANTES de llegar, como las de Alejandra. */
let cortes: Partial<Record<Accion, number>> = {}

const fetchLocal: typeof fetch = async (entrada, init) => {
  const url = String(entrada)
  const m = /^\/api\/cotizaciones\/([^/]+)\/([a-z-]+)$/.exec(url)
  if (!m || !(m[2] in RUTAS)) throw new Error(`ruta inesperada ${url}`)
  const accion = m[2] as Accion
  if ((cortes[accion] ?? 0) > 0) {
    cortes[accion] = (cortes[accion] ?? 0) - 1
    // Lo que lanza Chromium cuando la conexión se cae antes de que la petición llegue.
    throw new TypeError('Failed to fetch')
  }
  const cuerpo = String(init?.body ?? '')
  llegadas.push({ accion, bytes: cuerpo.length })
  const req = new Request(`https://trappvel.metrikone.co${url}`, { method: 'POST', body: cuerpo, headers: { 'content-type': 'application/json' } })
  return RUTAS[accion](req, { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) })
}

// ── La bandeja, como la corre el componente ──────────────────────────────────

let capturas: Captura[] = []
let contador = 0

function lineas(): Fila[] {
  return (tablas.items ?? []).filter(i => i.cotizacion_id === COT).map(i => structuredClone(i))
}

/** Pega un pantallazo y deja que la bandeja lo mire y lo lea, como `agregar` + `procesar`. */
async function pegar(archivo: string): Promise<Captura> {
  const id = `cap-${++contador}`
  const dataUrl = dataUrlDe(archivo)
  if (MODO_GEMINI) archivoPorHuella.set(Buffer.from(dataUrl.split(',')[1], 'base64').subarray(0, 4096).toString('base64'), archivo)
  const c: Captura = {
    id, preview: dataUrl, dataUrl, estado: { fase: 'mirando' }, tipo: null, pistas: null, borrador: null,
    itemId: null, donde: null, leida: null, error: null,
  }
  capturas.push(c)
  const actualizar = (cambio: CambioDeCaptura) => Object.assign(c, cambio)
  await procesarCaptura({
    detectar: () => red.detectarPorRuta(COT, dataUrl, fetchLocal),
    leer: (tipo, enfoque) => red.leerPorRuta(COT, tipo, dataUrl, enfoque, fetchLocal),
    revisar: borrador => revisarBorrador({
      capId: id, borrador, lineas: lineas() as never, comparables: opcionesParaComparar(lineas() as never, capturas, id),
      composicion: GRUPO, destinoViaje: DESTINO, ubicaciones: {}, comparar: true,
    }),
    vigente: () => true,
    informar: actualizar,
  })
  return c
}

/** «Aceptar» de la fila (`aceptar` del componente): el mismo cuerpo, por la misma ruta. */
async function aceptar(c: Captura, decision: 'auto' | 'opcion' | 'habitacion' | 'reemplazar' = 'auto', destinoId: string | null = null) {
  const b = c.borrador
  if (!b) throw new Error(`${c.id} no tiene borrador: ${JSON.stringify(c.estado)}`)
  const r = await red.aceptarPorRuta(COT, {
    tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision,
    destinoId, imagen: c.dataUrl || null, correcciones: null,
  }, fetchLocal)
  const d = desenlaceDeAceptacion(r)
  if (d.tipo === 'aceptada') Object.assign(c, { estado: { fase: 'aceptada' }, itemId: d.itemId, donde: d.donde, error: null })
  else Object.assign(c, { error: d.mensaje })
  return d
}

/** Lo que Componentes muestra: bloque, opción y habitaciones. */
function componentes() {
  const porBloque = new Map<string, { nombre: string; habitaciones: string[] }[]>()
  for (const i of lineas()) {
    const bloque = etiquetaDeRanura(i.grupo as string)
    const t = leerTarifaPax(i.tarifa_pax)
    const habs = habitacionesDeTarifa(t).map(h => {
      const o = h.lectura.paraComposicion ?? null
      return o ? `${o.adultos}A+${o.ninos}N+${o.infantes}I` : '?'
    })
    porBloque.set(bloque, [...(porBloque.get(bloque) ?? []), { nombre: String(i.nombre), habitaciones: habs }])
  }
  return Object.fromEntries(porBloque)
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  tablas = { cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-n1-26-1', oportunidad_id: null, valor_total: 0 }], items: [], rubros: [], ranuras: [] }
  capturas = []
  llegadas = []
  cortes = {}
  secuencia = 0
})
afterEach(() => vi.unstubAllEnvs())
afterAll(() => {
  if (!GRABAR) return
  const capturasNuevas = fixture.capturas.map(c => ({ ...c, ...grabado.get(c.archivo) }))
  writeFileSync(RUTA_FIXTURE, `${JSON.stringify({ ...fixture, capturas: capturasNuevas }, null, 1)}\n`)
})

const ARCHIVOS = fixture.capturas.map(c => c.archivo)

describe.runIf(!MODO_GEMINI || existsSync(DIR_CAPTURAS))('caso Alejandra (N1 26 1): 6A + 1N + 1I, dos vuelos, hoteles por habitación', () => {
  it('reproducción: el orden de Alejandra con la red sana', async () => {
    const avianca = await pegar('captura-1.jpeg')
    expect(avianca.estado.fase).toBe('lista')
    expect((await aceptar(avianca)).tipo).toBe('aceptada')
    const satena = await pegar('captura-8.jpeg')
    expect((await aceptar(satena)).tipo).toBe('aceptada')
    const cabanas = await pegar('captura-4.jpeg')
    console.log(cabanas.estado, cabanas.donde)
    const d = await aceptar(cabanas)
    console.log(d)
    for (const a of ['captura-2.jpeg', 'captura-3.jpeg', 'captura-5.jpeg', 'captura-6.jpeg', 'captura-7.jpeg']) {
      const c = await pegar(a)
      console.log(a, c.estado.fase, 'mensaje' in c.estado ? c.estado.mensaje : '', c.donde)
      if (c.borrador) console.log(a, await aceptar(c, c.estado.fase === 'parecida' && 'habitacion' in c.estado && c.estado.habitacion ? 'habitacion' : 'auto', c.estado.fase === 'parecida' ? c.estado.conItemId : null))
    }
    console.log(JSON.stringify(componentes(), null, 1))
    expect(ARCHIVOS).toHaveLength(8)
  }, 120_000)
})
