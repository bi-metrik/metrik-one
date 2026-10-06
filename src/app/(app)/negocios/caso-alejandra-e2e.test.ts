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
const proceso = await import('@/lib/cotizaciones/proceso-captura')
const { procesarCaptura, leerCaptura } = proceso
const red = await import('@/lib/cotizaciones/bandeja-red')
const { revisarBorrador } = await import('@/lib/cotizaciones/revisar-borrador')
const { desenlaceDeAceptacion, idDeAceptacion, opcionesParaComparar } = await import('./bandeja-capturas')
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')
const { habitacionesDeTarifa } = await import('@/lib/cotizaciones/habitaciones')
const { etiquetaDeRanura } = await import('@/lib/cotizaciones/ranuras-pantallazo')

type Captura = import('./bandeja-capturas').Captura
type CambioDeCaptura = import('@/lib/cotizaciones/proceso-captura').CambioDeCaptura
type FalloDeBandeja = import('@/lib/errores-cliente/enviar').FalloDeBandeja

// ── La red entre la bandeja y Vercel ─────────────────────────────────────────

const RUTAS = { 'detectar-captura': detectarPOST, 'leer-captura': leerPOST, 'aceptar-captura': aceptarPOST } as const
type Accion = keyof typeof RUTAS

/** Lo que llegó a «Vercel» (las rutas), en orden. */
let llegadas: { accion: Accion; bytes: number }[] = []
/**
 * Peticiones que se cortan ANTES de llegar, por ruta (como las de Alejandra: el borde de Vercel
 * no las contó). `Infinity` = la red no vuelve.
 */
let cortes: Partial<Record<Accion, number>> = {}
/** Peticiones que SÍ llegan y se ejecutan, pero cuya respuesta se pierde en el camino. */
let respuestasPerdidas: Partial<Record<Accion, number>> = {}
/** Las líneas que la bandeja manda al log de Vercel (`reportarFalloDeBandeja`). */
let reportes: FalloDeBandeja[] = []
/** Cuántas veces esperó la bandeja antes de reintentar. */
let esperas = 0

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
  const res = await RUTAS[accion](req, { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) })
  if ((respuestasPerdidas[accion] ?? 0) > 0) {
    respuestasPerdidas[accion] = (respuestasPerdidas[accion] ?? 0) - 1
    throw new TypeError('Failed to fetch')
  }
  return res
}

const RED = { dormir: async () => { esperas++ }, reportar: (f: FalloDeBandeja) => void reportes.push(f) }

// ── La bandeja, como la corre el componente ──────────────────────────────────

let capturas: Captura[] = []
let contador = 0

function lineas(): Fila[] {
  return (tablas.items ?? []).filter(i => i.cotizacion_id === COT).map(i => structuredClone(i))
}

/** Las dependencias de una pasada (`dependencias` del componente), con la red de la prueba. */
function deps(c: Captura) {
  return {
    detectar: () => red.detectarPorRuta(COT, c.dataUrl, fetchLocal, RED),
    leer: (tipo: Parameters<typeof red.leerPorRuta>[1], enfoque: Parameters<typeof red.leerPorRuta>[3]) => red.leerPorRuta(COT, tipo, c.dataUrl, enfoque, fetchLocal, RED),
    revisar: (borrador: Parameters<typeof revisarBorrador>[0]['borrador']) => revisarBorrador({
      capId: c.id, borrador, lineas: lineas() as never, comparables: opcionesParaComparar(lineas() as never, capturas, c.id),
      composicion: GRUPO, destinoViaje: DESTINO, ubicaciones: {}, comparar: true,
    }),
    vigente: () => true,
    informar: (cambio: CambioDeCaptura) => void Object.assign(c, cambio),
  }
}

