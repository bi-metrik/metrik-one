'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { C, MONO } from '../../components/tokens'
import { CintaTemporal } from '../../components/cinta-temporal'
import { BloquesTecnica } from '../../components/bloques-tecnica'
import { HablaSplit } from '../../components/habla-split'
import { OrigenBadge, SeveridadBadge } from '../../components/semaforo-badge'
import { DISCLAIMER_BANDERAS, mmss, SEMAFORO_LABEL, type LlamadaDetalle } from '../../types'

export default function DetalleClient({ llamada }: { llamada: LlamadaDetalle }) {
  // Clic en una bandera → la cinta salta a su segundo. Es el gesto que conecta
  // "esto pasó" con "pasó en este minuto de la llamada".
  const [segundoActivo, setSegundoActivo] = useState<number | null>(null)

  const totalMin = llamada.duracionSeg / 60
  const criticas = llamada.banderas.filter((b) => b.severidad === 'critica').length
  const altas = llamada.banderas.filter((b) => b.severidad === 'alta').length
  const medias = llamada.banderas.filter((b) => b.severidad === 'media').length

  const bloqueEscucha = llamada.bloques.find((b) => b.nombre.startsWith('Escucha'))

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1120, color: C.ink }}>
      <Link
        href="/calidad"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: C.inkMuted,
          textDecoration: 'none',
          marginBottom: 14,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Llamadas
      </Link>

      {/* ── Encabezado ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>
          Detalle de llamada ·{' '}
          {new Date(llamada.fechaHora).toLocaleString('es-CO', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </div>
        <h1
          style={{
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: '-.4px',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {llamada.agenteNombre}
          <OrigenBadge esReal={llamada.esReal} />
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '66ch', fontSize: 14 }}>
          {mmss(llamada.duracionSeg)} minutos, llamada {llamada.direccion}, cliente {llamada.clienteRef}.
          {llamada.esReal
            ? ' Auditada sobre transcripción literal con marca de tiempo por turno. Cada hallazgo de abajo tiene su minuto.'
            : ' Guion simulado de demostración. Agente y cliente ficticios: no corresponden a ninguna persona real.'}
        </p>

        {/*
          Procedencia de la grabación. En un espacio de trabajo de muestra las
          llamadas se listan en el día en curso para que el tablero tenga
          contenido; esta línea dice de cuándo es la grabación de verdad, para
          que reubicarla no equivalga a perder el dato.
        */}
        {llamada.fechaGrabacion && (
          <p
            style={{
              marginTop: 10,
              fontSize: 12.5,
              color: C.inkMuted,
              background: C.surfaceAlt,
              border: `1px dashed ${C.lineStrong}`,
              borderRadius: 6,
              padding: '9px 12px',
              display: 'inline-block',
            }}
          >
            Grabación del{' '}
            <b style={{ color: C.ink }}>
              {new Date(llamada.fechaGrabacion).toLocaleString('es-CO', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </b>
            . Se lista en la fecha de arriba porque este es un espacio de trabajo de demostración.
          </p>
        )}
      </div>

      {/* ── Los dos ejes, lado a lado y sin promediar ──────────────────── */}
      <section style={{ ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Kpi label="Eje técnica" valor={`${llamada.puntajeTecnico}`} sufijo="/100" nota="venta consultiva" />
        <Kpi
          label="Eje cumplimiento"
          valor={SEMAFORO_LABEL[llamada.semaforo].toUpperCase()}
          nota={`${criticas} críticas, ${altas} altas, ${medias} medias`}
          tono={llamada.semaforo === 'rojo' ? 'bad' : undefined}
        />
        {llamada.hablaAgentePct != null && (
          <Kpi
            label="Habla el agente"
            valor={`${Math.round(llamada.hablaAgentePct)}%`}
            nota={`${(totalMin * (llamada.hablaAgentePct / 100)).toFixed(1)} de ${totalMin.toFixed(1)} minutos`}
          />
        )}
        {llamada.turnos != null && (
          <Kpi label="Turnos" valor={String(llamada.turnos)} nota="intervenciones de la conversación" />
        )}
      </section>

      {/* ── La cinta: el argumento central ────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>La llamada minuto a minuto</h2>
        <div style={{ ...card, padding: 18 }}>
          <p style={{ fontSize: 13.5, color: C.inkMuted, margin: '0 0 4px', maxWidth: '66ch' }}>
            Cada marca está anclada al segundo exacto de la grabación. Pasa por encima o haz clic para
            ver la evidencia.
          </p>
          <CintaTemporal
            duracionSeg={llamada.duracionSeg}
            banderas={llamada.banderas}
            eventos={llamada.eventos}
            segundoActivo={segundoActivo}
          />
        </div>
      </section>

      {/* ── Desglose técnico + escucha ────────────────────────────────── */}
      <section style={{ ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 26 }}>
        <div style={{ ...card, padding: '16px 18px' }}>
          <h2 style={h2}>Eje técnica · {llamada.puntajeTecnico} de 100</h2>
          <BloquesTecnica bloques={llamada.bloques} />
        </div>

        <div style={{ ...card, padding: '16px 18px' }}>
          <h2 style={h2}>
            {bloqueEscucha
              ? `${bloqueEscucha.nombre} · ${bloqueEscucha.puntaje} de ${bloqueEscucha.puntajeMax}`
              : 'Escucha y control'}
          </h2>

          {llamada.hablaAgentePct != null && llamada.hablaClientePct != null ? (
            <HablaSplit agentePct={llamada.hablaAgentePct} clientePct={llamada.hablaClientePct} />
          ) : (
            <p style={{ fontSize: 13, color: C.inkMuted }}>Sin medición de reparto de habla.</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            {llamada.repreguntas != null && (
              <Mini label="Repreguntas" valor={llamada.repreguntas} nota="veces que el agente no entendió" />
            )}
            {llamada.monologos45s != null && (
              <Mini label="Monólogos" valor={llamada.monologos45s} nota="de 45 s o más" />
            )}
          </div>
        </div>
      </section>

      {/* ── Banderas ──────────────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>
          Eje cumplimiento · {llamada.banderas.length}{' '}
          {llamada.banderas.length === 1 ? 'bandera' : 'banderas'}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {llamada.banderas.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSegundoActivo(b.segundo)}
              style={{
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                background: C.surface,
                border: `1px solid ${C.line}`,
                borderLeft: `3px solid ${
                  b.severidad === 'critica' ? C.crit : b.severidad === 'alta' ? C.high : C.inkMuted
                }`,
                borderRadius: '0 6px 6px 0',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>{b.codigo}</span>
                <SeveridadBadge severidad={b.severidad} />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    color: C.inkMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {b.turnoRef ?? mmss(b.segundo)}
                </span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.titulo}</div>
              {b.hecho && <div style={{ fontSize: 13.5, color: C.ink }}>{b.hecho}</div>}
              {b.cita && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: C.inkMuted,
                    paddingLeft: 11,
                    borderLeft: `1px solid ${C.lineStrong}`,
                  }}
                >
                  <span style={{ color: C.ink }}>&ldquo;{b.cita}&rdquo;</span>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Disclaimer fijo. Obligatorio en toda pieza con banderas. */}
        <p
          style={{
            fontSize: 12,
            color: C.inkMuted,
            marginTop: 26,
            paddingTop: 14,
            borderTop: `1px solid ${C.line}`,
          }}
        >
          {DISCLAIMER_BANDERAS}
        </p>
      </section>
    </div>
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

function Kpi({
  label,
  valor,
  sufijo,
  nota,
  tono,
}: {
  label: string
  valor: string
  sufijo?: string
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
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: '-1px',
          lineHeight: 1.15,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: tono === 'bad' ? C.crit : C.ink,
        }}
      >
        {valor}
        {sufijo && <span style={{ fontSize: 16, color: C.inkMuted }}>{sufijo}</span>}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 3 }}>{nota}</div>
    </div>
  )
}

function Mini({ label, valor, nota }: { label: string; valor: number; nota: string }) {
  return (
    <div>
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
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.inkMuted }}>{nota}</div>
    </div>
  )
}
