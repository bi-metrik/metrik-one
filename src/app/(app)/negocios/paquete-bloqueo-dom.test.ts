import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * La tarjeta del paquete de bloqueo con React de verdad sobre happy-dom (Vera sobre el PR #1324):
 *  · lo pegado que la detección no ubica pregunta «¿Es el hotel o el vuelo?» y ofrece también «Otro
 *    servicio» (vuelve a la bandeja) y «Descartar»;
 *  · una Pública con comisión dice su margen (10 %), no «Margen 0 %»;
 *  · el clic en la casilla la enfoca; «Subir archivo» es aparte.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const leer = vi.hoisted(() => vi.fn(async (_c: string, _cual: string, _d: string): Promise<unknown> => ({ ok: false, elegir: true, mensaje: 'No se reconoce si es el pantallazo del hotel o el del vuelo. Elige cuál es.' })))
const guardar = vi.hoisted(() => vi.fn(async (_id: string, entrada: { paquete: unknown }) => ({ success: true, paquete: entrada.paquete, costo: null, falta: [] })))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/bloqueo-actions', () => ({
  leerPantallazoBloqueo: leer,
  crearPaqueteBloqueo: async () => ({ success: true, itemId: 'x' }),
  guardarPaqueteBloqueo: guardar,
  ajustarReglasDelPaquete: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let Tarjeta: typeof import('./por-pasos/paquete-bloqueo').TarjetaPaqueteBloqueo
let Registro: typeof import('@/lib/cotizaciones/bloqueo-pegado').RegistroDePaquetes
let paqueteVacio: typeof import('@/lib/cotizaciones/bloqueo-paquete').paqueteVacio

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Tarjeta = (await import('./por-pasos/paquete-bloqueo')).TarjetaPaqueteBloqueo
  Registro = (await import('@/lib/cotizaciones/bloqueo-pegado')).RegistroDePaquetes
  paqueteVacio = (await import('@/lib/cotizaciones/bloqueo-paquete')).paqueteVacio
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  leer.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

const DATA = 'data:image/png;base64,AAAA'
const texto = () => (contenedor.textContent ?? '').replace(/\s+/g, ' ')
const clic = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }

async function montar(registro: InstanceType<typeof Registro> | null, tarifaPax: unknown = null, margenAplicado: number | null = null, edadesNinosSolicitud: number[] | null = null, extra: Record<string, unknown> = {}) {
  await act(async () => {
    root!.render(React.createElement(Tarjeta, {
      cotizacionId: 'cot-1', itemId: 'pq-1', tarifaPax, precioVenta: null, editable: true, operador: 'Aliados Travel',
      pasajeros: null, vueloSugerido: null, onCambio: () => {}, onEliminar: () => {}, registro, margenAplicado, edadesNinosSolicitud,
      ...extra,
    }))
  })
}

