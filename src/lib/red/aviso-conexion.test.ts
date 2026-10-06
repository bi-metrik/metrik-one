import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ANIMACION_APARECER,
  ATRIBUTO_CAUSA,
  AVISO_CONEXION,
  ESTILO_AVISO_CONEXION,
  GRACIA_TRAS_CHUNK_MS,
  ID_AVISO_PANTALLA,
  LIMITE_ESPERA_RUTA_MS,
  LIMITE_HIDRATACION_MS,
  MENSAJE_REPORTE_AVISO,
  marcarHidratada,
  scriptAvisoConexion,
} from './aviso-conexion'
import { leerReporte } from '@/lib/errores-cliente/reporte'
import Loading from '@/app/(app)/loading'

/**
 * El respaldo sin chunks (2026-10-06): el script en linea del layout raiz corrido tal cual
 * (el mismo texto que va en el HTML) sobre un DOM `happy-dom`, sin React. Simula lo que vio
 * Deisy desde Claro/Telmex: los chunks de `/_next/static/` no bajan y React nunca hidrata
 * (login en la portada, tableros en blanco), o el stream de la pagina se queda colgado con el
 * fallback de carga en pantalla.
 */

interface Entorno {
  ventana: Window
  doc: Document
  fetchs: Record<string, unknown>[]
  reload: ReturnType<typeof vi.fn>
  assign: ReturnType<typeof vi.fn>
  correr: () => void
}

function montar(pathname = '/tableros', respuesta: Promise<{ status: number }> = Promise.resolve({ status: 204 })): Entorno {
  const ventana = new Window({ url: `https://soena.metrikone.co${pathname}` })
  const doc = ventana.document as unknown as Document
  const fetchs: Record<string, unknown>[] = []
  const reload = vi.fn()
  const assign = vi.fn()
  const location = { pathname, host: 'soena.metrikone.co', reload, assign }
  const fetchFalso = vi.fn((_url: string, init: { body: string }) => {
    fetchs.push(JSON.parse(init.body))
    return respuesta
  })
  const codigo = scriptAvisoConexion('dpl_prueba')
  // Los globales que el script usa sin `window.`: los del navegador, aqui inyectados.
  const fn = new Function('window', 'document', 'location', 'navigator', 'fetch', 'crypto', codigo)
  const correr = () =>
    fn(ventana, doc, location, { userAgent: 'Chrome/Windows', onLine: true }, fetchFalso, globalThis.crypto)
  // `marcarHidratada` lee el `window` global.
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: ventana })
  correr()
  return { ventana, doc, fetchs, reload, assign, correr }
}

const aviso = (e: Entorno) => e.doc.getElementById(ID_AVISO_PANTALLA)

function errorDeScript(e: Entorno, src: string) {
  const s = e.doc.createElement('script')
  s.setAttribute('src', src)
  ;(s as unknown as { src: string }).src = src
  e.doc.head.appendChild(s)
  s.dispatchEvent(new e.ventana.Event('error') as unknown as Event)
}

