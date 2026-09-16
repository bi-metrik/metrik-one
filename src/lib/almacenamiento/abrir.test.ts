import { describe, expect, it } from 'vitest'
import { resolverAccesoNegocio, resolverApertura, type DependenciasApertura } from './abrir'
import { ErrorAlmacenamiento } from './config'

const WS_TRAPPVEL = 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc'
const WS_SOENA = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG_TRAPPVEL = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const REF = `sbext://one-documentos/negocios/${NEG_TRAPPVEL}/5-documentos-del-viajero/pasaporte-y-visado.pdf`

/** Doble que APLICA la pertenencia negocio → workspace, no la afirma. */
function deps(over: Partial<DependenciasApertura> & { sesion?: string | null; externo?: boolean } = {}) {
  const firmadas: Array<{ ws: string; ref: string; descargar: boolean }> = []
  const d: DependenciasApertura = {
    workspaceDeSesion: async () => (over.sesion === undefined ? WS_TRAPPVEL : over.sesion),
    negocioEsDelWorkspace: async (neg, ws) => neg === NEG_TRAPPVEL && ws === WS_TRAPPVEL,
    puedeVerNegocio: async () => true,
    firmar: async (ws, ref, o) => {
      firmadas.push({ ws, ref, descargar: o.descargar })
      return over.externo === false ? null : 'https://yodndfclcbcgyqsoauwa.supabase.co/storage/v1/object/sign/x?token=t'
    },
    ...over,
  }
  return { d, firmadas }
}

describe('resolverApertura', () => {
  it('usuario del workspace: firma y redirige', async () => {
    const { d, firmadas } = deps()
    const r = await resolverApertura(REF, false, d)
    expect(r).toEqual({ tipo: 'redirigir', url: expect.stringContaining('/object/sign/') })
    expect(firmadas).toEqual([{ ws: WS_TRAPPVEL, ref: REF, descargar: false }])
  })

  it('pasa la intención de descarga a la firma', async () => {
    const { d, firmadas } = deps()
    await resolverApertura(REF, true, d)
    expect(firmadas[0].descargar).toBe(true)
  })

  it('usuario de OTRO workspace con la referencia: 404 y no se firma nada', async () => {
    const { d, firmadas } = deps({ sesion: WS_SOENA })
    const r = await resolverApertura(REF, false, d)
    expect(r).toMatchObject({ tipo: 'error', status: 404 })
    expect(firmadas).toHaveLength(0)
  })

  it('sin sesión: 401 y no se firma nada', async () => {
    const { d, firmadas } = deps({ sesion: null })
    expect(await resolverApertura(REF, false, d)).toMatchObject({ tipo: 'error', status: 401 })
    expect(firmadas).toHaveLength(0)
  })

  it('del workspace pero sin permiso sobre el negocio (operator ajeno): 403', async () => {
    const { d, firmadas } = deps({ puedeVerNegocio: async () => false })
    expect(await resolverApertura(REF, false, d)).toMatchObject({ tipo: 'error', status: 403 })
    expect(firmadas).toHaveLength(0)
  })

  it('referencia mal formada, de otro bucket o fuera de negocios: 400', async () => {
    const { d, firmadas } = deps()
    for (const mala of [
      null,
      'https://drive.google.com/file/d/x',
      `sbext://ve-documentos/negocios/${NEG_TRAPPVEL}/a.pdf`,
      `sbext://one-documentos/negocios/${NEG_TRAPPVEL}/../otro/a.pdf`,
      'sbext://one-documentos/otra-cosa/a.pdf',
    ]) {
      expect(await resolverApertura(mala, false, d)).toMatchObject({ tipo: 'error', status: 400 })
    }
    expect(firmadas).toHaveLength(0)
  })

  it('workspace en Drive: 404 (el endpoint no abre nada fuera del almacenamiento externo)', async () => {
    const { d } = deps({ externo: false })
    expect(await resolverApertura(REF, false, d)).toMatchObject({ tipo: 'error', status: 404 })
  })

  it('falta la variable de entorno: 503 con el mensaje que dice qué falta', async () => {
    const { d } = deps({
      firmar: async () => {
        throw new ErrorAlmacenamiento('Workspace trappvel: falta la variable de entorno WS_STORAGE_SECRET_TRAPPVEL.')
      },
    })
    const r = await resolverApertura(REF, false, d)
    expect(r).toMatchObject({ tipo: 'error', status: 503 })
    expect(r.tipo === 'error' && r.mensaje).toContain('WS_STORAGE_SECRET_TRAPPVEL')
  })

  it('el objeto no existe en el bucket: 404 genérico', async () => {
    const { d } = deps({ firmar: async () => { throw new Error('Object not found') } })
    expect(await resolverApertura(REF, false, d)).toMatchObject({ tipo: 'error', status: 404 })
  })
})

