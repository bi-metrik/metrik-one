import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * SOE-038 · corregir un campo de la factura a mano dejaba guardada solo la primera letra.
 *
 * En SOENA, entre sep y oct de 2026, la ciudad de venta quedó «B», «p», «C»; el número de
 * factura «1» y «0»; la partida arancelaria «X». Siempre con `manual: true` y casi siempre
 * con el guardado de la letra suelta como el ÚLTIMO del bloque (en V0621, V0624 y V0655 la
 * hora de la edición es la misma de `completado_at`): después de esa letra no llegó nada más.
 *
 * El mecanismo: el campo guarda en `onBlur` lo que tiene el input en ese instante, y mientras
 * el guardado viaja TODOS los campos de la tarjeta quedaban `disabled`. Basta una pérdida de
 * foco a mitad de palabra (cambiar de ventana para mirar el PDF, el autocompletar del
 * navegador, pasar al siguiente campo con Tab mientras el anterior guarda) para que se guarde
 * el prefijo, el input se desactive, Chrome le quite el foco y el resto de lo que la persona
 * escribe caiga en ninguna parte. Nadie vuelve a guardar: queda la primera letra.
 *
 * Reproducido también en Chromium real (CDP) con el componente de verdad: Tab desde un campo
 * mientras guarda deja el siguiente sin foco y lo tecleado no llega.
 *
 * `teclear` modela al navegador: en un input desactivado no se escribe. Por eso estas pruebas
 * fallan con el `disabled={saving}` de antes, aunque happy-dom deje asignar `value` a mano.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios/n1' })
const GLOBALES = [
  'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Text',
  'Event', 'MouseEvent', 'FocusEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle',
] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

// ── El servidor: cada guardado queda pendiente hasta que la prueba lo suelte ──────────────
type Guardado = { slug: string; value: string; soltar: () => void }
const guardados: Guardado[] = []
let enVuelo = 0
let maxEnVuelo = 0

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/actions/documento-actions', () => ({
  procesarDocumento: async () => ({ success: true }),
  reprocesarDocumento: async () => ({ success: true }),
  actualizarCampoDocumento: (_b: string, _n: string, slug: string, value: string) => {
    enVuelo++
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
    return new Promise(resolve => {
      guardados.push({ slug, value, soltar: () => { enVuelo--; resolve({ success: true }) } })
    })
  },
}))
vi.mock('@/lib/actions/almacenamiento-actions', () => ({
  prepararSubidaExterna: async () => ({ ok: false, error: '' }),
  descartarSubidaExterna: async () => {},
}))
vi.mock('@/lib/actions/devolucion-actions', () => ({ devolverBloque: async () => ({ ok: true }) }))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let BloqueDocumento: typeof import('./BloqueDocumento').default

beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  React = await import('react')
  act = React.act
  createRoot = (await import('react-dom/client')).createRoot
  BloqueDocumento = (await import('./BloqueDocumento')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  guardados.length = 0
  enVuelo = 0
  maxEnVuelo = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  contenedor.remove()
})

const CAMPOS = [
  { slug: 'modelo', label: 'Modelo', tipo: 'texto', descripcion_ai: 'año modelo', required: true },
  { slug: 'ciudad_venta', label: 'Ciudad de venta', tipo: 'texto', descripcion_ai: 'ciudad', required: true, alerta_revision: true },
  { slug: 'numero_factura', label: 'Número de factura', tipo: 'texto', descripcion_ai: 'número', required: true },
]

function montar(
  modo: 'editable' | 'visible',
  campos: Array<Record<string, unknown>> = CAMPOS,
) {
  const instancia = {
    id: 'nb1',
    estado: 'pendiente',
    data: {
      drive_url: 'https://drive.example/factura.pdf',
      file_name: 'factura.pdf',
      _extraction_status: 'ok',
      campos: Object.fromEntries(campos.map(c => [
        c.slug as string,
        c.slug === 'modelo' ? { value: '2025', confidence: 0.95 } : { value: null, confidence: 0, manual: true },
      ])),
    },
  }
  return act(async () => {
    root!.render(React.createElement(BloqueDocumento, {
      negocioBloqueId: 'nb1',
      negocioId: 'n1',
      workspaceId: 'w1',
      instancia: instancia as never,
      modo,
      userRole: 'operator',
      configExtra: { label: 'Factura venta vehículo', campos_extraccion: campos as never, editar_extraidos: true },
      esResponsable: true,
    }))
  })
}

