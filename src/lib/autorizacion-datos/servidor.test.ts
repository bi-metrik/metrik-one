import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La página pública y la respuesta del titular contra una base falsa en memoria (solo lo que
 * estas consultas usan: select/eq/is/gt/lte/order/limit/maybeSingle/update). Lo que se prueba es
 * lo que decide el servidor: qué token sirve, qué se guarda al autorizar.
 */

type Fila = Record<string, unknown>
const tablas: Record<string, Fila[]> = {}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let cambio: Fila | null = null
  const orden: Array<[string, boolean]> = []
  let tope = Infinity
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return q },
    is: (c: string, v: unknown) => { filtros.push(f => (f[c] ?? null) === v); return q },
    gt: (c: string, v: string) => { filtros.push(f => String(f[c]) > v); return q },
    lt: (c: string, v: string) => { filtros.push(f => String(f[c]) < v); return q },
    lte: (c: string, v: string) => { filtros.push(f => String(f[c]) <= v); return q },
    order: (c: string, o: { ascending: boolean }) => { orden.push([c, o.ascending]); return q },
    limit: (n: number) => { tope = n; return q },
    update: (v: Fila) => { cambio = v; return q },
    filas() {
      let fs = (tablas[tabla] ?? []).filter(f => filtros.every(x => x(f)))
      for (const [c, asc] of [...orden].reverse()) fs = [...fs].sort((a, b) => (Number(a[c]) - Number(b[c])) * (asc ? 1 : -1))
      return fs.slice(0, tope)
    },
    async maybeSingle() { return { data: q.filas()[0] ?? null, error: null } },
    then(res: (v: { data: Fila[]; error: null }) => void) {
      const fs = q.filas()
      if (cambio) for (const f of fs) Object.assign(f, cambio)
      res({ data: fs, error: null })
    },
    insert: (fila: Fila) => {
      const nueva = { id: `id-${(tablas[tabla] ??= []).length + 1}`, ...fila }
      tablas[tabla].push(nueva)
      return { select: () => ({ maybeSingle: async () => ({ data: { id: nueva.id }, error: null }) }) }
    },
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (t: string) => consulta(t),
    rpc: async () => ({ data: null, error: { message: 'sin rpc en la prueba' } }),
  }),
}))

const WS = 'ws-agencia'
const WS2 = 'ws-otra'
const TOKEN = 'A'.repeat(43)
const futuro = new Date(Date.now() + 10 * 86400_000).toISOString()
const pasado = new Date(Date.now() - 86400_000).toISOString()

function sembrar(enlace: Partial<Fila> = {}) {
  tablas.workspaces = [
    { id: WS, slug: 'agencia', name: 'Agencia Inventada', config_extra: {} },
    { id: WS2, slug: 'otra', name: 'Otra', config_extra: {} },
  ]
  tablas.fiscal_profiles = [{ workspace_id: WS, razon_social: 'AGENCIA INVENTADA S.A.S.', nit: '900.000.000-1' }]
  tablas.contactos = [{ id: 'c1', workspace_id: WS, nombre: 'MAURICIO MORENO', email: null, custom_data: { origen: 'web' } }]
  tablas.autorizacion_datos_textos = [{
    id: 't1', workspace_id: WS, version: 'demo-v1.0', mayor: 1, menor: 0, titulo: 'Autorización',
    cuerpo_md: 'Hola [NOMBRE_CLIENTE]. [RESPONSABLE]. [ENCARGADO].',
    casillas: [{ clave: 'generales', texto: 'Autorizo' }, { clave: 'menores', texto: 'Menores' }],
    variables: { encargado: 'Persona Encargada Inventada' }, mensajes: {}, plantilla_sha256: 'f'.repeat(64),
    publicado_at: '2026-10-01T00:00:00Z',
  }]
  tablas.autorizacion_datos_enlaces = [{
    id: 'e1', workspace_id: WS, contacto_id: 'c1', token: TOKEN, expira_at: futuro, aceptado_at: null, rechazado_at: null,
    texto_id: null, texto_version: null, texto_mayor: null, casillas: null, medio: null, ...enlace,
  }]
  tablas.activity_log = []
}

vi.mock('@/lib/almacenamiento/one', () => ({
  subirAOne: async (e: { bucket: string; path: string }) => ({ referencia: `one://${e.bucket}/${e.path}`, bucket: e.bucket, path: e.path }),
}))

const { abrirAutorizacion, responderAutorizacion, registrarConEvidencia } = await import('./servidor')

const respuesta = (extra: Partial<Parameters<typeof responderAutorizacion>[0]> = {}) => responderAutorizacion({
  token: TOKEN, slug: 'agencia', decision: 'autorizo', textoId: 't1', casillas: { generales: true, menores: true },
  medio: 'whatsapp_reenviado', ip: '203.0.113.7', userAgent: 'Prueba/1.0', ...extra,
})

beforeEach(() => sembrar())