async function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  await act(async () => {
    setter.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

describe('«¿Es el hotel o el vuelo?» en la tarjeta', () => {
  it('ofrece hotel, vuelo, «Otro servicio» (vuelve a la bandeja) y «Descartar»', async () => {
    const registro = new Registro()
    const aLaBandeja = vi.fn()
    registro.conectarBandeja(aLaBandeja)
    await montar(registro)
    await act(async () => { registro.entregar('pq-1', DATA, null) })
    expect(leer).toHaveBeenCalledWith('cot-1', 'detectar', DATA)
    const pregunta = contenedor.querySelector('[data-elegir-casilla]')!
    expect([...pregunta.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Es el hotel', 'Es el vuelo', 'Otro servicio', 'Descartar'])
    await clic(pregunta.querySelector('[data-es-casilla="otro"]')!)
    expect(aLaBandeja).toHaveBeenCalledWith(DATA)
    expect(contenedor.querySelector('[data-elegir-casilla]')).toBeNull()
  })

  it('«Descartar» la quita sin leer ni devolver nada', async () => {
    const registro = new Registro()
    const aLaBandeja = vi.fn()
    registro.conectarBandeja(aLaBandeja)
    await montar(registro)
    await act(async () => { registro.entregar('pq-1', DATA, null) })
    await clic(contenedor.querySelector('[data-es-casilla="descartar"]')!)
    expect(contenedor.querySelector('[data-elegir-casilla]')).toBeNull()
    expect(aLaBandeja).not.toHaveBeenCalled()
    expect(leer).toHaveBeenCalledTimes(1)
  })

  it('el clic en la casilla la enfoca y no abre archivos; «Subir archivo» es un botón aparte', async () => {
    await montar(null)
    const zona = contenedor.querySelector('[data-casilla-paquete="vuelo"] [role="textbox"]') as HTMLElement
    const entrada = contenedor.querySelector('[data-casilla-paquete="vuelo"] input[type="file"]') as HTMLInputElement
    const abrir = vi.spyOn(entrada, 'click')
    await clic(zona)
    expect(document.activeElement).toBe(zona)
    expect(abrir).not.toHaveBeenCalled()
    await clic(contenedor.querySelector('[data-casilla-paquete="vuelo"] [data-subir-archivo]')!)
    expect(abrir).toHaveBeenCalledTimes(1)
  })
})

describe('margen de un paquete Público con comisión', () => {
  it('dice el 10 % de su comisión, no «Margen 0 %»', async () => {
    const p = paqueteVacio('Aliados Travel')
    p.hotel.hotel = 'Hotel Ficticio'
    await montar(null, { bloqueo: p, tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', comisionPct: 10 } }, 0)
    expect(contenedor.querySelector('[data-margen-paquete]')?.textContent).toBe('Margen 10 % (comisión)')
    expect(texto()).not.toContain('Margen 0 %')
  })
})

describe('la edad del niño viene precargada de la Solicitud (prueba real del 2026-10-29)', () => {
  const conNino = (edades: number[]) => {
    const p = paqueteVacio('Aliados Travel')
    p.hotel.hotel = 'Hotel de prueba'
    p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 1_000_000 }]
    p.distribucion = { habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: edades }
    return { bloqueo: p }
  }
  const casilla = () => contenedor.querySelector('input[aria-label="Edades de los niños"]') as HTMLInputElement | null
  const abrir = async () => {
    const b = [...contenedor.querySelectorAll('button')].find(x => x.textContent === 'Ver y editar el paquete')
    if (b) await clic(b)
  }

  it('el paquete sin edad abre con la de la Solicitud («8 años») y se puede cambiar', async () => {
    await montar(null, conNino([]), null, [8])
    await abrir()
    expect(casilla()?.value).toBe('8')
    expect(casilla()?.readOnly).toBe(false)
    // Ya no se pide como falta (el aviso de «Falta la edad» no aparece en la tarjeta).
    expect(texto()).not.toContain('Falta la edad de un niño')
  })
  it('la edad ya guardada en el paquete manda sobre la de la Solicitud', async () => {
    await montar(null, conNino([5]), null, [8])
    await abrir()
    expect(casilla()?.value).toBe('5')
  })
  it('sin edad en la Solicitud, la casilla queda vacía como antes', async () => {
    await montar(null, conNino([]), null, null)
    await abrir()
    expect(casilla()?.value).toBe('')
  })
})

describe('D3 · la comisión de la agencia en la tarjeta del paquete (2026-10-29)', () => {
  const radio = (t: string) => [...contenedor.querySelectorAll('label')].find(l => l.textContent?.includes(t))!.querySelector('input')!
  const guardarPaquete = async () => clic([...contenedor.querySelectorAll('button')].find(b => b.textContent?.includes('Guardar paquete'))!)

  it('con «Pública», la comisión se pide desde el inicio (antes de guardar) y es obligatoria', async () => {
    guardar.mockClear()
    await montar(null)
    expect(contenedor.querySelector('[data-comision-paquete]')).toBeNull()
    await clic(radio('Pública'))
    expect(contenedor.querySelector('[data-comision-paquete]')).not.toBeNull()
    expect(contenedor.querySelector('[data-comision-estado]')?.getAttribute('data-comision-estado')).toBe('falta')
    expect(texto()).toContain('sin ella la cotización no se puede enviar')
    expect(texto()).not.toContain('margen 0 %')
  })

  it('en %: «12» se guarda con el paquete como 12 %', async () => {
    guardar.mockClear()
    await montar(null)
    await clic(radio('Pública'))
    await escribir(contenedor.querySelector('input[aria-label="Comisión de la agencia en %"]') as HTMLInputElement, '12')
    await guardarPaquete()
    expect(guardar).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls[0][1]).toMatchObject({ comision: 'incluida', comisionAgencia: { tipo: 'pct', valor: 12 } })
  })

  it('en pesos: «$ 250.000» se guarda como 250.000 pesos', async () => {
    guardar.mockClear()
    await montar(null)
    await clic(radio('Pública'))
    await clic(contenedor.querySelector('[data-comision-tipo="monto"]')!)
    await escribir(contenedor.querySelector('input[aria-label="Comisión de la agencia en pesos"]') as HTMLInputElement, '$ 250.000')
    expect(contenedor.querySelector('[data-comision-estado]')?.getAttribute('data-comision-estado')).toBe('escrita')
    await guardarPaquete()
    expect(guardar.mock.calls[0][1]).toMatchObject({ comision: 'incluida', comisionAgencia: { tipo: 'monto', valor: 250_000 } })
  })

  it('«Neta» no manda comisión', async () => {
    guardar.mockClear()
    await montar(null)
    await clic(radio('Neta'))
    await guardarPaquete()
    expect(guardar.mock.calls[0][1]).not.toHaveProperty('comisionAgencia')
  })
})

describe('D5 · «Va en la propuesta» en la tarjeta del paquete', () => {
  it('sin tarifas no aparece; con ellas, quitarlo y ponerlo llama a la acción con el valor', async () => {
    await montar(null)
    expect(contenedor.querySelector('[data-paquete-en-propuesta]')).toBeNull()
    const onEnPropuesta = vi.fn()
    await montar(null, null, null, null, { enPropuesta: true, onEnPropuesta })
    const check = contenedor.querySelector('[data-paquete-en-propuesta] input') as HTMLInputElement
    expect(check.checked).toBe(true)
    await clic(check)
    expect(onEnPropuesta).toHaveBeenCalledWith(false)
  })
})
