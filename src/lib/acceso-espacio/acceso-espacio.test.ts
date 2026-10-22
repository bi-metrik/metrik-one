import { describe, expect, it, vi } from 'vitest'
import { slugDeEntrada, urlDelEspacio, urlLoginGeneral } from './direcciones'
import { LimiteEnMemoria } from './limite'
import { LOGO_URL, PIE_MARCA, TEXTOS_LOGIN, correoBienvenidaValida, correoRecuperarEspacio } from './textos'
import {
  VENTANA_RECUPERAR_MS,
  correoSolicitado,
  enviarBienvenidaValida,
  enviarDireccionesDeEspacio,
  idsDeEspacios,
  type DepsRecuperar,
} from './servidor'
import type { CorreoSaliente } from '@/lib/cobros/enlace-automatico-servidor'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

const PROD = { NODE_ENV: 'production', NEXT_PUBLIC_BASE_DOMAIN: 'metrikone.co' }

describe('slugDeEntrada: lo que la persona escribe en «La dirección de tu espacio»', () => {
  it.each([
    ['acme', 'acme'],
    ['  ACME  ', 'acme'],
    ['acme.metrikone.co', 'acme'],
    ['https://acme-prueba-1.metrikone.co/valida', 'acme-prueba-1'],
    ['acme-prueba-1.metrikone.co/login?redirectTo=/valida', 'acme-prueba-1'],
    ['http://www.acme.metrikone.co', 'acme'],
    ['metrikone.co', ''],
    ['', ''],
  ])('%j → %j', (entrada, slug) => {
    expect(slugDeEntrada(entrada, 'metrikone.co')).toBe(slug)
  })

  it('el dominio base con puerto (desarrollo) también se quita', () => {
    expect(slugDeEntrada('acme.localhost:3000', 'localhost:3000')).toBe('acme')
  })
})

describe('direcciones del espacio', () => {
  it('arma el subdominio con la ruta', () => {
    expect(urlDelEspacio('acme', '/valida', PROD)).toBe('https://acme.metrikone.co/valida')
    expect(urlLoginGeneral(PROD)).toBe('https://metrikone.co/login')
  })
})

describe('LimiteEnMemoria', () => {
  it('deja pasar hasta el tope dentro de la ventana y vuelve a abrir al salir de ella', () => {
    const l = new LimiteEnMemoria(2, 1000)
    expect(l.permitir('a', 0)).toBe(true)
    expect(l.permitir('a', 10)).toBe(true)
    expect(l.permitir('a', 20)).toBe(false)
    // Otra llave no se ve afectada.
    expect(l.permitir('b', 20)).toBe(true)
    // Un rechazo no suma: al vencer el primero, cabe uno.
    expect(l.permitir('a', 1001)).toBe(true)
    expect(l.permitir('a', 1002)).toBe(false)
  })

  it('no guarda más llaves que la cota', () => {
    const l = new LimiteEnMemoria(1, 10_000, 2)
    l.permitir('a', 0)
    l.permitir('b', 1)
    l.permitir('c', 2) // saca a «a», la más vieja
    expect(l.permitir('a', 3)).toBe(true)
    expect(l.permitir('c', 4)).toBe(false)
  })
})

describe('correoSolicitado', () => {
  it('normaliza un correo y rechaza lo que no lo es', () => {
    expect(correoSolicitado('  Ana@Ejemplo.CO ')).toBe('ana@ejemplo.co')
    expect(correoSolicitado('ana@ejemplo')).toBeNull()
    expect(correoSolicitado('ana ejemplo.co')).toBeNull()
    expect(correoSolicitado('a@b.co, c@d.co')).toBeNull()
    expect(correoSolicitado(42)).toBeNull()
    expect(correoSolicitado(`${'a'.repeat(250)}@x.co`)).toBeNull()
  })
})