describe('el token', () => {
  it('abre en el subdominio de su workspace', async () => {
    const r = await abrirAutorizacion(TOKEN, 'agencia')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.vista.cuerpo).toBe('Hola Mauricio Moreno. AGENCIA INVENTADA S.A.S., NIT 900.000.000-1. Persona Encargada Inventada.')
      expect(r.vista.autorizable.ok).toBe(true)
    }
  })

  it('en el subdominio de otro workspace no existe', async () => {
    expect(await abrirAutorizacion(TOKEN, 'otra')).toMatchObject({ ok: false, motivo: 'no_encontrado' })
    expect(await respuesta({ slug: 'otra' })).toEqual({ ok: false, error: 'no_encontrado' })
  })

  it('un token inválido o inexistente no abre', async () => {
    expect(await abrirAutorizacion('../etc', 'agencia')).toMatchObject({ ok: false, motivo: 'no_encontrado' })
    expect(await abrirAutorizacion('B'.repeat(43), 'agencia')).toMatchObject({ ok: false, motivo: 'no_encontrado' })
  })

  it('vencido sin autorizar no sirve para autorizar', async () => {
    sembrar({ expira_at: pasado })
    expect(await abrirAutorizacion(TOKEN, 'agencia')).toMatchObject({ ok: false, motivo: 'expirado' })
    expect(await respuesta()).toEqual({ ok: false, error: 'expirado' })
  })
})

describe('la respuesta del titular', () => {
  it('autorizar guarda versión, medio, casillas, huella y evidencia; y el resumen en el contacto', async () => {
    expect(await respuesta()).toEqual({ ok: true, copiaEnviada: false })
    const e = tablas.autorizacion_datos_enlaces[0]
    expect(e).toMatchObject({
      medio: 'whatsapp_reenviado', texto_id: 't1', texto_version: 'demo-v1.0', texto_mayor: 1, texto_menor: 0,
      casillas: { generales: true, sensibles: null, menores: true, ofertas: null },
      encargado: 'Persona Encargada Inventada', ip: '203.0.113.7', user_agent: 'Prueba/1.0',
    })
    expect(String(e.texto_sha256)).toMatch(/^[0-9a-f]{64}$/)
    const c = tablas.contactos[0].custom_data as Record<string, unknown>
    expect(c.origen).toBe('web')
    expect(c.autorizacion_datos_link).toMatchObject({ version: 'demo-v1.0', medio: 'whatsapp_reenviado', casillas: { generales: true } })
  })

  it('sin la casilla general no se registra', async () => {
    expect(await respuesta({ casillas: { menores: true } })).toEqual({ ok: false, error: 'falta_generales' })
    expect(tablas.autorizacion_datos_enlaces[0].aceptado_at).toBeNull()
  })

  it('si el texto cambió mientras leía, pide recargar', async () => {
    expect(await respuesta({ textoId: 'otro' })).toEqual({ ok: false, error: 'texto_cambio' })
  })

  it('dos toques: el segundo no pisa el primero', async () => {
    await respuesta()
    const primera = tablas.autorizacion_datos_enlaces[0].aceptado_at
    expect(await respuesta({ medio: 'correo' })).toEqual({ ok: false, error: 'ya_autorizo' })
    expect(tablas.autorizacion_datos_enlaces[0]).toMatchObject({ aceptado_at: primera, medio: 'whatsapp_reenviado' })
  })

  it('con el texto marcador (sin publicar) no se puede autorizar', async () => {
    tablas.autorizacion_datos_textos = []
    expect(await respuesta({ textoId: null })).toEqual({ ok: false, error: 'no_autorizable' })
  })

  it('«No autorizo» queda registrado y el enlace sigue abierto', async () => {
    expect(await respuesta({ decision: 'no_autorizo' })).toEqual({ ok: true, copiaEnviada: false })
    const e = tablas.autorizacion_datos_enlaces[0]
    expect(e.rechazado_at).toBeTruthy()
    expect(e.aceptado_at).toBeNull()
    expect(await respuesta()).toEqual({ ok: true, copiaEnviada: false })
  })
})

describe('vía «recibida por otro medio», con evidencia', () => {
  const archivo = () => new File([new Uint8Array([37, 80, 68, 70])], 'firma.pdf', { type: 'application/pdf' })
  const registrar = (extra: Partial<Parameters<typeof registrarConEvidencia>[0]> = {}) => registrarConEvidencia({
    workspaceId: WS, contactoId: 'c1', negocioId: null, staffId: 'staff-1', textoId: 't1', fecha: '2026-10-02',
    medio: 'papel', casillas: { generales: true }, archivo: archivo(), ...extra,
  })
  const encender = () => { tablas.workspaces[0].config_extra = { autorizacion_datos: { registro_con_evidencia: true } } }

  it('apagada por defecto', async () => {
    expect(await registrar()).toEqual({ ok: false, error: 'apagado' })
  })

  it('sin archivo no registra; fecha futura tampoco', async () => {
    encender()
    expect(await registrar({ archivo: null })).toEqual({ ok: false, error: 'sin_archivo' })
    expect(await registrar({ fecha: '2099-01-01' })).toEqual({ ok: false, error: 'fecha' })
    expect(await registrar({ casillas: { menores: true } })).toEqual({ ok: false, error: 'falta_generales' })
  })

  it('con evidencia queda como enlace aceptado vía evidencia, con la fecha del cliente', async () => {
    encender()
    expect(await registrar()).toEqual({ ok: true })
    const e = tablas.autorizacion_datos_enlaces.at(-1)!
    expect(e).toMatchObject({
      via: 'evidencia', medio: 'papel', aceptado_at: '2026-10-02T12:00:00-05:00', texto_id: 't1', texto_mayor: 1,
      casillas: { generales: true, sensibles: null, menores: false, ofertas: null }, registrado_por: 'staff-1',
    })
    expect(String(e.evidencia_ref)).toMatch(/^one:\/\/ve-documentos\/autorizacion-datos\/ws-agencia\/c1\//)
  })
})