/** Pega un pantallazo y deja que la bandeja lo mire y lo lea (`agregar` + `procesar`). */
async function pegar(archivo: string): Promise<Captura> {
  const dataUrl = dataUrlDe(archivo)
  if (MODO_GEMINI) archivoPorHuella.set(Buffer.from(dataUrl.split(',')[1], 'base64').subarray(0, 4096).toString('base64'), archivo)
  const c: Captura = {
    id: `cap-${++contador}-${archivo.replace(/\W/g, '')}`, preview: dataUrl, dataUrl, estado: { fase: 'mirando' }, tipo: null, pistas: null,
    borrador: null, itemId: null, donde: null, leida: null, error: null,
  }
  capturas.push(c)
  await procesarCaptura(deps(c))
  return c
}

/** «Reintentar» de la fila (`reintentar` del componente): la misma imagen, sin volver a pegarla. */
async function reintentarFila(c: Captura) {
  if (c.tipo) await leerCaptura(deps(c), c.tipo, c.pistas ?? { lugar: null, origen: null, destino: null }, null)
  else await procesarCaptura(deps(c))
}

/** «Elegir el tipo» de la fila: la lectura sigue con ese tipo (`procesar(id, dataUrl, t)`). */
async function elegirTipo(c: Captura, tipo: 'hotel' | 'vuelo') {
  await procesarCaptura(deps(c), tipo)
}

/** La decisión que toma la fila con «Aceptar» / «Es una habitación más». */
function decisionDe(c: Captura): { decision: 'auto' | 'habitacion'; destinoId: string | null } {
  const e = c.estado
  if (e.fase === 'parecida' && e.habitacion) return { decision: 'habitacion', destinoId: e.conItemId }
  return { decision: 'auto', destinoId: null }
}

/** «Aceptar» de la fila (`aceptar` del componente): el mismo cuerpo, por la misma ruta. */
async function aceptar(c: Captura) {
  const b = c.borrador
  if (!b) throw new Error(`${c.id} no tiene borrador: ${JSON.stringify(c.estado)}`)
  const { decision, destinoId } = decisionDe(c)
  const r = await red.aceptarPorRuta(COT, {
    tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision,
    destinoId, imagen: c.dataUrl || null, correcciones: null, idAceptacion: idDeAceptacion(c),
  }, fetchLocal, RED)
  const d = desenlaceDeAceptacion(r)
  if (d.tipo === 'aceptada') Object.assign(c, { estado: { fase: 'aceptada' }, itemId: d.itemId, donde: d.donde, error: null })
  else Object.assign(c, { error: d.mensaje })
  return d
}

/** Lo que Componentes muestra: bloques, opciones y la ocupación de cada habitación. */
function componentes() {
  const porBloque: Record<string, { nombre: string; habitaciones: string[] }[]> = {}
  for (const i of lineas()) {
    const bloque = etiquetaDeRanura(i.grupo as string)
    const habs = habitacionesDeTarifa(leerTarifaPax(i.tarifa_pax)).map(h => {
      const o = h.lectura.paraComposicion
      return o ? `${o.adultos}A+${o.ninos}N+${o.infantes}I` : '?'
    })
    ;(porBloque[bloque] ??= []).push({ nombre: String(i.nombre), habitaciones: habs })
  }
  return porBloque
}

/** El mismo viaje armado: dos vuelos y dos hoteles de tres habitaciones (6A + 1N + 1I cada uno). */
const ESPERADO = {
  'Vuelo Bogotá–San Andrés Isla': [{ nombre: 'AVIANCA BOGOTÁ–SAN ANDRÉS ISLA', habitaciones: ['6A+1N+1I'] }],
  'Vuelo 2 · Vuelo San Andrés Isla–Providencia': [{ nombre: 'SATENA SAN ANDRÉS ISLA ADZ–PROVIDENCIA PVA', habitaciones: ['6A+1N+1I'] }],
  'Hotel en Providencia Island': [
    { nombre: 'CABAÑAS AGUA DULCE · PROVIDENCIA ISLAND / PROVIDENCIA ISLAND', habitaciones: ['2A+1N+0I', '2A+0N+1I', '2A+0N+0I'] },
    { nombre: 'POSADA ENILDA · PROVIDENCIA ISLAND', habitaciones: ['2A+0N+1I', '2A+1N+0I', '2A+0N+0I'] },
  ],
}

