import { getCotizacion, getCotizacionItems } from '@/app/(app)/negocios/cotizacion-actions'
import { getEstadoItinerarios } from '@/app/(app)/negocios/itinerario-actions'
import { getAdicionalesDeCotizacion } from '@/app/(app)/negocios/adicional-actions'
import { getPoliticaRecargo } from '@/app/(app)/negocios/recargo-actions'
import { getSalidaDeCotizacion } from '@/app/(app)/negocios/margen-salida-actions'
import { getTextoCliente } from '@/app/(app)/negocios/documento-cliente-actions'
import { getFiscalProfile } from '@/app/(app)/config/fiscal-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { plantillaMuestraResumenFiscal } from '@/lib/pdf/plantillas-cotizacion'
import { notFound } from 'next/navigation'
import CotizacionEditor from '@/app/(app)/negocios/cotizacion-editor'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { lineaCotizaPorTipo } from '@/lib/cotizaciones/lineas-por-tipo'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import {
  CONFIG_IVA_POR_DEFECTO,
  leerConfigIvaCotizacion,
  type ConfigIvaCotizacion,
} from '@/lib/fiscal/iva-cotizacion'
import {
  politicaMargenDeLinea,
  umbralesDeCotizacion,
  UMBRALES_MARGEN_POR_DEFECTO,
  type UmbralesMargen,
} from '@/lib/cotizaciones/convencion-margen'