function animacion(e: Entorno, el: Element, nombre: string) {
  const ev = new e.ventana.Event('animationstart', { bubbles: true }) as unknown as Event
  Object.defineProperty(ev, 'animationName', { value: nombre })
  el.dispatchEvent(ev)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('script en linea: React no hidrato (login en la portada, tableros en blanco)', () => {
  it('a los 20 s sin hidratar pinta el aviso a pantalla completa con Reintentar, y lo reporta una vez', async () => {
    const e = montar('/login')
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS - 1)
    expect(aviso(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    const a = aviso(e)
    expect(a).not.toBeNull()
    expect(a?.textContent).toContain(AVISO_CONEXION.titulo)
    expect(a?.textContent).toContain(AVISO_CONEXION.cuerpo)
    expect(a?.querySelector('button')?.textContent).toBe('Reintentar')
    expect(a?.textContent).not.toMatch(/proceso/i)
    // Estilos en linea: no depende de la hoja de estilos (que tampoco bajo).
    expect(a?.getAttribute('style')).toMatch(/position:\s*fixed/)
    expect(e.fetchs).toHaveLength(1)
    expect(e.fetchs[0]).toMatchObject({
      message: MENSAJE_REPORTE_AVISO,
      name: 'AvisoConexion',
      causa: 'sin-hidratar',
      pathname: '/login',
      version: 'dpl_prueba',
      segDesdeCarga: 20,
    })
    // El endpoint lo acepta tal cual.
    const r = leerReporte(JSON.stringify(e.fetchs[0]))
    expect(r.ok && r.reporte.causa).toBe('sin-hidratar')
    // Mucho despues: nada mas (sin tormenta, sin recargas solas).
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(e.fetchs).toHaveLength(1)
    expect(e.reload).not.toHaveBeenCalled()
  })

  it('una carga lenta que hidrata antes del limite no ve el aviso', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(15_000)
    marcarHidratada()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(aviso(e)).toBeNull()
    expect(e.fetchs).toHaveLength(0)
  })

  it('si hidrata despues de pintado el aviso (lenta pero exitosa), el aviso se quita', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    expect(aviso(e)).not.toBeNull()
    marcarHidratada()
    expect(aviso(e)).toBeNull()
  })

  it('un chunk de /_next/static/ que no bajo antes de hidratar: aviso a los 3 s', async () => {
    const e = montar()
    errorDeScript(e, 'https://soena.metrikone.co/_next/static/chunks/abc.js')
    await vi.advanceTimersByTimeAsync(GRACIA_TRAS_CHUNK_MS)
    expect(aviso(e)).not.toBeNull()
    expect(e.fetchs.map((f) => f.causa)).toEqual(['chunk'])
    // El de los 20 s ya no pinta otro ni reporta otra vez.
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    expect(e.doc.querySelectorAll(`#${ID_AVISO_PANTALLA}`)).toHaveLength(1)
    expect(e.fetchs).toHaveLength(1)
  })

  it('el chunk fallo pero React igual hidrato en la gracia: no hay aviso', async () => {
    const e = montar()
    errorDeScript(e, 'https://soena.metrikone.co/_next/static/chunks/abc.js')
    marcarHidratada()
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS * 2)
    expect(aviso(e)).toBeNull()
  })

  it('un script ajeno que falla (no es de /_next/static/) no adelanta el aviso', async () => {
    const e = montar()
    errorDeScript(e, 'https://connect.facebook.net/sdk.js')
    await vi.advanceTimersByTimeAsync(GRACIA_TRAS_CHUNK_MS + 1)
    expect(aviso(e)).toBeNull()
  })

  it('despues de hidratar, un chunk que falla es asunto de la escalera de React, no del script', async () => {
    const e = montar()
    marcarHidratada()
    errorDeScript(e, 'https://soena.metrikone.co/_next/static/chunks/lazy.js')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(aviso(e)).toBeNull()
  })

  it('Reintentar recarga y borra la escalera de la ruta (un clic no es un bucle)', async () => {
    const e = montar('/negocios')
    ;(e.ventana.sessionStorage as unknown as Storage).setItem(
      'metrik:auto-recarga:/negocios',
      JSON.stringify({ r: [1, 2, 3, 4] }),
    )
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    aviso(e)?.querySelector('button')?.dispatchEvent(new e.ventana.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect(e.reload).toHaveBeenCalledTimes(1)
    expect((e.ventana.sessionStorage as unknown as Storage).getItem('metrik:auto-recarga:/negocios')).toBe('{"r":[]}')
  })

  it('el reporte queda en la cola de [error-cliente] hasta que el servidor contesta', async () => {
    let contestar!: (r: { status: number }) => void
    const e = montar('/tableros', new Promise((r) => (contestar = r)))
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    const cola = () => JSON.parse((e.ventana.localStorage as unknown as Storage).getItem('metrik:errores-cliente:cola') ?? '[]')
    expect(cola()).toHaveLength(1)
    expect(cola()[0]).toMatchObject({ reenvios: 0, cuerpo: { causa: 'sin-hidratar' } })
    contestar({ status: 204 })
    await vi.advanceTimersByTimeAsync(0)
    expect(cola()).toHaveLength(0)
  })

  it('correr el script dos veces (otro <head> en la misma pagina) no duplica nada', async () => {
    const e = montar()
    e.correr()
    const el = e.doc.createElement('div')
    el.setAttribute(ATRIBUTO_CAUSA, 'espera-ruta')
    e.doc.body.appendChild(el)
    animacion(e, el, ANIMACION_APARECER)
    el.remove()
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    expect(e.doc.querySelectorAll(`#${ID_AVISO_PANTALLA}`)).toHaveLength(1)
    expect(e.fetchs.map((f) => f.causa)).toEqual(['espera-ruta', 'sin-hidratar'])
  })

  it('tope de 5 avisos reportados por carga (sin tormenta aunque la pagina monte muchas esperas)', () => {
    const e = montar()
    for (let i = 0; i < 8; i++) {
      const el = e.doc.createElement('div')
      el.setAttribute(ATRIBUTO_CAUSA, 'navegacion')
      e.doc.body.appendChild(el)
      animacion(e, el, ANIMACION_APARECER)
      el.remove()
    }
    expect(e.fetchs).toHaveLength(5)
  })

  it('el texto del script no puede cerrar su propio <script>', () => {
    expect(scriptAvisoConexion('</script><b>')).not.toMatch(/<\//)
  })
})

describe('script en linea: el aviso diferido de una espera (CSS) se reporta al aparecer', () => {
  it('una vez por aparicion, con la causa del aviso', () => {
    const e = montar('/negocios/abc')
    const el = e.doc.createElement('div')
    el.setAttribute(ATRIBUTO_CAUSA, 'navegacion')
    e.doc.body.appendChild(el)
    animacion(e, el, ANIMACION_APARECER)
    animacion(e, el, ANIMACION_APARECER)
    animacion(e, el, 'otra-animacion')
    expect(e.fetchs.map((f) => f.causa)).toEqual(['navegacion'])
    // Otro fallback (otra aparicion): otra linea.
    const otro = e.doc.createElement('div')
    otro.setAttribute(ATRIBUTO_CAUSA, 'espera-ruta')
    e.doc.body.appendChild(otro)
    animacion(e, otro, ANIMACION_APARECER)
    expect(e.fetchs.map((f) => f.causa)).toEqual(['navegacion', 'espera-ruta'])
  })

  it('con el aviso a pantalla completa ya pintado, el de la espera no se reporta aparte', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS)
    const el = e.doc.createElement('div')
    el.setAttribute(ATRIBUTO_CAUSA, 'espera-ruta')
    e.doc.body.appendChild(el)
    animacion(e, el, ANIMACION_APARECER)
    expect(e.fetchs.map((f) => f.causa)).toEqual(['sin-hidratar'])
  })

  it('el boton del aviso diferido (sin hidratar) lleva al destino de la navegacion', () => {
    const e = montar('/negocios')
    e.doc.body.innerHTML = '<button data-one-reintentar="/negocios/abc">Reintentar</button>'
    e.doc.querySelector('button')?.dispatchEvent(new e.ventana.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect(e.assign).toHaveBeenCalledWith('/negocios/abc')
    expect(e.reload).not.toHaveBeenCalled()
  })
})

describe('loading.tsx de (app): la espera de la ruta tiene tope sin JavaScript', () => {
  const html = renderToStaticMarkup(createElement(Loading))

  it('trae el aviso en el HTML, oculto, y lo hace aparecer una animacion CSS a los 25 s', () => {
    expect(LIMITE_ESPERA_RUTA_MS).toBe(25_000)
    expect(html).toContain(AVISO_CONEXION.titulo)
    expect(html).toContain('data-animacion-marca="liviana"')
    expect(html).toMatch(new RegExp(`visibility:hidden;animation:${ANIMACION_APARECER} 1ms linear 25000ms forwards`))
    expect(html).toContain(`${ATRIBUTO_CAUSA}="espera-ruta"`)
    // Sin onClick (puede no hidratar): el clic lo atiende el script.
    expect(html).toContain('data-one-reintentar=""')
  })

  it('el CSS en linea define las dos animaciones', () => {
    expect(ESTILO_AVISO_CONEXION).toContain(`@keyframes ${ANIMACION_APARECER}`)
    expect(ESTILO_AVISO_CONEXION).toMatch(/visibility:visible/)
    expect(ESTILO_AVISO_CONEXION).toMatch(/visibility:hidden/)
  })
})
