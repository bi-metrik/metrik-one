/**
 * El aviso de factura cargada, contra la base. Las reglas viven en `aviso-factura-cuota.ts`.
 *
 * Sin `'use server'` a propósito: recibe el espacio cobrador por parámetro y no valida rol, así que no
 * puede ser un endpoint. La llama `cargarFacturaCuota` DESPUÉS de registrar la factura, que ya pasó
 * sus barreras (dueño o administrador, cuota de un contrato cobrado por ese espacio).
 *
 * ⚠️ NUNCA lanza. La factura ya quedó cargada y el cliente ya la puede descargar; un aviso que no sale
 * se registra en el log y no deshace la carga (mismo criterio que `confirmar-cobro-programado`).
 */

import type { Ancla } from '@/lib/suscripciones-producto/ancla'
import { filtrarPorAncla } from '@/lib/suscripciones-producto/ancla'
import {
  ENLACE_PAGOS,
  TIPO_AVISO_FACTURA,
  contenidoAvisoFactura,
  destinatariosAvisoFactura,
  elegirContrato,
  grupoClaveFactura,
  planAvisoFactura,
  type ContratoAviso,
  type PendientePrevio,
} from './aviso-factura-cuota'

export type ResultadoAvisoFactura =
  | { avisado: false; motivo: 'sin_contrato' | 'sin_pagador' | 'sin_destinatarios' | 'error' }
  | { avisado: true; workspacePagadorId: string; creadas: number; actualizadas: number }

export async function avisarFacturaCargada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  p: {
    /** El espacio que cobra y carga la factura (el de la sesión). */
    workspaceCobradorId: string
    ancla: Ancla
    cuotaId: string
    numeroCuota: number | string | null
    numeroFactura: string
    /** Ya había factura para la cuota: el texto dice «se actualizó». */
    reemplazo: boolean
  },
): Promise<ResultadoAvisoFactura> {
  try {
    // `aceptante_designado_id` y `workspace_pagador_id` no están en `database.ts`: cliente sin tipos.
    const contratos = await filtrarPorAncla(
      svc
        .from('servicios_contratados')
        .select('id, estado, vigente_desde, workspace_pagador_id, aceptante_designado_id'),
      p.ancla,
    ).eq('workspace_id', p.workspaceCobradorId)
    if (contratos.error) {
      console.error('[aviso-factura] no se pudo leer el contrato de la cuota', p.cuotaId, contratos.error.message)
      return { avisado: false, motivo: 'error' }
    }
    const contrato = elegirContrato((contratos.data ?? []) as ContratoAviso[])
    if (!contrato) return { avisado: false, motivo: 'sin_contrato' }
    const pagador = contrato.workspace_pagador_id
    if (!pagador) {
      console.error('[aviso-factura] el contrato no tiene espacio pagador', contrato.id)
      return { avisado: false, motivo: 'sin_pagador' }
    }
    const destinatarios = destinatariosAvisoFactura(contrato)
    if (destinatarios.length === 0) {
      console.error('[aviso-factura] el contrato no tiene persona designada a quien avisar', contrato.id)
      return { avisado: false, motivo: 'sin_destinatarios' }
    }

    const grupo = grupoClaveFactura(p.cuotaId)
    const pendientes = await svc
      .from('notificaciones')
      .select('id, destinatario_id')
      .eq('workspace_id', pagador)
      .eq('grupo_clave', grupo)
      .eq('estado', 'pendiente')
    if (pendientes.error) {
      // Sin saber si ya hay uno pendiente no se crea otro: un aviso duplicado en la campana del
      // cliente se ve peor que uno que no llega (la factura igual está en Pagos).
      console.error('[aviso-factura] no se pudo leer el aviso previo', grupo, pendientes.error.message)
      return { avisado: false, motivo: 'error' }
    }
    const plan = planAvisoFactura(destinatarios, (pendientes.data ?? []) as PendientePrevio[])

    const contenido = contenidoAvisoFactura({
      numeroFactura: p.numeroFactura,
      numeroCuota: p.numeroCuota,
      reemplazo: p.reemplazo,
    })
    const metadata = {
      cuota_id: p.cuotaId,
      numero_cuota: p.numeroCuota,
      numero_factura: p.numeroFactura,
      servicio_contratado_id: contrato.id,
      via: 'factura_cuota',
    }

    let actualizadas = 0
    if (plan.actualizar.length > 0) {
      const upd = await svc
        .from('notificaciones')
        .update({ contenido, metadata, deep_link: ENLACE_PAGOS, updated_at: new Date().toISOString() })
        .in('id', plan.actualizar)
        .eq('estado', 'pendiente')
      if (upd.error) console.error('[aviso-factura] no se pudo actualizar el aviso', grupo, upd.error.message)
      else actualizadas = plan.actualizar.length
    }

    let creadas = 0
    if (plan.crear.length > 0) {
      const filas = plan.crear.map((destinatarioId) => ({
        workspace_id: pagador,
        destinatario_id: destinatarioId,
        tipo: TIPO_AVISO_FACTURA,
        estado: 'pendiente',
        contenido,
        // La cuota y el contrato son del espacio cobrador: no hay entidad del pagador que abrir.
        entidad_tipo: null,
        entidad_id: null,
        deep_link: ENLACE_PAGOS,
        grupo_clave: grupo,
        metadata,
      }))
      const ins = await svc.from('notificaciones').insert(filas)
      if (ins.error) console.error('[aviso-factura] no se pudo crear el aviso', grupo, ins.error.message)
      else creadas = filas.length
    }

    if (creadas + actualizadas === 0) return { avisado: false, motivo: 'error' }
    return { avisado: true, workspacePagadorId: pagador, creadas, actualizadas }
  } catch (e) {
    console.error('[aviso-factura] falló para la cuota', p.cuotaId, (e as Error).message)
    return { avisado: false, motivo: 'error' }
  }
}