describe('idsDeEspacios', () => {
  it('suma staff activo y el espacio del perfil, y descarta donde lo desactivaron', () => {
    expect(
      idsDeEspacios({ workspace_id: 'ws-perfil', home_workspace_id: null }, [
        { workspace_id: 'ws-a', is_active: true },
        { workspace_id: 'ws-perfil', is_active: true },
      ]).sort(),
    ).toEqual(['ws-a', 'ws-perfil'])
    expect(idsDeEspacios({ workspace_id: 'ws-viejo', home_workspace_id: null }, [{ workspace_id: 'ws-viejo', is_active: false }])).toEqual([])
    expect(idsDeEspacios(null, [])).toEqual([])
  })
})

/** Dependencias de mentira: un único usuario con dos espacios. */
function deps(over: Partial<DepsRecuperar> = {}) {
  const enviados: CorreoSaliente[] = []
  const d: DepsRecuperar = {
    buscarUsuario: async (c) => (c === 'ana@acme.example' ? 'u-ana' : null),
    espaciosDe: async () => [
      { slug: 'acme', nombre: 'ACME S.A.S.' },
      { slug: 'beta', nombre: 'Beta' },
    ],
    enviar: async (m) => {
      enviados.push(m)
      return { ok: true, id: 'r-1' }
    },
    urlLogin: (slug) => urlDelEspacio(slug, '/login', PROD),
    // Al inicio exacto de una ventana: +1 ms cae en la misma.
    ahoraMs: VENTANA_RECUPERAR_MS * 3_000_000,
    ...over,
  }
  return { d, enviados }
}

describe('enviarDireccionesDeEspacio', () => {
  it('con cuenta: envía UN correo con el enlace al login de cada espacio', async () => {
    const { d, enviados } = deps()
    expect(await enviarDireccionesDeEspacio('ana@acme.example', d)).toBe('enviado')
    expect(enviados).toHaveLength(1)
    const m = enviados[0]
    expect(m.to).toBe('ana@acme.example')
    expect(m.text).toContain('ACME S.A.S.: https://acme.metrikone.co/login')
    expect(m.text).toContain('Beta: https://beta.metrikone.co/login')
    expect(m.subject).toBe('Las direcciones de tus espacios en MéTRIK ONE')
    // La llave no lleva el correo en claro, y es la misma dentro de la ventana.
    expect(m.idempotencyKey).not.toContain('ana')
    const otra = deps({ ahoraMs: d.ahoraMs + 1 })
    await enviarDireccionesDeEspacio('ana@acme.example', otra.d)
    expect(otra.enviados[0].idempotencyKey).toBe(m.idempotencyKey)
    const siguiente = deps({ ahoraMs: d.ahoraMs + VENTANA_RECUPERAR_MS })
    await enviarDireccionesDeEspacio('ana@acme.example', siguiente.d)
    expect(siguiente.enviados[0].idempotencyKey).not.toBe(m.idempotencyKey)
  })

  it('sin cuenta o sin espacios: no envía nada', async () => {
    const a = deps()
    expect(await enviarDireccionesDeEspacio('nadie@acme.example', a.d)).toBe('sin_cuenta')
    expect(a.enviados).toHaveLength(0)
    const b = deps({ espaciosDe: async () => [] })
    expect(await enviarDireccionesDeEspacio('ana@acme.example', b.d)).toBe('sin_espacios')
    expect(b.enviados).toHaveLength(0)
  })

  it('si Auth o el envío fallan, no lanza', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = deps({ buscarUsuario: async () => { throw new Error('Auth caído') } })
    expect(await enviarDireccionesDeEspacio('ana@acme.example', a.d)).toBe('error')
    const b = deps({ enviar: async () => ({ ok: false, error: 'resend_500' }) })
    expect(await enviarDireccionesDeEspacio('ana@acme.example', b.d)).toBe('error')
    espia.mockRestore()
  })
})

