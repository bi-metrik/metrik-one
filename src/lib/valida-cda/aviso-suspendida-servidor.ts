import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import {
  asuntoCorreoSuspendida,
  htmlCorreoSuspendida,
  periodoEnLetrasConAnio,
  periodosQueSuspenden,
  textoCorreoSuspendida,
  type DatosAvisoSuspendida,
} from './aviso-suspendida'
import { cuotasConEstado, proximoPago, type CobroRecibido, type CuotaDeServicio } from './pago-pendiente'
import { TIPOS_CUOTA_SIN_MORA } from './plan-anual'
import { estadoMora, REGLA_MORA_CDA, SLUG_TERMINOS_CDA, vigenciaRestriccion, vigenciaTransicion } from './plazos'

/**
 * Paso 8d del cron `procesar-planes-cobro`: el correo del día en que un CDA entra en Suspendida por pago
 * (Términos del Plan CDA v1.5, 11.2; D6 y D8 del diseño del 4-nov-2026). Con el cliente de servicio.
 *
 * ## A quién se le mide
 *
 * A cada contrato `valida-cda-licencia` ACTIVO con negocio y con la v1.5 registrada y publicada (sin la
 * v1.5 no existe «Suspendida por pago»). La mora se mide con las MISMAS piezas que la puerta de Valida
 * (`proximoPago` sin las cuotas de usuarios adicionales, `estadoMora` con `REGLA_MORA_CDA`, la vigencia de
 * la v1.4 y la de la transición), sobre las mismas filas que leen `mis_cuotas_de_servicio` y
 * `mis_cobros_de_servicio`. Solo se avisa con el estado `restringido`: la pantalla y el correo no pueden
 * decir cosas distintas. Hoy (4-nov) ningún CDA puede estarlo antes del 6-dic (cláusula 11.7).
 *
 * ## A quién se le manda
 *
 * Los correos registrados (cláusula 15.1): el `email_fiscal` de la empresa del contrato y la persona
 * designada (`aceptante_designado_id`), sin repetir una dirección. Es el mismo criterio del correo del
 * aviso de la v1.5 (`scripts/valida-cda/aviso-terminos-v1-5.ts`).
 *
 * ## Una sola vez
 *
 * Por episodio de Suspendida: el asunto lleva la fecha de entrada, así que una fila en `avisos_cliente`
 * del mismo negocio, con el mismo asunto y el mismo destino, que no quedó `fallido`, ya es el aviso. Un
 * fallido se reintenta en la corrida siguiente. Además, cada envío lleva `Idempotency-Key` = contrato +
 * fecha de entrada + destino (Resend no lo duplica en 24 h) y el cron corre bajo su candado.
 *
 * Nunca lanza por un contrato: cada uno queda en el resumen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const SERVICIO_CDA = 'valida-cda-licencia'

export interface DepsAvisoSuspendida {
  db: SupabaseClient
  /** Hoy en Bogotá, 'YYYY-MM-DD'. */
  hoy: string
  ahoraISO?: string
  enviarCorreo: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  /** El correo de una persona (Auth). Por defecto, `auth.admin.getUserById`. */
  correoDePersona?: (profileId: string) => Promise<string | null>
  /** `/suscripcion?tab=pagos` en el subdominio del espacio del CDA. */
  urlPagos?: (slug: string) => string
}

export interface ResumenAvisoSuspendida {
  revisados: number
  suspendidos: number
  enviados: { servicioContratadoId: string; destino: string }[]
  yaAvisados: number
  omitidos: { servicioContratadoId: string; motivo: string }[]
  fallidos: { servicioContratadoId: string; destino: string | null; error: string }[]
}

