'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_DOCUMENTOS_SERVICIO } from '@/lib/valida-api/recibo-manual'
import { esUuid } from '@/lib/valida-api/reglas'
import {
  numeroFacturaValido,
  problemaArchivoFactura,
  rutaFactura,
  type ClaseArchivoFactura,
} from '@/lib/valida-cda/factura-cuota'

/**
 * `cargarFacturaCuota`: MeTRIK sube la factura electrónica (PDF y XML) de una cuota de un contrato de
 * servicio, y el cliente pagador la descarga desde la pestaña Pagos de `/valida`.
 *
 * ⚠️ Es un endpoint alcanzable con cualquier id, aunque la pantalla solo lo ofrezca en la ficha del
 * negocio. Barreras, en orden:
 *
 *   1. Dueño o administrador del espacio de la sesión (la factura es un documento fiscal).
 *   2. La cuota es de ese espacio (`plan_cobro_cuotas.workspace_id`), su plan también, y el negocio
 *      del plan es un contrato de `servicios_contratados` COBRADO por ese espacio: solo el cobrador
 *      factura, y solo lo que el cliente puede ver por `mis_cuotas_de_servicio`. Todo se lee con el
 *      cliente de servicio, así que ese filtro es lo único que impide tocar la cuota de otro.
 *   3. Tipo, tamaño y CONTENIDO de cada archivo (`factura-cuota.ts`) antes de subir nada: el tipo que
 *      declara el navegador no prueba nada.
 *
 * Volver a cargar reemplaza la parte que se sube y conserva la otra (el XML puede llegar después del
 * PDF). El reemplazo queda en `activity_log` con el número; el archivo anterior se queda en el bucket
 * bajo su huella.
 */

export type ResultadoFacturaCuota = { ok: true; numero: string } | { ok: false; error: string }

/** Cuántos bytes del comienzo se miran para reconocer el contenido. */
const BYTES_CABECERA = 512

async function leerArchivo(valor: FormDataEntryValue | null): Promise<{ file: File; bytes: Buffer } | null> {
  if (!(valor instanceof File) || valor.size === 0) return null
  return { file: valor, bytes: Buffer.from(await valor.arrayBuffer()) }
}

export async function cargarFacturaCuota(formData: FormData): Promise<ResultadoFacturaCuota> {
  const { workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Solo el dueño y los administradores cargan facturas.' }
  }

  const cuotaId = String(formData.get('cuota_id') ?? '').trim()
  if (!esUuid(cuotaId)) return { ok: false, error: 'La cuota no es válida.' }
  const numero = numeroFacturaValido(String(formData.get('numero') ?? ''))
  if (!numero) return { ok: false, error: 'El número de la factura lleva letras, dígitos y guiones (hasta 40).' }

  const partes: { clase: ClaseArchivoFactura; file: File; bytes: Buffer }[] = []
  for (const clase of ['pdf', 'xml'] as const) {
    const archivo = await leerArchivo(formData.get(clase))
    if (!archivo) continue
    const problema = problemaArchivoFactura(clase, {
      nombre: archivo.file.name,
      tipo: archivo.file.type,
      tamano: archivo.file.size,
      cabecera: new Uint8Array(archivo.bytes.subarray(0, BYTES_CABECERA)),
    })
    if (problema) return { ok: false, error: problema }
    partes.push({ clase, ...archivo })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  const cuota = await svc
    .from('plan_cobro_cuotas')
    .select('id, numero, plan_cobro_id')
    .eq('id', cuotaId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (cuota.error) return { ok: false, error: `No se pudo leer la cuota: ${cuota.error.message}` }
  // Mismo mensaje si no existe o es de otro espacio: no se confirma un id ajeno.
  if (!cuota.data) return { ok: false, error: 'Cuota no encontrada.' }

  const plan = await svc
    .from('planes_cobro')
    .select('negocio_id')
    .eq('id', cuota.data.plan_cobro_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (plan.error || !plan.data) return { ok: false, error: 'Cuota no encontrada.' }
  const negocioId = plan.data.negocio_id as string

  const contrato = await svc
    .from('servicios_contratados')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)
    .limit(1)
  if (contrato.error) return { ok: false, error: `No se pudo leer el contrato: ${contrato.error.message}` }
  if ((contrato.data ?? []).length === 0) {
    return { ok: false, error: 'Esta cuota no es de un contrato de servicio: su factura no tiene dónde verla el cliente.' }
  }

  const previa = await svc
    .from('facturas_cuota')
    .select('id, numero, pdf_path, pdf_sha256, xml_path, xml_sha256')
    .eq('plan_cobro_cuota_id', cuotaId)
    .maybeSingle()
  if (previa.error) return { ok: false, error: `No se pudo leer la factura de la cuota: ${previa.error.message}` }
  if (partes.length === 0 && !previa.data) return { ok: false, error: 'Falta el PDF o el XML de la factura.' }

  const fila: Record<string, string | null> = {
    pdf_path: previa.data?.pdf_path ?? null,
    pdf_sha256: previa.data?.pdf_sha256 ?? null,
    xml_path: previa.data?.xml_path ?? null,
    xml_sha256: previa.data?.xml_sha256 ?? null,
  }
  for (const p of partes) {
    const sha256 = createHash('sha256').update(p.bytes).digest('hex')
    const ruta = rutaFactura(workspaceId, sha256, p.clase)
    const subida = await svc.storage.from(BUCKET_DOCUMENTOS_SERVICIO).upload(ruta, p.bytes, {
      contentType: p.clase === 'pdf' ? 'application/pdf' : 'application/xml',
      upsert: false,
    })
    // Por huella: si ya existe, es EL MISMO archivo, y reusarlo es correcto.
    if (subida.error && !/exists|duplicate/i.test(subida.error.message)) {
      return { ok: false, error: `No se pudo guardar el ${p.clase.toUpperCase()}: ${subida.error.message}` }
    }
    fila[`${p.clase}_path`] = ruta
    fila[`${p.clase}_sha256`] = sha256
  }

  const { user } = await getCachedUser()
  const escritura = await svc.from('facturas_cuota').upsert(
    {
      workspace_id: workspaceId,
      plan_cobro_cuota_id: cuotaId,
      numero,
      ...fila,
      cargada_por: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'plan_cobro_cuota_id' },
  )
  if (escritura.error) return { ok: false, error: `No se pudo registrar la factura: ${escritura.error.message}` }

  if (staffId) {
    const cargado = partes.map((p) => p.clase.toUpperCase()).join(' y ') || 'número'
    const verbo = previa.data ? 'actualizada' : 'cargada'
    await registrarActividad(
      svc,
      {
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'sistema',
        autor_id: staffId, // FK a staff(id), NO a profiles
        // `activity_log.contenido` tiene CHECK de 280 caracteres.
        contenido: `Factura ${numero} ${verbo} para la cuota ${cuota.data.numero} (${cargado}).`.slice(0, 280),
      },
      'cargarFacturaCuota',
    )
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true, numero }
}
