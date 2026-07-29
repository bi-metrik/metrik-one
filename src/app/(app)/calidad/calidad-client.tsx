'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { C, MONO } from './components/tokens'
import { OrigenBadge, SemaforoBadge } from './components/semaforo-badge'
import { duracion, slugAgente, type LlamadaResumen, type Semaforo } from './types'

const FILTROS = [
  { key: 'todas', label: 'Todas' },
  { key: 'rojo', label: 'Rojo' },
  { key: 'amarillo', label: 'Amarillo' },
  { key: 'verde', label: 'Verde' },
  { key: 'auditadas', label: 'Con transcripción' },
] as const

type FiltroKey = (typeof FILTROS)[number]['key']

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function CalidadClient({
  llamadas,
  soloMias,
}: {
  llamadas: LlamadaResumen[]
  /** true cuando el usuario es ejecutor: la vista es su hoja, no la del piso. */
  soloMias: boolean
}) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<FiltroKey>('todas')

  const visibles = useMemo(() => {
    if (filtro === 'todas') return llamadas
    if (filtro === 'auditadas') return llamadas.filter((l) => l.detalleCompleto)
    return llamadas.filter((l) => l.semaforo === (filtro as Semaforo))
  }, [llamadas, filtro])

  const conteo = useMemo(() => {
    const c: Record<string, number> = { rojo: 0, amarillo: 0, verde: 0 }
    for (const l of llamadas) c[l.semaforo] += 1
    return c
  }, [llamadas])

  const tecnicaPromedio = llamadas.length
    ? Math.round(llamadas.reduce((a, l) => a + l.puntajeTecnico, 0) / llamadas.length)
    : 0

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1120, color: C.ink }}>
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: C.inkMuted,
            marginBottom: 5,
          }}
        >
          {soloMias ? 'Mis llamadas' : 'Llamadas auditadas'}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          {soloMias ? 'Tus llamadas, con la evidencia' : 'Todas, no una muestra'}
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '66ch', fontSize: 14 }}>
          Cada llamada entra con sus dos ejes calificados. La técnica da puntaje; el cumplimiento
          levanta banderas. No se promedian.
        </p>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <Kpi label="Llamadas" valor={String(llamadas.length)} nota={soloMias ? 'asignadas a ti' : 'auditadas hoy'} />
        <Kpi label="En rojo" valor={String(conteo.rojo)} nota={`${pct(conteo.rojo, llamadas.length)}% del total`} tono="bad" />
        <Kpi label="En amarillo" valor={String(conteo.amarillo)} nota={`${pct(conteo.amarillo, llamadas.length)}% del total`} />
        <Kpi label="Técnica promedio" valor={String(tecnicaPromedio)} nota="sobre 100 puntos" />
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTROS.map((f) => {
          const activo = filtro === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltro(f.key)}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '.05em',
                textTransform: 'uppercase',
                padding: '5px 11px',
                borderRadius: 4,
                border: `1px solid ${activo ? C.ink : C.line}`,
                background: activo ? C.ink : C.surface,
                color: activo ? C.surface : C.inkMuted,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.line}`,
          borderRadius: 6,
          padding: '16px 18px',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 720 }}>
            <thead>
              <tr>
                {['Llamada', 'Agente', 'Duración', 'Técnica', 'Cumplimiento', 'Banderas'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: C.inkMuted,
                      padding: '0 12px 9px',
                      borderBottom: `1px solid ${C.line}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => (
                // Solo las llamadas con transcripcion auditada tienen detalle.
                // Las de relleno no llevan a ninguna parte, y no simulamos que si.
                <tr
                  key={l.id}
                  onClick={l.detalleCompleto ? () => router.push(`/calidad/llamada/${l.id}`) : undefined}
                  style={l.detalleCompleto ? { cursor: 'pointer' } : undefined}
                >
                    <td style={td}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <b style={{ fontWeight: 600 }}>{fmtFecha(l.fechaHora)}</b>
                          <OrigenBadge esReal={l.esReal} />
                        </span>
                        <span style={{ fontSize: 11.5, color: C.inkMuted }}>
                          {l.direccion} · {l.clienteRef}
                        </span>
                      </div>
                    </td>
                    <td style={td}>
                      {/* Puerta al perfil. `stopPropagation` porque la fila
                          entera navega al detalle de la llamada: sin esto, un
                          click en el nombre abriria las dos cosas. */}
                      <a
                        href={`/calidad/agente/${slugAgente(l.agenteNombre)}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: C.ink, textDecoration: 'none', borderBottom: `1px solid ${C.line}` }}
                      >
                        {l.agenteNombre}
                      </a>
                    </td>
                    <td style={{ ...td, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                      {duracion(l.duracionSeg)}
                    </td>
                    <td style={{ ...td, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                      {l.puntajeTecnico}
                    </td>
                    <td style={td}>
                      <SemaforoBadge semaforo={l.semaforo} />
                    </td>
                    <td style={{ ...td, fontFamily: MONO, color: l.codigos.length ? C.ink : C.inkMuted }}>
                      {l.codigos.length ? l.codigos.join(' ') : '—'}
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibles.length === 0 && (
          <p style={{ fontSize: 13.5, color: C.inkMuted, padding: '18px 12px 4px', margin: 0 }}>
            Sin llamadas para este filtro.
          </p>
        )}

        <p style={nota}>
          Solo la llamada marcada como <b>real</b> corresponde a una grabación auditada. El resto son{' '}
          <b>datos de demostración</b>: sirven para mostrar la forma del tablero, no el estado de la
          operación.
        </p>
      </div>
    </div>
  )
}

const td: React.CSSProperties = {
  padding: '11px 12px',
  borderBottom: `1px solid ${C.line}`,
  verticalAlign: 'middle',
}

const nota: React.CSSProperties = {
  fontSize: 12.5,
  color: C.inkMuted,
  background: C.surfaceAlt,
  border: `1px dashed ${C.lineStrong}`,
  borderRadius: 6,
  padding: '11px 13px',
  marginTop: 14,
  marginBottom: 0,
}

function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

function Kpi({
  label,
  valor,
  nota: notaTexto,
  tono,
}: {
  label: string
  valor: string
  nota: string
  tono?: 'bad' | 'up'
}) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: C.inkMuted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: '-1px',
          lineHeight: 1.15,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: tono === 'bad' ? C.crit : tono === 'up' ? C.brandDeep : C.ink,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 3 }}>{notaTexto}</div>
    </div>
  )
}