/** Inputs de texto de la tarjeta, en el orden de `CAMPOS` (los que se pintan). */
const inputs = () => [...contenedor.querySelectorAll('input[type="text"]')] as HTMLInputElement[]

/** Como el navegador: en un campo desactivado no entra ninguna tecla. */
async function teclear(input: HTMLInputElement, texto: string) {
  for (const c of texto) {
    if (input.disabled) return
    await act(async () => {
      input.value += c
      input.dispatchEvent(new ventana.Event('input', { bubbles: true }) as unknown as Event)
    })
  }
}

/** Pérdida de foco: Tab, clic en otro campo o cambiar de ventana. React escucha `focusout`. */
async function perderFoco(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new ventana.FocusEvent('focusout', { bubbles: true }) as unknown as Event)
  })
}

async function soltarTodo() {
  // Suelta en orden, también los que se encolan mientras se sueltan los anteriores.
  for (let i = 0; i < 20; i++) {
    const g = guardados.find(x => !(x as { suelto?: boolean }).suelto)
    if (!g) return
    ;(g as { suelto?: boolean }).suelto = true
    await act(async () => { g.soltar() })
  }
}

const ultimoDe = (slug: string) => [...guardados].reverse().find(g => g.slug === slug)?.value

describe('SOE-038 · el texto completo se guarda (modo editable)', () => {
  it('una pérdida de foco tras la primera letra no deja «B»: lo que se sigue escribiendo también se guarda', async () => {
    await montar('editable')
    const ciudad = inputs()[1]
    await teclear(ciudad, 'B')
    await perderFoco(ciudad) // p. ej. cambió de ventana a mirar el PDF
    expect(guardados.map(g => g.value)).toEqual(['B'])

    // El guardado de «B» sigue en vuelo; la persona vuelve y termina la palabra.
    expect(ciudad.disabled).toBe(false)
    await teclear(ciudad, 'ogotá')
    await perderFoco(ciudad)
    await soltarTodo()

    expect(ciudad.value).toBe('Bogotá')
    expect(ultimoDe('ciudad_venta')).toBe('Bogotá')
  })

  it('pasar al siguiente campo mientras el anterior guarda no pierde lo que se escribe', async () => {
    await montar('editable')
    const [modelo, ciudad, numero] = inputs()
    await teclear(modelo, '6')
    await perderFoco(modelo) // Tab: el guardado de «modelo» queda en vuelo

    await teclear(ciudad, 'Pereira')
    await perderFoco(ciudad)
    await teclear(numero, 'FV 1144')
    await perderFoco(numero)
    await soltarTodo()

    expect(ultimoDe('modelo')).toBe('20256')
    expect(ultimoDe('ciudad_venta')).toBe('Pereira')
    expect(ultimoDe('numero_factura')).toBe('FV 1144')
  })

  it('los guardados salen de a uno y en orden: el valor viejo nunca llega después del nuevo', async () => {
    await montar('editable')
    const ciudad = inputs()[1]
    await teclear(ciudad, 'B')
    await perderFoco(ciudad)
    await teclear(ciudad, 'ogotá')
    await perderFoco(ciudad)
    // El segundo no sale mientras el primero no vuelve: el servidor lee y reescribe el JSON
    // del bloque entero, y dos escrituras cruzadas se pisarían.
    expect(guardados.map(g => g.value)).toEqual(['B'])
    await soltarTodo()
    expect(guardados.map(g => g.value)).toEqual(['B', 'Bogotá'])
    expect(maxEnVuelo).toBe(1)
  })
})

