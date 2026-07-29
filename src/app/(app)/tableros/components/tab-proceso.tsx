'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Info, Minus, RotateCcw } from 'lucide-react'
import type { ProcesoSeccionalData, ProcesoSeccionalEtapa, ProcesoSeccionalCelda } from '../types'
import { ChartCard } from './chart-card'

// Paleta MeTRIK (tokens del manual de marca, no Tailwind generico).
const VERDE = '#10B981'
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#F59E0B'
const ROJO = '#B91C1C'
const OCRE = '#92400E'

/**
 * Foto del proceso: UNA sola tabla con dos niveles de detalle.
 *
 * Contraída muestra el total por etapa; expandida abre las columnas por seccional. Antes
 * eran dos tablas separadas (totales arriba, seccionales abajo) y había que cruzarlas a
 * ojo. El total de cada etapa se calcula sumando sus seccionales, así que las dos vistas
 * no pueden contar distinto por construcción.
 *
 * El segundo selector cambia la métrica: cuántos casos hay, o cuántos van atrasados.
 *
 * La columna de reprocesos son los dos indicadores de calidad del comité directivo:
 * certificados UPME que salieron mal y devoluciones que la DIAN rechazó.
 */
export function TabProceso({ data }: { data: ProcesoSeccionalData }) {
  const {
    etapas,
    conCita,
    sinCita,
    sinRegistrar,
    total,
    fechaFotoPrevia,
    reprocesosTotal,
    etapasConSla,
    etapasTotales,
  } = data

  const [detalle, setDetalle] = useState<'totales' | 'seccional'>('totales')
  const [metrica, setMetrica] = useState<'abiertos' | 'vencidos'>('abiertos')

  const valorDe = (c?: ProcesoSeccionalCelda) =>
    c ? (metrica === 'abiertos' ? c.abiertos : c.vencidos) : 0
  const antesDe = (c?: ProcesoSeccionalCelda) =>
    c ? (metrica === 'abiertos' ? c.abiertosAntes : c.vencidosAntes) : null

  const celda = (e: ProcesoSeccionalEtapa, nombre: string | null) =>
    e.celdas.find(c => c.seccional === nombre)

  const sumaGrupo = (e: ProcesoSeccionalEtapa, nombres: string[]) => {
    let hoy = 0
    let antes: number | null = null
    for (const n of nombres) {
      const c = celda(e, n)
      hoy += valorDe(c)
      const a = antesDe(c)
      if (a !== null) antes = (antes ?? 0) + a
    }
    return { hoy, antes }
  }

  const totalColumna = (
    getter: (e: ProcesoSeccionalEtapa) => { hoy: number; antes: number | null },
  ) => {
    let hoy = 0
    let antes: number | null = null
    for (const e of etapas) {
      const v = getter(e)
      hoy += v.hoy
      if (v.antes !== null) antes = (antes ?? 0) + v.antes
    }
    return { hoy, antes }
  }

  if (etapas.length === 0) {
    return (
      <ChartCard title="Foto del proceso" accentColor={VERDE}>
        <p className="py-4 text-center text-sm" style={{ color: GRIS }}>
          No hay negocios abiertos.
        </p>
      </ChartCard>
    )
  }

  const totalGeneral = totalColumna(e => ({ hoy: valorDe(e.total), antes: antesDe(e.total) }))
  const totalReprocesos = reprocesosTotal.certificacionUpme + reprocesosTotal.devolucionDian
  const cuello = etapas.reduce<ProcesoSeccionalEtapa>(
    (m, e) => (valorDe(e.total) > valorDe(m.total) ? e : m),
    etapas[0],
  )

  return (
    <div className="space-y-4">
      <ChartCard title="Foto del proceso" accentColor={VERDE}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs" style={{ color: GRIS }}>
            <span>
              <strong className="text-base" style={{ color: CARBON }}>{totalGeneral.hoy}</strong>{' '}
              {metrica === 'abiertos' ? 'casos abiertos' : 'casos atrasados'}
            </span>
            {valorDe(cuello.total) > 0 && (
              <span>
                Mayor acumulado: <strong style={{ color: CARBON }}>{cuello.nombre}</strong> (
                {valorDe(cuello.total)})
              </span>
            )}
            {totalReprocesos > 0 && (
              <span style={{ color: ROJO }}>
                <RotateCcw className="mr-0.5 inline h-3 w-3" />
                <strong>{totalReprocesos}</strong> en reproceso
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Selector
              valor={detalle}
              onChange={setDetalle}
              opciones={[
                { key: 'totales' as const, label: 'Totales' },
                { key: 'seccional' as const, label: 'Por seccional' },
              ]}
            />
            <Selector
              valor={metrica}
              onChange={setMetrica}
              opciones={[
                { key: 'abiertos' as const, label: 'Casos' },
                { key: 'vencidos' as const, label: 'Solo atrasados' },
              ]}
            />
          </div>
        </div>

        <p className="mb-2 text-[11px]" style={{ color: GRIS }}>
          {fechaFotoPrevia
            ? `Cada celda muestra hoy / ${fechaFotoPrevia}`
            : 'La comparación con la semana anterior aparece cuando se tome la siguiente foto.'}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: detalle === 'seccional' ? 680 : 420 }}>
            <thead>
              <tr className="border-b" style={{ borderColor: BORDE }}>
                <Th align="left">Etapa</Th>
                {detalle === 'seccional' && (
                  <>
                    {conCita.map(c => (
                      <Th key={c} color={AMBAR} title="Seccional que exige cita previa en la DIAN">
                        {c}
                      </Th>
                    ))}
                    <Th title={sinCita.join(', ') || 'Sin casos'}>Sin cita</Th>
                    <Th color={OCRE}>Sin registrar</Th>
                  </>
                )}
                <Th>Total</Th>
                <Th color={ROJO} title="Certificados UPME rehechos y devoluciones rechazadas por la DIAN">
                  Reproceso
                </Th>
              </tr>
            </thead>
            <tbody>
              {etapas.map(e => (
                <tr key={e.etapaId} className="border-b last:border-0" style={{ borderColor: BORDE }}>
                  <td className="py-2 pr-3 text-xs" style={{ color: CARBON }}>
                    <span className="tabular-nums" style={{ color: GRIS }}>
                      {String(e.numero).padStart(2, '0')}
                    </span>{' '}
                    {e.nombre}
                    {metrica === 'vencidos' && !e.slaHoras && (
                      <span
                        className="ml-1 text-[10px]"
                        style={{ color: BORDE }}
                        title="Esta etapa no tiene tiempo máximo configurado"
                      >
                        sin SLA
                      </span>
                    )}
                  </td>
                  {detalle === 'seccional' && (
                    <>
                      {conCita.map(c => {
                        const cel = celda(e, c)
                        return <Celda key={c} hoy={valorDe(cel)} antes={antesDe(cel)} color={AMBAR} />
                      })}
                      <Celda {...sumaGrupo(e, sinCita)} />
                      <Celda hoy={valorDe(celda(e, null))} antes={antesDe(celda(e, null))} color={OCRE} />
                    </>
                  )}
                  <Celda hoy={valorDe(e.total)} antes={antesDe(e.total)} negrita />
                  <ReprocesoCelda r={e.reprocesos} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: BORDE }}>
                <td className="pt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: GRIS }}>
                  Total ({total})
                </td>
                {detalle === 'seccional' && (
                  <>
                    {conCita.map(c => {
                      const t = totalColumna(e => ({
                        hoy: valorDe(celda(e, c)),
                        antes: antesDe(celda(e, c)),
                      }))
                      return <Celda key={c} hoy={t.hoy} antes={t.antes} color={AMBAR} negrita />
                    })}
                    <Celda {...totalColumna(e => sumaGrupo(e, sinCita))} negrita />
                    <Celda
                      {...totalColumna(e => ({
                        hoy: valorDe(celda(e, null)),
                        antes: antesDe(celda(e, null)),
                      }))}
                      color={OCRE}
                      negrita
                    />
                  </>
                )}
                <Celda hoy={totalGeneral.hoy} antes={totalGeneral.antes} negrita />
                <ReprocesoCelda r={reprocesosTotal} negrita />
              </tr>
            </tfoot>
          </table>
        </div>

        {metrica === 'vencidos' && etapasConSla < etapasTotales && (
          <Aviso>
            Solo <strong>{etapasConSla} de {etapasTotales}</strong> etapas tienen tiempo máximo
            configurado. Una etapa sin configurar nunca aparece como atrasada, aunque tenga casos
            represados.
          </Aviso>
        )}
        {detalle === 'seccional' && sinRegistrar > 0 && metrica === 'abiertos' && (
          <Aviso>
            <strong>{sinRegistrar} de {total}</strong> casos no tienen seccional registrada, así que
            no se sabe todavía si necesitan cita. Se toma del RUT (casilla 12) y el cargue de los
            casos antiguos está pendiente.
          </Aviso>
        )}
      </ChartCard>

      {/* Calidad: los dos cuadros del comité. Se muestran aunque estén en cero, porque su
          ausencia también es información: nadie ha tenido que rehacer trabajo. */}
      <ChartCard title="Calidad" accentColor={totalReprocesos > 0 ? ROJO : VERDE}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Indicador
            label="Certificados UPME rehechos"
            valor={reprocesosTotal.certificacionUpme}
            ayuda="El certificado salió mal y el caso volvió a Cargue"
          />
          <Indicador
            label="Devoluciones rechazadas por la DIAN"
            valor={reprocesosTotal.devolucionDian}
            ayuda="La DIAN rechazó la devolución y el caso volvió a Cita"
          />
        </div>
        {totalReprocesos === 0 && (
          <p className="mt-3 text-[11px]" style={{ color: GRIS }}>
            Ningún caso en reproceso. Solo cuenta el error propio: si la DIAN devuelve por criterio
            del funcionario, no penaliza el indicador.
          </p>
        )}
      </ChartCard>
    </div>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────

function Selector<T extends string>({
  valor,
  onChange,
  opciones,
}: {
  valor: T
  onChange: (v: T) => void
  opciones: Array<{ key: T; label: string }>
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
      {opciones.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
            valor === o.key ? 'bg-white shadow-sm' : ''
          }`}
          style={{ color: valor === o.key ? CARBON : GRIS }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Th({
  children,
  align = 'right',
  color = GRIS,
  title,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  color?: string
  title?: string
}) {
  return (
    <th
      className={`pb-2 ${align === 'left' ? 'text-left' : 'text-right'} text-[10px] font-bold uppercase tracking-wide`}
      style={{ color }}
      title={title}
    >
      {children}
    </th>
  )
}

/** Celda "hoy / antes" con flecha de cambio. El antes va atenuado: manda el de hoy. */
function Celda({
  hoy,
  antes,
  color = CARBON,
  negrita,
}: {
  hoy: number
  antes: number | null
  color?: string
  negrita?: boolean
}) {
  const delta = antes === null ? null : hoy - antes
  return (
    <td className="py-2 text-right tabular-nums">
      <span style={{ color: hoy > 0 ? color : BORDE, fontWeight: negrita || hoy > 0 ? 600 : 400 }}>
        {hoy || '·'}
      </span>
      {antes !== null && (
        <>
          <span style={{ color: BORDE }}>{' / '}</span>
          <span className="text-[11px]" style={{ color: GRIS }}>
            {antes}
          </span>
          {delta !== null && delta !== 0 && (
            <span
              className="ml-0.5 inline-flex items-center text-[10px]"
              style={{ color: delta > 0 ? AMBAR : VERDE }}
              title={`${delta > 0 ? '+' : ''}${delta} contra la foto anterior`}
            >
              {delta > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
            </span>
          )}
          {delta === 0 && <Minus className="ml-0.5 inline h-2.5 w-2.5" style={{ color: BORDE }} />}
        </>
      )}
    </td>
  )
}

function ReprocesoCelda({
  r,
  negrita,
}: {
  r: { certificacionUpme: number; devolucionDian: number }
  negrita?: boolean
}) {
  const n = r.certificacionUpme + r.devolucionDian
  return (
    <td className="py-2 text-right tabular-nums">
      {n > 0 ? (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: '#FEE2E2', color: ROJO }}
          title={`${r.certificacionUpme} por certificado UPME · ${r.devolucionDian} por devolución DIAN`}
        >
          <RotateCcw className="h-3 w-3" />
          {n}
        </span>
      ) : (
        <span style={{ color: BORDE, fontWeight: negrita ? 600 : 400 }}>·</span>
      )}
    </td>
  )
}

function Indicador({ label, valor, ayuda }: { label: string; valor: number; ayuda: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: BORDE }}>
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: valor > 0 ? ROJO : CARBON }}>
        {valor}
      </p>
      <p className="mt-0.5 text-[10px]" style={{ color: GRIS }}>
        {ayuda}
      </p>
    </div>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-[11px]" style={{ color: OCRE }}>
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
