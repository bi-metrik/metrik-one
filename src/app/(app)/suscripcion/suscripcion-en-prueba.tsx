import Link from 'next/link'
import type { SuscripcionEnPrueba } from '@/lib/seccion-suscripcion/prueba'
import { RUTA_ACTIVAR_PLAN } from '@/lib/valida/corte-bolsa'
import { PLAN_CDA } from '@/lib/valida-cda/redaccion-fiscal'
import { ClausulaCobro, TEXTO_PRUEBA_CANCELADA } from '../valida/cobro-prueba'
import { CancelarPruebaSuscripcion } from './cancelar-prueba-suscripcion'

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/**
 * `/suscripcion` durante la prueba gratis de Valida (2026-10-16): el plan en prueba, las consultas
 * usadas, la fecha y el valor del primer cobro (la cláusula con su texto exacto), la tarjeta (los 4
 * dígitos que da ePayco; ONE no guarda la tarjeta) y «Cancelar prueba», la misma acción de `/valida`.
 * Al activarse el plan, la suscripción pasa a activa y esta página muestra la sección de siempre.
 */
export function SuscripcionEnPruebaVista({ s }: { s: SuscripcionEnPrueba }) {
  const cobro = s.prueba?.cobro ?? null
  const cancelada = s.estado === 'cancelada' || cobro?.estado === 'cancelado'
  const tarjeta = s.ultimos4 ? `Terminada en ${s.ultimos4}` : s.conTarjeta ? 'La tarjeta que registraste' : 'Sin tarjeta registrada'
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-suscripcion-en-prueba={s.estado}>
      <header data-encabezado-suscripcion className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Suscripción</p>
            <h1 className="text-xl font-bold text-tinta">{s.razonSocial}</h1>
            <p className="text-sm text-tinta">{PLAN_CDA}</p>
          </div>
          <span
            data-chip-estado={cancelada ? 'prueba_cancelada' : 'en_prueba'}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
              cancelada ? 'border-border bg-papel text-tinta-suave' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {cancelada ? 'Prueba cancelada' : 'En prueba'}
          </span>
        </div>
        {s.soloLectura && (
          <p data-solo-lectura className="rounded-md border border-border bg-papel px-3 py-2 text-xs text-tinta-suave">
            Estás viendo como la persona que abrió la prueba: solo lectura.
          </p>
        )}
      </header>

      <section className="rounded-lg border border-border bg-white p-4 sm:p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-tinta-suave">Plan</dt>
            <dd className="font-semibold text-tinta">{cancelada ? 'Prueba gratis (cancelada)' : 'Prueba gratis'}</dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Consultas de prueba</dt>
            <dd className="text-tinta" data-consultas-usadas={s.consultas ? `${s.consultas.usadas}/${s.consultas.total}` : undefined}>
              {s.consultas ? (
                <>
                  <span className="font-semibold">{s.consultas.usadas}</span> usadas de {s.consultas.total} · te quedan{' '}
                  <span className="font-semibold text-acento">{s.consultas.restantes}</span>
                </>
              ) : (
                'No pudimos leerlas ahora.'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">{cobro && !cancelada ? 'Primer cobro' : 'Fin de la prueba'}</dt>
            <dd className="text-tinta" data-primer-cobro>
              {cobro && !cancelada ? (
                <>
                  <span className="font-semibold">${PESOS.format(cobro.precio)}</span> el {cobro.fechaYHora}
                </>
              ) : (
                (s.prueba?.finTexto ?? '—')
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Tarjeta</dt>
            <dd className="text-tinta" data-tarjeta>
              {cancelada ? 'Se pidió a ePayco borrarla' : tarjeta}
            </dd>
          </div>
        </dl>

        {cobro && !cancelada && (
          <div className="mt-4 border-t border-border pt-3">
            <ClausulaCobro fechaYHora={cobro.fechaYHora} fechaCorta={cobro.fechaCorta} precio={cobro.precio} />
          </div>
        )}
        {cancelada && <p className="mt-4 border-t border-border pt-3 text-sm text-tinta-suave">{TEXTO_PRUEBA_CANCELADA}</p>}

        {!s.soloLectura && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={RUTA_ACTIVAR_PLAN}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-acento px-5 text-sm font-semibold text-white"
            >
              Activar plan
            </Link>
            {cobro?.estado === 'programado' && cobro.puedeCancelar && !cancelada && <CancelarPruebaSuscripcion boton={cobro.boton} />}
          </div>
        )}
      </section>
    </div>
  )
}