// ── Buckets del propio proyecto de ONE (`one://`) ────────────────────────────
//
// La ruta trae el workspace, así que la puerta lo compara en vez de resolverlo. Lo que
// estas pruebas fijan es que ese atajo NO afloje nada: un archivo de otro workspace
// sigue siendo 404 y un documento de negocio sigue pasando por `puedeVerNegocio`.

const NEG_SOENA = '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const DOC_ONE = `one://ve-documentos/${WS_SOENA}/negocios/${NEG_SOENA}/11111111-2222-4333-8444-555555555555/factura.pdf`
const GASTO_ONE = `one://gastos-soportes/${WS_SOENA}/55555555-6666-4777-8888-999999999999.jpg`
const PAGO_ONE = `one://ve-documentos/${WS_SOENA}/pagos-externos/22222222-3333-4444-8555-666666666666.pdf`

/** Doble para el workspace de SOENA, que es el dueño de las rutas `one://` de arriba. */
function depsOne(over: Partial<DependenciasApertura> & { sesion?: string | null } = {}) {
  const firmadas: string[] = []
  const d: DependenciasApertura = {
    workspaceDeSesion: async () => (over.sesion === undefined ? WS_SOENA : over.sesion),
    negocioEsDelWorkspace: async (neg, ws) => neg === NEG_SOENA && ws === WS_SOENA,
    puedeVerNegocio: async () => true,
    firmar: async (_ws, ref) => {
      firmadas.push(ref)
      return 'https://yfjqscvvxetobiidnepa.supabase.co/storage/v1/object/sign/x?token=t'
    },
    ...over,
  }
  return { d, firmadas }
}

