'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { mmss, type MuroData } from '../types'

/**
 * Muro proyectable.
 *
 * Vive en un televisor que ve todo el piso e incluso visitas. Dos consecuencias
 * de diseno que no son negociables:
 *   1. NO lleva dinero ni el identificador del cliente. La RPC que lo alimenta
 *      tampoco los devuelve, asi que meterlos exigiria cambiar SQL.
 *   2. Los agentes salen por NOMBRE DE PILA. Como el muro es publico por enlace,
 *      en internet un nombre de pila no identifica a nadie; en el piso todos se
 *      conocen igual. Misma logica de minimizacion que la transcripcion.
 *
 * Forma: h-dvh sin scroll, fondo oscuro, numero heroe grande, tres bloques,
 * todo legible a tres metros.
 */

const M = {
  bg: '#1A1A1A',
  panel: '#232321',
  line: '#32322F',
  ink: '#EDECEA',
  muted: '#9A9C9F',
  brand: '#34D399',
  crit: '#F87171',
  high: '#FBBF24',
  ok: '#34D399',
} as const

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

const COLOR_SEMAFORO: Record<string, string> = {
  rojo: M.crit,
  amarillo: M.high,
  verde: M.ok,
}

export default function MuroView({
  data,
  nombreWorkspace,
  /** true en la version publica: activa auto-refresh y botón de pantalla completa. */
  proyectable = false,
}: {
  data: MuroData
  nombreWorkspace: string
  proyectable?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Auto-refresh cada 30 s. Solo en el muro proyectable: dentro de la app
  // recargar la pagina cada medio minuto seria hostil.
  useEffect(() => {
    if (!proyectable) return
    const t = setInterval(() => window.location.reload(), 30_000)
    return () => clearInterval(t)
  }, [proyectable])

  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  const alternarPantallaCompleta = () => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen?.()
      setPantallaCompleta(true)
    } else {
      document.exitFullscreen?.()
      setPantallaCompleta(false)
    }
  }

  const cob = data.cobertura
  const sem = data.semaforos

  return (
    <div
      ref={ref}
      style={{
        height: '100dvh',
        overflow: 'hidden',
        background: M.bg,
        color: M.ink,
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 40px',
        boxSizing: 'border-box',
      }}
    >
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 20 }}>
        <div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 24,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: M.muted,
            }}
          >
            Calidad de llamadas
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.5px', marginTop: 2 }}>
            {nombreWorkspace}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 24, color: M.muted }}>
            {new Date(`${data.fecha}T12:00:00`).toLocaleDateString('es-CO', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </div>
          {proyectable && (
            <button
              type="button"
              onClick={alternarPantallaCompleta}
              aria-label="Pantalla completa"
              style={{
                background: 'transparent',
                border: `1px solid ${M.line}`,
                borderRadius: 6,
                color: M.muted,
                cursor: 'pointer',
                padding: 8,
                display: 'flex',
              }}
            >
              <Maximize2 style={{ width: 20, height: 20 }} />
            </button>
          )}
        </div>
      </div>

      {/* Tres bloques, no más */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr 1.2fr',
          gap: 22,
          marginTop: 26,
        }}
      >
        {/* 1. Cobertura — el número héroe */}
        <Panel titulo="Cobertura de auditoría">
          <div
            style={{
              fontFamily: MONO,
              fontSize: 140,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-4px',
              color: M.brand,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {cob ? cob.pct : 0}
            <span style={{ fontSize: 56, letterSpacing: 0 }}>%</span>
          </div>
          <div style={{ fontSize: 26, color: M.muted, marginTop: 14, lineHeight: 1.35 }}>
            {cob ? (
              <>
                {cob.auditadas} de {cob.recibidas} llamadas
                <br />
                <span style={{ color: M.high }}>
                  antes {cob.pctBaseline}% · {cob.baseline} a mano
                </span>
              </>
            ) : (
              'Sin registros del día'
            )}
          </div>
        </Panel>

        {/* 2. Semáforo del día + bandera que más se repite */}
        <Panel titulo="Cumplimiento del día">
          {sem ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(['rojo', 'amarillo', 'verde'] as const).map((k) => {
                const n = sem[k]
                const pct = sem.total > 0 ? (n / sem.total) * 100 : 0
                return (
                  <div key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 26, textTransform: 'capitalize' }}>{k}</span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 34,
                          fontWeight: 600,
                          color: COLOR_SEMAFORO[k],
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {n}
                      </span>
                    </div>
                    <div style={{ height: 8, background: M.line, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: COLOR_SEMAFORO[k] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: 26, color: M.muted }}>Sin registros del día</div>
          )}

          {data.banderaTop && (
            <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${M.line}` }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 20,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: M.muted,
                }}
              >
                Se repite más
              </div>
              <div style={{ fontSize: 28, marginTop: 6, lineHeight: 1.3 }}>
                <b style={{ fontFamily: MONO, color: M.crit }}>{data.banderaTop.codigo}</b>{' '}
                {data.banderaTop.titulo}
                <span style={{ color: M.muted }}> · {data.banderaTop.veces} veces</span>
              </div>
            </div>
          )}
        </Panel>

        {/* 3. Últimas llamadas cayendo */}
        <Panel titulo="Últimas llamadas">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
            {data.ultimas.slice(0, 9).map((u, i) => (
              <div
                key={`${u.hora}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '82px 1fr 78px 20px',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${M.line}`,
                  fontSize: 26,
                }}
              >
                <span style={{ fontFamily: MONO, color: M.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {u.hora}
                </span>
                {/* Nombre de pila. El muro es público por enlace. */}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.agente}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    textAlign: 'right',
                    color: M.muted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {mmss(u.duracion)}
                </span>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: COLOR_SEMAFORO[u.semaforo] ?? M.muted,
                    justifySelf: 'end',
                  }}
                />
              </div>
            ))}
            {data.ultimas.length === 0 && (
              <div style={{ fontSize: 26, color: M.muted }}>Sin llamadas registradas hoy.</div>
            )}
          </div>
        </Panel>
      </div>

      <div
        style={{
          marginTop: 18,
          fontSize: 18,
          color: M.muted,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <span>Datos de demostración. Una llamada real; el resto es muestra.</span>
        <span>Powered by MéTRIK</span>
      </div>

      {pantallaCompleta && <span hidden />}
    </div>
  )
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: M.panel,
        border: `1px solid ${M.line}`,
        borderRadius: 10,
        padding: '22px 26px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <h2
        style={{
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: M.muted,
          margin: '0 0 18px',
        }}
      >
        {titulo}
      </h2>
      {children}
    </section>
  )
}
