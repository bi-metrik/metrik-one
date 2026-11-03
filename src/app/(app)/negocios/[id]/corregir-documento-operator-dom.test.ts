import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * SOENA, SOE-028 (2026-10-26): una operadora responsable del caso, con su área invitada al
 * documento (`areas_editoras: ['operaciones']`), no lograba cambiar el RUT de Documentación
 * con el caso ya en Cargue. El servidor la dejaba (`guardEditarBloque`, ver
 * `guard-correccion-hacia-atras.test.ts`); la pantalla no:
 *
 *   · el HISTORIAL no le pasaba `_esResponsable` al bloque, así que `BloqueDocumento` la trataba
 *     como no responsable y no le ofrecía corregir ni reemplazar el original;
 *   · la COPIA de solo lectura de la etapa actual se pintaba editable, con «Reemplazar» y
 *     «Reprocesar IA», y el servidor rechaza toda escritura sobre ella.
 *
 * Se monta la ficha real con React y se abre el historial con clics.
 *
 * VISTO FALLAR (2026-10-26), una mutación a la vez:
 *   · sin `_esResponsable: esResponsable` en el historial → cae «operadora responsable…»;
 *   · sin la línea de la copia en `getBloqueMode`       → cae «la copia de solo lectura…»;
 *   · el aviso de la copia sin exigir rol o responsable → cae «un read_only ve la copia…».
 *
 * Datos inventados.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'location', 'history'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
// `next/link` prefetchea con `requestIdleCallback` sobre `self` y mira la vista con IntersectionObserver.
Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true, writable: true,
  value: class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } },
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {}, replace: () => {} }),
  useParams: () => ({ id: 'neg-1' }),
  usePathname: () => '/negocios/neg-1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, info: () => {} }) }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({}))