describe('resolverApertura sobre los buckets de ONE', () => {
  it('soporte de gasto del propio workspace: firma sin preguntar por ningún negocio', async () => {
    let preguntado = false
    const { d, firmadas } = depsOne({
      puedeVerNegocio: async () => { preguntado = true; return true },
      negocioEsDelWorkspace: async () => { preguntado = true; return true },
    })
    expect(await resolverApertura(GASTO_ONE, false, d)).toMatchObject({ tipo: 'redirigir' })
    expect(firmadas).toEqual([GASTO_ONE])
    // Un gasto puede no tener negocio (gasto de empresa, gasto fijo): si la puerta del
    // negocio corriera aquí, esos comprobantes quedarían inabribles para siempre.
    expect(preguntado).toBe(false)
  })

  it('soporte de pago: mismo trato que el del gasto', async () => {
    const { d, firmadas } = depsOne()
    expect(await resolverApertura(PAGO_ONE, false, d)).toMatchObject({ tipo: 'redirigir' })
    expect(firmadas).toEqual([PAGO_ONE])
  })

  it('soporte de gasto de OTRO workspace: 404 y no se firma nada', async () => {
    const { d, firmadas } = depsOne({ sesion: WS_TRAPPVEL })
    expect(await resolverApertura(GASTO_ONE, false, d)).toMatchObject({ tipo: 'error', status: 404 })
    expect(firmadas).toHaveLength(0)
  })

  it('sin sesión: 401, aunque la ruta diga de quién es el archivo', async () => {
    const { d, firmadas } = depsOne({ sesion: null })
    expect(await resolverApertura(GASTO_ONE, false, d)).toMatchObject({ tipo: 'error', status: 401 })
    expect(firmadas).toHaveLength(0)
  })

  it('documento de negocio: la puerta del negocio SÍ corre, igual que en Drive o en el proyecto del cliente', async () => {
    const { d, firmadas } = depsOne({ puedeVerNegocio: async () => false })
    expect(await resolverApertura(DOC_ONE, false, d)).toMatchObject({ tipo: 'error', status: 403 })
    expect(firmadas).toHaveLength(0)
  })

  it('documento de negocio con permiso: firma', async () => {
    const { d, firmadas } = depsOne()
    expect(await resolverApertura(DOC_ONE, false, d)).toMatchObject({ tipo: 'redirigir' })
    expect(firmadas).toEqual([DOC_ONE])
  })

  it('un negocio que no es del workspace de la ruta tampoco pasa', async () => {
    const { d, firmadas } = depsOne({ negocioEsDelWorkspace: async () => false })
    expect(await resolverApertura(DOC_ONE, false, d)).toMatchObject({ tipo: 'error', status: 404 })
    expect(firmadas).toHaveLength(0)
  })

  it('bucket de ONE fuera de la lista, o ruta sin workspace: 400', async () => {
    const { d, firmadas } = depsOne()
    for (const mala of [
      `one://cert-databooks/${WS_SOENA}/a.pdf`,
      `one://workspace-logos/${WS_SOENA}/a.png`,
      'one://ve-documentos/publico/a.pdf',
      `one://ve-documentos/${WS_SOENA}`,
      `one://ve-documentos/${WS_SOENA}/../${WS_TRAPPVEL}/a.pdf`,
    ]) {
      expect(await resolverApertura(mala, false, d)).toMatchObject({ tipo: 'error', status: 400 })
    }
    expect(firmadas).toHaveLength(0)
  })

  it('una URL pública sin migrar NO entra por aquí: 400 (la pantalla la abre directo)', async () => {
    const { d } = depsOne()
    const publica = `https://x.supabase.co/storage/v1/object/public/gastos-soportes/${WS_SOENA}/a.jpg`
    expect(await resolverApertura(publica, false, d)).toMatchObject({ tipo: 'error', status: 400 })
  })
})

describe('resolverAccesoNegocio (la vista del repositorio usa las mismas puertas)', () => {
  it('del workspace y con permiso: ok con el workspace de la sesión', async () => {
    const { d } = deps()
    expect(await resolverAccesoNegocio(NEG_TRAPPVEL, d)).toEqual({ tipo: 'ok', workspaceId: WS_TRAPPVEL })
  })

  it('sin sesión: 401', async () => {
    const { d } = deps({ sesion: null })
    expect(await resolverAccesoNegocio(NEG_TRAPPVEL, d)).toMatchObject({ tipo: 'error', status: 401 })
  })

  it('negocio de otro workspace: 404, y no se pregunta el permiso', async () => {
    let preguntado = false
    const { d } = deps({ sesion: WS_SOENA, puedeVerNegocio: async () => { preguntado = true; return true } })
    expect(await resolverAccesoNegocio(NEG_TRAPPVEL, d)).toMatchObject({ tipo: 'error', status: 404 })
    expect(preguntado).toBe(false)
  })

  it('del workspace sin permiso sobre el negocio: 403', async () => {
    const { d } = deps({ puedeVerNegocio: async () => false })
    expect(await resolverAccesoNegocio(NEG_TRAPPVEL, d)).toMatchObject({ tipo: 'error', status: 403 })
  })
})
