import { C, MONO } from '../components/tokens'
import { DISCLAIMER_BANDERAS, type DuenoData } from '../types'

const usd = (n: number) =>
  `US$${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

/**
 * Vendido contra recaudado, cuota por cuota.
 *
 * El tablero que hoy se proyecta en el televisor de Regat muestra ventas. Pero
 * la venta no termina cuando el agente cierra: termina en la cuota 6. Esta
 * pantalla es la unica del modulo que muestra plata, y por eso es la unica que
 * solo ve el dueno.
 */
export default function DuenoClient({ datos }: { datos: DuenoData }) {
  const maxVendido = Math.max(...datos.cuotas.map((c) => c.vendidoUsd), 1)

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1120, color: C.ink }}>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Vista de dueño · privada</div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          Lo vendido contra lo recaudado
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '66ch', fontSize: 14 }}>
          Esta pantalla no se proyecta. Es la única del módulo que lleva dinero y solo la ve el
          dueño.
        </p>
      </div>

      <section style={{ ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Kpi label="Ventas cerradas" valor={String(datos.ventasCerradas)} nota="a US$799, en 6 cuotas" />
        <Kpi
          label="Llegaron a cuota 6"
          valor={String(datos.llegaronCuota6)}
          nota={`${pct(datos.llegaronCuota6, datos.ventasCerradas)}% de las cerradas`}
          tono="bad"
        />
        <Kpi label="Recaudo efectivo" valor={`${datos.recaudoPct}%`} nota="de lo vendido" tono="bad" />
        <Kpi
          label="Dejado de recaudar"
          valor={usd(datos.vendidoTotal - datos.recaudadoTotal)}
          nota={`de ${usd(datos.vendidoTotal)} vendidos`}
          tono="bad"
        />
      </section>

      {/* Caída cuota a cuota */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>La caída, cuota por cuota</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {datos.cuotas.map((c) => {
              const pctRec = c.vendidoUsd > 0 ? (c.recaudadoUsd / c.vendidoUsd) * 100 : 0
              return (
                <div key={c.cuota}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                      fontSize: 13.5,
                    }}
                  >
                    <span>
                      Cuota {c.cuota}{' '}
                      <span style={{ color: C.inkMuted }}>· {c.ventas} de {datos.ventasCerradas} pagaron</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                      {usd(c.recaudadoUsd)}{' '}
                      <span style={{ color: C.inkMuted }}>de {usd(c.vendidoUsd)}</span>
                    </span>
                  </div>
                  {/* Barra doble: lo esperado en gris, lo recaudado encima. */}
                  <div
                    style={{
                      position: 'relative',
                      height: 10,
                      background: C.line,
                      borderRadius: 5,
                      marginTop: 6,
                      overflow: 'hidden',
                      width: `${(c.vendidoUsd / maxVendido) * 100}%`,
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${pctRec}%`,
                        background: pctRec >= 85 ? C.brand : pctRec >= 60 ? C.high : C.crit,
                        borderRadius: 5,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <p style={nota}>
            La venta no termina cuando el agente cierra: termina en la cuota 6. El tablero que hoy se
            proyecta en el piso muestra ventas, no plata recaudada.
          </p>
        </div>
      </section>

      {/* Banderas críticas abiertas */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Banderas críticas abiertas</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          {datos.criticasAbiertas.length === 0 ? (
            <p style={{ fontSize: 13.5, color: C.inkMuted, margin: 0 }}>
              Sin banderas críticas registradas.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {datos.criticasAbiertas.map((b) => (
                <div
                  key={b.codigo}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: `1px solid ${C.line}`,
                  }}
                >
                  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.crit }}>
                    {b.codigo}
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{b.titulo}</span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 15,
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {b.veces}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p style={nota}>
            La llamada se anuncia como grabada, y esa misma grabación es la que contiene los datos de
            tarjeta. El registro que se conserva para protegerse concentra la exposición.
          </p>
        </div>

        <p
          style={{
            fontSize: 12,
            color: C.inkMuted,
            marginTop: 26,
            paddingTop: 14,
            borderTop: `1px solid ${C.line}`,
          }}
        >
          {DISCLAIMER_BANDERAS} Cifras de demostración.
        </p>
      </section>
    </div>
  )
}

function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 6,
}

const grid: React.CSSProperties = { display: 'grid', gap: 14 }

const eyebrow: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: C.inkMuted,
  marginBottom: 5,
}

const h2: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  margin: '0 0 12px',
  color: C.inkMuted,
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

function Kpi({
  label,
  valor,
  nota: notaTexto,
  tono,
}: {
  label: string
  valor: string
  nota: string
  tono?: 'bad'
}) {
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
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
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-1px',
          lineHeight: 1.15,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: tono === 'bad' ? C.crit : C.ink,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 3 }}>{notaTexto}</div>
    </div>
  )
}