export default async function CotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string; cotId: string }>
}) {
  const { id, cotId } = await params

  // getFiscalProfile tiene getWorkspace() interno que THROWS — catch para no crashear
  const [cotizacion, items, fiscalResult, itinerarios, adicionales, salida, textoCliente] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
    getFiscalProfile().catch(() => ({ success: false as const, data: null })),
    // La tabla de combinaciones. Devuelve vacio cuando la cotizacion no tiene
    // opciones —que es toda cotizacion anterior a este frente— y tambien cuando la
    // migracion no esta aplicada: en los dos casos la pantalla se ve como hoy.
    getEstadoItinerarios(cotId),
    // Los adicionales de cada variante. Mismo corte: sin la tabla devuelve
    // `disponible: false` y el editor no ofrece el control, en vez de ofrecer uno que
    // va a devolver un 42P01 al primer clic.
    getAdicionalesDeCotizacion(cotId),
    // El margen mínimo en la salida: si puede enviarse y quién puede autorizarla. Si no
    // se puede leer, la pantalla queda como siempre; el candado real está en el servidor.
    getSalidaDeCotizacion(cotId).catch(() => null),
    // El texto para el cliente. `null` con cualquier plantilla que no lo imprima, y si
    // la lectura falla: el editor queda como siempre, sin el botón «Texto».
    getTextoCliente(cotId).catch(() => null),
  ])

  // Regla 2 · el recargo fijo que declara la línea del negocio. Sin línea, o sin la
  // clave en su `config_extra`, llega apagado y la pantalla no ofrece nada.
  const politicaRecargo = await getPoliticaRecargo(id)

  if (!cotizacion) notFound()

  // Check if any cotizacion in this negocio has estado='aceptada'
  let frozen = false
  try {
    const { supabase: sbCheck } = await getWorkspace()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: accepted } = await (sbCheck as any)
      .from('cotizaciones')
      .select('id')
      .eq('negocio_id', id)
      .eq('estado', 'aceptada')
      .limit(1)
    // Freeze if there's an accepted quote AND the current one is NOT the accepted one
    if (accepted && accepted.length > 0 && accepted[0].id !== cotId) {
      frozen = true
    }
  } catch {
    // Non-critical — if check fails, don't freeze
  }

  // Obtener datos fiscales del cliente
  // 1. Desde la oportunidad vinculada (flujo pipeline)
  const opp = (cotizacion as Record<string, unknown>)?.oportunidades as Record<string, unknown> | null
  let empresaData = opp?.empresas as Record<string, unknown> | null

  // 2. Si no hay oportunidad, buscar empresa desde el negocio
  // Tambien capturamos linea_id para filtrar catalogo de servicios por linea
  let negocioLineaId: string | null = null
  if (!empresaData) {
    try {
      const { supabase: sb } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (sb as any)
        .from('negocios')
        .select('empresa_id, linea_id')
        .eq('id', id)
        .single()

      if (negocio?.empresa_id) {
        const { data: emp } = await sb
          .from('empresas')
          .select('id, nombre, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor')
          .eq('id', negocio.empresa_id)
          .single()
        empresaData = emp as Record<string, unknown> | null
      }
      negocioLineaId = negocio?.linea_id ?? null
    } catch {
      // Datos fiscales del cliente no son críticos para el editor
    }
  } else {
    // Si vino por oportunidad, igual buscamos linea_id del negocio para filtrar catalogo
    try {
      const { supabase: sb } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (sb as any)
        .from('negocios').select('linea_id').eq('id', id).single()
      negocioLineaId = negocio?.linea_id ?? null
    } catch {}
  }

  const clientFiscal = empresaData
    ? {
        person_type: (empresaData.tipo_persona ?? null) as string | null,
        tax_regime: (empresaData.regimen_tributario ?? null) as string | null,
        gran_contribuyente: (empresaData.gran_contribuyente ?? false) as boolean,
        agente_retenedor: (empresaData.agente_retenedor ?? false) as boolean,
      }
    : null

  const fiscalProfile = fiscalResult.success ? fiscalResult.data ?? null : null

  // Fetch staff for mano de obra datalist
  let staffMembers: { id: string; nombre: string; tarifa_hora: number }[] = []
  try {
    const { supabase: sbStaff, workspaceId: wsId } = await getWorkspace()
    if (wsId) {
      const { data } = await sbStaff
        .from('staff')
        .select('id, full_name, salary, horas_disponibles_mes')
        .eq('workspace_id', wsId)
        .eq('is_active', true)
        .order('full_name')
      staffMembers = (data ?? []).map(s => ({
        id: s.id,
        nombre: s.full_name,
        tarifa_hora: (s.salary && s.horas_disponibles_mes) ? s.salary / s.horas_disponibles_mes : 0,
      }))
    }
  } catch {
    // Staff data is not critical for the editor
  }

  // Los umbrales de margen: manda lo que la cotización CONGELÓ al nacer y la política
  // de la línea solo entra donde la cotización no diga nada. La precedencia se resuelve
  // aquí, una sola vez, con el helper puro — la pantalla recibe dos números y ya.
  //
  // Mientras la migración `20260914160000` no esté aplicada, las dos columnas llegan
  // como `undefined` (el `select('*')` de `getCotizacion` no falla por columnas que no
  // existen) y todo cae a la línea, que es el comportamiento de hoy.
  let politicaLinea: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO
  if (negocioLineaId) {
    try {
      const { supabase: sbLinea } = await getWorkspace()
      const { data: linea } = await sbLinea
        .from('lineas_negocio')
        .select('config_extra')
        .eq('id', negocioLineaId)
        .maybeSingle()
      const { pisoPct, avisoPct } = politicaMargenDeLinea(
        (linea as { config_extra?: unknown } | null)?.config_extra,
      )
      politicaLinea = { pisoPct, avisoPct }
    } catch {
      // Sin la línea rigen los umbrales por defecto: el color de una cifra no puede
      // depender de que una consulta secundaria responda.
    }
  }

  // ¿El piso BLOQUEA avanzar de etapa desde donde el negocio está parado hoy?
  //
  // El gate `margen_sobre_piso` es opt-in por etapa, así que la pantalla no puede
  // afirmar ni negar el bloqueo por su cuenta: en un workspace sin el gate, decir «no
  // deja avanzar» sería falso, y en Trappvel decir «es una marca, no un bloqueo»
  // —que es lo que decía hasta hoy— también. Se pregunta, y si no se puede leer, no
  // se afirma nada.
  let pisoBloqueaAvance = false
  try {
    const { supabase: sbGate } = await getWorkspace()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: negGate } = await (sbGate as any)
      .from('negocios')
      .select('etapas_negocio!negocios_etapa_actual_id_fkey(config_extra)')
      .eq('id', id)
      .maybeSingle()
    const etapa = (negGate as { etapas_negocio?: unknown } | null)?.etapas_negocio
    const filaEtapa = Array.isArray(etapa) ? etapa[0] : etapa
    const gates = ((filaEtapa as { config_extra?: { gates?: unknown } } | null)?.config_extra?.gates ?? []) as unknown[]
    pisoBloqueaAvance = Array.isArray(gates) && gates.includes('margen_sobre_piso')
  } catch {
    // Sin respuesta, la pantalla no afirma que bloquea. Un aviso que promete un
    // bloqueo inexistente enseña a ignorar los avisos.
  }

  // Quiénes viajan (etapa 1), para la tarifa por pasajero. Si no se puede leer, las líneas
  // piden escribir su composición: preferible a inventar un grupo que no es el del viaje.
  let composicionViaje: Composicion | null = null
  try {
    const { supabase: sbViaje } = await getWorkspace()
    const { viaje, error: errViaje } = await leerViajeDelNegocio(sbViaje, id)
    if (errViaje) console.warn('[cotizacion] no se pudo leer la composición del viaje:', errViaje)
    composicionViaje = viaje.composicion
  } catch {
    // Sin composición del viaje la pantalla la pide por línea.
  }

  // ¿Líneas por tipo («+ Vuelo», «+ Hotel»…) en vez de nombre libre? Solo si la línea del
  // negocio declara quiénes viajan (`lineas-por-tipo.ts`). Si no se puede leer, la pantalla
  // queda como siempre: preferible a ofrecer tipos de viaje a quien no cotiza viajes.
  let lineasPorTipo = false
  if (negocioLineaId) {
    try {
      const { supabase: sbTipos } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bloquesLinea, error: errTipos } = await (sbTipos as any)
        .from('bloque_configs')
        .select('fields:config_extra->fields, etapas_negocio!inner(linea_id)')
        .eq('etapas_negocio.linea_id', negocioLineaId)
      if (errTipos) console.warn('[cotizacion] no se pudo leer si la línea cotiza por tipo:', errTipos.message)
      else lineasPorTipo = lineaCotizaPorTipo(((bloquesLinea ?? []) as { fields: unknown }[]).map(b => b.fields))
    } catch {
      // Sin respuesta, lo de siempre: nombre libre.
    }
  }

  // Sobre qué va el IVA de esta cotización (`iva-cotizacion.ts`). Del `config_extra` del
  // workspace solo viaja lo ya interpretado, nunca el jsonb. Si no se puede leer, lo de
  // siempre: IVA sobre el total, que es lo que reciben todos los workspaces que no declaran
  // nada.
  //
  // De la misma fila sale la plantilla, que decide si el editor pinta el resumen fiscal del
  // final (hallazgo 33: Trappvel no). Si no se puede leer, se pinta, como siempre.
  let configIva: ConfigIvaCotizacion = CONFIG_IVA_POR_DEFECTO
  let mostrarResumenFiscal = true
  try {
    const { supabase: sbIva, workspaceId: wsIva } = await getWorkspace()
    if (wsIva) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: wsRow } = await (sbIva as any)
        .from('workspaces')
        .select('config_extra, cotizacion_template_slug')
        .eq('id', wsIva)
        .maybeSingle()
      const fila = wsRow as { config_extra?: unknown; cotizacion_template_slug?: string | null } | null
      configIva = leerConfigIvaCotizacion(fila?.config_extra)
      mostrarResumenFiscal = plantillaMuestraResumenFiscal(fila?.cotizacion_template_slug)
    }
  } catch {
    // Sin respuesta, el IVA de siempre.
  }

  const cotRow = cotizacion as unknown as { piso_margen_pct?: number | null; aviso_margen_pct?: number | null }
  const umbrales = umbralesDeCotizacion(
    { pisoPct: cotRow.piso_margen_pct, avisoPct: cotRow.aviso_margen_pct },
    politicaLinea,
  )

  return (
    <CotizacionEditor
      oportunidadId={id}
      // Con los tipos regenerados, `convencion_margen` llega como `string` de la base y el
      // editor la declara como la unión de sus dos valores (el CHECK de la columna). El cast
      // es el mismo de `initialItems`: no cambia lo que llega, solo lo que el tipo afirma.
      cotizacion={cotizacion as Parameters<typeof CotizacionEditor>[0]['cotizacion']}
      initialItems={items as Parameters<typeof CotizacionEditor>[0]['initialItems']}
      fiscalProfile={fiscalProfile}
      clientFiscal={clientFiscal}
      backUrl={`/negocios/${id}`}
      staffMembers={staffMembers}
      frozen={frozen}
      lineaId={negocioLineaId}
      umbrales={umbrales}
      pisoBloqueaAvance={pisoBloqueaAvance}
      politicaRecargo={politicaRecargo}
      itinerarios={itinerarios}
      composicionViaje={composicionViaje}
      lineasPorTipo={lineasPorTipo}
      adicionales={adicionales as Parameters<typeof CotizacionEditor>[0]['adicionales']}
      salida={salida}
      textoCliente={textoCliente}
      configIva={configIva}
      mostrarResumenFiscal={mostrarResumenFiscal}
    />
  )
}
