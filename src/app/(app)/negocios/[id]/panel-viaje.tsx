'use client'

import Link from 'next/link'
import { ClipboardList, FileText, Plus, UserRound } from 'lucide-react'
import { ESTADO_COTIZACION_CONFIG } from '@/lib/catalogos/constants'
import { formatCOP } from '@/lib/cobros/format'
import { fechaCortaBogota, type MarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio'

/**
 * Lo que el negocio de viaje (Trappvel) suma al panel del contacto: la solicitud, el
 * perfil del cliente y las cotizaciones abiertas. Vive DENTRO de `PanelContacto` para
 * que el negocio y su cotización pinten exactamente el mismo panel (corrección de
 * Mauricio a #874). Sin `viaje` no se pinta nada: el resto de líneas no cambia (R6).
 */

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-xs">{children}</dd>
    </div>
  )
}

function Encabezado({ icono, titulo }: { icono: React.ReactNode; titulo: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icono}
      <h3 className="text-xs font-semibold">{titulo}</h3>
    </div>
  )
}

export default function PanelViaje({ viaje, cotActualId }: { viaje: MarcoDelNegocio; cotActualId: string | null }) {
  const s = viaje.solicitud
  const p = viaje.perfil
  const destino = [s.destino, s.alcance?.toLowerCase()].filter(Boolean).join(' · ') || null
  const fechas = [s.fechas, s.tipoDeFechas].filter(Boolean).join(' · ') || null

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-3" data-panel-solicitud>
        <Encabezado icono={<ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />} titulo="Solicitud" />
        {destino || fechas || s.pasajeros || s.requisitos ? (
          <dl className="space-y-1">
            {destino && <Fila label="Destino">{destino}</Fila>}
            {fechas && <Fila label="Fechas">{fechas}</Fila>}
            {s.pasajeros && <Fila label="Pasajeros">{s.pasajeros}</Fila>}
            {s.requisitos && <Fila label="Requisitos">{s.requisitos}</Fila>}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">El negocio todavía no tiene la solicitud del viaje.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-3" data-panel-perfil>
        <Encabezado icono={<UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />} titulo="Perfil del cliente" />
        {p ? (
          <dl className="space-y-1">
            {p.tipo && <Fila label="Tipo">{p.tipo}</Fila>}
            {p.conQuienViaja && <Fila label="Viaja con">{p.conQuienViaja}</Fila>}
            {p.bolsillo && <Fila label="Bolsillo declarado">{p.bolsillo}</Fila>}
            {p.preferencias && <Fila label="Preferencias">{p.preferencias}</Fila>}
            {p.notas && <Fila label="Notas">{p.notas}</Fila>}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Sin perfil todavía.</p>
        )}
      </section>

      {viaje.cotizaciones && (
        <section className="rounded-lg border border-border bg-card p-3" data-lista-cotizaciones>
          <Encabezado icono={<FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />} titulo="Cotizaciones" />
          {viaje.cotizaciones.length === 0 && (
            <p className="text-xs text-muted-foreground">Todavía no hay cotizaciones abiertas.</p>
          )}
          <ul className="space-y-1">
            {viaje.cotizaciones.map(c => {
              const actual = c.id === cotActualId
              const estado = ESTADO_COTIZACION_CONFIG[c.estado as keyof typeof ESTADO_COTIZACION_CONFIG]
              const contenido = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tabular-nums">{c.codigo}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estado?.chipClass ?? 'bg-muted'}`}>
                      {estado?.label ?? c.estado}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{c.valorTotal && c.valorTotal > 0 ? formatCOP(c.valorTotal) : 'Sin total'}</span>
                    {c.editadaEl && <span>edit. {fechaCortaBogota(c.editadaEl)}</span>}
                  </span>
                </>
              )
              return (
                <li key={c.id}>
                  {actual ? (
                    <div aria-current="page" className="flex flex-col rounded-md border-l-2 border-primary bg-primary/5 px-2 py-1.5">
                      {contenido}
                    </div>
                  ) : (
                    <Link
                      href={`/negocios/${viaje.negocioId}/cotizacion/${c.id}`}
                      className="flex flex-col rounded-md border-l-2 border-transparent px-2 py-1.5 hover:bg-accent"
                    >
                      {contenido}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
          {viaje.puedeCrearCotizacion && (
            <Link
              href={`/negocios/${viaje.negocioId}/cotizacion/nueva`}
              prefetch={false}
              className="mt-1 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Nueva cotización
            </Link>
          )}
        </section>
      )}
    </>
  )
}
