import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * La foto del hotel del paquete de bloqueo (Mauricio, 2026-11-05: «no permite agregar fotos a los
 * hoteles de los paquetes»), con React de verdad sobre happy-dom y la biblioteca de las tarjetas
 * (`FotosEnTarjetas`) real:
 *  · la tarjeta del paquete pide a la biblioteca el hotel GUARDADO, sin ciudad (la llave que busca el
 *    documento) y sin la ficha del operador;
 *  · subir una foto pasa por la casilla de autorización y llama `subirFotoABiblioteca` con ese pedido;
 *  · lo que vuelve se pinta en el recuadro.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader', 'File', 'Blob'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never as Record<string, (...a: unknown[]) => unknown>)[k].bind(ventana) })
}

const subir = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/bloqueo-actions', () => ({
  leerPantallazoBloqueo: async () => ({ ok: false, mensaje: 'x' }),
  crearPaqueteBloqueo: async () => ({ success: true, itemId: 'x' }),
  guardarPaqueteBloqueo: async () => ({ success: true, paquete: null, costo: null, falta: [] }),
  ajustarReglasDelPaquete: async () => ({ success: true }),
  operadoresDelDirectorio: async () => [],
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))
vi.mock('@/app/(app)/fotos/actions', () => ({
  subirFotoABiblioteca: subir,
  fotosParaTarjetas: async () => ({ ok: false, error: 'no debe llamarse: la lectura va inyectada' }),
  contestarMismoPerfil: vi.fn(),
}))
vi.mock('@/lib/cotizaciones/foto-hotel-navegador', () => ({
  comprimirFotoHotel: async () => ({ dataUrl: 'data:image/jpeg;base64,COMPRIMIDA', proporcion: 1.5 }),
}))
// La casilla «Tengo autorización» (Emilio): un doble mínimo que confirma con la casilla marcada.
vi.mock('@/app/(app)/fotos/autorizacion-foto', async () => {
  const React = await import('react')
  return {
    DialogoAutorizacionFoto: (p: { archivo: Blob | null; nombre?: string; conCategoria?: boolean; onConfirmar: (permiso: { autorizada: boolean; procedencia: string | null }, categoria: string | null) => void }) =>
      p.archivo
        ? React.createElement('button', {
          type: 'button',
          'data-autorizo': p.nombre ?? '',
          'data-con-categoria': p.conCategoria ? 'si' : 'no',
          onClick: () => p.onConfirmar({ autorizada: true, procedencia: 'kit de medios' }, 'fachada'),
        }, 'Tengo autorización')
        : null,
  }
})
vi.mock('@/app/(app)/fotos/perfil-fotos', () => ({ default: () => null }))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let Tarjeta: typeof import('./por-pasos/paquete-bloqueo').TarjetaPaqueteBloqueo
let FotosEnTarjetas: typeof import('./fotos-tarjeta').FotosEnTarjetas
let paqueteVacio: typeof import('@/lib/cotizaciones/bloqueo-paquete').paqueteVacio
let claveDeFoto: typeof import('@/lib/fotos/clave').claveDeFoto
let claveDeHotel: typeof import('@/lib/fotos/foto-hotel-documento').claveDeHotel
let hotelesDePaquetes: typeof import('@/lib/cotizaciones/bloqueo-documento').hotelesDePaquetes

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Tarjeta = (await import('./por-pasos/paquete-bloqueo')).TarjetaPaqueteBloqueo
  FotosEnTarjetas = (await import('./fotos-tarjeta')).FotosEnTarjetas
  paqueteVacio = (await import('@/lib/cotizaciones/bloqueo-paquete')).paqueteVacio
  claveDeFoto = (await import('@/lib/fotos/clave')).claveDeFoto
  claveDeHotel = (await import('@/lib/fotos/foto-hotel-documento')).claveDeHotel
  hotelesDePaquetes = (await import('@/lib/cotizaciones/bloqueo-documento')).hotelesDePaquetes
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  subir.mockReset()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const espera = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

function tarifaConHotel(hotel: string | null) {
  const p = paqueteVacio('Aliados Travel')
  p.hotel.hotel = hotel
  p.hotel.zona = 'Centro'
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_150_000 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return { bloqueo: p }
}

type Pedido = { tipo: string; nombre: string; ciudad: string | null; proveedorId?: string; aMano?: boolean }
const elemento = (fotos: number) => ({
  tipo: 'hotel' as const, clave: 'decameron isleno|', nombre: 'Decameron Isleño', ciudad: null, alias: [], admiteOtra: fotos < 3,
  fotos: Array.from({ length: fotos }, (_, i) => ({ id: `f${i}`, url: `https://firmada.example/${i}.jpg`, principal: i === 0, origen: 'asesora' as const, fuente: null, seImprime: true, categoria: null })),
})

async function montar(tarifaPax: unknown, leer: (pedidos: Pedido[], o?: { destino?: string | null }) => Promise<unknown>, editable = true) {
  await act(async () => {
    const tarjeta = React.createElement(Tarjeta, {
      cotizacionId: 'cot-1', itemId: 'pq-1', tarifaPax, precioVenta: null, editable, operador: 'Aliados Travel',
      pasajeros: null, vueloSugerido: null, onCambio: () => {}, onEliminar: () => {},
    })
    const props = { leer: leer as never, destino: 'San Andrés' } as Omit<Parameters<typeof FotosEnTarjetas>[0], 'children'>
    root!.render(React.createElement(FotosEnTarjetas as unknown as (p: typeof props) => null, props, tarjeta))
  })
  await espera()
  await espera()
  // La tarjeta guardada nace cerrada: se abre como lo haría la asesora.
  const abrir = [...contenedor.querySelectorAll('button')].find(b => b.textContent === 'Ver y editar el paquete')
  if (abrir) await act(async () => { abrir.click() })
}

