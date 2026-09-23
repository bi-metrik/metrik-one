/**
 * Las server actions del texto para el cliente, con la base y el modelo falsos.
 *
 * Lo que se fija es lo que el navegador NO puede decidir: que solo la plantilla de
 * Trappvel escribe, que redactar deja un BORRADOR (sin revisión) con la huella de las
 * líneas, que guardar ES revisar, y que un texto revisado no se pisa sin pedirlo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentoCliente, TextoCliente, ViajeParaRedactar } from '@/lib/cotizaciones/documento-cliente'

// ── Dobles ───────────────────────────────────────────────────────────────────

interface Escritura {
  tabla: string
  valores: Record<string, unknown>
  filtros: [string, string, unknown][]
}

const estado = {
  slug: 'trappvel' as string | null,
  role: 'owner' as string | null,
  staffId: 'staff-1' as string | null,
  filasActualizadas: 1,
  escrituras: [] as Escritura[],
  ctx: null as unknown,
}

function fakeSupabase() {
  return {
    from(tabla: string) {
      const filtros: [string, string, unknown][] = []
      let valores: Record<string, unknown> | null = null
      const b = {
        select() { return b },
        eq(col: string, v: unknown) { filtros.push(['eq', col, v]); return b },
        is(col: string, v: unknown) { filtros.push(['is', col, v]); return b },
        update(v: Record<string, unknown>) { valores = v; return b },
        async maybeSingle() {
          if (tabla === 'workspaces') return { data: { cotizacion_template_slug: estado.slug }, error: null }
          if (tabla === 'staff') return { data: { full_name: 'Edgar Alarcón' }, error: null }
          return { data: null, error: null }
        },
        then(resolve: (r: unknown) => void) {
          if (valores) estado.escrituras.push({ tabla, valores, filtros })
          const filas = Array.from({ length: estado.filasActualizadas }, () => ({ id: 'cot-1' }))
          resolve({ data: filas, error: null })
        },
      }
      return b
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'clave' }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: fakeSupabase(),
    workspaceId: 'ws-1',
    staffId: estado.staffId,
    role: estado.role,
    error: null,
  }),
}))
vi.mock('@/lib/cotizaciones/documento-cliente-datos', () => ({
  leerContextoTextoCliente: async () => estado.ctx,
}))
const redactarTextoCliente = vi.fn()
vi.mock('@/lib/ai/redactar-documento-cliente', () => ({
  redactarTextoCliente: (...a: unknown[]) => redactarTextoCliente(...a),
}))

const { getTextoCliente, guardarDocumentoCliente, redactarDocumentoCliente } = await import('./documento-cliente-actions')

// ── Datos ────────────────────────────────────────────────────────────────────

const VIAJE: ViajeParaRedactar = {
  destino: 'San Andrés', fechaSalida: '2026-11-23', fechaRegreso: '2026-11-28', duracion: '6 dias / 5 noches',
  viajeros: { adultos: 2, ninos: 0, infantes: 0 }, vuelos: [], hoteles: [], traslados: [], actividades: [],
  otrosServicios: [], cargosEnDestino: [],
}
const TEXTO: TextoCliente = {
  titular: 'San Andrés, el mar de siete colores',
  intro: 'Seis días frente al Caribe.',
  incluye: ['Tiquetes con Avianca'],
  antes_de_viajar: ['Tarjeta de turismo'],
}
const REVISADO: DocumentoCliente = {
  ...TEXTO, origen: 'ia', modelo: 'gemini-2.5-flash', redactado_en: '2026-09-22T20:00:00.000Z',
  fuente_hash: 'vieja', revisado_por: 'staff-9', revisado_por_nombre: 'Otra', revisado_en: '2026-09-22T21:00:00.000Z',
}

const ctx = (over: Record<string, unknown> = {}) => ({
  cotizacionId: 'cot-1',
  negocioId: 'neg-1',
  estado: 'borrador',
  columnaPresente: true,
  documento: null,
  viaje: VIAJE,
  huella: 'huella-actual',
  terminos: null,
  configLinea: { terminosBase: null, ejemplos: [] },
  ...over,
})

beforeEach(() => {
  estado.slug = 'trappvel'
  estado.role = 'owner'
  estado.staffId = 'staff-1'
  estado.filasActualizadas = 1
  estado.escrituras = []
  estado.ctx = ctx()
  redactarTextoCliente.mockReset()
  redactarTextoCliente.mockResolvedValue({ texto: TEXTO, modelo: 'gemini-2.5-flash' })
})

const escrito = () => estado.escrituras[0]?.valores.documento_cliente as DocumentoCliente | null | undefined

describe('solo la plantilla de Trappvel', () => {
  it('con otra plantilla no hay panel ni escritura', async () => {
    estado.slug = 'metrik'
    expect(await getTextoCliente('cot-1')).toBeNull()
    const r = await redactarDocumentoCliente('cot-1')
    expect(r.success).toBe(false)
    expect(redactarTextoCliente).not.toHaveBeenCalled()
    expect(estado.escrituras).toHaveLength(0)
  })

  it('con la de Trappvel el panel llega con el estado del texto', async () => {
    estado.ctx = ctx({ documento: REVISADO })
    const p = await getTextoCliente('cot-1')
    expect(p).toMatchObject({ columnaPresente: true, editable: true, hayViaje: true, desactualizado: true })
  })
})

describe('redactarDocumentoCliente', () => {
  it('⚠️⚠️ guarda un BORRADOR: sin revisión, con la huella de las líneas de ahora', async () => {
    const r = await redactarDocumentoCliente('cot-1')
    expect(r.success).toBe(true)
    const d = escrito()!
    expect(d.revisado_en).toBeNull()
    expect(d.revisado_por).toBeNull()
    expect(d.origen).toBe('ia')
    expect(d.modelo).toBe('gemini-2.5-flash')
    expect(d.fuente_hash).toBe('huella-actual')
    expect(d.titular).toBe(TEXTO.titular)
    // El modelo recibe SOLO el viaje ya armado (y la voz de la línea), nunca la cotización
    // ni el negocio.
    expect(redactarTextoCliente).toHaveBeenCalledWith(VIAJE, 'clave', { ejemplos: [] })
  })

  it('escribe acotado al workspace y sin pisar un texto revisado que llegue en el camino', async () => {
    await redactarDocumentoCliente('cot-1')
    const f = estado.escrituras[0].filtros
    expect(f).toContainEqual(['eq', 'workspace_id', 'ws-1'])
    expect(f).toContainEqual(['is', 'documento_cliente->>revisado_en', null])
  })

  it('sobre un texto revisado pide confirmación y no llama al modelo', async () => {
    estado.ctx = ctx({ documento: REVISADO })
    const r = await redactarDocumentoCliente('cot-1')
    expect(r).toMatchObject({ success: false, requiereConfirmacion: true })
    expect(redactarTextoCliente).not.toHaveBeenCalled()
    expect(estado.escrituras).toHaveLength(0)
  })

  it('confirmado, reemplaza el revisado por un borrador', async () => {
    estado.ctx = ctx({ documento: REVISADO })
    const r = await redactarDocumentoCliente('cot-1', { reemplazarRevisado: true })
    expect(r.success).toBe(true)
    expect(escrito()!.revisado_en).toBeNull()
    expect(estado.escrituras[0].filtros).not.toContainEqual(['is', 'documento_cliente->>revisado_en', null])
  })

  it('si alguien guardó un revisado mientras el modelo redactaba, no se pisa y se dice', async () => {
    estado.filasActualizadas = 0
    const r = await redactarDocumentoCliente('cot-1')
    expect(r).toMatchObject({ success: false })
    expect((r as { error: string }).error).toContain('mientras ONE redactaba')
  })

  it('sin viaje que describir no llama al modelo', async () => {
    estado.ctx = ctx({ viaje: { ...VIAJE, destino: null } })
    const r = await redactarDocumentoCliente('cot-1')
    expect(r.success).toBe(false)
    expect(redactarTextoCliente).not.toHaveBeenCalled()
  })

  it('si el modelo falla, el error no deja nada escrito', async () => {
    redactarTextoCliente.mockRejectedValue(new Error('Gemini no terminó la respuesta (MAX_TOKENS)'))
    const r = await redactarDocumentoCliente('cot-1')
    expect(r.success).toBe(false)
    expect(estado.escrituras).toHaveLength(0)
  })
})

describe('guardarDocumentoCliente', () => {
  it('⚠️⚠️ guardar ES revisar: queda la marca de quién y cuándo, y la huella de ahora', async () => {
    estado.ctx = ctx({ documento: { ...REVISADO, revisado_en: null, revisado_por: null, revisado_por_nombre: null } })
    const r = await guardarDocumentoCliente('cot-1', { ...TEXTO, titular: 'Corregido a mano' })
    expect(r.success).toBe(true)
    const d = escrito()!
    expect(d.titular).toBe('Corregido a mano')
    expect(d.revisado_en).toEqual(expect.any(String))
    expect(d.revisado_por).toBe('staff-1')
    expect(d.revisado_por_nombre).toBe('Edgar Alarcón')
    expect(d.fuente_hash).toBe('huella-actual')
    // Lo redactó ONE aunque una persona lo corrija: el origen y el modelo se conservan.
    expect(d.origen).toBe('ia')
    expect(d.modelo).toBe('gemini-2.5-flash')
  })

  it('un texto que nace a mano queda como de una persona', async () => {
    await guardarDocumentoCliente('cot-1', TEXTO)
    expect(escrito()!.origen).toBe('persona')
    expect(escrito()!.modelo).toBeNull()
  })

  it('vaciado del todo, borra la columna: el documento vuelve a ser el de siempre', async () => {
    await guardarDocumentoCliente('cot-1', { titular: ' ', intro: null, incluye: [''], antes_de_viajar: [] })
    expect(escrito()).toBeNull()
  })

  it('una cotización que ya no es borrador no se escribe', async () => {
    estado.ctx = ctx({ estado: 'enviada' })
    const r = await guardarDocumentoCliente('cot-1', TEXTO)
    expect(r.success).toBe(false)
    expect(estado.escrituras).toHaveLength(0)
  })

  it('un rol de solo lectura no escribe', async () => {
    estado.role = 'read_only'
    const r = await guardarDocumentoCliente('cot-1', TEXTO)
    expect(r.success).toBe(false)
    expect(estado.escrituras).toHaveLength(0)
  })

  it('sin la migración aplicada lo dice, en vez de un error de columna', async () => {
    estado.ctx = ctx({ columnaPresente: false })
    const r = await guardarDocumentoCliente('cot-1', TEXTO)
    expect((r as { error: string }).error).toContain('migración')
    expect(estado.escrituras).toHaveLength(0)
  })
})

// ── Brief del 2026-09-23: términos en el mismo guardar, voz de la línea, estilo ──────

const TERMINOS = 'Condiciones generales\n- Las tarifas están sujetas a cambios.\n  - Sub-renglón con sangría'

describe('los términos, en el mismo panel (C1 y C2)', () => {
  it('el panel trae los términos guardados y el texto base de la línea', async () => {
    estado.ctx = ctx({ terminos: 'Guardados.', configLinea: { terminosBase: TERMINOS, ejemplos: [] } })
    const p = await getTextoCliente('cot-1')
    expect(p).toMatchObject({ terminos: 'Guardados.', terminosBase: TERMINOS })
  })

  it('⚠️⚠️ un solo guardar: texto y términos van en el MISMO update, acotado al workspace', async () => {
    const r = await guardarDocumentoCliente('cot-1', TEXTO, `${TERMINOS}   \n\n\n`)
    expect(r.success).toBe(true)
    expect(estado.escrituras).toHaveLength(1)
    const w = estado.escrituras[0]
    expect(w.valores.documento_cliente).toMatchObject({ titular: TEXTO.titular })
    // Se guarda normalizado, con la sangría de la sub-lista intacta.
    expect(w.valores.terminos_condiciones).toBe(TERMINOS)
    expect(w.filtros).toContainEqual(['eq', 'workspace_id', 'ws-1'])
    if (r.success) expect(r.panel.terminos).toBe(TERMINOS)
  })

  it('términos vaciados se guardan como null: el PDF sale sin la sección', async () => {
    await guardarDocumentoCliente('cot-1', TEXTO, '   ')
    expect(estado.escrituras[0].valores).toHaveProperty('terminos_condiciones', null)
  })

  it('sin el parámetro de términos, la columna no se toca', async () => {
    await guardarDocumentoCliente('cot-1', TEXTO)
    expect(estado.escrituras[0].valores).not.toHaveProperty('terminos_condiciones')
  })

  it('una cotización que ya no es borrador no guarda términos', async () => {
    estado.ctx = ctx({ estado: 'enviada' })
    const r = await guardarDocumentoCliente('cot-1', TEXTO, TERMINOS)
    expect(r.success).toBe(false)
    expect(estado.escrituras).toHaveLength(0)
  })

  it('⚠️ «Redactar con ONE» no toca los términos', async () => {
    estado.ctx = ctx({ terminos: 'Guardados.', configLinea: { terminosBase: TERMINOS, ejemplos: [] } })
    const r = await redactarDocumentoCliente('cot-1')
    expect(r.success).toBe(true)
    expect(estado.escrituras[0].valores).not.toHaveProperty('terminos_condiciones')
    if (r.success) expect(r.panel.terminos).toBe('Guardados.')
  })
})

describe('la voz de la línea y el validador de estilo (C4)', () => {
  it('los ejemplos de la línea viajan al redactor', async () => {
    const ejemplos = [{ titular: null, intro: 'Cinco noches en Cancún, frente al mar.', incluye: [], antes_de_viajar: [] }]
    estado.ctx = ctx({ configLinea: { terminosBase: null, ejemplos } })
    await redactarDocumentoCliente('cot-1')
    expect(redactarTextoCliente).toHaveBeenCalledWith(VIAJE, 'clave', { ejemplos })
  })

  it('⚠️⚠️ una fórmula vetada MARCA el borrador y no lo reescribe', async () => {
    redactarTextoCliente.mockResolvedValue({
      texto: { ...TEXTO, titular: 'Descubra San Andrés — el paraíso' },
      modelo: 'gemini-2.5-flash',
    })
    await redactarDocumentoCliente('cot-1')
    const d = escrito()!
    expect(d.titular).toBe('Descubra San Andrés — el paraíso')
    expect(d.revisado_en).toBeNull()
    expect(d.estilo_por_revisar).toEqual(expect.arrayContaining([
      { motivo: 'vetada', texto: 'Descubra', campo: 'titular' },
      { motivo: 'vetada', texto: 'paraíso', campo: 'titular' },
      { motivo: 'guion_largo', texto: '—', campo: 'titular' },
    ]))
  })

  it('un borrador limpio no lleva marca', async () => {
    await redactarDocumentoCliente('cot-1')
    expect(escrito()).not.toHaveProperty('estilo_por_revisar')
  })

  it('al guardar queda dicho lo que la persona decidió dejar', async () => {
    await guardarDocumentoCliente('cot-1', { ...TEXTO, intro: 'Un rincón del Caribe.' })
    expect(escrito()!.estilo_por_revisar).toEqual([{ motivo: 'vetada', texto: 'rincón', campo: 'intro' }])
  })
})
