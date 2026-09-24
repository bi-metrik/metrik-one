import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeAutorizarCierreNoFacturable, canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { createServiceClient } from '@/lib/supabase/server'
import { listarConsultasPorNegocio } from '@/lib/actions/valida-consultas'
import { getDatosSarlaft, getScoreNegocio } from '@/lib/actions/valida-score'
import type { ComponentProps } from 'react'
import type NegocioDetailClient from './negocio-detail-client'
import { leerMarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio-datos'
import BloqueValida from './bloques/BloqueValida'
import BloqueRiesgoSarlaft from './bloques/BloqueRiesgoSarlaft'
import CerradoHeaderBanner from './cerrado-header-banner'
import { negocioCerrado } from '@/lib/negocios/motivo-cierre'
import { puedeOmitirGatesConMotivo } from '@/lib/permissions/omitir-gates'
import { exigeCarpetaLocal } from '@/lib/negocios/carpeta-local'
import { resolverPermisoCarpetaLocal } from '@/lib/negocios/carpeta-local-servidor'
import { esAlmacenamientoExterno } from '@/lib/almacenamiento/config'
import { leerFacturasDeCuotas } from '@/lib/valida-cda/facturas-negocio-servidor'
import { FacturasCuotas } from './facturas-cuotas'

/**
 * Todo lo que la página del negocio le pasa a `NegocioDetailClient`, armado en UN sitio.
 *
 * Lo usan la página del negocio y la de la cotización de viaje: la cotización se pinta
 * dentro del MISMO marco (encabezado y panel), así que tiene que recibir exactamente los
 * mismos datos, permisos y banners. Dos copias de este armado se desincronizarían y el
 * encabezado cambiaría al ir de una pantalla a la otra (corrección de Mauricio a #874).
 *
 * `viaje` solo existe en las líneas que cotizan viajes (`leerMarcoDelNegocio`); en las
 * demás es `null` y la página no cambia (R6).
 */
export type VistaNegocio = Omit<ComponentProps<typeof NegocioDetailClient>, 'errorMsg' | 'centro' | 'cotActualId'>

export async function cargarVistaNegocio(id: string): Promise<VistaNegocio | null> {
  const data = await getNegocioDetalleCompleto(id)
  if (!data) return null

  // Cargar consultas Valida solo si el workspace tiene el flag activo
  const { supabase, workspaceId, staffId, role, areas } = await getWorkspace()

  // Areas efectivas del staff actual (para gatear boton "Reabrir" como supervisor
  // y la casilla de cierre no facturable)
  let hasAreaComercial = false
  let puedeCierreNoFacturable = false
  // Cerrar el aviso de recaudo cambiado es del area financiera, igual que conciliar.
  let puedeResolverAvisoRecaudo = false
  if (staffId) {
    const svc2 = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: areas } = await (svc2.from('staff_areas') as any)
      .select('area')
      .eq('staff_id', staffId)
    const areaList = ((areas ?? []) as Array<{ area: string }>).map((r) => r.area)
    hasAreaComercial = areaList.includes('comercial') || areaList.includes('direccion')
    // Mismo helper que usa el guard del servidor: la pantalla no puede ofrecer
    // una excepcion que la accion vaya a rechazar al final del formulario.
    puedeCierreNoFacturable = puedeAutorizarCierreNoFacturable({
      id: staffId,
      role: (role ?? 'read_only') as Role,
      areas: areaList as Area[],
    })
    // MISMO predicado que `ctxFinanciero` (canEditBloque del stage 'cobro' con
    // responsables vacio). Copiar el criterio aqui desincronizaria la pantalla del
    // guard: ofreceria el boton a quien la accion rechaza, o se lo esconderia a
    // quien si puede.
    const userCtx: UserContext = {
      id: staffId,
      role: (role ?? 'read_only') as Role,
      areas: areaList as Area[],
    }
    puedeResolverAvisoRecaudo = canEditBloque(userCtx, { stage: 'cobro' }, [])
  }
  // Dos preguntas distintas que hasta ahora compartian una sola variable, y por eso
  // una arrastraba el defecto de la otra.
  //
  // (a) ¿ESTA CERRADO? Sale de `estado`, el criterio unico del producto
  //     (`motivo-cierre.ts`). Es el que decide si el negocio sigue recibiendo plata.
  //     Antes salia de `cierre_motivo`, que es NULL en todo cierre real: por eso los
  //     33 cerrados de SOENA seguian ofreciendo "Registrar pago" (medido 2026-09-10).
  const cerrado = negocioCerrado(data.negocio.estado)
  // (b) ¿SE PINTA EL BANNER DE CIERRE? Sigue atado a `cierre_motivo` — A PROPOSITO,
  //     no por descuido. Ese banner enciende el boton "Reabrir", y `reabrirNegocio`
  //     corta exigiendo `stage_actual = 'cerrado'`, un stage que esta linea nunca
  //     alcanza: prenderlo seria ofrecer una accion que la server action rechaza.
  //     Hoy solo aparece en los 5 negocios de `metrik` que si tienen la columna
  //     poblada. Cambiar esto es decision de producto, no de este PR.
  const tieneBannerDeCierre = data.negocio.cierre_motivo !== null
  let validaConsultas: Awaited<ReturnType<typeof listarConsultasPorNegocio>> | null = null
  let datosSarlaft: Awaited<ReturnType<typeof getDatosSarlaft>> | null = null
  let scoreSarlaft: Awaited<ReturnType<typeof getScoreNegocio>> | null = null
  let validaActivo = false
  // Conciliación: habilita "Registrar pago" dentro del bloque de pagos — opt-in por
  // workspace (modules.conciliacion). El registro + reparto viven en BloqueCobros; el
  // panel financiero solo acepta/rechaza.
  let conciliacionActiva = false
  // Registro de pago SIMPLE en la ficha (modules.fab_registrar_pago), el mismo que ya
  // vive en el FAB global. Sin conciliación no hay reparto que proponer: la plata que
  // entra se anota contra el negocio abierto y queda registrada de una.
  let pagoSimpleActivo = false
  // "Omitir gate" en el modal de gates pendientes: owner/admin, o la persona declarada en
  // `config_extra.omitir_gate.staff_ids`. MISMA función que el guard de
  // `cambiarEtapaNegocioConGate`: el botón no se ofrece a quien el servidor rechaza.
  let puedeOmitirGates = false
  // Carpeta del cerebro: el campo solo existe donde el workspace exige la carpeta, y se
  // edita con el MISMO resolvedor que usa `actualizarCarpetaLocalNegocio`.
  const carpetaLocal = { visible: false, puedeEditar: false }
  // Archivos en el proyecto propio del cliente (`storage_provider`): sin carpeta de Drive
  // y con subida directa a ese proyecto. Se lee de la MISMA fila de config de abajo.
  let almacenamientoExterno = false
  if (workspaceId) {
    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ws } = await (svc.from('workspaces') as any)
      .select('modules, config_extra')
      .eq('id', workspaceId)
      .single()
    const modules = (ws?.modules ?? {}) as Record<string, boolean>
    puedeOmitirGates = puedeOmitirGatesConMotivo({ role, staffId }, ws?.config_extra ?? null)
    almacenamientoExterno = esAlmacenamientoExterno(ws?.config_extra ?? null)
    if (exigeCarpetaLocal(ws?.config_extra ?? null)) {
      carpetaLocal.visible = true
      carpetaLocal.puedeEditar = await resolverPermisoCarpetaLocal(
        supabase,
        { id: staffId ?? '', role: (role ?? 'read_only') as Role, areas: (areas ?? []) as Area[] },
        workspaceId,
        id,
      )
    }
    if (modules.valida_consulta) {
      validaActivo = true
      validaConsultas = await listarConsultasPorNegocio(id)
      datosSarlaft = await getDatosSarlaft(id)
      scoreSarlaft = await getScoreNegocio(id)
    }
    if (modules.conciliacion && !cerrado) {
      conciliacionActiva = true
    }
    if (modules.fab_registrar_pago && !modules.conciliacion && !cerrado) {
      pagoSimpleActivo = true
    }
  }

  // El banner de cierre y los bloques de Valida se renderizan aquí (con la
  // lógica de permisos de este server component) y viajan como props al cliente,
  // que los pinta DENTRO de su columna principal. Antes eran hermanos con su
  // propio `mx-auto max-w-2xl`: al ensancharse el contenedor del detalle
  // quedaban desalineados. JSX del servidor se puede pasar como prop a un
  // componente cliente; convertir esta página en cliente no es opción.
  const banner = tieneBannerDeCierre && data.negocio.cierre_motivo
    ? (
      <div className="mb-3">
        <CerradoHeaderBanner
          negocioId={id}
          cierreMotivo={data.negocio.cierre_motivo}
          closedAt={data.negocio.closed_at}
          razonCierre={data.negocio.razon_cierre}
          role={role}
          hasAreaComercial={hasAreaComercial}
        />
      </div>
    )
    : null

  // Facturas electrónicas de las cuotas: solo en un negocio que es un contrato de servicio cobrado
  // por este espacio (hoy, metrik con los CDA de Valida), y solo para quien las puede cargar.
  const facturasCuotas =
    workspaceId && (role === 'owner' || role === 'admin')
      ? await leerFacturasDeCuotas(workspaceId, id)
      : null

  const extrasValida = validaActivo
    ? (
      <div className="space-y-3">
        <BloqueRiesgoSarlaft
          negocioId={id}
          datosIniciales={datosSarlaft?.ok ? datosSarlaft.datos : null}
          scoreInicial={scoreSarlaft?.ok ? scoreSarlaft.score : null}
        />
        {validaConsultas && (
          <BloqueValida
            negocioId={id}
            consultas={validaConsultas.ok ? validaConsultas.consultas : []}
            error={validaConsultas.ok ? null : validaConsultas.error}
          />
        )}
      </div>
    )
    : null

  const extras = extrasValida || facturasCuotas?.estado === 'ok' || facturasCuotas?.estado === 'no_disponible'
    ? (
      <div className="space-y-3">
        {facturasCuotas?.estado === 'ok' && <FacturasCuotas cuotas={facturasCuotas.cuotas} />}
        {facturasCuotas?.estado === 'no_disponible' && (
          <p className="text-xs text-tinta-suave">No se pudieron cargar las facturas de las cuotas en este momento.</p>
        )}
        {extrasValida}
      </div>
    )
    : null

  let viaje: VistaNegocio['viaje'] = null
  if (workspaceId) {
    try {
      viaje = await leerMarcoDelNegocio(supabase, workspaceId, id)
    } catch (e) {
      console.warn('[negocio] no se pudo leer el viaje del negocio:', e instanceof Error ? e.message : e)
    }
  }

  return {
    negocio: data.negocio,
    bloques: data.bloques,
    etapasLinea: data.etapasLinea,
    etapasNoAplican: data.etapasNoAplican,
    noAplica: data.noAplica,
    datosClave: data.datosClave,
    profiles: data.profiles,
    currentUserId: data.currentUserId,
    currentUserEsResponsable: data.currentUserEsResponsable,
    userRole: data.userRole,
    cobros: data.cobros,
    cotizacionesNegocio: data.cotizacionesNegocio,
    puedeCorregirCotizacion: data.puedeCorregirCotizacion,
    resumenFinanciero: data.resumenFinanciero,
    ejecucionData: data.ejecucionData,
    historialData: data.historialData,
    actividad: data.actividad,
    staffList: data.staffList,
    datosOtrasEtapas: data.datosOtrasEtapas,
    datosPorSlug: data.datosPorSlug,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bloquesEtapasPrevias: data.bloquesEtapasPrevias as any,
    pausaEnabled: data.pausaEnabled,
    registrarPagoEnabled: conciliacionActiva,
    registrarPagoSimple: pagoSimpleActivo,
    puedeCierreNoFacturable: puedeCierreNoFacturable,
    puedeOmitirGates: puedeOmitirGates,
    puedeResolverAvisoRecaudo: puedeResolverAvisoRecaudo,
    carpetaLocal: carpetaLocal,
    almacenamientoExterno: almacenamientoExterno,
    banner: banner,
    extras: extras,
    viaje,
  }
}
