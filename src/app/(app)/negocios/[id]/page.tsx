import { notFound } from 'next/navigation'
import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeAutorizarCierreNoFacturable, canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { createServiceClient } from '@/lib/supabase/server'
import { listarConsultasPorNegocio } from '@/lib/actions/valida-consultas'
import { getDatosSarlaft, getScoreNegocio } from '@/lib/actions/valida-score'
import NegocioDetailClient from './negocio-detail-client'
import BloqueValida from './bloques/BloqueValida'
import BloqueRiesgoSarlaft from './bloques/BloqueRiesgoSarlaft'
import CerradoHeaderBanner from './cerrado-header-banner'
import { negocioCerrado } from '@/lib/negocios/motivo-cierre'

export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}

export default async function NegocioDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { err } = await searchParams
  const data = await getNegocioDetalleCompleto(id)

  if (!data) notFound()

  // Cargar consultas Valida solo si el workspace tiene el flag activo
  const { workspaceId, staffId, role } = await getWorkspace()

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
  if (workspaceId) {
    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ws } = await (svc.from('workspaces') as any)
      .select('modules')
      .eq('id', workspaceId)
      .single()
    const modules = (ws?.modules ?? {}) as Record<string, boolean>
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

  const extras = validaActivo
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

  return (
    <>
      <NegocioDetailClient
        negocio={data.negocio}
        bloques={data.bloques}
        etapasLinea={data.etapasLinea}
        etapasNoAplican={data.etapasNoAplican}
        profiles={data.profiles}
        currentUserId={data.currentUserId}
        currentUserEsResponsable={data.currentUserEsResponsable}
        userRole={data.userRole}
        cobros={data.cobros}
        cotizacionesNegocio={data.cotizacionesNegocio}
        puedeCorregirCotizacion={data.puedeCorregirCotizacion}
        resumenFinanciero={data.resumenFinanciero}
        ejecucionData={data.ejecucionData}
        historialData={data.historialData}
        actividad={data.actividad}
        staffList={data.staffList}
        datosOtrasEtapas={data.datosOtrasEtapas}
        datosPorSlug={data.datosPorSlug}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bloquesEtapasPrevias={data.bloquesEtapasPrevias as any}
        pausaEnabled={data.pausaEnabled}
        registrarPagoEnabled={conciliacionActiva}
        registrarPagoSimple={pagoSimpleActivo}
        puedeCierreNoFacturable={puedeCierreNoFacturable}
        puedeResolverAvisoRecaudo={puedeResolverAvisoRecaudo}
        errorMsg={err}
        banner={banner}
        extras={extras}
      />
    </>
  )
}
