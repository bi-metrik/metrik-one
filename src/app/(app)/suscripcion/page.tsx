import Link from 'next/link'
import { notFound } from 'next/navigation'
import EmptyState from '@/components/empty-state'
import { PestanaTerminos } from '@/components/terminos/pestana-terminos'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import { leerEquipo } from '@/lib/seccion-suscripcion/carga-servidor'
import { contextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { PLAN_CDA } from '@/lib/valida-cda/redaccion-fiscal'
import { fechaConAnio } from '@/lib/seccion-suscripcion/estado'
import { estadoSugerencia } from '@/lib/seccion-suscripcion/sustenta-servidor'
import { accionesSobreUsuario, esAdministradorSinCosto } from '@/lib/usuarios-espacio/reglas'
import { leerPagosCda, leerTerminosEmpresaCda } from '@/lib/valida-cda/pestanas-servidor'
import { PestanaPagos } from './pestana-pagos'
import SuscripcionClient, { type PestanaSuscripcion } from './suscripcion-client'
import { TarjetaPago } from './tarjeta-pago'

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
 * `/suscripcion`: la suscripción del espacio a un servicio de MeTRIK, hoy la suscripción a Valida de
 * los CDA. Solo la ve la persona designada del contrato del espacio que lo PAGA; a cualquier otro
 * (dueño o administrador que no sea la persona designada, operador, espacio sin contrato, AFI,
 * metrik) la ruta no existe (404), igual que el ítem del menú. Un platform admin en «Ver como» la ve
 * si mira como la persona designada, en solo lectura. Todo se resuelve en el servidor en cada
 * navegación: la regla vive en `puedeVerSuscripcion` (vía `contextoSuscripcion`) y la vuelven a
 * exigir las acciones.
 */
export default async function SuscripcionPage({ searchParams }: Props) {
  const ctx = await contextoSuscripcion()
  if (ctx.tipo === 'no_aplica') notFound()
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

  const [pagos, terminos, equipo, sugerencia] = await Promise.all([
    leerPagosCda(ctx.entrada),
    leerTerminosEmpresaCda(ctx.entrada),
    leerEquipo(ctx),
    estadoSugerencia({ workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId, ahora: new Date() }),
  ])

  const { contrato, resumen } = ctx
  // El nombre fiscal del plan (Felipe, 2026-09-24), no el del catálogo, que todavía dice «Licencia».
  const plan = PLAN_CDA
  const vigencia = contrato.vigenteHasta
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
    ) : ctx.pago ? (
      <TarjetaPago lectura={ctx.pago} />
    ) : null

  // «Aceptados el {fecha} por {nombre}», de la constancia verificada.
  let terminosResumen: string | null = null
  if (terminos.estado === 'ok') {
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
        sustenta={soloLectura ? null : sugerencia.yaSolicitado ? 'solicitada' : sugerencia.mostrar ? 'oferta' : null}
        pagos={<PestanaPagos carga={pagos} />}
        terminos={
          aprobada ? (
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
