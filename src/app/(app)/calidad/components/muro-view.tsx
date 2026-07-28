'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { MuroData, Semaforo } from '../types'

/**
 * Muro proyectable, v4.
 *
 * Vive en un televisor que ve todo el piso e incluso visitas. Criterio de
 * aceptacion, y es el que manda sobre cualquier otro: TODO se lee a tres
 * metros. Si algo obliga a acercarse, o sobra o tiene que crecer. Por eso la
 * pantalla prefiere pocas cosas grandes antes que muchas comodas.
 *
 * Cuatro zonas:
 *
 *   1. ENCABEZADO — "HOY · martes 28 de julio". La ambigüedad temporal se
 *      resuelve de una vez: nadie deberia tener que adivinar si lo que ve es
 *      de hoy o el acumulado del mes. La cobertura viaja aqui como sello
 *      discreto, no como heroe: una vez instalado el producto marca 100% todos
 *      los dias, informa una vez y despues es constante.
 *   2. HEROE — cierres de hoy con su denominador (llamadas y % de cierre) y
 *      partidos por forma de pago. Cobrado completo es caja que entro; a seis
 *      cuotas es una promesa que puede caerse (y si se cae, el servicio se
 *      suspende). Contar los dos como "una venta" es el error del Excel que
 *      este muro viene a reemplazar.
 *   3. DOS COLUMNAS —
 *      · TABLA DE AGENTES: el ACUMULADO del dia, TODOS sin recortar. Con
 *        llamadas y % de cierre al lado de los cierres aparece el dato que el
 *        conteo simple esconde: quien cierra al mismo ritmo con la mitad de
 *        llamadas. La columna de cumplimiento lleva encabezado y PALABRA, no
 *        solo color: a tres metros un punto sin etiqueta no comunica, y el
 *        color solo tampoco sirve para quien no lo distingue.
 *      · ULTIMAS LLAMADAS: el FLUJO, lo que esta pasando ahora. Es lo que
 *        mantiene la pantalla viva durante el dia; la tabla casi no se mueve.
 *   4. BANDA — la bandera que mas se repite hoy. Es lo unico realmente
 *      accionable para el piso, asi que va en grande y no en letra chica.
 *
 * Que NO lleva, y no es negociable: `cliente_ref`. El muro nunca identifica al
 * cliente final, y la RPC que lo alimenta tampoco lo devuelve. Los agentes
 * salen por NOMBRE DE PILA porque el enlace es publico: en el piso todos se
 * conocen, en internet un nombre de pila no identifica a nadie.
 *
 * Que SI lleva desde v2: montos en dolares. Decision explicita de Mauricio.
 *
 * Los debitos rebotados salieron de aqui en v4: son cobranza, no operacion de
 * piso. Viven en la vista de dueno, junto al recaudo a seis cuotas.
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

/**
 * Cumplimiento en palabra, no en punto de color. Un circulo sin etiqueta no
 * dice nada a tres metros, y quien no distingue rojo de verde se queda sin la
 * columna entera. El color acompaña; la palabra es la que informa.
 */
const CUMPLIMIENTO: Record<Semaforo, { texto: string; color: string }> = {
  verde: { texto: 'Sin banderas', color: M.ok },
  amarillo: { texto: 'Revisar', color: M.high },
  rojo: { texto: 'Crítico', color: M.crit },
}

const usd = (n: number) => `US$${Math.round(n).toLocaleString('es-CO')}`

const COLS_AGENTES = '1fr 112px 104px 112px 118px 158px 196px'
const COLS_ULTIMAS = '98px 1fr 94px 178px'

/**
 * "martes 28 de julio". `toLocaleDateString` devuelve "martes, 28 de julio" y
 * `text-transform: capitalize` convertiria cada palabra ("Martes, 28 De
 * Julio"), que no es como se escribe una fecha en español. Se arma a mano:
 * fuera la coma, mayuscula solo en la primera letra.
 */
