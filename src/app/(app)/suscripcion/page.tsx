import Link from 'next/link'
import { notFound } from 'next/navigation'
import EmptyState from '@/components/empty-state'
import { PestanaTerminos } from '@/components/terminos/pestana-terminos'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import { leerEquipo } from '@/lib/seccion-suscripcion/carga-servidor'
import { contextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { suscripcionEnPrueba } from '@/lib/seccion-suscripcion/prueba-servidor'
import { ofrecePagarAhora, rechazoDeLaTarjeta } from '@/lib/seccion-suscripcion/pagar-ahora'
import { createServiceClient } from '@/lib/supabase/server'
import { PLAN_CDA, PLAN_ONE } from '@/lib/valida-cda/redaccion-fiscal'
import { fechaConAnio } from '@/lib/seccion-suscripcion/estado'
import { estadoSugerencia } from '@/lib/seccion-suscripcion/sustenta-servidor'
import { accionesSobreUsuario, esAdministradorSinCosto } from '@/lib/usuarios-espacio/reglas'
import { leerPagosCda, leerTerminosEmpresaCda } from '@/lib/valida-cda/pestanas-servidor'
import { leerOpcionesPago } from '@/lib/valida-cda/plan-anual-servidor'
import { vistaBloquePagar } from '@/lib/valida-cda/tarjeta-cda-servidor'
import { OpcionesPago } from './opciones-pago'
import { PagoAutomatico } from './pago-automatico'
import { PestanaPagos } from './pestana-pagos'
import SuscripcionClient, { type PestanaSuscripcion } from './suscripcion-client'
import { TarjetaPago } from './tarjeta-pago'
import { SuscripcionEnPruebaVista } from './suscripcion-en-prueba'
import { ReactivarSuscripcion } from './reactivar-suscripcion'
import { valorDeReactivacion } from '@/lib/valida-cda/cancelada-servidor'
import { noContinuaCda } from '@/lib/valida-cda/puerta'

export const dynamic = 'force-dynamic'

const PESTANAS: readonly PestanaSuscripcion[] = ['resumen', 'pagos', 'usuarios', 'terminos']

const CLASE_CHIP: Record<string, string> = {
  verde: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  ambar: 'border-amber-200 bg-amber-50 text-amber-900',
  ambar_fuerte: 'border-amber-400 bg-amber-100 text-amber-900',
  rojo: 'border-red-200 bg-red-50 text-red-800',
  gris: 'border-border bg-papel text-tinta-suave',
}

interface Props {
  searchParams: Promise<{ tab?: string }>
}

/**
 * `/suscripcion`: la suscripción del espacio a un servicio de MeTRIK: Valida de los CDA, o la licencia
 * de ONE de un cliente de Clarity (`ctx.producto`). Solo la ve la persona designada del contrato del espacio que lo PAGA; a cualquier otro
 * (dueño o administrador que no sea la persona designada, operador, espacio sin contrato, AFI,
 * metrik) la ruta no existe (404), igual que el ítem del menú. Un platform admin en «Ver como» la ve
 * si mira como la persona designada, en solo lectura. Todo se resuelve en el servidor en cada
 * navegación: la regla vive en `puedeVerSuscripcion` (vía `contextoSuscripcion`) y la vuelven a
 * exigir las acciones.
 */
export default async function SuscripcionPage({ searchParams }: Props) {
  const ctx = await contextoSuscripcion()
  if (ctx.tipo === 'no_aplica') {
    // Sin contrato todavía: la prueba gratis de Valida (la persona que se registró la ve desde el día 1).
    const prueba = await suscripcionEnPrueba()
    if (prueba) return <SuscripcionEnPruebaVista s={prueba} />
    notFound()
  }
  if (ctx.tipo === 'no_disponible') {
    return (
      <EmptyState
        title="No se pudo cargar tu suscripción"
        description="Intenta de nuevo en un momento. Si sigue sin cargar, escríbenos."
      />
    )
  }

  const { tab } = await searchParams
  const tabInicial = PESTANAS.find((p) => p === tab) ?? 'resumen'
  const aprobada = ctx.entrada.estado.estado === 'aprobada'
  const esOne = ctx.producto === 'one'
  // Cancelada (Términos v1.5, 11.3): en lugar de la tarjeta de pago y de las formas de pagar, «Reactivar»
  // (11.4) con el valor de un período. Sin tarjeta ni Plan Anual mientras tanto.
  const cancelada = !esOne && ctx.canceladaDesde !== null
  // 16.4 (Emilio, 5-nov): aceptó la v1.5 tarde y ningún período vendido cubre hoy: vuelve a empezar con un
  // período desde el día del pago, por el mismo camino de la reactivación.
  const v15Tarde = !esOne && !cancelada && (await noContinuaCda()).estado === 'no_continua'

  // La licencia de ONE no tiene términos publicados que releer ni oferta de Sustenta (es para los CDA).
  // Una suscripción cuya tarjeta rechazó el banco: se dice en la tarjeta de pago (2026-10-19).
  const rechazoTarjeta = ctx.contrato.suscripcionId ? await rechazoDeLaTarjeta(ctx, createServiceClient()) : null
  const [pagos, terminos, equipo, sugerencia, opcionesPago, bloquePagar] = await Promise.all([
    leerPagosCda(ctx.entrada),
    esOne ? null : leerTerminosEmpresaCda(ctx.entrada),
    leerEquipo(ctx),
    esOne ? null : estadoSugerencia({ workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId, ahora: new Date() }),
    // El Plan Anual: solo Valida de los CDA, con términos aceptados y el contrato encendido.
    esOne || !aprobada || cancelada ? null : leerOpcionesPago(ctx),
    // El bloque «Pagar» de los CDA: la tarjeta (Términos v1.5, 2.4) y «Pagar solo este mes», que se
    // excluyen (brief del 2026-11-03). Solo la persona designada lo ve.
    esOne || !aprobada || cancelada ? null : vistaBloquePagar(ctx),
  ])
  const montoReactivacion = cancelada || v15Tarde
    ? await valorDeReactivacion(createServiceClient(), { id: ctx.contrato.id, parametros: ctx.contrato.parametros })
    : null
  const hayCartera = pagos.estado === 'ok' && (pagos.cartera ?? []).length > 0
  const pagoAutomatico = bloquePagar?.automatico ?? null

  const { contrato, resumen } = ctx
  // El nombre fiscal del plan (Felipe, 2026-09-24), no el del catálogo, que todavía dice «Licencia».
  const plan = esOne ? PLAN_ONE : PLAN_CDA
  // Con el Plan Anual pagado, su plazo absorbe y extiende el de la cláusula 12.1 (anexo 3.3).
  const planAnual = opcionesPago?.tipo === 'ok' && opcionesPago.anual.estado === 'activo' ? opcionesPago.anual : null
  const vigencia = planAnual
    ? `Plan anual del ${fechaConAnio(planAnual.desde)} al ${fechaConAnio(planAnual.hasta)}`
    : contrato.vigenteHasta
      ? `Vigente hasta el ${fechaConAnio(contrato.vigenteHasta)} · renovación mensual`
      : `Vigente desde el ${fechaConAnio(contrato.vigenteDesde)} · renovación mensual`

  // Términos pendientes: la tarjeta de pago cede su lugar a la aceptación (el estado lo manda).
  const soloLectura = ctx.soloLectura
  const puedeAceptar = !aprobada && !soloLectura && ctx.designadoId !== null && ctx.designadoId === ctx.usuarioId
  const principal =
    resumen.estado === 'terminos_pendientes' ? (
      <section data-terminos-pendientes className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:p-5">
        <p className="font-semibold">{resumen.mensaje}</p>
        {puedeAceptar ? (
          <Link
            href="/valida?terminos=1"
            className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white sm:w-auto"
          >
            Revisar y aceptar
          </Link>
        ) : (
          ctx.designadoNombre && <p className="mt-1">La persona designada para aceptarlos es {ctx.designadoNombre}.</p>
        )}
      </section>
    ) : cancelada ? (
      <ReactivarSuscripcion monto={montoReactivacion} hayCartera={hayCartera} soloLectura={soloLectura} />
    ) : v15Tarde ? (
      <ReactivarSuscripcion monto={montoReactivacion} hayCartera={hayCartera} soloLectura={soloLectura} variante="v15_tarde" />
    ) : ctx.pago ? (
      <TarjetaPago
        lectura={ctx.pago}
        pagarAhora={!soloLectura && ofrecePagarAhora(ctx)}
        rechazoTarjeta={rechazoTarjeta}
        avisoTarjeta={pagoAutomatico?.tipo === 'activa' ? pagoAutomatico.fallo : null}
        tarjetaActiva={pagoAutomatico?.tipo === 'activa' ? pagoAutomatico.resumen : null}
        transicion={ctx.transicion}
        hoy={ctx.entrada.hoy}
      />
    ) : null

  // «Aceptados el {fecha} por {nombre}», de la constancia verificada.
  let terminosResumen: string | null = null
  if (terminos?.estado === 'ok') {
    const t = terminos.datos.find((d) => d.estado === 'verificado' && d.contrato)
    if (t && t.estado === 'verificado' && t.contrato) {
      const fecha = formatBogotaFechaCortaAno(t.contrato.aceptadoAt)
      terminosResumen = `Aceptados el ${fecha}${t.contrato.aceptadoPor ? ` por ${t.contrato.aceptadoPor}` : ''}.`
    }
  }

  const usuarios =
    equipo === 'error'
      ? null
      : equipo.usuarios.map((u) => ({
          ...u,
          ultimoIngresoTexto: u.ultimoIngreso ? (formatBogotaFechaCortaAno(u.ultimoIngreso) ?? null) : null,
          sinCosto: esAdministradorSinCosto(u.id, ctx.designadoId),
          acciones: soloLectura
            ? { puedeRetirar: false, puedeCambiarRol: false, puedeReenviar: false, nota: null }
            : accionesSobreUsuario({ actorId: ctx.usuarioId, objetivo: u, designadoId: ctx.designadoId }),
        }))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header data-encabezado-suscripcion className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Suscripción</p>
            <h1 className="text-xl font-bold text-tinta">{contrato.empresaNombre ?? 'Tu empresa'}</h1>
            <p className="text-sm text-tinta">{plan}</p>
          </div>
          <span
            data-chip-estado={resumen.estado}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${CLASE_CHIP[resumen.tono] ?? CLASE_CHIP.gris}`}
          >
            {resumen.chip}
          </span>
        </div>
        <p className="text-xs text-tinta-suave">{vigencia}</p>
        {soloLectura && (
          <p
            data-solo-lectura
            className="rounded-md border border-border bg-papel px-3 py-2 text-xs text-tinta-suave"
          >
            Estás viendo como la persona designada del contrato: solo lectura, sin aceptar términos ni tocar
            usuarios.
          </p>
        )}
        {resumen.estado !== 'terminos_pendientes' && resumen.mensaje && (
          <p className="text-sm text-tinta" data-mensaje-estado>
            {resumen.mensaje}
          </p>
        )}
      </header>

      <SuscripcionClient
        tabInicial={tabInicial}
        principal={principal}
        licencias={
          equipo === 'error' || !equipo.cupo
            ? null
            : {
                usados: equipo.cupo.usados,
                total: equipo.cupo.licencias,
                operativos: equipo.usuarios.some((u) => esAdministradorSinCosto(u.id, ctx.designadoId)),
              }
        }
        terminosResumen={terminosResumen}
        sustenta={soloLectura || !sugerencia ? null : sugerencia.yaSolicitado ? 'solicitada' : sugerencia.mostrar ? 'oferta' : null}
        pagos={
          <PestanaPagos
            carga={pagos}
            transicion={ctx.transicion}
            reactivar={cancelada ? <ReactivarSuscripcion monto={montoReactivacion} hayCartera={hayCartera} soloLectura={soloLectura} /> : null}
            pagoAutomatico={bloquePagar ? <PagoAutomatico vista={bloquePagar.automatico} mes={bloquePagar.mes} soloLectura={soloLectura} /> : null}
            opciones={
              opcionesPago?.tipo === 'ok' ? (
                // Con el bloque «Pagar», «Pagar el mes» vive allí (con la exclusión de la tarjeta): aquí no se repite.
                <OpcionesPago
                  opciones={bloquePagar ? { ...opcionesPago, mes: null } : opcionesPago}
                  soloLectura={soloLectura}
                  nombreSugerido={ctx.designadoNombre}
                />
              ) : null
            }
          />
        }
        terminos={
          !terminos ? (
            <p data-sin-terminos className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
              Tu suscripción a MeTRIK ONE no tiene términos para aceptar en la plataforma.
            </p>
          ) : aprobada ? (
            <PestanaTerminos carga={terminos} alcance="empresa" />
          ) : (
            <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
              Los Términos aceptados se releen aquí cuando la persona designada los acepte.
            </p>
          )
        }
        usuarios={{
          lista: usuarios,
          cupo: equipo === 'error' ? null : equipo.cupo,
          valorAdicional: equipo === 'error' ? null : equipo.licencias.valorAdicional,
          adicionalesVigentes: equipo === 'error' ? 0 : equipo.licencias.adicionalesVigentes.length,
          licenciasContrato: equipo === 'error' ? null : equipo.licencias.licencias,
          soloLectura,
        }}
      />
    </div>
  )
}
