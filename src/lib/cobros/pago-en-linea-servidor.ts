import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import type { EventoPasarela, PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { createServiceClient } from '@/lib/supabase/server'
import { confirmarPagoCobroProgramado } from './confirmar-cobro-programado'
import { procesarEventoPasarela, type CobroParaPago, type RepoPagoEnLinea } from './pago-en-linea'

/**
 * El lado de Supabase del pago en línea, y `atenderWebhookPasarela`: todo lo que una ruta de webhook
 * tiene que hacer. La ruta de cada pasarela queda en tres líneas (leer el cuerpo crudo, llamar,
 * responder), así que agregar ePayco es su adaptador y una ruta igual a la de Bold.
 *
 * Todo con el cliente de SERVICIO: el webhook no tiene sesión. Por eso cada lectura de un cobro exige
 * `tipo_cobro = 'programado'`, y la búsqueda por enlace solo mira cobros que tienen un enlace
 * cargado: el webhook no puede tocar un cobro cualquiera.
 *
 * `pasarela_eventos` es server-only (migración 20260924030000).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const COLUMNAS_COBRO = 'id, workspace_id, negocio_id, monto, retencion_iva, fecha, anulado_at, tipo_cobro, external_ref, notas, enlace_pago_url'

type FilaCobro = {
  id: string
  workspace_id: string
  negocio_id: string | null
  monto: number | string | null
  retencion_iva: number | string | null
  fecha: string | null
  anulado_at: string | null
  tipo_cobro: string | null
  external_ref: string | null
  notas: string | null
  enlace_pago_url: string | null
}

function aCobro(f: FilaCobro): CobroParaPago {
  return {
    id: f.id,
    workspaceId: f.workspace_id,
    negocioId: f.negocio_id,
    monto: Number(f.monto ?? 0),
    retencionIva: Number(f.retencion_iva ?? 0),
    fecha: f.fecha,
    anuladoAt: f.anulado_at,
    tipoCobro: f.tipo_cobro,
    externalRef: f.external_ref,
    notas: f.notas,
  }
}

/** `_` y `%` son comodines de LIKE: el id del enlace se escapa para que no empareje otra cosa. */
function patronLike(idEnlace: string): string {
  return `%${idEnlace.replace(/[\\%_]/g, (c) => `\\${c}`)}`
}

export function repoPagoEnLinea(dbCliente: SupabaseClient, pasarela: string, adapter: PasarelaAdapter): RepoPagoEnLinea {
  const db = dbCliente as Db
  return {
    pasarela,

    async registrarEvento(e: EventoPasarela) {
      const ins = await db.from('pasarela_eventos').insert({
        pasarela,
        evento_id: e.eventoId,
        tipo: e.tipoOriginal,
        transaccion_id: e.transaccionId,
        referencia: e.referencia,
        monto: e.monto,
        moneda: e.moneda,
        resultado: 'recibido',
        payload: e.crudo ?? {},
      })
      if (!ins.error) return { nuevo: true, resultadoPrevio: null }
      if (ins.error.code !== '23505') throw new Error(`registrar evento de ${pasarela}: ${ins.error.message}`)
      const previo = await db
        .from('pasarela_eventos')
        .select('resultado')
        .eq('pasarela', pasarela)
        .eq('evento_id', e.eventoId)
        .maybeSingle()
      if (previo.error) throw new Error(`leer evento de ${pasarela}: ${previo.error.message}`)
      return { nuevo: false, resultadoPrevio: (previo.data?.resultado as string | undefined) ?? null }
    },

    async cerrarEvento(eventoId, r) {
      const { error } = await db
        .from('pasarela_eventos')
        .update({
          resultado: r.resultado,
          detalle: r.detalle.slice(0, 1000),
          cobro_id: r.cobro?.id ?? null,
          workspace_id: r.cobro?.workspaceId ?? null,
          procesado_at: new Date().toISOString(),
        })
        .eq('pasarela', pasarela)
        .eq('evento_id', eventoId)
      if (error) throw new Error(`cerrar evento de ${pasarela}: ${error.message}`)
    },

    async cobroPorId(id) {
      const { data, error } = await db
        .from('cobros')
        .select(COLUMNAS_COBRO)
        .eq('id', id)
        .eq('tipo_cobro', 'programado')
        .maybeSingle()
      if (error) throw new Error(`leer cobro ${id}: ${error.message}`)
      return data ? aCobro(data as FilaCobro) : null
    },

    async cobrosPorIdEnlace(idEnlace) {
      if (!adapter.idEnlaceDeUrl) return []
      const porUrl = await db
        .from('cobros')
        .select(COLUMNAS_COBRO)
        .eq('tipo_cobro', 'programado')
        .not('enlace_pago_url', 'is', null)
        .like('enlace_pago_url', patronLike(idEnlace))
        .limit(5)
      if (porUrl.error) throw new Error(`buscar cobro por enlace: ${porUrl.error.message}`)
      // El LIKE es un primer filtro; manda que el adaptador reconozca ese id en la URL.
      const exactos = ((porUrl.data ?? []) as FilaCobro[]).filter((f) => adapter.idEnlaceDeUrl?.(f.enlace_pago_url) === idEnlace)
      return exactos.map(aCobro)
    },

    confirmarPago(c) {
      return confirmarPagoCobroProgramado(dbCliente, c)
    },

    async anotarEnNegocio(cobro, texto) {
      if (!cobro.negocioId) return
      await registrarActividad(
        dbCliente,
        {
          workspace_id: cobro.workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: cobro.negocioId,
          tipo: 'sistema',
          autor_id: null,
          // `activity_log.contenido` tiene CHECK de 280 caracteres.
          contenido: texto.slice(0, 280),
        },
        `webhook-${pasarela}`,
      )
    },
  }
}

/**
 * Lo que responde la ruta del webhook de una pasarela. Una vez verificada la firma, todo lo que no
 * sea un error de base responde 200, incluido lo que ONE ignora o deja para revisión: las pasarelas
 * reintentan cualquier otra cosa.
 */
export async function atenderWebhookPasarela(
  pasarela: string,
  cuerpoCrudo: string,
  cabeceras: Record<string, string | undefined>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const adapter = adapterPara(pasarela)
  if (!adapter?.verificarWebhook) {
    return { status: 404, body: { error: 'pasarela_sin_webhook' } }
  }
  const v = adapter.verificarWebhook(cuerpoCrudo, cabeceras)
  if (!v.ok) {
    if (v.motivo === 'no_configurado') {
      console.error(`[webhook-${pasarela}] sin llave configurada`)
      return { status: 503, body: { error: 'webhook_no_configurado' } }
    }
    if (v.motivo === 'cuerpo_invalido') return { status: 400, body: { error: 'cuerpo_invalido' } }
    console.warn(`[webhook-${pasarela}] ${v.motivo}`)
    return { status: 401, body: { error: v.motivo } }
  }

  try {
    const salida = await procesarEventoPasarela(
      v.evento,
      repoPagoEnLinea(createServiceClient(), pasarela, adapter),
      todayBogotaISO(),
    )
    if (salida.resultado === 'requiere_revision') console.warn(`[webhook-${pasarela}] revisar: ${salida.detalle}`)
    return { status: 200, body: { ok: true, resultado: salida.resultado } }
  } catch (e) {
    console.error(`[webhook-${pasarela}]`, (e as Error).message)
    return { status: 500, body: { error: 'error_interno' } }
  }
}
