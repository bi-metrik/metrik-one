'use client'

import { AlertTriangle, BadgeCheck } from 'lucide-react'
import { TextoDocumento } from '@/components/terminos/entrada-terminos'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'
import type { Carga, ResultadoTerminosAprobados } from '@/lib/valida-api/resultados'

/**
 * Piezas de pestaña que comparten Valida API (`/valida-api`) y Valida de los CDA (`/valida`): el aviso
 * de una pestaña que no cargó y la relectura de los términos aprobados, con el mismo texto, el mismo
 * render y el mismo sello. Vivían en `valida-api-cliente.tsx` hasta el 2026-09-23.
 */

/** Lo que se dice cuando una pestaña no cargó. Nunca una lista vacía en su lugar. */
export function AvisoCarga({ carga }: { carga: Exclude<Carga<unknown>, { estado: 'ok' }> }) {
  if (carga.estado === 'sin_acceso') {
    return <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">{carga.razon}</p>
  }
  const titulo = carga.estado === 'rechazada' ? 'Valida rechazó la consulta' : 'No disponible en este momento'
  const detalle =
    carga.estado === 'rechazada'
      ? carga.mensaje
      : carga.motivo === 'sin_migracion'
        ? 'Esta sección todavía no está habilitada en este entorno.'
        : 'No pudimos conectar con Valida. El resto del módulo funciona; intenta de nuevo en unos minutos.'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">{titulo}</p>
        <p className="mt-1">{detalle}</p>
      </div>
    </div>
  )
}

/**
 * Los términos aprobados, con el mismo texto y el mismo render de la entrada, y un sello «Aprobado».
 * Solo lectura: sin casilla, sin botón y con el scroll normal de la página. El texto llega únicamente
 * si el servidor comprobó que es el de la versión aprobada; si no, se dice, y no se pinta ningún otro.
 *
 * `alcance`:
 *   - `usuario` (Valida API): lo que aprobó la persona de la sesión, en su entrada.
 *   - `empresa` (Valida de los CDA): lo que aceptó la persona designada en nombre de la empresa. Los
 *     demás usuarios no firmaron nada propio, así que decir «aprobado por ti» sería falso.
 */
export function PestanaTerminos({
  carga,
  alcance = 'usuario',
}: {
  carga: ResultadoTerminosAprobados
  alcance?: 'usuario' | 'empresa'
}) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  if (carga.datos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
        {alcance === 'empresa'
          ? 'No encontramos términos aceptados por tu empresa. Escríbenos si esperabas verlos.'
          : 'No encontramos términos aprobados por ti en este espacio. Escríbenos si esperabas verlos.'}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {carga.datos.map((t) =>
        t.estado === 'verificado' ? (
          <article key={t.documentoId} data-termino-aprobado className="rounded-lg border border-border bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                {t.titulo} · {t.version}
              </p>
              <span
                data-sello-aprobado
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
              >
                <BadgeCheck className="h-4 w-4" />
                Aprobado
              </span>
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-tinta-suave">
              {alcance === 'empresa' ? (
                <p>
                  Aceptados en nombre de tu empresa el {formatBogotaFechaHora(t.aprobadoAt)} (hora Colombia)
                  {t.contrato?.aceptadoPor ? `, por ${t.contrato.aceptadoPor}` : ''}
                  {t.contrato?.canal === 'whatsapp' ? ', por WhatsApp.' : ', en este módulo.'}
                </p>
              ) : (
                <>
                  <p>Aprobado por ti el {formatBogotaFechaHora(t.aprobadoAt)} (hora Colombia).</p>
                  {t.contrato && (
                    <p>
                      Contrato aceptado el {formatBogotaFechaHora(t.contrato.aceptadoAt)}
                      {t.contrato.aceptadoPor && ` por ${t.contrato.aceptadoPor}`}
                      {t.contrato.canal === 'whatsapp' ? ', por WhatsApp.' : ', en este módulo.'}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="mt-4 rounded-md border border-border bg-papel p-4 text-sm leading-relaxed text-tinta [overflow-wrap:anywhere]">
              <TextoDocumento md={t.textoMd} />
            </div>
          </article>
        ) : (
          <div
            key={`${t.titulo ?? 'documento'}-${t.version}`}
            data-termino-no-verificado
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {alcance === 'empresa' ? 'No podemos mostrar el texto que aceptó tu empresa' : 'No podemos mostrar el texto que aprobaste'}
                {t.titulo ? ` de «${t.titulo}»` : ''} ({t.version})
              </p>
              <p className="mt-1">
                {alcance === 'empresa' ? 'La aceptación' : 'Tu aprobación'} es del {formatBogotaFechaHora(t.aprobadoAt)} (hora
                Colombia), pero no pudimos comprobar que el texto guardado sea el mismo que{' '}
                {alcance === 'empresa' ? 'se aceptó' : 'aprobaste'}, así que no mostramos ninguno. Escríbenos para revisarlo.
              </p>
            </div>
          </div>
        ),
      )}
    </div>
  )
}
