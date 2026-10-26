/**
 * Modo `miniweb` resuelto por catalogo.
 *
 * Lo que se protege: que el bloque nuevo del webhook NO le robe palabras a los estudios de
 * chat (la demo viva de Grupo Progreso se abre con `cardumen` → estudio `navigate`, modo
 * chat), y que una fila a medio sembrar no despache a ninguna parte.
 *
 * VISTO FALLAR (mutacion): sin el `if (data.modo !== "miniweb")` pasa el caso de la
 * palabra de chat; sin el `if (!data.url)` pasa el de la fila sin url; cambiando el
 * separador fijo a `?` cae el caso de la url que ya trae query.
 */
import { describe, expect, it } from 'vitest'
import { resolverEstudioMiniwebPorTrigger, urlMiniwebParaParticipante } from './estudios'

type Fila = Record<string, unknown>

/** Cliente falso con las dos tablas del catalogo. `maybeSingle` devuelve null si no hay fila. */
function clienteFalso(opts: { triggers?: Fila[]; estudios?: Fila[]; errorTrigger?: string }) {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      const q = {
        select() { return q },
        eq(col: string, val: unknown) { filtros.push((f) => f[col] === val); return q },
        maybeSingle() {
          if (tabla === 'cardumen_estudio_triggers' && opts.errorTrigger) {
            return Promise.resolve({ data: null, error: { message: opts.errorTrigger } })
          }
          const filas = (tabla === 'cardumen_estudio_triggers' ? opts.triggers : opts.estudios) ?? []
          const hit = filas.find((f) => filtros.every((p) => p(f))) ?? null
          return Promise.resolve({ data: hit, error: null })
        },
      }
      return q
    },
  }
}

const ADULTOS = {
  estudio: 'cardumen-instrumento-adultos',
  nombre: 'Cardumen — instrumento adultos (prototipo)',
  modo: 'miniweb',
  url: 'https://reframeit.metrik.com.co/adultos',
  activo: true,
}

const catalogo = (estudios: Fila[] = [ADULTOS]) =>
  clienteFalso({
    triggers: [
      { palabra: 'cardumen adultos', estudio: 'cardumen-instrumento-adultos' },
      { palabra: 'cardumenadultos', estudio: 'cardumen-instrumento-adultos' },
      { palabra: 'cardumen niños', estudio: 'cardumen-instrumento-ninos' },
      // La palabra de la demo viva: modo chat, NO la puede atender el bloque de miniweb.
      { palabra: 'cardumen', estudio: 'navigate' },
    ],
    // La fila de chat lleva url A PROPOSITO (en produccion es null): asi lo unico que la
    // mantiene fuera del miniweb es el `modo`, y la prueba se cae si se quita ese chequeo.
    estudios: [...estudios, { estudio: 'navigate', nombre: 'Navigate', modo: 'chat', url: 'https://x.co/no-deberia', activo: true }],
  })

describe('resolverEstudioMiniwebPorTrigger', () => {
  it('resuelve el instrumento por su palabra', async () => {
    const r = await resolverEstudioMiniwebPorTrigger(catalogo(), 'cardumen adultos')
    expect(r).toEqual({ estudio: ADULTOS.estudio, nombre: ADULTOS.nombre, url: ADULTOS.url })
  })

  it('normaliza como el chat: mayusculas, espacios y puntuacion', async () => {
    for (const texto of ['  Cardumen Adultos ', 'CARDUMEN ADULTOS!', 'cardumen adultos.']) {
      const r = await resolverEstudioMiniwebPorTrigger(catalogo(), texto)
      expect(r?.estudio, texto).toBe(ADULTOS.estudio)
    }
  })

  it('la ñ NO se normaliza: `cardumen niños` resuelve y `cardumen ninos` sin fila no', async () => {
    const c = catalogo([ADULTOS, { estudio: 'cardumen-instrumento-ninos', nombre: 'Niños', modo: 'miniweb', url: 'https://reframeit.metrik.com.co/ninos', activo: true }])
    expect((await resolverEstudioMiniwebPorTrigger(c, 'cardumen niños'))?.estudio).toBe('cardumen-instrumento-ninos')
    expect(await resolverEstudioMiniwebPorTrigger(c, 'cardumen ninos')).toBe(null)
  })

  it('una palabra de estudio de CHAT no la atiende el miniweb (demo viva intacta)', async () => {
    expect(await resolverEstudioMiniwebPorTrigger(catalogo(), 'cardumen')).toBe(null)
  })

  it('palabra sin trigger, texto vacio y fila inexistente devuelven null', async () => {
    expect(await resolverEstudioMiniwebPorTrigger(catalogo(), 'hola')).toBe(null)
    expect(await resolverEstudioMiniwebPorTrigger(catalogo(), '   ')).toBe(null)
    expect(await resolverEstudioMiniwebPorTrigger(catalogo([]), 'cardumen adultos')).toBe(null)
  })

  it('un estudio apagado no se despacha', async () => {
    const r = await resolverEstudioMiniwebPorTrigger(catalogo([{ ...ADULTOS, activo: false }]), 'cardumen adultos')
    expect(r).toBe(null)
  })

  it('fila miniweb SIN url: devuelve null en vez de reventar el turno del webhook', async () => {
    const r = await resolverEstudioMiniwebPorTrigger(catalogo([{ ...ADULTOS, url: null }]), 'cardumen adultos')
    expect(r).toBe(null)
  })

  it('un error de la consulta de triggers no tumba el webhook', async () => {
    const c = clienteFalso({ errorTrigger: '42703 column does not exist' })
    expect(await resolverEstudioMiniwebPorTrigger(c, 'cardumen adultos')).toBe(null)
  })
})

describe('urlMiniwebParaParticipante', () => {
  it('agrega p y wa con ? cuando la url no trae query', () => {
    expect(urlMiniwebParaParticipante('https://x.co/adultos', '573159509103'))
      .toBe('https://x.co/adultos?p=573159509103&wa=573159509103')
  })

  it('usa & cuando la url del catalogo ya trae query', () => {
    expect(urlMiniwebParaParticipante('https://x.co/adultos?v=2', '5731'))
      .toBe('https://x.co/adultos?v=2&p=5731&wa=5731')
  })

  it('escapa el telefono: un + sin escapar se lee como espacio del otro lado', () => {
    expect(urlMiniwebParaParticipante('https://x.co/a', '+57 315')).toBe('https://x.co/a?p=%2B57%20315&wa=%2B57%20315')
  })
})
