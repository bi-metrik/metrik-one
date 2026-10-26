'use client'

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'
import {
  casillasDeRuta,
  PLANES,
  type CasillaNoOfrecida,
  type PlanN,
  type PlanTarifa,
  type RutaTarifa,
  type TarifaVersion,
} from '@/lib/propuesta/tarifas'
import { getTarifasServicio, guardarTarifasServicio, type TarifasServicioVista } from './tarifas-actions'

// Editor de las tarifas fijas por plan y ruta de un servicio. Cada guardado crea una
// versión NUEVA con su vigencia; la anterior queda en el historial. El valor de cada
// casilla no se teclea: sale del valor del plan por el % de la ruta.

const NOMBRES_PLAN: Record<PlanN, string> = {
  1: 'Plan 1 (tarifa plena)',
  2: 'Plan 2 (pago anticipado)',
}

function fecha(iso: string): string {
  return iso.split('-').reverse().join('/')
}

interface Borrador {
  planes: Array<{ n: PlanN; nombre: string; valor: string }>
  rutas: Array<{ valor: string; nombre: string; pct: string }>
  no_ofrece: CasillaNoOfrecida[]
  cap: string
  vigente_desde: string
  nota: string
}

function borradorDesde(vista: TarifasServicioVista): Borrador {
  const ultima = vista.versiones[0] as TarifaVersion | undefined
  // Rutas: las que un negocio puede declarar hoy, con el % de la última versión. Una
  // ruta que la versión tenía y ya no se puede declarar se conserva, para no perderla
  // en silencio al guardar.
  const rutas = vista.rutasDisponibles.map(r => {
    const previa = ultima?.rutas.find(x => x.valor === r.valor)
    return { valor: r.valor, nombre: previa?.nombre ?? r.nombre, pct: previa ? String(previa.pct) : '' }
  })
  for (const r of ultima?.rutas ?? []) {
    if (!rutas.some(x => x.valor === r.valor)) rutas.push({ valor: r.valor, nombre: r.nombre, pct: String(r.pct) })
  }
  return {
    planes: PLANES.map(n => {
      const p = ultima?.planes.find(x => x.n === n)
      return { n, nombre: p?.nombre ?? NOMBRES_PLAN[n], valor: p ? String(p.valor) : '' }
    }),
    rutas,
    no_ofrece: ultima?.no_ofrece ?? [],
    cap: ultima ? String(ultima.cap_descuento_pct) : '25',
    vigente_desde: vista.hoy,
    nota: '',
  }
}

