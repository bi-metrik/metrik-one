// ============================================================
// Aviso de sobrepago al área financiera — la ejecución.
//
// Las reglas (qué es sobrepago, config, idempotencia, texto) viven en
// `aviso-sobrepago.ts`, puras y probadas. Aquí solo se resuelven contra la base y se
// envían.
//
// ── Por qué una función llamada desde el código y no un trigger ────────────────
//
// El sobrepago lo decide `descuadreConciliacion`, que vive en TypeScript y depende del
// modelo de dinero (tarifa confirmada, recaudo confirmado). Un trigger en SQL tendría
// que reescribir esa resta, y una segunda vara para la misma plata es el error que este
// repo ya pagó siete veces. Hermana de `alRegistrarCobro` (`siigo/recibo-automatico.ts`) por la misma razón.
//
// ── Desde dónde se llama ─────────────────────────────────────────────────────
//
//   · el AVANCE de etapa (`cambiarEtapaNegocioConGate`), que es la red de seguridad: todo
//     caso que salta una etapa de cobro con saldo a favor pasa por ahí en esa misma
//     llamada, venga la plata por donde venga;
//   · los caminos que meten plata al negocio, para que el aviso llegue cuando entra el
//     pago y no cuando alguien lo mueve: `registrarPagoEnNegocio` (FAB y pago fuera de
//     ePayco de Tesorería), `registrarPagoEpayco`, `registrarPagoExterno`,
//     `aceptarRepartoComercial` y `reevaluarBloquesCobros` (auto-cobros del bloque,
//     confirmar pago, cambio de precio, anulación y redistribución).
//
// No duplica: la clave del aviso es la misma venga de donde venga.
//
// ⚠️ NUNCA lanza y NUNCA devuelve error. Registrar el pago o mover el caso es lo que la
// persona pidió; el aviso es una consecuencia, y no puede frenar ni ensuciar nada.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { tarifaConfirmadaPorNegocio, type FilaBloqueTarifa } from '@/lib/upme/modelo-dinero'
import type { CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import {
  configAvisoSobrepago,
  contenidoAvisoSobrepago,
  correoAvisoSobrepago,
  excesoParaAviso,
  planAvisoSobrepago,
  prefijoAvisoSobrepago,
  ENLACE_SOBRANTES,
  type AvisoPrevio,
} from './aviso-sobrepago'

const FROM = 'MéTRIK ONE <noreply@metrikone.co>'

/** Tipo de notificación. Ya está en el CHECK de `notificaciones.tipo`. */
const TIPO_NOTIFICACION = 'conciliacion_solicitada'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

interface NegocioAviso {
  id: string
  codigo: string | null
  nombre: string | null
  precio_aprobado: number | null
  precio_estimado: number | null
  lineas_negocio: { config_extra: Record<string, unknown> | null } | null
  workspaces: { slug: string | null; config_extra: Record<string, unknown> | null } | null
}

/** Qué pasó, para las pruebas y el log. Quien llama no necesita leerlo. */
export type ResultadoAvisoSobrepago =
  | { avisado: false; motivo: 'sin_datos' | 'apagado' | 'sin_sobrepago' | 'ya_avisado' | 'sin_destinatarios' | 'error' }
  | { avisado: true; exceso: number; areas: string[]; correos: number }

/**
 * Avisa al área financiera si el negocio quedó con sobrepago y todavía no se le avisó
 * por ese monto. Silenciosa: un workspace sin `aviso_sobrepago` no paga más que una
 * lectura.
 */
export async function avisarSobrepagoSiCorresponde(
  workspaceId: string | null | undefined,
  negocioId: string | null | undefined,
): Promise<ResultadoAvisoSobrepago> {
  if (!workspaceId || !negocioId) return { avisado: false, motivo: 'sin_datos' }
  try {
    const svc = createServiceClient()

    // Una sola lectura decide si el resto vale la pena: la config viaja con el negocio.
    const { data: negRaw } = await db(svc)
      .from('negocios')
      .select(`
        id, codigo, nombre, precio_aprobado, precio_estimado,
        lineas_negocio:linea_id ( config_extra ),
        workspaces:workspace_id ( slug, config_extra )
      `)
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const neg = negRaw as NegocioAviso | null
    if (!neg) return { avisado: false, motivo: 'sin_datos' }

    const cfg = configAvisoSobrepago(neg.lineas_negocio?.config_extra, neg.workspaces?.config_extra)
    if (!cfg) return { avisado: false, motivo: 'apagado' }

    // Las mismas lecturas que el panel de Tesorería hace por lote, acotadas a un negocio.
    const [cobrosRes, concRes, tarifasRes, serviciosRes] = await Promise.all([
      db(svc).from('cobros').select('monto, tipo_cobro, split_json')
        .eq('workspace_id', workspaceId).eq('negocio_id', negocioId),
      db(svc).from('negocio_conciliacion').select('conciliado')
        .eq('workspace_id', workspaceId).eq('negocio_id', negocioId).maybeSingle(),
      db(svc).from('negocio_bloques').select('negocio_id, data, bloque_configs!inner(config_extra)')
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.config_extra->tarifa_confirmacion->>enabled', 'true'),
      db(svc).from('negocio_bloques').select('negocio_id, data, bloque_configs!inner(slug)')
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.slug', 'servicio_contratado'),
    ])
    // Sin poder leer la plata no se afirma nada: un aviso con una cifra a medias es peor
    // que no avisar, y la próxima llamada lo vuelve a intentar.
    if (cobrosRes.error || concRes.error || tarifasRes.error || serviciosRes.error) {
      console.error('[aviso-sobrepago] no se pudo leer el recaudo de', negocioId)
      return { avisado: false, motivo: 'error' }
    }

    const tarifa = tarifaConfirmadaPorNegocio(
      (tarifasRes.data ?? []) as FilaBloqueTarifa[],
      (serviciosRes.data ?? []) as FilaBloqueTarifa[],
    ).get(negocioId) ?? 0

    const exceso = excesoParaAviso({
      honorario: neg.precio_aprobado ?? neg.precio_estimado ?? 0,
      tarifaConfirmada: tarifa,
      cobros: (cobrosRes.data ?? []) as CobroParaRecaudo[],
      conciliado: (concRes.data as { conciliado: boolean } | null)?.conciliado === true,
    })
    if (exceso <= 0) return { avisado: false, motivo: 'sin_sobrepago' }

    // Idempotencia: lo ya avisado en CUALQUIER estado, no solo lo pendiente.
    const { data: previosRaw, error: previosErr } = await db(svc)
      .from('notificaciones')
      .select('grupo_clave, estado')
      .eq('workspace_id', workspaceId)
      .like('grupo_clave', `${prefijoAvisoSobrepago(negocioId)}%`)
    if (previosErr) {
      console.error('[aviso-sobrepago] no se pudo leer lo ya avisado de', negocioId, previosErr.message)
      return { avisado: false, motivo: 'error' }
    }

    const plan = planAvisoSobrepago({
      negocioId,
      exceso,
      areas: cfg.areas,
      previos: (previosRaw ?? []) as AvisoPrevio[],
    })
    if (plan.crear.length === 0) return { avisado: false, motivo: 'ya_avisado' }

    // Un monto anterior que seguía abierto se retira: no puede haber dos cifras vivas
    // para el mismo caso en la campana.
    for (const clave of plan.retirar) {
      await db(svc).rpc('resolver_grupo_notificaciones', {
        p_workspace_id: workspaceId,
        p_grupo_clave: clave,
        p_resuelta_por: null,
      })
    }

    const contenido = contenidoAvisoSobrepago(neg, exceso)
    const creadas: Array<{ area: string; clave: string }> = []
    for (const c of plan.crear) {
      const { data: n, error } = await db(svc).rpc('crear_notificacion_equipo', {
        p_workspace_id: workspaceId,
        p_area: c.area,
        p_tipo: TIPO_NOTIFICACION,
        p_contenido: contenido,
        p_grupo_clave: c.clave,
        p_entidad_tipo: null,
        p_entidad_id: null,
        p_deep_link: ENLACE_SOBRANTES,
        p_metadata: { negocio_id: negocioId, codigo: neg.codigo, exceso, via: 'aviso_sobrepago' },
        p_excluir_profile_id: null,
      })
      if (error) {
        console.error('[aviso-sobrepago] no se pudo crear el aviso', c.clave, error.message)
        continue
      }
      // Un área sin nadie no crea filas: sin fila no hay aviso, y la próxima llamada lo
      // vuelve a intentar cuando el área tenga gente.
      if (Number(n) > 0) creadas.push(c)
    }
    if (creadas.length === 0) return { avisado: false, motivo: 'sin_destinatarios' }

    let correos = 0
    if (cfg.email) {
      correos = await enviarCorreo(svc, workspaceId, creadas.map((c) => c.clave), {
        negocio: neg,
        exceso,
        workspaceSlug: neg.workspaces?.slug ?? '',
      })
    }

    return { avisado: true, exceso, areas: creadas.map((c) => c.area), correos }
  } catch (e) {
    console.error('[aviso-sobrepago] falló para el negocio', negocioId, (e as Error).message)
    return { avisado: false, motivo: 'error' }
  }
}

/**
 * El correo va a las MISMAS personas que recibieron la campana: se leen de las filas que
 * `crear_notificacion_equipo` acaba de escribir, no se vuelven a resolver por área. Dos
 * resoluciones separadas son justo como la campana le llega a unos y el correo a otros.
 */
async function enviarCorreo(
  svc: unknown,
  workspaceId: string,
  claves: string[],
  datos: { negocio: NegocioAviso; exceso: number; workspaceSlug: string },
): Promise<number> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.error('[aviso-sobrepago] RESEND_API_KEY no configurada: la campana salió, el correo no')
    return 0
  }
  if (!datos.workspaceSlug) return 0

  const { data: filas } = await db(svc)
    .from('notificaciones')
    .select('destinatario_id')
    .eq('workspace_id', workspaceId)
    .in('grupo_clave', claves)
  const perfiles = [...new Set(((filas ?? []) as Array<{ destinatario_id: string | null }>)
    .map((f) => f.destinatario_id)
    .filter((id): id is string => !!id))]

  const destinatarios: string[] = []
  for (const pid of perfiles) {
    const { data: u } = await db(svc).auth.admin.getUserById(pid)
    const email = u?.user?.email as string | undefined
    if (email) destinatarios.push(email)
  }
  if (destinatarios.length === 0) return 0

  const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  const { asunto, html } = correoAvisoSobrepago({
    negocio: datos.negocio,
    exceso: datos.exceso,
    workspaceSlug: datos.workspaceSlug,
    baseDomain,
  })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: destinatarios, subject: asunto, html }),
  })
  if (!res.ok) {
    // La campana ya salió y no se repite: el aviso existe aunque el correo falle.
    console.error('[aviso-sobrepago] Resend falló:', res.status, await res.text().catch(() => ''))
    return 0
  }
  return destinatarios.length
}
