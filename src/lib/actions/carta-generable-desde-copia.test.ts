/**
 * La carta de autorización se GENERA desde su copia en Cita y queda en la fila del ORIGEN.
 *
 * SOENA, 2026-10-08: la copia de solo lectura de `carta_autorizacion_generar` (#1057) solo
 * mostraba el PDF de Documentación; sin PDF no había cómo generarla desde Cita. Ahora la copia
 * que declara `genera_en_origen` genera y regenera en la fila del origen, con la configuración
 * del origen; las demás copias siguen de solo lectura.
 *
 * Aquí `casilla-compartida` y `fila-formulario` NO se sustituyen: se ejercitan contra un doble
 * de la base que aplica las escrituras, así que se ve EN QUÉ FILA quedó cada cosa.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cumpleCondicion } from '@/lib/negocios/condicion-bloque'
import { copiaDeSoloLectura } from '@/lib/negocios/copia-heredada'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const LINEA = 'linea-ve'
const COPIA = '11111111-2222-4333-8444-555555555555'
const ORIGEN = '99999999-8888-4777-8666-555555555555'

const escenario: { tablas: Record<string, Fila[]> } = { tablas: {} }
const efectos = { subcarpetas: [] as Array<string | null>, nombres: [] as string[], guardSobre: [] as string[] }

function valorEnRuta(f: Fila, columna: string): unknown {
  const partes = columna.split('.')
  let v: unknown = f[partes[0]]
  for (const k of partes.slice(1)) v = v && typeof v === 'object' ? (v as Fila)[k] : undefined
  return v
}

function cliente() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const eqs: Fila = {}
  const ins: Record<string, unknown[]> = {}
  let payload: Fila | null = null
  let insercion: Fila | null = null
  let tope: number | null = null
  let ordenDesc: string | null = null
  const filtradas = () => {
    let fs = (escenario.tablas[tabla] ?? []).filter(f =>
      Object.entries(eqs).every(([c, v]) => valorEnRuta(f, c) === v)
      && Object.entries(ins).every(([c, vs]) => vs.includes(valorEnRuta(f, c))))
    if (ordenDesc) fs = [...fs].sort((a, b) => Number(b[ordenDesc!]) - Number(a[ordenDesc!]))
    return tope == null ? fs : fs.slice(0, tope)
  }
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    in: (c: string, vs: unknown[]) => { ins[c] = vs; return q },
    order: (c: string, o?: { ascending?: boolean }) => { if (o?.ascending === false) ordenDesc = c; return q },
    limit: (n: number) => { tope = n; return q },
    update: (p: Fila) => { payload = p; return q },
    insert: (p: Fila) => { insercion = p; return q },
    upsert: async (p: Fila) => {
      const filas = (escenario.tablas[tabla] ??= [])
      if (!filas.find(f => f.negocio_id === p.negocio_id && f.bloque_config_id === p.bloque_config_id)) {
        const cfg = (escenario.tablas.bloque_configs ?? []).find(c => c.id === p.bloque_config_id)
        filas.push({ id: ORIGEN, ...structuredClone(p), bloque_configs: structuredClone(cfg?._embed) })
      }
      return { data: null, error: null }
    },
    maybeSingle: async () => ({ data: copia(filtradas()[0]), error: null }),
    single: async () => ({ data: copia(filtradas()[0]), error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (insercion) {
        ;(escenario.tablas[tabla] ??= []).push(structuredClone(insercion))
        return Promise.resolve({ data: null, error: null }).then(ok, ko)
      }
      if (payload) {
        const tocadas = filtradas()
        for (const f of tocadas) Object.assign(f, structuredClone(payload))
        return Promise.resolve({ data: null, error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas().map(copia), error: null }).then(ok, ko)
    },
  }
  return q
}

function copia(f: Fila | undefined): Fila | null {
  return f ? structuredClone(f) : null
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(), workspaceId: WS, userId: 'user-1', role: 'supervisor', staffId: 'staff-1', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: async (id: string) => { efectos.guardSobre.push(id); return { ok: true } },
}))
vi.mock('@/lib/negocios/disputa-generacion', () => ({ generacionNegadaPorDisputa: async () => null }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@react-pdf/renderer', async (orig) => ({
  ...(await orig<typeof import('@react-pdf/renderer')>()),
  renderToBuffer: async () => Buffer.from('%PDF-1.4'),
}))
let subidas = 0
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async (sub: string | null) => { efectos.subcarpetas.push(sub); return 'carpeta-destino' },
  uploadFileToDrive: async (_b: unknown, nombre: string) => {
    subidas++
    efectos.nombres.push(nombre)
    return { fileId: `drv-${subidas}`, webViewLink: `https://drive.google.com/file/d/drv-${subidas}/view` }
  },
  setFilePublicByLink: async () => {},
}))

import { generarFormulario, resolverFormularioParaEdicion, guardarFormularioOverrides } from './formulario-actions'
import { resolverDestinoCompartido } from '@/lib/negocios/casilla-compartida'

// Lo que hay en producción (SOENA VE, 2026-10-08), recortado a lo que decide la prueba.
const RUT2 = { slug: 'rut_solicitante_2', label: 'RUT del segundo solicitante' }
const CFG_ORIGEN = {
  label: '009_CARTA_AUTORIZACION',
  template: 'carta-autorizacion',
  editable_siempre: true,
  drive_subfolder: '2. Comercial',
  requiere_bloques: [{ slug: 'rut', label: 'RUT del solicitante' }, RUT2],
  campos_constantes: { municipio: 'MEDELLÍN' },
}
const CONDICION = {
  field: 'modalidad_solicitante', value: 'copropiedad',
  source_bloque_slug: 'titularidad', source_etapa_orden: 4,
}
const CFG_COPIA_CITA = {
  modo: 'visible',
  label: '009_CARTA_AUTORIZACION_BORRADOR',
  heredado: true,
  readonly: true,
  condition: CONDICION,
  source_bloque_slug: 'carta_autorizacion_generar',
  source_etapa_orden: 6,
  genera_en_origen: true,
}
// Generación, Envío, Anexos y Entrega a la DIAN: la misma copia sin el flag.
const { genera_en_origen: _sinFlag, ...CFG_COPIA_LECTURA } = CFG_COPIA_CITA
void _sinFlag

const embed = (configExtra: Fila, slug: string | null, orden: number) => ({
  config_extra: configExtra, slug, orden, etapa_id: `etapa-${orden}`,
  etapas_negocio: { linea_id: LINEA, orden },
})

function filaCopia(configExtra: Fila = CFG_COPIA_CITA): Fila {
  return { id: COPIA, negocio_id: NEG, estado: 'pendiente', data: {}, bloque_config_id: 'cfg-copia', bloque_configs: embed(configExtra, null, 16) }
}
function filaOrigen(data: Fila = {}): Fila {
  return { id: ORIGEN, negocio_id: NEG, estado: 'pendiente', data, bloque_config_id: 'cfg-origen', bloque_configs: embed(CFG_ORIGEN, 'carta_autorizacion_generar', 6) }
}
const filaRut = (slug: string, data: Fila): Fila => ({
  id: `nb-${slug}`, negocio_id: NEG, estado: 'completo', data, bloque_config_id: `cfg-${slug}`, bloque_configs: embed({}, slug, 6),
})

function montar(opciones: { origen?: Fila | null; rut2?: Fila; copia?: Fila } = {}) {
  const filas = [
    opciones.copia ?? filaCopia(),
    filaRut('rut', { drive_url: 'https://drive/rut1', campos: { nit: { value: '1' } } }),
    filaRut('rut_solicitante_2', opciones.rut2 ?? { drive_url: 'https://drive/rut2' }),
  ]
  if (opciones.origen !== null) filas.push(opciones.origen ?? filaOrigen())
  escenario.tablas = {
    negocio_bloques: filas,
    bloque_configs: [{ id: 'cfg-origen', slug: 'carta_autorizacion_generar', etapas_negocio: { linea_id: LINEA }, _embed: embed(CFG_ORIGEN, 'carta_autorizacion_generar', 6) }],
    negocios: [{ id: NEG, linea_id: LINEA, codigo: 'V0248', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg', metadata: {} }],
    workspaces: [{ id: WS, drive_folder_id: 'raiz' }],
    formulario_versiones: [],
    profiles: [],
  }
}

const fila = (id: string) => escenario.tablas.negocio_bloques.find(f => f.id === id)!

beforeEach(() => {
  efectos.subcarpetas = []
  efectos.nombres = []
  efectos.guardSobre = []
  subidas = 0
})

describe('generar la carta desde la copia de Cita', () => {
  it('sin PDF: queda UNA fila con drive_url, la del origen; la copia sigue vacía', async () => {
    montar()
    const r = await generarFormulario(COPIA, NEG)
    expect(r).toMatchObject({ success: true, version_n: 1 })

    expect(fila(ORIGEN)).toMatchObject({ estado: 'completo', data: { drive_url: expect.stringContaining('drv-1'), version_actual: 1 } })
    expect(fila(COPIA).data).toEqual({})
    expect(fila(COPIA).estado).toBe('pendiente')
    // La configuración es la del origen: carpeta «2. Comercial» y nombre del origen.
    expect(efectos.subcarpetas).toEqual(['2. Comercial'])
    expect(efectos.nombres).toEqual(['009_CARTA_AUTORIZACION.pdf'])
    // La versión cuelga del origen: una sola serie, se mire desde donde se mire.
    expect(escenario.tablas.formulario_versiones).toEqual([
      expect.objectContaining({ negocio_bloque_id: ORIGEN, version_n: 1 }),
    ])
    // El permiso se mide donde el usuario trabaja: la copia (Cita), no Documentación.
    expect(efectos.guardSobre).toEqual([COPIA])
  })

  it('con PDF ya generado: regenera sobre el origen como versión siguiente', async () => {
    montar({ origen: filaOrigen({ drive_url: 'https://drive/v1', version_actual: 1 }) })
    escenario.tablas.formulario_versiones.push({ negocio_bloque_id: ORIGEN, version_n: 1, drive_url: 'https://drive/v1', generated_at: '2026-10-08T10:00:00Z', generated_by: null })

    const r = await generarFormulario(COPIA, NEG)
    expect(r).toMatchObject({ success: true, version_n: 2 })
    expect(fila(ORIGEN).data).toMatchObject({ version_actual: 2, drive_url: expect.stringContaining('drv-1') })
    expect(fila(COPIA).data).toEqual({})
    expect(escenario.tablas.formulario_versiones.map(v => [v.negocio_bloque_id, v.version_n]))
      .toEqual([[ORIGEN, 1], [ORIGEN, 2]])
  })

  it('sin RUT del segundo titular: el mismo mensaje del origen y nada escrito', async () => {
    montar({ rut2: {} })
    const r = await generarFormulario(COPIA, NEG)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Falta cargar antes: RUT del segundo solicitante')
    expect(fila(ORIGEN).data).toEqual({})
    expect(escenario.tablas.formulario_versiones).toEqual([])
    expect(efectos.nombres).toEqual([])
  })

  it('el caso que nunca tuvo la fila del origen: se crea y se escribe ahí, nunca en la copia', async () => {
    montar({ origen: null })
    const r = await generarFormulario(COPIA, NEG)
    expect(r.success).toBe(true)
    expect(fila(ORIGEN)).toMatchObject({ bloque_config_id: 'cfg-origen', estado: 'completo' })
    expect(fila(COPIA).data).toEqual({})
  })

  it('las casillas editadas desde la copia quedan en el origen y salen en el PDF', async () => {
    montar()
    expect(await guardarFormularioOverrides(COPIA, { autorizante_nombre: 'ANA PÉREZ' })).toEqual({ error: null })
    expect(fila(ORIGEN).data).toEqual({ campos_override: { autorizante_nombre: 'ANA PÉREZ' } })
    expect(fila(COPIA).data).toEqual({})
    const r = await generarFormulario(COPIA, NEG)
    expect(r.campos_usados).toMatchObject({ autorizante_nombre: 'ANA PÉREZ' })
  })

  it('la lectura para editar trae las versiones del origen', async () => {
    montar({ origen: filaOrigen({ drive_url: 'https://drive/v1', version_actual: 1 }) })
    escenario.tablas.formulario_versiones.push({ negocio_bloque_id: ORIGEN, version_n: 1, drive_url: 'https://drive/v1', generated_at: '2026-10-08T10:00:00Z', generated_by: null })
    const r = await resolverFormularioParaEdicion(COPIA, NEG)
    expect(r.error).toBeUndefined()
    expect(r.versiones.map(v => v.version_n)).toEqual([1])
  })

  it('la lectura sin fila de origen no crea nada: responde vacío y generar la creará', async () => {
    montar({ origen: null })
    const r = await resolverFormularioParaEdicion(COPIA, NEG)
    expect(r).toEqual({ casillas: [], versiones: [] })
    expect(escenario.tablas.negocio_bloques.some(f => f.id === ORIGEN)).toBe(false)
  })
})

describe('las otras cuatro copias siguen de solo lectura', () => {
  it('sin `genera_en_origen` la copia no genera ni edita casillas, y no escribe nada', async () => {
    montar({ copia: filaCopia(CFG_COPIA_LECTURA) })
    const r = await generarFormulario(COPIA, NEG)
    expect(r).toMatchObject({ success: false, error: expect.stringContaining('copia de solo lectura de la etapa 6') })
    expect(await guardarFormularioOverrides(COPIA, { x: 'y' })).toEqual({ error: expect.stringContaining('solo lectura') })
    expect((await resolverFormularioParaEdicion(COPIA, NEG)).error).toContain('solo lectura')
    expect(fila(ORIGEN).data).toEqual({})
    expect(fila(COPIA).data).toEqual({})
    expect(escenario.tablas.formulario_versiones).toEqual([])
  })

  it('ninguna otra escritura (datos, documentos) cae en el origen por esta puerta', async () => {
    montar()
    // `actualizarBloqueData` y compañía resuelven con `resolverDestinoCompartido`, sin
    // `generaEnOrigen`: la copia generable se queda en su fila (y documento la rechaza).
    expect(await resolverDestinoCompartido(cliente(), COPIA)).toBe(COPIA)
  })

  it('la copia generable sigue sin recibir archivos: para documentos es de solo lectura', () => {
    expect(copiaDeSoloLectura(CFG_COPIA_CITA)).toBe(true)
  })
})

describe('el formulario de origen no cambia', () => {
  it('generar en Documentación escribe en su propia fila', async () => {
    montar()
    const r = await generarFormulario(ORIGEN, NEG)
    expect(r.success).toBe(true)
    expect(efectos.guardSobre).toEqual([ORIGEN])
    expect(fila(ORIGEN).data).toMatchObject({ version_actual: 1 })
  })
})

describe('condición copropiedad', () => {
  it('la copia generable solo aplica en copropiedad', () => {
    const fuentes = (modalidad: string) => ({ porSlug: { titularidad: { modalidad_solicitante: modalidad } }, porEtapaOrden: {} })
    expect(cumpleCondicion(CFG_COPIA_CITA.condition, fuentes('copropiedad'))).toBe(true)
    expect(cumpleCondicion(CFG_COPIA_CITA.condition, fuentes('individual'))).toBe(false)
  })
})