export default function TarifasServicio({ servicioId }: { servicioId: string }) {
  const [vista, setVista] = useState<TarifasServicioVista | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [guardando, startGuardar] = useTransition()

  const cargar = () =>
    getTarifasServicio(servicioId).then(res => {
      if ('error' in res) {
        setError(res.error)
        return
      }
      setVista(res)
      setBorrador(borradorDesde(res))
    })

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId])

  if (error) return <p className="px-4 py-3 text-xs text-red-700">{error}</p>
  if (!vista || !borrador) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando tarifas…
      </div>
    )
  }

  const vigente = vista.versiones.find(v => v.vigente_desde <= vista.hoy) ?? null
  const puede = vista.puedeEditar

  // La versión que se está armando, para calcular las casillas en vivo.
  const enCurso = {
    planes: borrador.planes.map(p => ({ n: p.n, nombre: p.nombre, valor: Number(p.valor) || 0 })) as PlanTarifa[],
    rutas: borrador.rutas.map(r => ({ valor: r.valor, nombre: r.nombre, pct: Number(r.pct) || 0 })) as RutaTarifa[],
    no_ofrece: borrador.no_ofrece,
  }
  const marcada = (plan: PlanN, ruta: string) =>
    borrador.no_ofrece.some(c => c.plan === plan && c.ruta === ruta)
  const alternar = (plan: PlanN, ruta: string) =>
    setBorrador({
      ...borrador,
      no_ofrece: marcada(plan, ruta)
        ? borrador.no_ofrece.filter(c => !(c.plan === plan && c.ruta === ruta))
        : [...borrador.no_ofrece, { plan, ruta }],
    })

  const guardar = () =>
    startGuardar(async () => {
      const res = await guardarTarifasServicio(servicioId, {
        planes: enCurso.planes,
        rutas: enCurso.rutas,
        no_ofrece: borrador.no_ofrece,
        cap_descuento_pct: Number(borrador.cap),
        vigente_desde: borrador.vigente_desde,
        nota: borrador.nota,
      })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Tarifas guardadas (versión ${res.version})`)
      await cargar()
    })

  const input = 'rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-70'

  return (
    <div className="space-y-3 border-t px-4 py-3">
      <div className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
        {vigente ? (
          <>
            Rige la <strong>versión {vigente.version}</strong> para los negocios creados desde el{' '}
            {fecha(vigente.vigente_desde)}. Los negocios anteriores, y las propuestas que ya se
            emitieron con otra versión, no cambian.
          </>
        ) : vista.versiones.length > 0 ? (
          <>La primera versión rige desde el {fecha(vista.versiones[vista.versiones.length - 1].vigente_desde)}.</>
        ) : (
          <>Sin tarifas: las propuestas usan el precio estándar y el descuento que escriba el comercial.</>
        )}
        {!puede && (
          <span className="mt-1 flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> Solo el dueño o el administrador pueden cambiarlas.
          </span>
        )}
      </div>

      {vista.rutasDisponibles.length === 0 && borrador.rutas.length === 0 ? (
        <p className="text-xs text-amber-700">
          Ninguna línea declara rutas («¿Qué contrató el cliente?»), así que no hay a qué ponerle tarifa.
        </p>
      ) : (
        <>
          {/* Valor fijo de cada plan */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {borrador.planes.map((p, i) => (
              <label key={p.n} className="text-xs">
                <span className="mb-1 block font-medium text-muted-foreground">{p.nombre} · con IVA</span>
                <input
                  type="number"
                  min="0"
                  step="500"
                  disabled={!puede}
                  value={p.valor}
                  onChange={e => {
                    const planes = [...borrador.planes]
                    planes[i] = { ...p, valor: e.target.value }
                    setBorrador({ ...borrador, planes })
                  }}
                  className={`${input} w-full`}
                />
              </label>
            ))}
          </div>

          {/* Matriz plan × ruta: % por ruta arriba, casillas calculadas abajo */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-1.5 pr-2 font-medium">Ruta</th>
                  {borrador.rutas.map((r, i) => (
                    <th key={r.valor} className="pb-1.5 pr-2 font-medium">
                      <span className="block">{r.nombre}</span>
                      <span className="mt-1 inline-flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          disabled={!puede}
                          value={r.pct}
                          onChange={e => {
                            const rutas = [...borrador.rutas]
                            rutas[i] = { ...r, pct: e.target.value }
                            setBorrador({ ...borrador, rutas })
                          }}
                          className={`${input} w-16`}
                        />
                        %
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLANES.map(n => (
                  <tr key={n} className="border-b border-dashed last:border-0">
                    <td className="py-2 pr-2 font-medium">{borrador.planes.find(p => p.n === n)?.nombre}</td>
                    {borrador.rutas.map(r => {
                      const c = casillasDeRuta(enCurso, r.valor)[n]
                      const no = marcada(n, r.valor)
                      return (
                        <td key={r.valor} className="py-2 pr-2">
                          <span className={no ? 'text-muted-foreground line-through' : 'font-medium'}>
                            {c.valor ? formatCOP(c.valor) : '—'}
                          </span>
                          <label className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <input type="checkbox" disabled={!puede} checked={no} onChange={() => alternar(n, r.valor)} />
                            No se ofrece
                          </label>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block font-medium text-muted-foreground">Descuento máximo del comercial</span>
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  disabled={!puede}
                  value={borrador.cap}
                  onChange={e => setBorrador({ ...borrador, cap: e.target.value })}
                  className={`${input} w-20`}
                />
                % sobre la casilla
              </span>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-muted-foreground">Rige para negocios creados desde</span>
              <input
                type="date"
                min={vista.hoy}
                disabled={!puede}
                value={borrador.vigente_desde}
                onChange={e => setBorrador({ ...borrador, vigente_desde: e.target.value })}
                className={`${input} w-full`}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-muted-foreground">Nota (opcional)</span>
              <input
                type="text"
                maxLength={280}
                disabled={!puede}
                value={borrador.nota}
                onChange={e => setBorrador({ ...borrador, nota: e.target.value })}
                placeholder="Por qué cambia"
                className={`${input} w-full`}
              />
            </label>
          </div>

          {puede && (
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar como versión {(vista.versiones[0]?.version ?? 0) + 1}
            </button>
          )}
        </>
      )}

      {/* Historial: cada versión se conserva y se puede consultar */}
      {vista.versiones.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Historial</p>
          <ul className="space-y-1">
            {vista.versiones.map(v => (
              <li key={v.id} className="rounded border text-xs">
                <button
                  type="button"
                  onClick={() => setAbierta(abierta === v.version ? null : v.version)}
                  className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
                >
                  {abierta === v.version ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-muted-foreground">
                    desde {fecha(v.vigente_desde)} · {v.creado_por_nombre ?? 'carga inicial'} ·{' '}
                    {formatBogotaFechaHora(v.created_at)}
                  </span>
                </button>
                {abierta === v.version && (
                  <div className="space-y-1 border-t px-2.5 py-2">
                    {v.nota && <p className="text-muted-foreground">{v.nota}</p>}
                    <p className="text-muted-foreground">Descuento máximo {v.cap_descuento_pct}%</p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pr-2 font-medium" />
                          {v.rutas.map(r => (
                            <th key={r.valor} className="pr-2 font-medium">{r.nombre} ({r.pct}%)</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PLANES.map(n => (
                          <tr key={n}>
                            <td className="pr-2">{v.planes.find(p => p.n === n)?.nombre}</td>
                            {v.rutas.map(r => {
                              const c = casillasDeRuta(v, r.valor)[n]
                              return (
                                <td key={r.valor} className="pr-2">
                                  {c.ofrece ? formatCOP(c.valor ?? 0) : <span className="text-muted-foreground">no se ofrece</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
