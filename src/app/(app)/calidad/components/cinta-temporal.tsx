'use client'

import { useMemo, useState } from 'react'
import { C, MONO } from './tokens'
import { mmss, type EventoCinta, type Hallazgo } from '../types'

/**
 * Cinta temporal de la llamada.
 *
 * Es el componente que carga el argumento de la muestra. En la llamada real se
 * ve, sin explicar nada, que los datos de pago se piden en el minuto 20 y el
 * reporte de credito llega en el 27: el agente pide la tarjeta antes de tener
 * el diagnostico. Eso no lo decide el agente, lo decide el procedimiento — y
 * por eso no se arregla capacitando ni despidiendo.
 *
 * Cada marca esta anclada a su segundo exacto. Las banderas se pintan con el
 * color de su severidad; los eventos de contexto, neutros.
 */

type Marca = {
  key: string
  segundo: number
  tipo: 'critica' | 'alta' | 'media' | 'nota'
  codigo?: string
  texto: string
}

const COLOR_MARCA: Record<Marca['tipo'], string> = {
  critica: C.crit,
  alta: C.high,
  media: C.inkMuted,
  nota: C.inkMuted,
}

export function CintaTemporal({
  duracionSeg,
  banderas,
  eventos,
  /** Segundo al que la vista debe saltar (lo fija el clic en una bandera). */
  segundoActivo,
}: {
  duracionSeg: number
  banderas: Hallazgo[]
  eventos: EventoCinta[]
  segundoActivo?: number | null
}) {
  const marcas = useMemo<Marca[]>(() => {
    const deBanderas: Marca[] = banderas.map((b) => ({
      key: `b-${b.id}`,
      segundo: b.segundo,
      tipo: b.severidad,
      codigo: b.codigo,
      texto: b.titulo,
    }))
    const deEventos: Marca[] = eventos.map((e) => ({
      key: `e-${e.id}`,
      segundo: e.segundo,
      tipo: 'nota',
      texto: e.titulo,
    }))
    return [...deBanderas, ...deEventos].sort((a, b) => a.segundo - b.segundo)
  }, [banderas, eventos])

  const [seleccion, setSeleccion] = useState<string | null>(null)

  // Cuando el usuario hace clic en una bandera de abajo, la cinta resalta la
  // marca mas cercana a ese segundo.
  const activa = useMemo(() => {
    if (seleccion) return marcas.find((m) => m.key === seleccion) ?? marcas[0]
    if (segundoActivo != null && marcas.length > 0) {
      return marcas.reduce((mejor, m) =>
        Math.abs(m.segundo - segundoActivo) < Math.abs(mejor.segundo - segundoActivo) ? m : mejor,
      )
    }
    return marcas[0]
  }, [seleccion, segundoActivo, marcas])

  if (marcas.length === 0) return null

  const ejes = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(duracionSeg * f))

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: 62,
          margin: '26px 0 8px',
          background: C.surfaceAlt,
          borderRadius: 3,
          border: `1px solid ${C.line}`,
        }}
      >
        {marcas.map((m) => {
          const on = activa?.key === m.key
          const color = COLOR_MARCA[m.tipo]
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setSeleccion(m.key)}
              onMouseEnter={() => setSeleccion(m.key)}
              onFocus={() => setSeleccion(m.key)}
              aria-label={`${mmss(m.segundo)} — ${m.texto}`}
              style={{
                position: 'absolute',
                top: 0,
                left: `${(m.segundo / duracionSeg) * 100}%`,
                width: 2,
                height: on ? 44 : 34,
                background: color,
                transform: 'translateX(-1px)',
                cursor: 'pointer',
                border: 0,
                padding: 0,
              }}
            >
              <span
                style={{
                  content: '""',
                  position: 'absolute',
                  top: on ? -7 : -5,
                  left: on ? -6 : -4,
                  width: on ? 14 : 10,
                  height: on ? 14 : 10,
                  borderRadius: '50%',
                  background: color,
                  border: `2px solid ${C.surface}`,
                  display: 'block',
                }}
              />
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: MONO,
          fontSize: 10.5,
          color: C.inkMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ejes.map((s, i) => (
          <span key={i}>{mmss(s)}</span>
        ))}
      </div>

      <div
        style={{
          minHeight: 44,
          marginTop: 12,
          padding: '10px 12px',
          background: C.surfaceAlt,
          borderLeft: `2px solid ${activa ? COLOR_MARCA[activa.tipo] : C.lineStrong}`,
          borderRadius: '0 3px 3px 0',
          fontSize: 13,
          color: C.ink,
        }}
      >
        {activa && (
          <>
            <span
              style={{
                fontFamily: MONO,
                fontWeight: 600,
                marginRight: 8,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {mmss(activa.segundo)}
            </span>
            {activa.codigo && <b style={{ marginRight: 6 }}>{activa.codigo} ·</b>}
            {activa.texto}
          </>
        )}
      </div>
    </div>
  )
}
