import type { SupabaseClient } from '@supabase/supabase-js'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { COBRADOR_VALIDA, FICHA_PLAN_VALIDA } from './activacion'

/**
 * La suscripción de Valida EN PRUEBA (Mauricio, 2026-10-16): la fila de `suscripciones_producto` nace al
 * registrarse, con `estado = 'prueba'`, para que la sección Suscripción exista desde el primer día. La
 * activación (consulta 11, «Activar plan» o el día 7) pasa ESA fila a 'activa'
 * (`valida_activar_autogestion`, migración 20261016170000): nunca crea otra.
 *
 * Sin `server-only`: recibe el cliente de servicio (las pruebas lo importan directo) y no toca secretos.
 * Nunca lanza: una falla aquí no tumba el registro (la activación crea la fila si falta).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface RegistroParaSuscripcion {
  id: string
  usuario_id: string | null
  razon_social: string
  identificacion: string
  dv: string | null
  correo: string
  aceptado_at: string | null
  prueba_vence_en: string | null
  origen: string | null
  origen_fuente: string | null
  metodo_pago_estado: string | null
  metodo_pago_ref: string | null
  slug_creado: string | null
}

const COLUMNAS =
  'id, usuario_id, razon_social, identificacion, dv, correo, aceptado_at, prueba_vence_en, origen, origen_fuente, metodo_pago_estado, metodo_pago_ref, slug_creado'

export type ResultadoSuscripcionPrueba =
  | { tipo: 'creada'; suscripcionId: string }
  | { tipo: 'ya_estaba'; suscripcionId: string }
  | { tipo: 'sin_registro' }
  | { tipo: 'error'; mensaje: string }

/** Idempotente: el segundo llamado (reintento de la prueba, doble envío) no crea otra fila. */
export async function asegurarSuscripcionEnPrueba(
  db: SupabaseClient | Db,
  p: { workspaceId: string; cobradorId?: string },
): Promise<ResultadoSuscripcionPrueba> {
  const svc = db as Db
  const cobrador = p.cobradorId ?? COBRADOR_VALIDA.workspaceId
  try {
    const reg = await svc.from('valida_registros').select(COLUMNAS).eq('workspace_id', p.workspaceId).eq('estado', 'creado').maybeSingle()
    if (reg.error) return { tipo: 'error', mensaje: `registro: ${reg.error.message}` }
    const r = reg.data as RegistroParaSuscripcion | null
    if (!r) return { tipo: 'sin_registro' }

    const viva = await svc
      .from('suscripciones_producto')
      .select('id, estado, prueba_hasta')
      .eq('workspace_id', cobrador)
      .eq('producto', 'valida')
      .eq('workspace_cliente_id', p.workspaceId)
      .neq('estado', 'cancelada')
      .maybeSingle()
    if (viva.error) return { tipo: 'error', mensaje: `suscripción: ${viva.error.message}` }
    if (viva.data) {
      const fila = viva.data as { id: string; estado: string; prueba_hasta: string | null }
      // La prueba se emitió después de crear la fila (reintento): se completa la fecha de fin.
      if (fila.estado === 'prueba' && !fila.prueba_hasta && r.prueba_vence_en) {
        await svc.from('suscripciones_producto').update({ prueba_hasta: r.prueba_vence_en }).eq('id', fila.id).eq('estado', 'prueba')
      }
      return { tipo: 'ya_estaba', suscripcionId: fila.id }
    }

    const conTarjeta = r.metodo_pago_estado === 'registrado' && (r.metodo_pago_ref ?? '').startsWith('epayco:')
    const nueva = await svc
      .from('suscripciones_producto')
      .insert({
        workspace_id: cobrador,
        producto: 'valida',
        workspace_cliente_id: p.workspaceId,
        nombre: `Valida — ${r.razon_social}`,
        razon_social: r.razon_social,
        tipo_documento: 'NIT',
        numero_documento: r.identificacion.replace(/\D/g, ''),
        dv: r.dv,
        correo_facturacion: r.correo,
        plan_slug: FICHA_PLAN_VALIDA,
        estado: 'prueba',
        prueba_desde: r.aceptado_at,
        prueba_hasta: r.prueba_vence_en,
        origen_comercial: r.origen,
        origen_fuente: r.origen_fuente,
        valida_registro_id: r.id,
        metodo_pago_pasarela: conTarjeta ? 'epayco' : null,
        metodo_pago_ref: conTarjeta ? r.metodo_pago_ref : null,
        metadata: { origen: 'valida_autogestion', workspace_one: r.slug_creado, fuente: 'registro autogestionado de Valida' },
        creado_por: r.usuario_id,
      })
      .select('id')
      .single()
    if (nueva.error) {
      // Dos registros a la vez: el índice de «una viva por espacio y producto» deja una sola.
      if (nueva.error.code === '23505') {
        const otra = await svc
          .from('suscripciones_producto')
          .select('id')
          .eq('workspace_cliente_id', p.workspaceId)
          .eq('producto', 'valida')
          .neq('estado', 'cancelada')
          .maybeSingle()
        if (otra.data?.id) return { tipo: 'ya_estaba', suscripcionId: otra.data.id as string }
      }
      return { tipo: 'error', mensaje: `crear: ${nueva.error.message}` }
    }
    const id = (nueva.data as { id: string }).id
    await anotarEnAncla(
      svc,
      {
        ancla: { tipo: 'suscripcion', id },
        workspaceId: cobrador,
        tipo: 'prueba',
        texto: `Prueba gratis de Valida abierta en el registro autogestionado (espacio ${r.slug_creado ?? p.workspaceId}): ${r.razon_social}, NIT ${r.identificacion}${r.dv ? `-${r.dv}` : ''}.`,
        datos: { valida_registro_id: r.id, con_tarjeta: conTarjeta },
        autorPerfilId: r.usuario_id,
      },
      'valida-registro',
    )
    return { tipo: 'creada', suscripcionId: id }
  } catch (e) {
    return { tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * «Cancelar prueba» también cierra la suscripción en prueba: la misma acción desde `/valida` y desde
 * `/suscripcion` (`cancelarCobroDelEspacio`). Las consultas que quedan siguen hasta el fin de la prueba;
 * la fila queda `cancelada` con el motivo. Nunca lanza.
 */
export async function cancelarSuscripcionEnPrueba(
  db: SupabaseClient | Db,
  p: { workspaceId: string; por: 'boton' | 'correo'; ahora: string; cobradorId?: string },
): Promise<void> {
  const svc = db as Db
  const cobrador = p.cobradorId ?? COBRADOR_VALIDA.workspaceId
  try {
    const u = await svc
      .from('suscripciones_producto')
      .update({
        estado: 'cancelada',
        cancelada_at: p.ahora,
        cancelacion_motivo: p.por === 'boton' ? 'Canceló la prueba con «Cancelar prueba».' : 'Canceló la prueba por correo.',
      })
      .eq('workspace_id', cobrador)
      .eq('producto', 'valida')
      .eq('workspace_cliente_id', p.workspaceId)
      .eq('estado', 'prueba')
      .select('id')
    if (u.error) {
      console.error('[valida-registro] cancelar la suscripción en prueba:', u.error.message)
      return
    }
    for (const f of (u.data ?? []) as { id: string }[]) {
      await anotarEnAncla(
        svc,
        { ancla: { tipo: 'suscripcion', id: f.id }, workspaceId: cobrador, tipo: 'prueba_cancelada', texto: 'Prueba cancelada: no se cobra nada y se pidió a ePayco borrar la tarjeta.', datos: { por: p.por } },
        'valida-registro',
      )
    }
  } catch (e) {
    console.error('[valida-registro] cancelar la suscripción en prueba:', e instanceof Error ? e.message : e)
  }
}
