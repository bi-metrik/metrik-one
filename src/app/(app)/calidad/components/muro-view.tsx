'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { MuroData } from '../types'

/**
 * Muro proyectable, v2.
 *
 * Vive en un televisor que ve todo el piso e incluso visitas. Tres zonas:
 *
 *   1. HEROE — cierres de hoy partidos por forma de pago. Tarjeta es caja que
 *      entro; cuenta es una promesa a seis cuotas que puede caerse (y si se
 *      cae, el servicio se suspende). Contar los dos como "una venta" es el
 *      error del Excel que este muro viene a reemplazar.
 *   2. RANKING — el corazon de la pantalla. El que va primero cerrando pero con
 *      bandera roja es la conversacion del dia; el que cierra menos, todo en
 *      tarjeta y sin banderas, es el que hoy nadie ve.
 *   3. PIE — recobro pendiente, cobertura y la bandera que mas se repite.
 *
 * Por que la cobertura NO es el heroe: una vez instalado el producto marca 100%
 * todos los dias. Informa una vez y despues es constante. Un televisor necesita
 * algo que se mueva durante el dia y sobre lo que el piso pueda actuar.
 *
 * Que NO lleva, y no es negociable: `cliente_ref`. El muro nunca identifica al
 * cliente final, y la RPC que lo alimenta tampoco lo devuelve. Los agentes
 * salen por NOMBRE DE PILA porque el enlace es publico: en el piso todos se
 * conocen, en internet un nombre de pila no identifica a nadie.
 *
 * Que SI lleva desde v2: montos en dolares. Decision explicita de Mauricio.
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

const usd = (n: number) => `US$${Math.round(n).toLocaleString('es-CO')}`

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

  const c = data.cierres
  const pie = data.pie

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
        padding: '24px 36px 18px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 20 }}>
        <div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 22,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: M.muted,
            }}
          >
            Cierres de hoy
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', marginTop: 2 }}>
            {nombreWorkspace}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: MONO, fontSize: 22, color: M.muted }}>
              {new Date(`${data.fecha}T12:00:00`).toLocaleDateString('es-CO', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </div>
            {/*
              El día pedido no tenía actividad y esto es el último día con
              llamadas. Se dice en pantalla en vez de mostrar la fecha de otro
              día como si fuera hoy.
            */}
            {data.esFallback && (
              <div style={{ fontFamily: MONO, fontSize: 16, color: M.high, marginTop: 2 }}>
                último día con actividad
              </div>
            )}
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
              <Maximize2 style={{ width: 18, height: 18 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Zonas 1 y 2 ────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '0.85fr 1.15fr',
          gap: 20,
          marginTop: 20,
        }}
      >
        {/* ── Zona 1: el héroe ── */}
        <Panel titulo="Cerrado hoy">
          <div
            style={{
              fontFamily: MONO,
              fontSize: 132,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-4px',
              color: M.brand,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {c?.total ?? 0}
          </div>
          <div style={{ fontSize: 24, color: M.muted, marginTop: 6 }}>
            de {c?.llamadas ?? 0} llamadas · {usd(c?.montoUsd ?? 0)}
          </div>

          {/* El desglose que hace la diferencia */}
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormaPago
              etiqueta="Con tarjeta"
              nota="cobrado, entró completo"
              n={c?.tarjeta.n ?? 0}
              monto={c?.tarjeta.montoUsd ?? 0}
              color={M.ok}
            />
            <FormaPago
              etiqueta="Por cuenta"
              nota={`a seis cuotas · ${usd(c?.cuenta.primeraCuotaUsd ?? 0)} este mes`}
              n={c?.cuenta.n ?? 0}
              monto={c?.cuenta.montoUsd ?? 0}
              color={M.high}
            />
          </div>
        </Panel>

        {/* ── Zona 2: el ranking ── */}
        <Panel titulo="Quién cerró, y cómo">
          {data.ranking.length === 0 ? (
            <div style={{ fontSize: 24, color: M.muted }}>Sin cierres registrados hoy.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 76px 100px 20px',
                  gap: 12,
                  paddingBottom: 8,
                  borderBottom: `1px solid ${M.line}`,
                  fontFamily: MONO,
                  fontSize: 15,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: M.muted,
                }}
              >
                <span>Agente</span>
                <span style={{ textAlign: 'right' }}>Cierres</span>
                <span style={{ textAlign: 'right' }}>Tarjeta</span>
                <span />
              </div>

              {data.ranking.slice(0, 7).map((a) => (
                <div
                  key={a.agente}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 76px 100px 20px',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: `1px solid ${M.line}`,
                    fontSize: 27,
                  }}
                >
                  {/* Nombre de pila. El muro es público por enlace. */}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.agente}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontWeight: 600,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {a.cierres}
                  </span>
                  {/* Verde cuando TODO lo que cerró fue con tarjeta: es el dato
                      que el conteo de ventas esconde. */}
                  <span
                    style={{
                      fontFamily: MONO,
                      textAlign: 'right',
                      color: a.cierres > 0 && a.tarjeta === a.cierres ? M.ok : M.muted,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {a.tarjeta} de {a.cierres}
                  </span>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: COLOR_SEMAFORO[a.semaforo] ?? M.muted,
                      justifySelf: 'end',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Zona 3: el pie ─────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px solid ${M.line}`,
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          gap: 32,
          alignItems: 'baseline',
          fontSize: 21,
          color: M.muted,
        }}
      >
        <span>
          <b style={{ fontFamily: MONO, color: pie.recobro?.pendientesRecobro ? M.high : M.muted }}>
            {pie.recobro?.pendientesRecobro ?? 0}
          </b>{' '}
          débitos rebotados por recobrar
          {pie.recobro?.montoEnRiesgoUsd ? ` · ${usd(pie.recobro.montoEnRiesgoUsd)} en riesgo` : ''}
        </span>

        <span>
          <b style={{ fontFamily: MONO, color: M.ink }}>
            {pie.cobertura?.auditadas ?? 0} de {pie.cobertura?.recibidas ?? 0}
          </b>{' '}
          llamadas auditadas
          {pie.cobertura?.baseline ? ` · antes ${pie.cobertura.baseline} a mano` : ''}
        </span>

        <span style={{ textAlign: 'right' }}>
          {pie.banderaTop ? (
            <>
              Se repite más:{' '}
              <b style={{ fontFamily: MONO, color: M.crit }}>{pie.banderaTop.codigo}</b>{' '}
              {pie.banderaTop.titulo}
              <span style={{ color: M.muted }}> · {pie.banderaTop.veces} veces</span>
            </>
          ) : (
            'Sin banderas hoy'
          )}
        </span>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 16,
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

function FormaPago({
  etiqueta,
  nota,
  n,
  monto,
  color,
}: {
  etiqueta: string
  nota: string
  n: number
  monto: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 46,
          fontWeight: 600,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 62,
        }}
      >
        {n}
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 25, color: M.ink }}>
          {etiqueta} <span style={{ fontFamily: MONO, color: M.muted }}>{usd(monto)}</span>
        </span>
        <span style={{ display: 'block', fontSize: 19, color: M.muted, marginTop: 1 }}>{nota}</span>
      </span>
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
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <h2
        style={{
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: M.muted,
          margin: '0 0 16px',
        }}
      >
        {titulo}
      </h2>
      {children}
    </section>
  )
}
