import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ANIMACION_APARECER,
  ATRIBUTO_CAUSA,
  AVISO_CONEXION,
  ESTILO_AVISO_CONEXION,
  ANIMACION_LENTA,
  AVISO_LENTA,
  ESPERAS_REINTENTO_CHUNK_MS,
  ESPERAS_REINTENTO_RSC_MS,
  GRACIA_TRAS_CHUNK_MS,
  ID_AVISO_LENTA,
  ID_AVISO_PANTALLA,
  LIMITE_AVISO_LENTA_MS,
  LIMITE_ESPERA_LENTA_MS,
  LIMITE_ESPERA_RUTA_MS,
  LIMITE_HIDRATACION_MS,
  MENSAJE_REPORTE_AVISO,
  MENSAJE_REPORTE_CHUNK,
  MENSAJE_REPORTE_LENTA,
  SIN_AVANCE_MS,
  TOPE_HIDRATACION_MS,
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

function montar(
  pathname = '/tableros',
  respuesta: Promise<{ status: number }> = Promise.resolve({ status: 204 }),
  opciones: { chunksBajan?: boolean; antes?: (v: Window) => void } = {},
): Entorno {
  // happy-dom no ejecuta JS: un <script src> conectado dispara `error` solo (un chunk que no
  // baja) o, con `chunksBajan`, `load` (el reintento que sí llegó).
  const ventana = new Window({
    url: `https://soena.metrikone.co${pathname}`,
    settings: { handleDisabledFileLoadingAsSuccess: !!opciones.chunksBajan, disableCSSFileLoading: true },
  })
  opciones.antes?.(ventana)
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
const pildora = (e: Entorno) => e.doc.getElementById(ID_AVISO_LENTA)
/** Solo los reportes de "No pudimos conectar con ONE", por causa. */
const avisos = (e: Entorno) => e.fetchs.filter((f) => f.message === MENSAJE_REPORTE_AVISO).map((f) => f.causa)
const mensajes = (e: Entorno) => e.fetchs.map((f) => f.message)
/** Un recurso que termina de bajar (evento `load` de un <link>): eso es avance. */
function bajo(e: Entorno) {
  const s = e.doc.createElement('link')
  e.doc.head.appendChild(s)
  s.dispatchEvent(new e.ventana.Event('load') as unknown as Event)
  s.remove()
}

/** Un <script src> que no baja: happy-dom (sin ejecutar JS) le dispara `error` al conectarlo. */
function errorDeScript(e: Entorno, src: string) {
  const s = e.doc.createElement('script')
  s.setAttribute('src', src)
  e.doc.head.appendChild(s)
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
  it('sin hidratar y sin nada que llegue: píldora a los 8 s y aviso a pantalla completa a los 25 s, cada uno reportado una vez', async () => {
    expect(LIMITE_AVISO_LENTA_MS).toBe(8_000)
    expect(SIN_AVANCE_MS).toBe(25_000)
    const e = montar('/login')
    await vi.advanceTimersByTimeAsync(LIMITE_AVISO_LENTA_MS - 1)
    expect(pildora(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    // La píldora no tapa nada: arriba, sin capturar clics.
    const p = pildora(e)
    expect(p?.textContent).toBe(AVISO_LENTA)
    expect(p?.getAttribute('style')).toMatch(/pointer-events:\s*none/)
    expect(p?.getAttribute('role')).toBe('status')
    expect(mensajes(e)).toEqual([MENSAJE_REPORTE_LENTA])
    expect(e.fetchs[0]).toMatchObject({ causa: 'sin-hidratar', segDesdeCarga: 8 })
    const rl = leerReporte(JSON.stringify(e.fetchs[0]))
    expect(rl.ok && rl.reporte.message).toBe(MENSAJE_REPORTE_LENTA)
    // A los 20 s ya NO sale el aviso (antes del 2026-10-07 sí): espera falta de avance.
    await vi.advanceTimersByTimeAsync(LIMITE_HIDRATACION_MS - LIMITE_AVISO_LENTA_MS)
    expect(aviso(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS - LIMITE_HIDRATACION_MS - 1)
    expect(aviso(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    const a = aviso(e)
    // El aviso reemplaza a la píldora.
    expect(pildora(e)).toBeNull()
    expect(a).not.toBeNull()
    expect(a?.textContent).toContain(AVISO_CONEXION.titulo)
    expect(a?.textContent).toContain(AVISO_CONEXION.cuerpo)
    expect(a?.querySelector('button')?.textContent).toBe('Reintentar')
    expect(a?.textContent).not.toMatch(/proceso/i)
    // Estilos en linea: no depende de la hoja de estilos (que tampoco bajo).
    expect(a?.getAttribute('style')).toMatch(/position:\s*fixed/)
    expect(e.fetchs).toHaveLength(2)
    expect(e.fetchs[1]).toMatchObject({
      message: MENSAJE_REPORTE_AVISO,
      name: 'AvisoConexion',
      causa: 'sin-hidratar',
      pathname: '/login',
      version: 'dpl_prueba',
      segDesdeCarga: 25,
    })
    // El endpoint lo acepta tal cual.
    const r = leerReporte(JSON.stringify(e.fetchs[1]))
    expect(r.ok && r.reporte.causa).toBe('sin-hidratar')
    // Mucho despues: nada mas (sin tormenta, sin recargas solas).
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(e.fetchs).toHaveLength(2)
    expect(e.reload).not.toHaveBeenCalled()
  })

  it('red lenta pero viva (algo termina de bajar cada 15 s): solo la píldora, nunca el aviso, hasta el tope de 2 min', async () => {
    const e = montar('/negocios')
    for (let t = 0; t < 105_000; t += 15_000) {
      await vi.advanceTimersByTimeAsync(15_000)
      bajo(e)
      expect(aviso(e)).toBeNull()
    }
    expect(pildora(e)).not.toBeNull()
    // Tope duro: aunque siga llegando algo gota a gota, a los 2 min se rinde.
    await vi.advanceTimersByTimeAsync(TOPE_HIDRATACION_MS - 105_000)
    expect(aviso(e)).not.toBeNull()
    expect(avisos(e)).toEqual(['sin-hidratar'])
  })

  it('el avance se corta: el aviso sale 25 s después de lo último que llegó', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(20_000)
    bajo(e)
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS - 1_000)
    expect(aviso(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(aviso(e)).not.toBeNull()
  })

  it('quita las hojas de estilo colgadas (bloquean el pintado) y las devuelve si React hidrata', async () => {
    const e = montar()
    const colgada = e.doc.createElement('link')
    colgada.setAttribute('rel', 'stylesheet')
    colgada.setAttribute('href', '/_next/static/chunks/colgada.css')
    Object.defineProperty(colgada, 'sheet', { value: null })
    const cargada = e.doc.createElement('link')
    cargada.setAttribute('rel', 'stylesheet')
    cargada.setAttribute('href', '/_next/static/chunks/cargada.css')
    Object.defineProperty(cargada, 'sheet', { value: {} })
    e.doc.head.append(colgada, cargada)
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    expect(aviso(e)).not.toBeNull()
    expect(colgada.isConnected).toBe(false)
    expect(cargada.isConnected).toBe(true)
    marcarHidratada()
    expect(colgada.parentNode).toBe(e.doc.head)
  })

  it('una carga lenta que hidrata antes del limite no ve el aviso, y la píldora se va al hidratar', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(pildora(e)).not.toBeNull()
    marcarHidratada()
    expect(pildora(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(aviso(e)).toBeNull()
    expect(mensajes(e)).toEqual([MENSAJE_REPORTE_LENTA])
  })

  it('hidrata antes de los 8 s: ni píldora ni reporte', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(LIMITE_AVISO_LENTA_MS - 1)
    marcarHidratada()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pildora(e)).toBeNull()
    expect(e.fetchs).toHaveLength(0)
  })

  it('si hidrata despues de pintado el aviso (lenta pero exitosa), el aviso se quita', async () => {
    const e = montar()
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    expect(aviso(e)).not.toBeNull()
    marcarHidratada()
    expect(aviso(e)).toBeNull()
  })

  it('un chunk de /_next/static/ que falla se pide de nuevo (1, 3 y 8 s) antes de avisar', async () => {
    expect(ESPERAS_REINTENTO_CHUNK_MS).toEqual([1_000, 3_000, 8_000])
    const e = montar()
    const src = 'https://soena.metrikone.co/_next/static/chunks/abc.js'
    errorDeScript(e, src)
    const copias = () => [...e.doc.querySelectorAll('script')].filter((s) => s.getAttribute('src') === src).length
    // happy-dom dispara `error` al conectar cada copia: todas fallan.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(copias()).toBe(2)
    expect(aviso(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(3_000 + 8_000)
    expect(copias()).toBe(4)
    expect(aviso(e)).toBeNull()
    // Sin más intentos: el aviso tras la gracia, con su causa.
    await vi.advanceTimersByTimeAsync(GRACIA_TRAS_CHUNK_MS)
    expect(aviso(e)).not.toBeNull()
    expect(avisos(e)).toEqual(['chunk'])
    const fallo = e.fetchs.find((f) => f.message === MENSAJE_REPORTE_CHUNK)
    expect(fallo).toMatchObject({ recuperado: false, intento: 3 })
    expect(leerReporte(JSON.stringify(fallo)).ok).toBe(true)
    // El de falta de avance ya no pinta otro ni reporta otra vez.
    await vi.advanceTimersByTimeAsync(TOPE_HIDRATACION_MS)
    expect(e.doc.querySelectorAll(`#${ID_AVISO_PANTALLA}`)).toHaveLength(1)
    expect(avisos(e)).toEqual(['chunk'])
  })

  it('el reintento del chunk SÍ baja: no hay aviso y se reporta recuperado', async () => {
    const e = montar('/negocios', undefined, { chunksBajan: true })
    const src = 'https://soena.metrikone.co/_next/static/chunks/abc.js'
    const s = e.doc.createElement('script')
    s.setAttribute('src', src)
    e.doc.head.appendChild(s)
    // El original "baja" al conectarse (ajuste de happy-dom); el error se simula a mano.
    s.dispatchEvent(new e.ventana.Event('error') as unknown as Event)
    await vi.advanceTimersByTimeAsync(1_000)
    const copia = [...e.doc.querySelectorAll('script')].filter((x) => x.getAttribute('src') === src)
    expect(copia).toHaveLength(2)
    expect(e.fetchs.find((f) => f.message === MENSAJE_REPORTE_CHUNK)).toMatchObject({ recuperado: true, intento: 1 })
    await vi.advanceTimersByTimeAsync(GRACIA_TRAS_CHUNK_MS + 10_000)
    expect(aviso(e)).toBeNull()
  })

  it('una hoja de estilo de /_next/static/ que falla también se pide de nuevo', async () => {
    const e = montar()
    const l = e.doc.createElement('link')
    l.setAttribute('rel', 'stylesheet')
    l.setAttribute('href', 'https://soena.metrikone.co/_next/static/chunks/a.css')
    e.doc.head.appendChild(l)
    l.dispatchEvent(new e.ventana.Event('error') as unknown as Event)
    await vi.advanceTimersByTimeAsync(1_000)
    const hojas = [...e.doc.querySelectorAll('link[rel="stylesheet"]')]
    expect(hojas).toHaveLength(2)
    // Va justo después de la original (el orden de las hojas importa).
    expect(l.nextSibling).toBe(hojas[1])
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
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    aviso(e)?.querySelector('button')?.dispatchEvent(new e.ventana.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect(e.reload).toHaveBeenCalledTimes(1)
    expect((e.ventana.sessionStorage as unknown as Storage).getItem('metrik:auto-recarga:/negocios')).toBe('{"r":[]}')
  })

  it('el reporte queda en la cola de [error-cliente] hasta que el servidor contesta', async () => {
    let contestar!: (r: { status: number }) => void
    const e = montar('/tableros', new Promise((r) => (contestar = r)))
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    const cola = () => JSON.parse((e.ventana.localStorage as unknown as Storage).getItem('metrik:errores-cliente:cola') ?? '[]')
    // La píldora (8 s) y el aviso (25 s): dos reportes esperando respuesta.
    expect(cola()).toHaveLength(2)
    expect(cola()[1]).toMatchObject({ reenvios: 0, cuerpo: { message: MENSAJE_REPORTE_AVISO, causa: 'sin-hidratar' } })
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
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    expect(e.doc.querySelectorAll(`#${ID_AVISO_PANTALLA}`)).toHaveLength(1)
    expect(avisos(e)).toEqual(['espera-ruta', 'sin-hidratar'])
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
    await vi.advanceTimersByTimeAsync(SIN_AVANCE_MS)
    const el = e.doc.createElement('div')
    el.setAttribute(ATRIBUTO_CAUSA, 'espera-ruta')
    e.doc.body.appendChild(el)
    animacion(e, el, ANIMACION_APARECER)
    expect(avisos(e)).toEqual(['sin-hidratar'])
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

  it('trae el aviso en el HTML, oculto, y lo hace aparecer una animacion CSS a los 45 s (antes 25)', () => {
    expect(LIMITE_ESPERA_RUTA_MS).toBe(45_000)
    expect(html).toContain(AVISO_CONEXION.titulo)
    expect(html).toContain('data-animacion-marca="liviana"')
    expect(html).toMatch(new RegExp(`visibility:hidden;animation:${ANIMACION_APARECER} 1ms linear 45000ms forwards`))
    expect(html).toContain(`${ATRIBUTO_CAUSA}="espera-ruta"`)
    // Sin onClick (puede no hidratar): el clic lo atiende el script.
    expect(html).toContain('data-one-reintentar=""')
  })

  it('a los 8 s, debajo de la animación, «tu conexión está lenta»; se oculta con la espera al tope', () => {
    expect(LIMITE_ESPERA_LENTA_MS).toBe(8_000)
    expect(html).toContain(AVISO_LENTA)
    expect(html).toMatch(
      new RegExp(
        `visibility:hidden;animation:${ANIMACION_LENTA} 1ms linear 8000ms forwards, one-aviso-conexion-ocultar 1ms linear 45000ms forwards`,
      ),
    )
  })

  it('el CSS en linea define las tres animaciones', () => {
    expect(ESTILO_AVISO_CONEXION).toContain(`@keyframes ${ANIMACION_APARECER}`)
    expect(ESTILO_AVISO_CONEXION).toContain(`@keyframes ${ANIMACION_LENTA}`)
    expect(ESTILO_AVISO_CONEXION).toMatch(/visibility:visible/)
    expect(ESTILO_AVISO_CONEXION).toMatch(/visibility:hidden/)
  })

  it('la línea lenta se reporta una vez, con su causa, sin contar como aviso', () => {
    const e = montar('/negocios')
    const el = e.doc.createElement('p')
    el.setAttribute('data-one-lenta-causa', 'navegacion')
    e.doc.body.appendChild(el)
    animacion(e, el, ANIMACION_LENTA)
    animacion(e, el, ANIMACION_LENTA)
    expect(e.fetchs).toHaveLength(1)
    expect(e.fetchs[0]).toMatchObject({ message: MENSAJE_REPORTE_LENTA, causa: 'navegacion' })
    expect(avisos(e)).toEqual([])
  })
})

describe('chunks que pide el runtime después de hidratar (una ruta nueva, un modal)', () => {
  /** Como lo hace Turbopack: `onerror` propio y `document.head.appendChild`. */
  function pedirChunk(e: Entorno, tipo: 'script' | 'link', url: string) {
    const el = e.doc.createElement(tipo) as unknown as HTMLScriptElement & HTMLLinkElement
    const onerror = vi.fn()
    const onload = vi.fn()
    if (tipo === 'link') {
      el.rel = 'stylesheet'
      el.href = url
    } else {
      el.src = url
    }
    el.onerror = onerror
    el.onload = onload
    e.doc.head.appendChild(el)
    return { el, onerror, onload }
  }

  it('si no baja, se pide 3 veces más antes de avisarle al runtime (que guarda el fallo para siempre)', async () => {
    const e = montar('/negocios')
    marcarHidratada()
    const { onerror } = pedirChunk(e, 'script', 'https://soena.metrikone.co/_next/static/chunks/ruta.js')
    await vi.advanceTimersByTimeAsync(1_000 + 3_000 + 8_000 - 1)
    expect(onerror).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(e.fetchs.find((f) => f.message === MENSAJE_REPORTE_CHUNK)).toMatchObject({ recuperado: false, intento: 3 })
    // No es asunto del aviso a pantalla completa: la escalera de React decide.
    expect(aviso(e)).toBeNull()
  })

  it('si el reintento baja, el runtime nunca se entera del fallo (y una hoja avisa su onload)', async () => {
    const e = montar('/negocios', undefined, { chunksBajan: true })
    marcarHidratada()
    const { el, onerror, onload } = pedirChunk(e, 'link', 'https://soena.metrikone.co/_next/static/chunks/modal.css')
    // happy-dom no carga CSS en esta prueba: el fallo del original se simula.
    el.dispatchEvent(new e.ventana.Event('error') as unknown as Event)
    el.onerror?.(new e.ventana.Event('error') as unknown as Event)
    await vi.advanceTimersByTimeAsync(1_000)
    const copia = [...e.doc.querySelectorAll('link[rel="stylesheet"]')].find((l) => l !== el)
    expect(copia).toBeTruthy()
    copia?.dispatchEvent(new e.ventana.Event('load') as unknown as Event)
    ;(copia as unknown as { onload: (ev: Event) => void }).onload(new e.ventana.Event('load') as unknown as Event)
    expect(onload).toHaveBeenCalled()
    expect(onerror).not.toHaveBeenCalled()
  })

  it('un script ajeno a /_next/static/ no se toca', () => {
    const e = montar('/negocios')
    const { el, onerror } = pedirChunk(e, 'script', 'https://connect.facebook.net/sdk.js')
    expect(el.onerror).toBe(onerror)
  })
})

describe('navegación interna (RSC): un fallo antes de la respuesta se repite', () => {
  function conFetch(respuestas: Array<() => Promise<unknown>>) {
    const llamadas: unknown[][] = []
    const e = montar('/negocios', undefined, {
      antes: (v) => {
        ;(v as unknown as { fetch: unknown }).fetch = (...args: unknown[]) => {
          llamadas.push(args)
          const r = respuestas.shift()
          return r ? r() : Promise.resolve({ ok: true })
        }
      },
    })
    const f = (e.ventana as unknown as { fetch: (u: string, i?: RequestInit) => Promise<unknown> }).fetch
    return { e, f, llamadas }
  }
  const caida = () => Promise.reject(new TypeError('Failed to fetch'))

  it('GET con `rsc: 1` que falla: se repite a 1 s y a 3 s', async () => {
    expect(ESPERAS_REINTENTO_RSC_MS).toEqual([1_000, 3_000])
    const { f, llamadas } = conFetch([caida, caida, () => Promise.resolve('llegó')])
    const p = f('/negocios/abc?_rsc=x', { headers: { rsc: '1', 'next-url': '/negocios' } })
    await vi.advanceTimersByTimeAsync(999)
    expect(llamadas).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1 + 3_000)
    expect(llamadas).toHaveLength(3)
    await expect(p).resolves.toBe('llegó')
  })

  it('sin más intentos, el error llega a Next tal cual (y Next cae a carga completa como antes)', async () => {
    const { f } = conFetch([caida, caida, caida])
    const p = f('/x', { headers: { RSC: '1' } })
    const atrapado = p.catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await atrapado).toBeInstanceOf(TypeError)
  })

  it('no repite: prefetch, POST (server actions), otra cosa que no es RSC, ni una navegación abortada', async () => {
    const casos: Array<RequestInit | undefined> = [
      { headers: { rsc: '1', 'next-router-prefetch': '1' } },
      { method: 'POST', headers: { rsc: '1', 'next-action': 'abc' } },
      { headers: { 'content-type': 'application/json' } },
      undefined,
    ]
    for (const init of casos) {
      const { f, llamadas } = conFetch([caida, () => Promise.resolve('no')])
      const atrapado = f('/x', init).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await atrapado).toBeInstanceOf(TypeError)
      expect(llamadas).toHaveLength(1)
    }
    const ac = new AbortController()
    const { f, llamadas } = conFetch([caida])
    const atrapado = f('/x', { headers: { rsc: '1' }, signal: ac.signal }).catch((err: Error) => err)
    ac.abort()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await atrapado).toBeInstanceOf(TypeError)
    expect(llamadas).toHaveLength(1)
  })
})
