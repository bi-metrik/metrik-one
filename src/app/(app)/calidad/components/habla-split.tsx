import { C, MONO } from './tokens'

/**
 * Reparto del tiempo de habla entre agente y cliente.
 *
 * Medido con las marcas de tiempo de la transcripcion, no estimado a oido. Es
 * el unico dato del eje tecnica que no admite discusion en la reunion: 73,7%
 * contra 26,3% no es una opinion sobre el agente.
 */
export function HablaSplit({
  agentePct,
  clientePct,
  minutosAgente,
  minutosTotal,
}: {
  agentePct: number
  clientePct: number
  minutosAgente?: number
  minutosTotal?: number
}) {
  return (
    <div>
      <div style={{ display: 'flex', height: 26, borderRadius: 3, overflow: 'hidden', margin: '12px 0 8px' }}>
        <div
          style={{
            width: `${agentePct}%`,
            background: C.crit,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            whiteSpace: 'nowrap',
          }}
        >
          Agente {agentePct.toLocaleString('es-CO', { minimumFractionDigits: 1 })}%
        </div>
        <div
          style={{
            width: `${clientePct}%`,
            background: C.inkMuted,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            whiteSpace: 'nowrap',
          }}
        >
          {clientePct.toLocaleString('es-CO', { minimumFractionDigits: 1 })}%
        </div>
      </div>
      <p style={{ fontSize: 13, color: C.inkMuted, margin: 0 }}>
        Medido con las marcas de tiempo, no estimado a oído
        {minutosAgente !== undefined && minutosTotal !== undefined
          ? `: ${minutosAgente.toLocaleString('es-CO', { minimumFractionDigits: 1 })} de ${minutosTotal.toLocaleString('es-CO', { minimumFractionDigits: 1 })} minutos.`
          : '.'}
      </p>
    </div>
  )
}