/** El orden de Alejandra: Avianca, SATENA, Cabañas Triple Basic 2A + 1 niño, y el resto. */
const ORDEN = ['captura-1.jpeg', 'captura-8.jpeg', 'captura-4.jpeg', 'captura-2.jpeg', 'captura-3.jpeg', 'captura-5.jpeg', 'captura-6.jpeg', 'captura-7.jpeg']

const TEXTOS_VIEJOS = ['No se pudo agregar la captura. Inténtalo otra vez.', 'No se pudo leer el pantallazo. Vuelve a pegarlo.']
const sinTextosViejos = () => {
  for (const c of capturas) {
    const t = JSON.stringify({ estado: c.estado, error: c.error })
    for (const v of TEXTOS_VIEJOS) expect(t).not.toContain(v)
  }
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  tablas = { cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-n1-26-1', oportunidad_id: null, valor_total: 0 }], items: [], rubros: [], ranuras: [] }
  capturas = []
  llegadas = []
  cortes = {}
  respuestasPerdidas = {}
  reportes = []
  esperas = 0
  secuencia = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => {
  if (!GRABAR) return
  const capturasNuevas = fixture.capturas.map(c => ({ ...c, ...grabado.get(c.archivo) }))
  writeFileSync(RUTA_FIXTURE, `${JSON.stringify({ ...fixture, capturas: capturasNuevas }, null, 1)}\n`)
})

describe.runIf(!MODO_GEMINI || existsSync(DIR_CAPTURAS))('caso Alejandra (N1 26 1): 6A + 1N + 1I, dos vuelos, hoteles por habitación', () => {
  it('el fixture son sus 8 pantallazos', () => {
    expect(fixture.capturas.map(c => c.archivo).sort()).toEqual([...ORDEN].sort())
  })

  it('criterios 1 y 2 · con la red sana los 8 entran; Cabañas Triple Basic 2A + 1 niño queda como habitación del hotel', async () => {
    for (const archivo of ORDEN) {
      const c = await pegar(archivo)
      expect(c.borrador, `${archivo}: ${JSON.stringify(c.estado)}`).not.toBeNull()
      expect((await aceptar(c)).tipo, archivo).toBe('aceptada')
    }
    expect(componentes()).toEqual(ESPERADO)
    // Cabañas 2A + 1N fue la primera del hotel: es la habitación 1 de su opción.
    const cabanas = capturas[2]
    expect(cabanas.donde).toBe('Hotel en Providencia Island · Opción 1')
    const opcion = lineas().find(i => i.id === cabanas.itemId)!
    const habitaciones = habitacionesDeTarifa(leerTarifaPax(opcion.tarifa_pax))
    expect(habitaciones[0].lectura.identidad.hotel).toBe('Cabañas Agua Dulce')
    expect(habitaciones[0].lectura.paraComposicion).toEqual({ adultos: 2, ninos: 1, infantes: 0 })
    expect(capturas.every(c => c.estado.fase === 'aceptada')).toBe(true)
    expect(reportes).toEqual([])
  })

  it('criterios 1 y 3 · la red se corta donde se le cortó a Alejandra y los 8 entran igual, sin repetidos', async () => {
    const avianca = await pegar('captura-1.jpeg')
    await aceptar(avianca)
    const satena = await pegar('captura-8.jpeg')
    await aceptar(satena)
    // Cabañas: su detección y su «Aceptar» no llegaron a Vercel (16:44–16:46).
    cortes = { 'detectar-captura': 1 }
    const cabanas = await pegar('captura-4.jpeg')
    expect(cabanas.estado.fase).toBe('lista')
    cortes = { 'aceptar-captura': 2 }
    expect((await aceptar(cabanas)).tipo).toBe('aceptada')
    // Los dos que pegó a la vez (16:46:09): la detección llegó, la lectura de los dos se cortó.
    cortes = { 'leer-captura': 2 }
    const [a, b] = await Promise.all([pegar('captura-2.jpeg'), pegar('captura-3.jpeg')])
    expect([a.estado.fase, b.estado.fase]).toEqual(['lista', 'lista'])
    for (const c of [a, b]) expect((await aceptar(c)).tipo).toBe('aceptada')
    for (const archivo of ['captura-5.jpeg', 'captura-6.jpeg', 'captura-7.jpeg']) await aceptar(await pegar(archivo))

    expect(componentes()).toEqual(ESPERADO)
    sinTextosViejos()
    // Cada corte que se recuperó deja su línea: es la señal de que la red de ese PC falla.
    expect(reportes).toEqual([
      expect.objectContaining({ ruta: 'detectar-captura', codigo: 'RED', cotizacionId: COT, intentos: 2, recuperado: true }),
      expect.objectContaining({ ruta: 'aceptar-captura', codigo: 'RED', cotizacionId: COT, intentos: 3, recuperado: true }),
      expect.objectContaining({ ruta: 'leer-captura', codigo: 'RED', cotizacionId: COT, intentos: 2, recuperado: true }),
      expect.objectContaining({ ruta: 'leer-captura', codigo: 'RED', cotizacionId: COT, intentos: 2, recuperado: true }),
    ])
    for (const r of reportes) expect(r.bytesImagen).toBeGreaterThan(0)
  })

  it('criterio 3 · dos pegados en el mismo segundo, con la red cortando a los dos, entran los dos', async () => {
    cortes = { 'detectar-captura': 2, 'leer-captura': 2 }
    const [enilda1, enilda2] = await Promise.all([pegar('captura-5.jpeg'), pegar('captura-6.jpeg')])
    expect([enilda1.estado.fase, enilda2.estado.fase]).toEqual(['lista', 'lista'])
    // Aceptados los dos a la vez (la fila los manda en cola, como `colaAceptar`).
    cortes = { 'aceptar-captura': 1 }
    const d1 = await aceptar(enilda1)
    const d2 = await aceptar(enilda2)
    expect([d1.tipo, d2.tipo]).toEqual(['aceptada', 'aceptada'])
    expect(componentes()['Hotel en Providencia Island']).toEqual([
      { nombre: 'POSADA ENILDA · PROVIDENCIA ISLAND', habitaciones: ['2A+0N+1I', '2A+1N+0I'] },
    ])
  })

  it('criterio 1 · si la red no vuelve, cada fila dice qué pasó y qué hacer; nada queda a medias y todo se puede retomar', async () => {
    // La detección no llega: se pide el tipo diciendo que fue la conexión.
    cortes = { 'detectar-captura': Infinity }
    const cabanas = await pegar('captura-4.jpeg')
    expect(cabanas.estado).toEqual({ fase: 'eligiendo_tipo', motivo: proceso.MENSAJE_DETECCION_SIN_RED })
    // Elige «Es hotel» y la lectura tampoco llega: «Reintentar», sin volver a pegarla.
    cortes = { 'leer-captura': Infinity }
    await elegirTipo(cabanas, 'hotel')
    expect(cabanas.estado).toEqual({ fase: 'rechazada', mensaje: proceso.MENSAJE_LECTURA_SIN_RED, reintentar: true })
    // Vuelve la red: «Reintentar» la lee.
    cortes = {}
    await reintentarFila(cabanas)
    expect(cabanas.estado.fase).toBe('lista')
    // «Aceptar» sin red: lo dice, la captura sigue en la bandeja y en Componentes no hay nada.
    cortes = { 'aceptar-captura': Infinity }
    const d = await aceptar(cabanas)
    expect(d).toEqual({ tipo: 'error', mensaje: red.MENSAJE_ACEPTAR_SIN_RED })
    expect(cabanas.borrador).not.toBeNull()
    expect(lineas()).toEqual([])
    // Con la red de vuelta, el mismo «Aceptar» entra.
    cortes = {}
    expect((await aceptar(cabanas)).tipo).toBe('aceptada')
    // Sin detección no hubo lugar leído: el bloque toma el destino del viaje, como siempre.
    expect(componentes()).toEqual({
      'Hotel en San Andrés - Providencia': [
        { nombre: 'CABAÑAS AGUA DULCE · PROVIDENCIA ISLAND / PROVIDENCIA ISLAND', habitaciones: ['2A+1N+0I'] },
      ],
    })
    sinTextosViejos()
  })

  it('criterio 4 · cada envío que no llegó deja su línea: ruta, código, cotización, tamaño de la imagen e intentos', async () => {
    cortes = { 'detectar-captura': Infinity }
    const c = await pegar('captura-4.jpeg')
    cortes = { 'leer-captura': Infinity }
    await elegirTipo(c, 'hotel')
    cortes = {}
    await reintentarFila(c)
    cortes = { 'aceptar-captura': Infinity }
    await aceptar(c)
    const bytes = Math.floor((c.dataUrl.length - c.dataUrl.indexOf(',') - 1) * 3 / 4)
    expect(reportes).toEqual([
      { ruta: 'detectar-captura', codigo: 'RED', cotizacionId: COT, bytesImagen: bytes, intentos: 3, ms: expect.any(Number) },
      { ruta: 'leer-captura', codigo: 'RED', cotizacionId: COT, bytesImagen: bytes, intentos: 3, ms: expect.any(Number) },
      { ruta: 'aceptar-captura', codigo: 'RED', cotizacionId: COT, bytesImagen: bytes, intentos: 3, ms: expect.any(Number) },
    ])
    // Y ninguna de esas peticiones llegó al servidor: como en Vercel el 2026-10-05.
    expect(llegadas.map(l => l.accion)).toEqual(['leer-captura'])
    // Entre intento e intento la bandeja esperó (1,5 s y 4 s en producción).
    expect(esperas).toBe(6)
  })

  it('criterio 4 · la línea llega al log de Vercel por /api/errores-cliente con origen «bandeja»', async () => {
    const { POST: erroresPOST } = await import('@/app/api/errores-cliente/route')
    const lineasDelLog: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lineasDelLog.push(a.map(String).join(' ')))
    const datos = new Map<string, string>()
    vi.stubGlobal('window', {
      location: { pathname: `/negocios/neg-n1-26-1/cotizacion/${COT}`, host: 'trappvel.metrikone.co' },
      localStorage: { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v), removeItem: (k: string) => void datos.delete(k) },
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    // El reporte es pequeño y sí sale: va a la ruta real de errores del cliente.
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => erroresPOST(new Request(`https://trappvel.metrikone.co${url}`, { method: 'POST', body: init.body as string })))
    const { reportarFalloDeBandeja } = await import('@/lib/errores-cliente/enviar')
    // La bandeja real (sin `reportar` de prueba): el aceptar de Cabañas no llega.
    const c = await pegar('captura-4.jpeg')
    cortes = { 'aceptar-captura': Infinity }
    const b = c.borrador!
    await red.aceptarPorRuta(COT, {
      tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision: 'auto',
      destinoId: null, imagen: c.dataUrl, correcciones: null, idAceptacion: idDeAceptacion(c),
    }, fetchLocal, { dormir: async () => {}, reportar: reportarFalloDeBandeja })
    await new Promise(r => setTimeout(r, 0))
    const linea = lineasDelLog.find(l => l.startsWith('[error-cliente]'))
    expect(linea).toBeDefined()
    const json = JSON.parse(linea!.slice('[error-cliente] '.length))
    expect(json).toMatchObject({
      origen: 'bandeja',
      message: 'Bandeja: aceptar-captura RED',
      host: 'trappvel.metrikone.co',
      bandeja: { ruta: 'aceptar-captura', codigo: 'RED', cotizacionId: COT, intentos: 3, bytesImagen: expect.any(Number) },
    })
  })

  it('«Aceptar» que llegó pero perdió la respuesta: el reintento no duplica la opción ni la habitación', async () => {
    const cabanas = await pegar('captura-4.jpeg')
    respuestasPerdidas = { 'aceptar-captura': 1 }
    expect((await aceptar(cabanas)).tipo).toBe('aceptada')
    expect(cabanas.donde).toBe('Hotel en Providencia Island · Opción 1')
    const otra = await pegar('captura-2.jpeg')
    respuestasPerdidas = { 'aceptar-captura': 2 }
    const d = await aceptar(otra)
    expect(d).toMatchObject({ tipo: 'aceptada', como: 'habitacion', habitacionNumero: 2 })
    expect(llegadas.filter(l => l.accion === 'aceptar-captura')).toHaveLength(5)
    expect(componentes()['Hotel en Providencia Island']).toEqual([
      { nombre: 'CABAÑAS AGUA DULCE · PROVIDENCIA ISLAND / PROVIDENCIA ISLAND', habitaciones: ['2A+1N+0I', '2A+0N+1I'] },
    ])
  })

  it('ninguna salida ok:false del servidor sin mensaje ni sin su línea [bandeja] en el log', async () => {
    const avisos: string[] = []
    const errores: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void avisos.push(a.map(String).join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errores.push(a.map(String).join(' ')))
    const c = await pegar('captura-4.jpeg')
    const b = c.borrador!
    // Una firma que no es la de la lectura: FIRMA, con su mensaje y su línea.
    const r = await red.aceptarPorRuta(COT, {
      tipo: b.tipo, lecturaJson: b.lecturaJson, firma: 'otra', pistas: b.pistas, decision: 'auto',
      destinoId: null, imagen: c.dataUrl, correcciones: null, idAceptacion: idDeAceptacion(c),
    }, fetchLocal, RED)
    expect(r).toMatchObject({ ok: false, codigo: 'FIRMA', mensaje: expect.stringMatching(/\S/) })
    const linea = avisos.find(l => l.startsWith('[bandeja]') && l.includes('"FIRMA"'))
    expect(JSON.parse(linea!.slice('[bandeja] '.length))).toEqual({
      ruta: 'aceptar-captura', codigo: 'FIRMA', cotizacionId: COT, bytesImagen: expect.any(Number), mensaje: expect.stringMatching(/\S/),
    })
    // La acción lanza (la base se cae a mitad): sale ok:false con ERROR y su línea, no un 500 ilegible.
    const original = tablas.items
    Object.defineProperty(tablas, 'items', { get: () => { throw new Error('se cayó la base') }, configurable: true })
    const r2 = await red.aceptarPorRuta(COT, {
      tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas, decision: 'auto',
      destinoId: null, imagen: c.dataUrl, correcciones: null, idAceptacion: idDeAceptacion(c),
    }, fetchLocal, RED)
    Object.defineProperty(tablas, 'items', { value: original, writable: true, configurable: true, enumerable: true })
    expect(r2).toMatchObject({ ok: false, codigo: 'ERROR', mensaje: expect.stringMatching(/^ONE tuvo un error/) })
    expect(errores.some(l => l.startsWith('[bandeja]') && l.includes('se cayó la base') && l.includes(COT))).toBe(true)
    // La desconocida sin mensaje: la fila igual dice qué pasó, con el código.
    expect(desenlaceDeAceptacion({ ok: false, codigo: 'X', mensaje: '' })).toEqual({ tipo: 'error', mensaje: expect.stringContaining('código X') })
  })
})