vi.mock('@/components/activity-log', () => ({ default: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/actions/documento-actions', () => ({
  procesarDocumento: async () => ({ success: true }),
  reprocesarDocumento: async () => ({ success: true }),
  actualizarCampoDocumento: async () => ({ success: true }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NegocioDetailClient: any

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  React = await import('react')
  act = React.act
  createRoot = (await import('react-dom/client')).createRoot
  NegocioDetailClient = (await import('./negocio-detail-client')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  contenedor.remove()
})

const CAMPOS = [{ slug: 'nit', label: 'NIT', tipo: 'texto', descripcion_ai: 'NIT', required: true }]
const DATA_RUT = {
  drive_url: 'https://drive.google.com/file/d/abc/view',
  file_name: 'rut.pdf',
  campos: { nit: { value: '900123456', confidence: 1, manual: false } },
}

const negocio = {
  id: 'neg-1', workspace_id: 'ws-1', codigo: 'S1 26 3', nombre: 'Caso de prueba', estado: 'abierto',
  stage_actual: 'ejecucion', etapa_actual_id: 'e7', precio_aprobado: null, precio_estimado: null,
  carpeta_url: null, pausado: false, pausado_hasta: null, veces_pausado: 0, motivo_pausa: null,
  motivo_pausa_detalle: null, metadata: {}, fecha_venta: null, responsables: [],
  etapas_negocio: { nombre: 'Cargue', stage: 'ejecucion', numero: 7 },
  lineas_negocio: { nombre: 'Vehículo eléctrico', numero: 1 },
  contactos: null, empresas: null, campanas_contacto: null,
}

/** El RUT original de Documentación (orden 6, venta), tal como lo arma el servidor para el historial. */
function rutOriginal() {
  return {
    id: 'bc-rut', etapa_id: 'e6', workspace_id: 'ws-1', bloque_definition_id: 'def-doc', estado: 'editable', orden: 1,
    es_gate: false, nombre: 'RUT', slug: 'rut', etapa_orden: 6, etapa_nombre: 'Documentación', block_id: null,
    bloque_definitions: { id: 'def-doc', tipo: 'documento', nombre: 'RUT', is_visualization: false, can_be_gate: false },
    instancia: { id: 'nb-rut', negocio_id: 'neg-1', bloque_config_id: 'bc-rut', estado: 'completo', data: DATA_RUT },
    config_extra: { label: 'RUT', campos_extraccion: CAMPOS, areas_editoras: ['operaciones'], corregir_campos_gerencial: true },
    items: [],
  }
}

/** La copia de solo lectura del RUT en Cargue (etapa actual), sin `estado: visible`. */
function copiaEnCargue() {
  return {
    id: 'bc-rut-cargue', etapa_id: 'e7', workspace_id: 'ws-1', bloque_definition_id: 'def-doc', estado: 'editable', orden: 1,
    es_gate: false, nombre: 'RUT', slug: null,
    bloque_definitions: { id: 'def-doc', tipo: 'documento', nombre: 'RUT', is_visualization: false, can_be_gate: false },
    instancia: { id: 'nb-rut-cargue', negocio_id: 'neg-1', bloque_config_id: 'bc-rut-cargue', estado: 'completo', data: DATA_RUT },
    config_extra: {
      label: 'RUT', campos_extraccion: CAMPOS, readonly: true, source_bloque_slug: 'rut', source_etapa_orden: 6,
      _origenEtapaNombre: 'Documentación',
    },
    items: [],
  }
}

async function montar(opts: { userRole: string; esResponsable: boolean; bloques?: unknown[]; historial?: unknown[] }) {
  await act(async () => {
    root!.render(React.createElement(NegocioDetailClient, {
      negocio,
      bloques: opts.bloques ?? [],
      bloquesEtapasPrevias: opts.historial ?? [],
      etapasLinea: [
        { id: 'e6', nombre: 'Documentación', stage: 'venta', orden: 6, numero: 6 },
        { id: 'e7', nombre: 'Cargue', stage: 'ejecucion', orden: 7, numero: 7 },
      ],
      profiles: [],
      currentUserId: 'u-1',
      currentUserEsResponsable: opts.esResponsable,
      userRole: opts.userRole,
      cobros: [],
      cotizacionesNegocio: [],
      resumenFinanciero: { totalCobrado: 0, porCobrar: 0, costosEjecutados: 0 },
      ejecucionData: { presupuesto: [], gastos: [], horas: [] },
      historialData: { gastos: [], horas: [], cobros: [] },
      actividad: [],
      staffList: [],
      datosOtrasEtapas: {},
      pausaEnabled: false,
    }))
  })
}

/**
 * Los bloques entran con `next/dynamic`: se espera a que el documento esté pintado (con
 * archivo, el modo visible trae «Descargar» y el editable «Ver en Drive») antes de mirar qué
 * más ofrece.
 */
async function esperarDocumento() {
  for (let i = 0; i < 60; i++) {
    if (texto().includes('Descargar') || texto().includes('Ver en Drive')) return
    await act(async () => { await new Promise(r => setTimeout(r, 25)) })
  }
  throw new Error('el bloque del documento no se pintó')
}

async function clic(texto: string) {
  const b = [...contenedor.querySelectorAll('button')].find(x => x.textContent?.includes(texto))
  if (!b) throw new Error(`no hay botón «${texto}»`)
  await act(async () => { (b as HTMLButtonElement).click() })
}

/** Abre el historial y, dentro, el RUT. */
async function abrirRutDelHistorial() {
  await clic('Historial de etapas anteriores')
  const items = [...contenedor.querySelectorAll('button')].filter(x => x.textContent?.includes('RUT') && x.textContent?.includes('Documentación'))
  if (items.length !== 1) throw new Error(`RUT en el historial: ${items.length}`)
  await act(async () => { (items[0] as HTMLButtonElement).click() })
  await esperarDocumento()
}

const texto = () => contenedor.textContent ?? ''

/** Despliega la tarjeta del RUT de la etapa actual (una completa llega plegada). */
async function abrirCopiaDeLaEtapa() {
  const cards = [...contenedor.querySelectorAll('button')].filter(x => x.textContent?.startsWith('RUT') && !x.textContent?.includes('Documentación'))
  if (cards.length !== 1) throw new Error(`RUT en la etapa: ${cards.length}`)
  await act(async () => { (cards[0] as HTMLButtonElement).click() })
  await esperarDocumento()
}

describe('Historial: corregir el RUT original de una etapa pasada', () => {
  it('operadora responsable con el área invitada: se le ofrece corregir', async () => {
    await montar({ userRole: 'operator', esResponsable: true, historial: [rutOriginal()] })
    await abrirRutDelHistorial()
    expect(texto()).toContain('Ver')
    expect(texto()).toContain('¿Por qué se corrige?')
  })

  it('operadora NO responsable: no se le ofrece', async () => {
    await montar({ userRole: 'operator', esResponsable: false, historial: [rutOriginal()] })
    await abrirRutDelHistorial()
    expect(texto()).toContain('Descargar')
    expect(texto()).not.toContain('¿Por qué se corrige?')
  })

  it('el área no invitada la resuelve el servidor (`_areaReadonly`): responsable o no, no se ofrece', async () => {
    const rut = rutOriginal()
    rut.config_extra = { ...rut.config_extra, _areaReadonly: true } as typeof rut.config_extra
    await montar({ userRole: 'operator', esResponsable: true, historial: [rut] })
    await abrirRutDelHistorial()
    expect(texto()).not.toContain('¿Por qué se corrige?')
  })

  it('supervisora: sin cambio, se le ofrece como antes', async () => {
    await montar({ userRole: 'supervisor', esResponsable: false, historial: [rutOriginal()] })
    await abrirRutDelHistorial()
    expect(texto()).toContain('¿Por qué se corrige?')
  })
})

describe('Copia de solo lectura del RUT en la etapa actual', () => {
  it('la copia de solo lectura no ofrece Reemplazar ni Reprocesar, y dice dónde está el original', async () => {
    await montar({ userRole: 'operator', esResponsable: true, bloques: [copiaEnCargue()], historial: [rutOriginal()] })
    await abrirCopiaDeLaEtapa()
    expect(texto()).not.toContain('Reprocesar IA')
    expect(texto()).not.toContain('Reemplazar')
    expect(texto()).not.toContain('¿Por qué se corrige?')
    const aviso = contenedor.querySelector('[data-copia-origen]')?.textContent ?? ''
    expect(aviso).toContain('«Documentación»')
    expect(aviso).toContain('Historial de etapas anteriores')
  })

  it('un read_only ve la copia sin el aviso: no tiene nada que corregir', async () => {
    await montar({ userRole: 'read_only', esResponsable: false, bloques: [copiaEnCargue()] })
    await abrirCopiaDeLaEtapa()
    expect(contenedor.querySelector('[data-copia-origen]')).toBeNull()
  })
})