describe('la foto del hotel del paquete de bloqueo', () => {
  it('pide a la biblioteca el hotel guardado sin ciudad ni ficha del operador: la MISMA llave que busca el documento', async () => {
    const pedidos: Pedido[] = []
    const opciones: unknown[] = []
    const tarifa = tarifaConHotel('Decameron Isleño')
    await montar(tarifa, async (ps, o) => {
      pedidos.push(...ps)
      opciones.push(o)
      return { ok: true, editable: true, tarjetas: [{ tipo: 'hotel', clave: claveDeFoto('hotel', 'Decameron Isleño', null), elemento: null, duda: null, proveedor: null }] }
    })
    expect(pedidos).toEqual([{ tipo: 'hotel', nombre: 'Decameron Isleño', ciudad: null }])
    // El destino del viaje viaja con la lectura: con él el servidor reconoce el mismo hotel cotizado suelto.
    expect(opciones).toEqual([{ destino: 'San Andrés' }])
    // La llave de la tarjeta es la del hotel del paquete en el documento (`hotelesDePaquetes`).
    const [delDocumento] = hotelesDePaquetes([{ nombre: 'Paquete 1', grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', tarifa_pax: tarifa, adicionales: [] } as never])
    expect(claveDeHotel(delDocumento)).toBe(claveDeFoto('hotel', pedidos[0].nombre, pedidos[0].ciudad))
    expect(claveDeHotel(delDocumento)).toBe('decameron isleno|')
    // El recuadro vacío invita a agregar la foto.
    expect(contenedor.querySelector('[data-foto-paquete="Decameron Isleño"] [data-foto-hotel="vacia"]')).not.toBeNull()
  })

  it('subir: pasa por «Tengo autorización» y llama subirFotoABiblioteca con el pedido del paquete; la foto se pinta', async () => {
    // La biblioteca como la deja el servidor: después de subir, el perfil tiene la foto (las demás
    // tarjetas la releen con `avisarCambioDeFotos`).
    let guardada: ReturnType<typeof elemento> | null = null
    await montar(tarifaConHotel('Decameron Isleño'), async () => ({
      ok: true, editable: true, tarjetas: [{ tipo: 'hotel', clave: 'decameron isleno|', elemento: guardada, duda: null, proveedor: null }],
    }))
    subir.mockImplementation(async () => { guardada = elemento(1); return { ok: true, elemento: guardada } })
    const entrada = contenedor.querySelector('[data-foto-paquete] input[type="file"]') as HTMLInputElement
    expect(entrada).not.toBeNull()
    const archivo = new File(['x'], 'decameron.jpg', { type: 'image/jpeg' })
    Object.defineProperty(entrada, 'files', { configurable: true, value: [archivo] })
    await act(async () => { entrada.dispatchEvent(new Event('change', { bubbles: true })) })
    // Sin la casilla no sube nada.
    expect(subir).not.toHaveBeenCalled()
    const autorizo = contenedor.querySelector('[data-autorizo]') as HTMLButtonElement
    expect(autorizo.getAttribute('data-autorizo')).toBe('Decameron Isleño')
    expect(autorizo.getAttribute('data-con-categoria')).toBe('si')
    await act(async () => { autorizo.click() })
    await espera()
    expect(subir).toHaveBeenCalledTimes(1)
    const [pedido, dataUrl, reemplaza, categoria, permiso] = subir.mock.calls[0]
    expect(pedido).toEqual({ tipo: 'hotel', nombre: 'Decameron Isleño', ciudad: null, aMano: false })
    expect(pedido).not.toHaveProperty('proveedorId')
    expect(dataUrl).toBe('data:image/jpeg;base64,COMPRIMIDA')
    expect(reemplaza).toBeNull()
    expect(categoria).toBe('fachada')
    expect(permiso).toEqual({ autorizada: true, procedencia: 'kit de medios' })
    const img = contenedor.querySelector('[data-foto-paquete] [data-foto-hotel="con-foto"] img') as HTMLImageElement
    expect(img?.getAttribute('src')).toBe('https://firmada.example/0.jpg')
  })

  it('con foto en la biblioteca la muestra con «+N»', async () => {
    await montar(tarifaConHotel('Decameron Isleño'), async () => ({
      ok: true, editable: true, tarjetas: [{ tipo: 'hotel', clave: 'decameron isleno|', elemento: elemento(2), duda: null, proveedor: null }],
    }))
    expect(contenedor.querySelector('[data-foto-paquete] [data-foto-hotel="con-foto"] img')?.getAttribute('src')).toBe('https://firmada.example/0.jpg')
    expect(contenedor.querySelector('[data-foto-paquete] [data-mas-fotos]')?.textContent).toBe('+1')
  })

  it('sin hotel guardado no pide nada y lo dice', async () => {
    const leer = vi.fn(async () => ({ ok: true, editable: true, tarjetas: [] }))
    await montar(tarifaConHotel(null), leer)
    expect(leer).not.toHaveBeenCalled()
    expect(contenedor.querySelector('[data-foto-paquete="sin-hotel"]')?.textContent).toMatch(/Guarda el paquete/)
  })

  it('sin biblioteca en el espacio (otra plantilla) no pinta el recuadro', async () => {
    await montar(tarifaConHotel('Decameron Isleño'), async () => ({ ok: false, error: 'sin propuesta de viaje' }))
    expect(contenedor.querySelector('[data-foto-paquete]')).toBeNull()
  })
})
