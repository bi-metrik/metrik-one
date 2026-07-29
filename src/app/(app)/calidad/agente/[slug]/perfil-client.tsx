'use client'

import Link from 'next/link'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C, MONO } from '../../components/tokens'
import {
  COMO_SUBIR,
  leerTendencia,
  type LecturaTendencia,
  type PerfilAgente,
  type Semaforo,
} from '../../types'

/**
 * Perfil de agente. Responde dos preguntas y nada mas:
 *
 *   ¿este agente esta mejorando o empeorando?  → dispersion + lectura
 *   ¿que tiene que hacer para subir?           → recomendaciones
 *
 * ES UNA PANTALLA DE TRABAJO, no un muro. Se mira de cerca, en un escritorio,
 * mientras se prepara una sesion de entrenamiento: aqui la densidad ayuda y el
 * criterio de los tres metros no aplica.
 *
 * SIRVE PARA ENTRENAR, NO PARA CASTIGAR. El encuadre no es cosmetico: cambia
 * para que se usa la pantalla. Por eso las recomendaciones hablan de conductas
 * ("haz una pregunta cada dos minutos"), no de la persona ("no sabe escuchar"),
 * y el bloque fuerte se nombra igual que el debil.
 *
 * LOS DOS EJES NO SE PROMEDIAN. El eje Y es el puntaje tecnico; el cumplimiento
 * entra como COLOR del punto, nunca sumado. Una llamada de 84 con una bandera
 * critica no es "una de 70": es una buena llamada con un problema aparte, y la
 * pantalla tiene que dejar ver las dos cosas sin mezclarlas.
 */

/**
 * Una fila del grafico. Los puntos y la recta comparten serie (Recharts la
 * quiere unica), asi que todo es opcional salvo la posicion en el eje temporal:
 * una fila de la recta no tiene semaforo y una llamada no tiene `recta`.
 */
type Fila = {
  x: number
  y?: number
  /**
   * Una clave por color en vez de `<Cell>` dentro de `<Scatter>`: en Recharts 3
   * las Cell reciben un ref que revienta el render en runtime (no lo ve el
   * compilador, solo la pantalla). Tres series, cada una con su `fill`, son
   * ademas mas honestas con el modelo: el cumplimiento es una dimension propia,
   * no una decoracion de los puntos del score.
   */
  yVerde?: number
  yAmarillo?: number
  yRojo?: number
  recta?: number
  id?: string
  ref?: string
  fecha?: string
  dia?: string
  tecnica?: number
  semaforo?: Semaforo
  cerroVenta?: boolean
  detalle?: boolean
}

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: C.ok,
  amarillo: C.high,
  rojo: C.crit,
}

/**
 * Los puntos se dibujan con `Line` sin trazo y con `dot`, no con `Scatter`.
 * Recharts 3.7 revienta en runtime al montar un `Scatter` bajo React 19
 * ("Expected ref to be a function...") y no hay ningun `Scatter` mas en el
 * proyecto que respalde el camino; `Line` si esta probado en los otros
 * tableros. Visualmente es la misma dispersion: sin linea que una los puntos.
 */
const puntosPorColor: [keyof Fila, string][] = [
  ['yVerde', C.ok],
  ['yAmarillo', C.high],
  ['yRojo', C.crit],
]

const LECTURA: Record<LecturaTendencia, { titulo: string; tono: string }> = {
  alza: { titulo: 'Viene subiendo', tono: C.ok },
  baja: { titulo: 'Viene bajando', tono: C.crit },
  estable: { titulo: 'Se mantiene estable', tono: C.inkMuted },
  sin_datos: { titulo: 'Todavía sin suficientes llamadas', tono: C.inkMuted },
}