function fechaLegible(iso: string): string {
  const t = new Date(`${iso}T12:00:00`)
    .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', '')
  return t.charAt(0).toUpperCase() + t.slice(1)
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

  const c = data.cierres
  const cob = data.cobertura

  const fechaLarga = fechaLegible(data.fecha)

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
        padding: '22px 34px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Encabezado: cuándo es "ahora", dicho sin rodeos ─────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, minWidth: 0 }}>
          {/*
            El dia pedido no tenia actividad y esto es el ultimo dia con
            llamadas. Se dice en pantalla en vez de rotularlo "HOY" y mostrar
            los datos de otro dia.
          */}
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-.5px', whiteSpace: 'nowrap' }}>
            <span style={{ color: data.esFallback ? M.high : M.brand }}>
              {data.esFallback ? 'ÚLTIMO DÍA CON ACTIVIDAD' : 'HOY'}
            </span>
            <span style={{ color: M.muted, margin: '0 14px' }}>·</span>
            <span>{fechaLarga}</span>
          </span>
          {/* Sello, no titular: la cobertura informa una vez y luego es constante. */}
          {cob && (
            <span style={{ fontFamily: MONO, fontSize: 22, color: M.muted, whiteSpace: 'nowrap' }}>
              {cob.auditadas} de {cob.recibidas} llamadas auditadas
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 26, fontWeight: 600, color: M.muted, whiteSpace: 'nowrap' }}>
            {nombreWorkspace}
          </span>
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

      {/* ── Zona 1: el héroe, con denominador ──────────────────────── */}
      <div
        style={{
          marginTop: 16,
          background: M.panel,
          border: `1px solid ${M.line}`,
          borderRadius: 10,
          padding: '16px 26px',
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          gap: 44,
          alignItems: 'center',
        }}
      >
        {/* Cierres: el numero que el piso persigue */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 96,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-3px',
              color: M.brand,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {c?.total ?? 0}
          </span>
          <span style={{ lineHeight: 1.3 }}>
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 21,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: M.muted,
              }}
            >
              Cierres
            </span>
            <span style={{ display: 'block', fontSize: 26, color: M.ink }}>
              de {c?.llamadas ?? 0} llamadas
            </span>
          </span>
        </div>

        {/* El denominador convertido en el numero que la operación entiende */}
        <div style={{ display: 'grid', gap: 6 }}>
          <Kpi valor={`${c?.pctCierre ?? 0}%`} etiqueta="de cierre" color={M.ink} />
          <Kpi valor={usd(c?.montoUsd ?? 0)} etiqueta="vendido hoy" color={M.ink} />
        </div>

        {/* El desglose que hace la diferencia */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <FormaPago
            etiqueta="cobrado completo"
            nota="el dinero ya entró"
            n={c?.tarjeta.n ?? 0}
            monto={c?.tarjeta.montoUsd ?? 0}
            color={M.ok}
          />
          <FormaPago
            etiqueta="a seis cuotas"
            nota={`${usd(c?.cuenta.primeraCuotaUsd ?? 0)} entra este mes`}
            n={c?.cuenta.n ?? 0}
            monto={c?.cuenta.montoUsd ?? 0}
            color={M.high}
          />
        </div>
      </div>

      {/* ── Zona 2: acumulado y flujo, lado a lado ─────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.44fr 0.86fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* ── Zona 2a: la tabla de agentes (el acumulado) ── */}
        <Panel titulo="Quién cerró, y cómo">
          {data.ranking.length === 0 ? (
            <div style={{ fontSize: 26, color: M.muted }}>Sin llamadas registradas hoy.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <Encabezados
                columnas={COLS_AGENTES}
                gap={18}
                lateral={12}
                celdas={[
                  { texto: 'Agente' },
                  { texto: 'Llamadas', der: true },
                  { texto: 'Cierres', der: true },
                  { texto: '% cierre', der: true },
                  // "Tarjeta" era el instrumento de pago; lo que importa es que
                  // el dinero entró completo. La definición va una vez, al pie.
                  { texto: 'Cobrado', der: true },
                  { texto: 'US$', der: true },
                  { texto: 'Cumplimiento' },
                ]}
              />

              {/* TODOS los agentes. Truncar la lista sesga: si alguien no
                  aparece, el piso no sabe si es que no cerró o que no cupo. */}
              {data.ranking.map((a, i) => (
                <div
                  key={a.agente}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLS_AGENTES,
                    alignItems: 'center',
                    gap: 18,
                    padding: '16px 12px',
                    // Alternancia de fondo: a tres metros es lo que impide que
                    // la vista salte de fila al recorrer la columna de la derecha.
                    background: i % 2 === 0 ? 'rgba(255,255,255,.035)' : 'transparent',
                    borderRadius: 6,
                    fontSize: 32,
                    // El interlineado por defecto (1.5) le da a cada fila 12 px
                    // que nadie ve y que se pagan cortando la ultima fila.
                    lineHeight: 1.15,
                  }}
                >
                  {/* Nombre de pila. El muro es público por enlace. */}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.agente}
                  </span>
                  <Num>{a.llamadas}</Num>
                  <Num destacado>{a.cierres}</Num>
                  {/* El % va en tinta plena: es el dato nuevo de v4 y el unico
                      que permite comparar agentes con distinto volumen. En gris
                      se pierde al lado del conteo de cierres. */}
                  <Num color={M.ink}>{a.pctCierre}%</Num>
                  {/* Verde cuando TODO lo que cerró se cobró completo: es el
                      dato que el conteo de ventas esconde. */}
                  <Num color={a.cierres > 0 && a.tarjeta === a.cierres ? M.ok : undefined}>
                    {a.tarjeta}
                  </Num>
                  <Num>{a.montoUsd > 0 ? usd(a.montoUsd) : '—'}</Num>
                  <Cumplimiento semaforo={a.semaforo} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ── Zona 2b: el flujo (lo que está pasando ahora) ── */}
        <Panel titulo="Últimas llamadas">
          {data.ultimas.length === 0 ? (
            <div style={{ fontSize: 26, color: M.muted }}>Sin llamadas registradas hoy.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <Encabezados
                columnas={COLS_ULTIMAS}
                gap={16}
                lateral={10}
                celdas={[
                  { texto: 'Hora' },
                  { texto: 'Agente' },
                  { texto: 'Técnica', der: true },
                  { texto: 'Cumplimiento' },
                ]}
              />

              {data.ultimas.map((u, i) => (
                <div
                  key={`${u.hora}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLS_ULTIMAS,
                    alignItems: 'center',
                    gap: 16,
                    padding: '10px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,.035)' : 'transparent',
                    borderRadius: 6,
                    fontSize: 27,
                    // Sin esto la decima llamada queda cortada por el borde del
                    // panel, y una lista que se corta sola miente sobre cuantas
                    // llamadas hubo.
                    lineHeight: 1.15,
                  }}
                >
                  <span style={{ fontFamily: MONO, color: M.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {u.hora}
                  </span>
                  {/* Nombre de pila. El muro es público por enlace. */}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.agente}
                    {/* Marca discreta de que esa llamada cerró venta: conecta el
                        flujo con el número de arriba sin agregar otra columna. */}
                    {u.cerroVenta && <span style={{ color: M.brand, marginLeft: 8 }}>·cerró</span>}
                  </span>
                  <Num>{u.tecnica}</Num>
                  <Cumplimiento semaforo={u.semaforo} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Zona 3: la banda accionable ─────────────────────────────── */}
      <div
        style={{
          marginTop: 14,
          background: data.banderaTop ? 'rgba(248,113,113,.10)' : M.panel,
          border: `1px solid ${data.banderaTop ? 'rgba(248,113,113,.35)' : M.line}`,
          borderRadius: 10,
          padding: '14px 26px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 26,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: M.muted,
            whiteSpace: 'nowrap',
          }}
        >
          Lo que más se repite hoy
        </span>
        {data.banderaTop ? (
          <span
            style={{
              fontSize: 34,
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
              minWidth: 0,
              flex: 1,
            }}
          >
            <b style={{ fontFamily: MONO, color: M.crit }}>{data.banderaTop.codigo}</b>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.banderaTop.titulo}
            </span>
            <b
              style={{
                fontFamily: MONO,
                color: M.crit,
                marginLeft: 'auto',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {data.banderaTop.veces} veces
            </b>
          </span>
        ) : (
          <span style={{ fontSize: 34, color: M.muted }}>Sin banderas hoy</span>
        )}
      </div>

      {/* ── Pie mínimo: una definición, una advertencia, una firma ──── */}
      <div
        style={{
          marginTop: 10,
          fontSize: 17,
          color: M.muted,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/*
          "Cobrado" se define UNA vez, aquí abajo. La columna no puede
          explicarse sola en una pantalla que se mira de reojo, y repetir la
          aclaración en cada fila sería ruido. El monto sale del dato, no
          escrito a mano: si el precio del programa cambia, la línea lo sigue.
        */}
        <span>
          {c?.montoUnitarioUsd
            ? `Cobrado = pagó los ${usd(c.montoUnitarioUsd)} completos hoy; el resto queda a seis cuotas.`
            : 'Cobrado = pagó completo hoy; el resto queda a seis cuotas.'}
          {'  ·  '}
          Datos de demostración: una llamada real, el resto es muestra.
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>Powered by MéTRIK</span>
      </div>

      {pantallaCompleta && <span hidden />}
    </div>
  )
}

function Kpi({ valor, etiqueta, color }: { valor: string; etiqueta: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 44,
          fontWeight: 600,
          lineHeight: 1.05,
          color,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {valor}
      </span>
      <span style={{ fontSize: 21, color: M.muted, whiteSpace: 'nowrap' }}>{etiqueta}</span>
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
          minWidth: 58,
        }}
      >
        {n}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 25, color: M.ink }}>
          {etiqueta} <span style={{ fontFamily: MONO, color: M.muted }}>{usd(monto)}</span>
        </span>
        <span style={{ display: 'block', fontSize: 19, color: M.muted, marginTop: 1 }}>{nota}</span>
      </span>
    </div>
  )
}

/**
 * `gap` y `lateral` deben ser los MISMOS que los de las filas: si no, los
 * encabezados quedan corridos respecto de la columna que titulan y a tres
 * metros la tabla deja de leerse como tabla.
 */
function Encabezados({
  columnas,
  celdas,
  gap,
  lateral,
}: {
  columnas: string
  celdas: { texto: string; der?: boolean }[]
  gap: number
  lateral: number
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columnas,
        gap,
        padding: `0 ${lateral}px 10px`,
        borderBottom: `1px solid ${M.line}`,
        marginBottom: 4,
        fontFamily: MONO,
        fontSize: 16,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: M.muted,
      }}
    >
      {celdas.map((c) => (
        <span key={c.texto} style={{ textAlign: c.der ? 'right' : 'left' }}>
          {c.texto}
        </span>
      ))}
    </div>
  )
}

/** Alineación numérica a la derecha y ancho tabular: las columnas se comparan de un vistazo. */
function Num({
  children,
  color,
  destacado = false,
}: {
  children: React.ReactNode
  color?: string
  destacado?: boolean
}) {
  return (
    <span
      style={{
        fontFamily: MONO,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: destacado ? 600 : 400,
        color: color ?? (destacado ? M.ink : M.muted),
      }}
    >
      {children}
    </span>
  )
}

function Cumplimiento({ semaforo }: { semaforo: Semaforo }) {
  const { texto, color } = CUMPLIMIENTO[semaforo] ?? CUMPLIMIENTO.verde
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 24, color, whiteSpace: 'nowrap' }}>{texto}</span>
    </span>
  )
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: M.panel,
        border: `1px solid ${M.line}`,
        borderRadius: 10,
        padding: '18px 18px 14px',
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
          margin: '0 0 14px 10px',
        }}
      >
        {titulo}
      </h2>
      {children}
    </section>
  )
}
