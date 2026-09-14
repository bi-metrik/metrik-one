import { describe, expect, it } from 'vitest'
import { resolverApertura, type DependenciasApertura } from './abrir'
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