export default function PerfilAgenteClient({ perfil }: { perfil: PerfilAgente }) {
  const { kpis, tendencia, bloques, puntos } = perfil
  const lectura = leerTendencia(tendencia)
  const nombreCorto = perfil.agente.split(' ')[0]

  // Serie para el grafico. `x` es el dia como numero para que el eje sea
  // temporal de verdad y no una secuencia de llamadas: si el agente hizo 40
  // llamadas un dia y 3 al siguiente, eso tiene que verse.
  const t0 = new Date(`${perfil.desde}T00:00:00`).getTime()
  const datos: Fila[] = puntos.map((p) => ({
    ...p,
    // Sin redondear: `Math.round` sobre la fraccion del dia empuja una llamada
    // de las 18:00 al dia siguiente y el eje termina mostrando una fecha que no
    // existe en el periodo.
    x: (new Date(`${p.fecha}:00`).getTime() - t0) / 86_400_000,
    y: p.tecnica,
    yVerde: p.semaforo === 'verde' ? p.tecnica : undefined,
    yAmarillo: p.semaforo === 'amarillo' ? p.tecnica : undefined,
    yRojo: p.semaforo === 'rojo' ? p.tecnica : undefined,
  }))

  // Linea de tendencia: la misma recta que sostiene la lectura de arriba, para
  // que el ojo vea de donde sale la palabra. Se dibuja solo si hay pendiente.
  const conRecta =
    tendencia.porSemana !== null && datos.length >= 3
      ? (() => {
          const n = datos.length
          const mx = datos.reduce((a, d) => a + d.x, 0) / n
          const my = datos.reduce((a, d) => a + (d.y ?? 0), 0) / n
          const m = tendencia.porSemana! / 7
          const b = my - m * mx
          const xs = [Math.min(...datos.map((d) => d.x)), Math.max(...datos.map((d) => d.x))]
          return xs.map((x): Fila => ({ x, recta: m * x + b }))
        })()
      : ([] as Fila[])

  const serie: Fila[] = [...datos, ...conRecta].sort((a, b) => a.x - b.x)

  const fecha = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })

  // Tres, no diez: una sesion de entrenamiento no cabe mas, y una lista larga
  // se lee como un expediente. Entra solo el bloque con puntaje real en juego Y
  // margen real de mejora: quien saca 19 de 20 en Educacion tecnica no necesita
  // que le recomienden Educacion tecnica, aunque quede 1 punto sobre la mesa.
  const recomendaciones = bloques.filter((b) => b.enJuego >= 1 && b.pctLogro < 90).slice(0, 3)
  const fuerte = [...bloques].sort((a, b) => b.pctLogro - a.pctLogro)[0]

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1180, color: C.ink }}>
      <Link href="/calidad" style={{ fontSize: 13, color: C.inkMuted, textDecoration: 'none' }}>
        ← Llamadas
      </Link>

      <div style={{ margin: '14px 0 20px' }}>
        <div style={eyebrow}>
          Perfil de agente · {fecha(perfil.desde)} a {fecha(perfil.hasta)}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          {perfil.agente}
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '70ch', fontSize: 13.5 }}>
          Cómo viene {nombreCorto}, hacia dónde va y dónde hay puntaje por ganar. La técnica da
          score; el cumplimiento levanta banderas. No se promedian.
        </p>
      </div>

      <section style={{ ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Kpi label="Llamadas" valor={String(kpis.llamadas)} nota="auditadas en el período" />
        <Kpi label="Técnica promedio" valor={String(kpis.tecnica)} nota="sobre 100 puntos" />
        <Kpi
          label="Cierre"
          valor={`${kpis.pctCierre}%`}
          nota={`${kpis.cierres} de ${kpis.llamadas} llamadas`}
        />
        <Kpi
          label="Errores críticos"
          valor={String(kpis.criticas)}
          nota="eje de cumplimiento, aparte del score"
        />
      </section>

      {/* ── Dispersión + tendencia ─────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Llamada por llamada</h2>
        <div style={{ ...card, padding: '18px 20px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: LECTURA[lectura].tono }}>
              {LECTURA[lectura].titulo}
            </span>
            <span style={{ fontSize: 13, color: C.inkMuted }}>
              {lectura === 'sin_datos' ? (
                'Hacen falta al menos tres llamadas en el período para leer una tendencia.'
              ) : (
                <>
                  {tendencia.porSemana !== null && (
                    <>
                      {tendencia.porSemana > 0 ? '+' : ''}
                      {tendencia.porSemana} puntos por semana
                      {' · '}
                    </>
                  )}
                  {tendencia.primeraMitad !== null && tendencia.segundaMitad !== null && (
                    <>
                      {tendencia.primeraMitad} → {tendencia.segundaMitad} entre la primera y la
                      segunda mitad
                    </>
                  )}
                </>
              )}
            </span>
          </div>
          {lectura === 'estable' && (
            <p style={{ fontSize: 12.5, color: C.inkMuted, margin: '6px 0 0' }}>
              El movimiento del período es menor que la variación normal entre sus propias
              llamadas: rinde parecido a como venía.
            </p>
          )}

          <div style={{ height: 300, marginTop: 14 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: C.inkMuted, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: C.line }}
                  tickFormatter={(v: number) => {
                    const d = new Date(t0 + v * 86_400_000)
                    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: C.inkMuted, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ stroke: C.lineStrong }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload
                    if (!active || !p || p.tecnica === undefined) return null
                    return (
                      <div
                        style={{
                          background: C.surface,
                          border: `1px solid ${C.lineStrong}`,
                          borderRadius: 6,
                          padding: '8px 10px',
                          fontSize: 12.5,
                          boxShadow: '0 2px 8px rgba(0,0,0,.08)',
                        }}
                      >
                        <div style={{ fontFamily: MONO, color: C.inkMuted }}>
                          {p.fecha.replace('T', ' · ')}
                        </div>
                        <div style={{ fontWeight: 700, marginTop: 2 }}>Técnica {p.tecnica}</div>
                        <div style={{ color: COLOR_SEMAFORO[p.semaforo as Semaforo] }}>
                          {p.semaforo === 'verde'
                            ? 'Sin banderas'
                            : p.semaforo === 'amarillo'
                              ? 'Con banderas'
                              : 'Con banderas críticas'}
                        </div>
                        {p.cerroVenta && <div style={{ color: C.brand }}>Cerró venta</div>}
                        {p.detalle && (
                          <div style={{ color: C.inkMuted, marginTop: 2 }}>Tiene transcripción</div>
                        )}
                      </div>
                    )
                  }}
                />
                {/* El cumplimiento es el COLOR del punto, jamás parte de la altura. */}
                {puntosPorColor.map(([clave, color]) => (
                  <Line
                    key={clave}
                    dataKey={clave}
                    stroke="none"
                    dot={{ r: 3, fill: color, fillOpacity: 0.6, stroke: 'none' }}
                    activeDot={{ r: 5, fill: color, stroke: C.surface, strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="recta"
                  stroke={C.ink}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              fontSize: 12,
              color: C.inkMuted,
              padding: '2px 4px 12px',
            }}
          >
            <Leyenda color={C.ok} texto={`Sin banderas · ${kpis.verde}`} />
            <Leyenda color={C.high} texto={`Con banderas · ${kpis.amarillo}`} />
            <Leyenda color={C.crit} texto={`Con críticas · ${kpis.rojo}`} />
            <span>· La línea es la tendencia del período.</span>
          </div>
        </div>
      </section>

      {/* ── Recomendaciones ────────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Dónde hay puntaje por ganar</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          {recomendaciones.length === 0 ? (
            <p style={{ fontSize: 13.5, color: C.inkMuted, margin: 0 }}>
              No hay un bloque con puntaje suficiente en juego: {nombreCorto} está cerca del máximo
              en todos. Aquí el entrenamiento no es de técnica.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {recomendaciones.map((b, i) => (
                <div
                  key={b.orden}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '26px 1fr 132px',
                    gap: 12,
                    alignItems: 'start',
                    paddingBottom: i < recomendaciones.length - 1 ? 14 : 0,
                    borderBottom:
                      i < recomendaciones.length - 1 ? `1px solid ${C.line}` : undefined,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 700,
                      color: C.inkMuted,
                      lineHeight: '20px',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{b.nombre}</div>
                    <p style={{ fontSize: 13.5, color: C.ink, margin: '4px 0 0', lineHeight: 1.5 }}>
                      {COMO_SUBIR[b.nombre] ?? 'Revisar las llamadas del período en este bloque.'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 19,
                        fontWeight: 600,
                        color: C.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      +{b.enJuego}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.inkMuted }}>
                      puntos en juego
                      <br />
                      hoy {b.promedio} de {b.maximo}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {fuerte && fuerte.pctLogro >= 75 && (
            <p style={nota}>
              Lo que ya hace bien: <b>{fuerte.nombre}</b>, {fuerte.promedio} de {fuerte.maximo} en
              promedio. Es la base sobre la que se apoya el resto del entrenamiento.
            </p>
          )}
        </div>
      </section>

      {/* ── Desglose completo ──────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Los siete bloques, en promedio</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {[...bloques]
              .sort((a, b) => a.orden - b.orden)
              .map((b) => {
                const pct = b.maximo > 0 ? (b.promedio / b.maximo) * 100 : 0
                const color = pct >= 75 ? C.brand : pct >= 45 ? C.high : C.crit
                return (
                  <div
                    key={b.orden}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 74px', gap: 12, alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontSize: 13.5, color: C.ink }}>{b.nombre}</div>
                      <div
                        style={{
                          height: 5,
                          background: C.line,
                          borderRadius: 3,
                          marginTop: 6,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: C.inkMuted,
                      }}
                    >
                      {b.promedio}/{b.maximo}
                    </div>
                  </div>
                )
              })}
          </div>
          <p style={nota}>
            Promedio de {kpis.llamadas} llamadas del período. La escala de color es la misma del
            detalle de llamada, para que un bloque en rojo signifique lo mismo en las dos pantallas.
          </p>
        </div>
      </section>
    </div>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 9, height: 9, borderRadius: '50%', background: color, opacity: 0.65 }} />
      {texto}
    </span>
  )
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

/**
 * Cifra de cabecera. Sin variante de alarma a proposito: en el muro el rojo
 * ordena a tres metros, pero aqui la pantalla se abre para preparar una sesion
 * de entrenamiento con la persona al lado. Un numero en rojo junto a su nombre
 * la convierte en expediente. El dato va completo; lo que no va es el senalamiento.
 */
function Kpi({
  label,
  valor,
  nota: notaTexto,
}: {
  label: string
  valor: string
  nota: string
}) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
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
          fontSize: 27,
          fontWeight: 600,
          letterSpacing: '-1px',
          lineHeight: 1.15,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: C.ink,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 3 }}>{notaTexto}</div>
    </div>
  )
}
