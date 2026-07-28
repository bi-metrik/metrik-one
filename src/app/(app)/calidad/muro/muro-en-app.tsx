'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import MuroView from '../components/muro-view'
import { C, MONO } from '../components/tokens'
import type { MuroData } from '../types'

/**
 * Vista previa del muro dentro de la app, con el enlace para pegarlo en el
 * navegador del televisor del piso.
 *
 * La previa se renderiza SIN `proyectable`: nada de auto-refresh cada 30 s
 * mientras alguien la mira desde su escritorio.
 */
export default function MuroEnApp({
  data,
  nombreWorkspace,
  token,
  muroPublico,
}: {
  data: MuroData
  nombreWorkspace: string
  token: string | null
  muroPublico: boolean
}) {
  const [copiado, setCopiado] = useState(false)

  const url =
    token && typeof window !== 'undefined' ? `${window.location.origin}/muro/${token}` : null

  const copiar = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1240, color: C.ink }}>
      <div style={{ marginBottom: 18 }}>
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
          Muro del piso
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          Lo que se proyecta en el televisor
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '66ch', fontSize: 14 }}>
          Responde dos preguntas: ¿estamos escuchando todo? y ¿qué se repite? No lleva dinero ni
          identificación de clientes, porque lo ve todo el piso y también las visitas.
        </p>
      </div>

      {muroPublico && url ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: C.surface,
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            padding: '12px 14px',
            marginBottom: 18,
          }}
        >
          <span style={{ fontSize: 13, color: C.inkMuted }}>Enlace para el televisor:</span>
          <code style={{ fontFamily: MONO, fontSize: 12.5, color: C.ink }}>{url}</code>
          <button type="button" onClick={copiar} style={boton}>
            {copiado ? <Check style={ico} /> : <Copy style={ico} />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" style={boton}>
            <ExternalLink style={ico} />
            Abrir
          </a>
        </div>
      ) : (
        <p
          style={{
            fontSize: 12.5,
            color: C.inkMuted,
            background: C.surfaceAlt,
            border: `1px dashed ${C.lineStrong}`,
            borderRadius: 6,
            padding: '11px 13px',
            marginBottom: 18,
          }}
        >
          El enlace público del muro no está habilitado en este espacio de trabajo. Se activa con
          <code style={{ fontFamily: MONO }}> config_extra.muro_publico</code>.
        </p>
      )}

      {/* Previa a escala. El muro real ocupa la pantalla completa. */}
      <div
        style={{
          border: `1px solid ${C.line}`,
          borderRadius: 10,
          overflow: 'hidden',
          height: '70vh',
          minHeight: 480,
        }}
      >
        <MuroView data={data} nombreWorkspace={nombreWorkspace} />
      </div>
    </div>
  )
}

const boton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: C.brandDeep,
  background: 'transparent',
  border: `1px solid ${C.line}`,
  borderRadius: 5,
  padding: '5px 10px',
  cursor: 'pointer',
  textDecoration: 'none',
}

const ico: React.CSSProperties = { width: 13, height: 13 }