describe('SOE-038 · el texto completo se guarda (corrección en modo visible)', () => {
  it('la ciudad con alerta de revisión: la pérdida de foco a mitad de palabra no la deja en «p»', async () => {
    await montar('visible')
    const ciudad = inputs()[0] // en visible solo es editable el campo con alerta_revision
    expect(ciudad).toBeDefined()
    await teclear(ciudad, 'p')
    await perderFoco(ciudad)
    expect(ciudad.disabled).toBe(false)
    await teclear(ciudad, 'ereira')
    await perderFoco(ciudad)
    await soltarTodo()
    expect(ultimoDe('ciudad_venta')).toBe('pereira')
  })
})

// ── Formato antes de guardar: un relleno no destraba el bloque ─────────────────────────────
//
// Al limpiar SOENA aparecieron, además de las letras sueltas, rellenos escritos a propósito
// para destrabar el bloque: NIT «1», fecha «1», número de factura «0», partida arancelaria
// «X» (la config dice que siempre es «0000»). ONE los guardaba y daba el documento por
// completo. Ahora el campo avisa ahí mismo y no manda nada al servidor.

const CAMPOS_FACTURA = [
  { slug: 'fecha_factura', label: 'Fecha de la factura', tipo: 'fecha', descripcion_ai: 'fecha', required: true },
  { slug: 'nit_proveedor', label: 'NIT del proveedor', tipo: 'texto', descripcion_ai: 'nit', required: true },
  { slug: 'numero_factura', label: 'Número de factura', tipo: 'texto', descripcion_ai: 'número', required: true, min_caracteres: 3 },
  { slug: 'partida_arancelaria', label: 'Partida arancelaria', tipo: 'texto', descripcion_ai: '0000', required: true, valor_fijo: '0000' },
]

const aviso = () => contenedor.querySelector('[role="alert"]')?.textContent ?? null

describe('SOE-038 · formato antes de guardar', () => {
  it.each([
    ['fecha_factura', '1', 0, 'fecha completa'],
    ['nit_proveedor', '1', 1, 'al menos 6 dígitos'],
    ['numero_factura', '0', 2, 'mínimo 3'],
    ['partida_arancelaria', 'X', 3, '«0000»'],
  ])('%s = «%s» no se guarda y el campo avisa', async (slug, relleno, i, texto) => {
    await montar('editable', CAMPOS_FACTURA)
    const input = inputs()[i as number]
    await teclear(input, relleno as string)
    await perderFoco(input)
    await soltarTodo()
    expect(guardados.filter(g => g.slug === slug)).toEqual([])
    expect(aviso()).toContain(texto)
  })

  it('la fecha escrita como la escribe la gente se guarda en AAAA-MM-DD y el aviso se va', async () => {
    await montar('editable', CAMPOS_FACTURA)
    const fecha = inputs()[0]
    await teclear(fecha, '1')
    await perderFoco(fecha)
    expect(aviso()).not.toBeNull()

    await act(async () => { fecha.value = '' })
    await teclear(fecha, '17/03/2026')
    await perderFoco(fecha)
    await soltarTodo()
    expect(ultimoDe('fecha_factura')).toBe('2026-03-17')
    expect(fecha.value).toBe('2026-03-17')
    expect(aviso()).toBeNull()
  })

  it('los valores reales pasan tal cual', async () => {
    await montar('editable', CAMPOS_FACTURA)
    const [, nit, numero, partida] = inputs()
    await teclear(nit, '800218155')
    await perderFoco(nit)
    await teclear(numero, 'VVBE/3575')
    await perderFoco(numero)
    await teclear(partida, '0000')
    await perderFoco(partida)
    await soltarTodo()
    expect(ultimoDe('nit_proveedor')).toBe('800218155')
    expect(ultimoDe('numero_factura')).toBe('VVBE/3575')
    expect(ultimoDe('partida_arancelaria')).toBe('0000')
    expect(aviso()).toBeNull()
  })
})