describe('enviarBienvenidaValida', () => {
  it('envía la bienvenida con la dirección del espacio y la llave del registro', async () => {
    const enviados: CorreoSaliente[] = []
    await enviarBienvenidaValida({ correo: 'ana@acme.example', razonSocial: 'ACME S.A.S.', slug: 'acme', registroId: 'reg-1' }, async (m) => {
      enviados.push(m)
      return { ok: true, id: null }
    })
    expect(enviados).toHaveLength(1)
    expect(enviados[0].to).toBe('ana@acme.example')
    expect(enviados[0].idempotencyKey).toBe('valida-bienvenida-reg-1')
    expect(enviados[0].text).toContain('/valida')
    expect(enviados[0].text).toContain('ana@acme.example')
  })

  it('un envío que lanza o falla no se propaga', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const p = { correo: 'ana@acme.example', razonSocial: 'ACME', slug: 'acme', registroId: 'reg-1' }
    await expect(enviarBienvenidaValida(p, async () => { throw new Error('red') })).resolves.toBeUndefined()
    await expect(enviarBienvenidaValida(p, async () => ({ ok: false, error: 'resend_422' }))).resolves.toBeUndefined()
    expect(espia).toHaveBeenCalledTimes(2)
    espia.mockRestore()
  })
})

describe('textos de cara al cliente', () => {
  const bienvenida = correoBienvenidaValida({
    razonSocial: 'ACME <S.A.S.>',
    correo: 'ana@acme.example',
    urlValida: 'https://acme.metrikone.co/valida',
    urlLoginGeneral: 'https://metrikone.co/login',
  })
  const recuperar = correoRecuperarEspacio({ correo: 'ana@acme.example', espacios: [{ nombre: 'ACME', url: 'https://acme.metrikone.co/login' }] })

  it('la bienvenida dice la dirección, el enlace directo y con qué correo entrar', () => {
    expect(bienvenida.subject).toBe('Tu espacio en Valida está listo')
    expect(bienvenida.text).toContain('La dirección de tu espacio es acme.metrikone.co')
    expect(bienvenida.text).toContain('Entrar a Valida: https://acme.metrikone.co/valida')
    expect(bienvenida.text).toContain('(ana@acme.example)')
    expect(bienvenida.html).toContain('href="https://acme.metrikone.co/valida"')
    // Lo que escribió la persona no entra crudo al HTML.
    expect(bienvenida.html).toContain('ACME &lt;S.A.S.&gt;')
    expect(bienvenida.html).not.toContain('<S.A.S.>')
  })

  it('un solo espacio: asunto en singular', () => {
    expect(recuperar.subject).toBe('La dirección de tu espacio en MéTRIK ONE')
  })

  it('los dos correos llevan la marca: logo hospedado arriba y pie de marca, en HTML y en texto', () => {
    expect(LOGO_URL).toMatch(/^https:\/\/metrikone\.co\/icons\/metrik-icono-192\.png$/)
    for (const c of [bienvenida, recuperar]) {
      expect(c.html).toMatch(new RegExp(`<img src="${LOGO_URL.replace(/[.]/g, '\\.')}"[^>]*alt="MéTRIK"`))
      // El logo va antes del cuerpo y el pie después.
      expect(c.html.indexOf(LOGO_URL)).toBeLessThan(c.html.indexOf('Hola:'))
      expect(c.html.indexOf(PIE_MARCA.linea1)).toBeGreaterThan(c.html.indexOf('Hola:'))
      expect(c.html).toContain(PIE_MARCA.linea2)
      expect(c.text.endsWith(`--\n${PIE_MARCA.linea1}\n${PIE_MARCA.linea2}`)).toBe(true)
      // Sin adjuntos ni imágenes embebidas.
      expect(c.html).not.toContain('data:image')
      expect(c.html).not.toContain('cid:')
    }
  })

  it('sin léxico vetado de marca', () => {
    const todo = [JSON.stringify(TEXTOS_LOGIN), bienvenida.subject, bienvenida.text, recuperar.subject, recuperar.text].join('\n').toLowerCase()
    for (const vetada of ['plata', 'pyme', 'proceso', 'headcount', 'licencia', 'premium', 'garantizamos']) {
      expect(todo).not.toContain(vetada)
    }
  })
})
