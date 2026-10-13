'use client'

/**
 * «Mis pendientes» (F6-9, Noor §5): Vencido · Hoy · Esta semana, una acción por línea, y para la
 * dirección las aprobaciones en la línea y la tarjeta «Margen del mes» con el tablero (F6-8).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { pesosCierre } from '@/lib/viaje/cierre-viaje'
import type { Grupo, Pendiente, Tablero } from '@/lib/viaje/mis-pendientes'
import { decidirAprobacionServicio } from './servicios-viaje-actions'
import { decidirAprobacionPlan } from './confirmacion-viaje-actions'

const TITULO: Record<Grupo, string> = { vencido: 'Vencido', hoy: 'Hoy', semana: 'Esta semana' }
const COLOR: Record<Grupo, string> = { vencido: 'text-red-700', hoy: 'text-foreground', semana: 'text-muted-foreground' }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fechaCorta = (f: string) => { const [, m, d] = f.split('-').map(Number); return `${d} ${MESES[m - 1].slice(0, 3)}` }

function Aprobar({ p }: { p: Pendiente }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const [motivo, setMotivo] = useState<string | null>(null)
  if (p.accion.tipo !== 'aprobar') return null
  const { aprobacionId, servicioId } = p.accion
  const decidir = (decision: 'aprobada' | 'rechazada') => startTransition(async () => {
    const r = servicioId
      ? await decidirAprobacionServicio(servicioId, aprobacionId, decision, decision === 'rechazada' ? motivo : null)
      : await decidirAprobacionPlan(p.negocioId, aprobacionId, decision, decision === 'rechazada' ? motivo : null)
    if (!r.ok) { toast.error(r.error); return }
    toast.success(decision === 'aprobada' ? 'Aprobado. Le avisamos.' : 'No aprobado. Le avisamos con tu motivo.')
    router.refresh()
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={isPending} onClick={() => decidir('aprobada')} className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">Aprobar</button>
      {motivo === null ? (
        <button type="button" disabled={isPending} onClick={() => setMotivo('')} className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60">No aprobar</button>
      ) : (
        <>
          <input autoFocus value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué no? (le llega a quien pidió)" className="h-11 min-w-0 flex-1 rounded-md border px-2 text-sm" />
          <button type="button" disabled={isPending || !motivo.trim()} onClick={() => decidir('rechazada')} className="min-h-11 rounded-md border border-red-300 px-3 text-sm text-red-700 disabled:opacity-60">No aprobar</button>
        </>
      )}
    </div>
  )
}

export default function MisPendientes({
  pendientes,
  proximo,
  tablero,
}: {
  pendientes: Pendiente[]
  proximo: { texto: string; fecha: string } | null
  tablero: Tablero | null
}) {
  const grupos = (['vencido', 'hoy', 'semana'] as const).map(g => ({ g, items: pendientes.filter(p => p.grupo === g) })).filter(x => x.items.length > 0)
  const mes = tablero?.meses[0] ?? null
  return (
    <div className="space-y-4" data-mis-pendientes>
      {tablero && (
        <section className="rounded-lg border p-3 text-xs">
          <p className="text-sm font-semibold">Margen del mes</p>
          {mes ? (
            <p className="mt-1">
              {MESES[Number(mes.mes.slice(5, 7)) - 1].replace(/^./, c => c.toUpperCase())}: {mes.viajes} viaje{mes.viajes === 1 ? '' : 's'} cerrado{mes.viajes === 1 ? '' : 's'} · margen real {mes.pctReal ?? '—'} % · cotizado {mes.pctCotizado ?? '—'} %
              {tablero.proveedores[0] && tablero.proveedores[0].desviacion > 0 ? ` · más desviación: ${tablero.proveedores[0].proveedor}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">Todavía no hay cierres confirmados.</p>
          )}
          {tablero.viajes.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">Ver por viaje, por proveedor y tarjetas personales</summary>
              <ul className="mt-1 divide-y">
                {tablero.viajes.map(v => (
                  <li key={v.negocioId} className="flex flex-wrap justify-between gap-2 py-1">
                    <Link href={`/negocios/${v.negocioId}`} className="min-w-0 flex-1 underline">{v.nombre}</Link>
                    <span className="tabular-nums">real {pesosCierre(v.margenReal)} ({v.pctReal ?? '—'} %) · cotizado {pesosCierre(v.margenCotizado)}</span>
                  </li>
                ))}
              </ul>
              {tablero.proveedores.length > 0 && (
                <p className="mt-2">Desviación por proveedor: {tablero.proveedores.map(p => `${p.proveedor} ${p.desviacion > 0 ? '+' : ''}${pesosCierre(p.desviacion)}`).join(' · ')}</p>
              )}
              <p className="mt-1">Pagado con tarjetas personales: {tablero.pctTarjetasPersonales ?? 0} %</p>
            </details>
          )}
        </section>
      )}

      {grupos.length === 0 ? (
        <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
          Nada pendiente hoy.{proximo ? ` Lo próximo: ${proximo.texto} el ${fechaCorta(proximo.fecha)}.` : ''}
        </p>
      ) : grupos.map(({ g, items }) => (
        <section key={g} className="space-y-2">
          <p className={`text-xs font-semibold uppercase tracking-wide ${COLOR[g]}`}>{TITULO[g]} · {items.length}</p>
          <ul className="space-y-2">
            {items.map(p => (
              <li key={p.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                <p>{p.texto}</p>
                <p className="text-xs text-muted-foreground">{p.viaje}</p>
                {p.accion.tipo === 'aprobar' ? <Aprobar p={p} /> : (
                  <Link href={`/negocios/${p.negocioId}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium">{p.accion.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