function urlPagosPorDefecto(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/suscripcion?tab=pagos`
}

interface FilaContrato {
  id: string
  workspace_id: string
  workspace_pagador_id: string | null
  empresa_id: string | null
  negocio_id: string | null
  aceptante_designado_id: string | null
}

interface FilaCuota {
  id: string
  plan_cobro_id: string
  numero: number
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  concepto_detalle: string | null
}

interface FilaCobro {
  plan_cobro_id: string | null
  numero_cuota: number | null
  monto: number | string | null
  monto_anulado: number | string | null
  anulado_at: string | null
  fecha: string | null
  retencion_iva: number | string | null
  enlace_pago_url: string | null
  enlace_pago_expira: string | null
}

/** Las cuotas y lo recibido del contrato, con la forma de las RPC del cliente (`pago-servidor.ts`). */
async function cuentaDelContrato(
  db: Db,
  sc: FilaContrato,
): Promise<{ cuotas: CuotaDeServicio[]; cobros: CobroRecibido[]; tipos: Map<number, string> } | { error: string }> {
  const planes = await db.from('planes_cobro').select('id').eq('negocio_id', sc.negocio_id).eq('workspace_id', sc.workspace_id)
  if (planes.error) return { error: `planes: ${planes.error.message}` }
  const ids = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)
  const [cuotasR, cobrosR] = await Promise.all([
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from('plan_cobro_cuotas')
          .select('id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle')
          .in('plan_cobro_id', ids),
    db
      .from('cobros')
      .select('plan_cobro_id, numero_cuota, monto, monto_anulado, anulado_at, fecha, retencion_iva, enlace_pago_url, enlace_pago_expira')
      .eq('negocio_id', sc.negocio_id),
  ])
  if (cuotasR.error) return { error: `cuotas: ${cuotasR.error.message}` }
  if (cobrosR.error) return { error: `cobros: ${cobrosR.error.message}` }
  const cobros = (cobrosR.data ?? []) as FilaCobro[]
  const tipos = new Map<number, string>()
  const cuotas = ((cuotasR.data ?? []) as FilaCuota[]).map((q): CuotaDeServicio => {
    tipos.set(q.numero, q.tipo)
    // El enlace vive en el cobro programado de ESA cuota; uno anulado no ofrece enlace (como la RPC).
    const c = cobros.find((x) => x.plan_cobro_id === q.plan_cobro_id && x.numero_cuota === q.numero && !x.anulado_at)
    return {
      cuotaId: q.id,
      numero: q.numero,
      tipo: q.tipo,
      monto: Number(q.monto),
      fechaVencimiento: q.fecha_vencimiento,
      concepto: q.concepto_detalle,
      enlacePagoUrl: c?.enlace_pago_url ?? null,
      enlacePagoExpira: c?.enlace_pago_expira ?? null,
    }
  })
  return {
    cuotas,
    tipos,
    cobros: cobros.map(
      (c): CobroRecibido => ({
        // Un cobro anulado vale 0 en `monto` y su valor vive en `monto_anulado` (como la RPC); no cuenta igual.
        monto: Number((Number(c.monto) || 0) === 0 ? (c.monto_anulado ?? c.monto ?? 0) : c.monto),
        estado: c.anulado_at ? 'anulado' : c.fecha === null ? 'programado' : 'pagado',
        retencionIva: Number(c.retencion_iva ?? 0),
      }),
    ),
  }
}

export async function avisarSuspendidasPorPago(deps: DepsAvisoSuspendida): Promise<ResumenAvisoSuspendida> {
  const db = deps.db as Db
  const ahoraISO = deps.ahoraISO ?? new Date().toISOString()
  const resumen: ResumenAvisoSuspendida = { revisados: 0, suspendidos: 0, enviados: [], yaAvisados: 0, omitidos: [], fallidos: [] }

  const contratos = await db
    .from('servicios_contratados')
    .select('id, workspace_id, workspace_pagador_id, empresa_id, negocio_id, aceptante_designado_id')
    .eq('servicio_slug', SERVICIO_CDA)
    .eq('estado', 'activo')
  if (contratos.error) throw new Error(`contratos CDA: ${contratos.error.message}`)

  for (const sc of (contratos.data ?? []) as FilaContrato[]) {
    resumen.revisados += 1
    const omitir = (motivo: string) => resumen.omitidos.push({ servicioContratadoId: sc.id, motivo })
    try {
      if (!sc.negocio_id || !sc.empresa_id || !sc.workspace_pagador_id) {
        omitir('sin_negocio_empresa_o_pagador')
        continue
      }

      // La v1.5 (y la v1.4) registradas y publicadas: las mismas fechas que mira la puerta.
      const docsR = await db
        .from('documentos_contractuales_versiones')
        .select('slug, version, vigente_desde, rige_por_aviso, publicada_at')
        .eq('empresa_id', sc.empresa_id)
        .eq('slug', SLUG_TERMINOS_CDA)
      if (docsR.error) {
        omitir(`documentos: ${docsR.error.message}`)
        continue
      }
      const ahora = Date.parse(ahoraISO)
      const docs = (
        (docsR.data ?? []) as { slug: string; version: string; vigente_desde: string | null; rige_por_aviso: boolean | null; publicada_at: string | null }[]
      )
        .filter((d) => d.vigente_desde && (d.rige_por_aviso !== true || (d.publicada_at !== null && Date.parse(d.publicada_at) <= ahora)))
        .map((d) => ({ slug: d.slug, version: d.version, vigenteDesde: String(d.vigente_desde) }))
      const transicion = vigenciaTransicion(docs)
      if (!transicion) {
        omitir('sin_v15')
        continue
      }

      const cuenta = await cuentaDelContrato(db, sc)
      if ('error' in cuenta) {
        // Sin poder leer las cuotas no hay prueba de la mora: no se avisa (el criterio de la puerta).
        omitir(cuenta.error)
        continue
      }
      const pago = proximoPago({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO, ignorarTipos: TIPOS_CUOTA_SIN_MORA })
      const mora = estadoMora(pago, deps.hoy, vigenciaRestriccion(docs), REGLA_MORA_CDA, transicion)
      if (mora.estado !== 'restringido') continue
      resumen.suspendidos += 1

      const periodos = periodosQueSuspenden({
        cuotas: cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO }),
        tipoDeCuota: (n) => cuenta.tipos.get(n),
        ignorarTipos: TIPOS_CUOTA_SIN_MORA,
        transicion,
        hoy: deps.hoy,
      })
      if (periodos.length === 0) {
        omitir('sin_periodos_impagos')
        continue
      }

      const [empresa, espacio] = await Promise.all([
        db.from('empresas').select('nombre, razon_social, email_fiscal').eq('id', sc.empresa_id).maybeSingle(),
        db.from('workspaces').select('slug, name').eq('id', sc.workspace_pagador_id).maybeSingle(),
      ])
      if (empresa.error || espacio.error || !espacio.data?.slug) {
        omitir(`empresa_o_espacio: ${empresa.error?.message ?? espacio.error?.message ?? 'sin espacio'}`)
        continue
      }
      let correoDesignado: string | null = null
      if (sc.aceptante_designado_id) {
        const correoDe =
          deps.correoDePersona ??
          (async (id: string) => {
            const u = await db.auth.admin.getUserById(id)
            return (u.data?.user?.email as string | undefined) ?? null
          })
        correoDesignado = await correoDe(sc.aceptante_designado_id).catch(() => null)
      }
      const destinos = [
        ...new Set(
          [empresa.data?.email_fiscal as string | null | undefined, correoDesignado]
            .filter((x): x is string => typeof x === 'string' && x.includes('@'))
            .map((x) => x.trim().toLowerCase()),
        ),
      ]
      if (destinos.length === 0) {
        omitir('sin_correos_registrados')
        continue
      }

      const razonSocial =
        (empresa.data?.razon_social as string | null | undefined) ?? (empresa.data?.nombre as string | null | undefined) ?? (espacio.data.name as string)
      const datos: DatosAvisoSuspendida = {
        razonSocial,
        suspendidaDesde: mora.restringeDesde,
        canceladaDesde: mora.corteDesde,
        periodos: periodos.map((c) => ({
          periodo: periodoEnLetrasConAnio(c) ?? `de la cuota ${c.numero}`,
          saldo: c.saldo,
          enlacePago: c.enlacePago,
        })),
        urlPagos: (deps.urlPagos ?? urlPagosPorDefecto)(espacio.data.slug as string),
      }
      const asunto = asuntoCorreoSuspendida(datos)

      const previos = await db
        .from('avisos_cliente')
        .select('destino, estado')
        .eq('negocio_id', sc.negocio_id)
        .eq('canal', 'email')
        .eq('titulo', asunto)
      if (previos.error) {
        // Sin poder leer lo ya enviado, no se manda: un correo de más al cliente es peor que uno tarde.
        omitir(`avisos_previos: ${previos.error.message}`)
        continue
      }
      const ya = new Set(
        ((previos.data ?? []) as { destino: string | null; estado: string }[])
          .filter((f) => f.estado !== 'fallido')
          .map((f) => (f.destino ?? '').toLowerCase()),
      )

      const texto = textoCorreoSuspendida(datos)
      const html = htmlCorreoSuspendida(datos)
      for (const destino of destinos) {
        if (ya.has(destino)) {
          resumen.yaAvisados += 1
          continue
        }
        const envio = await deps.enviarCorreo({
          to: destino,
          subject: asunto,
          text: texto,
          html,
          idempotencyKey: `valida-suspendida-${sc.id}-${mora.restringeDesde}-${destino}`,
        })
        const ins = await db.from('avisos_cliente').insert({
          workspace_id: sc.workspace_id,
          negocio_id: sc.negocio_id,
          canal: 'email',
          estado: envio.ok ? 'enviado' : 'fallido',
          destino,
          titulo: asunto,
          motivo: envio.ok ? null : envio.error,
          proveedor_id: envio.ok ? envio.id : null,
        })
        if (envio.ok) resumen.enviados.push({ servicioContratadoId: sc.id, destino })
        else resumen.fallidos.push({ servicioContratadoId: sc.id, destino, error: envio.error })
        if (ins.error) {
          resumen.fallidos.push({
            servicioContratadoId: sc.id,
            destino,
            error: `el correo ${envio.ok ? 'salió' : 'falló'} pero no quedó en avisos_cliente: ${ins.error.message}`,
          })
        }
      }
    } catch (err) {
      resumen.fallidos.push({ servicioContratadoId: sc.id, destino: null, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return resumen
}
