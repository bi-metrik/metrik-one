import { C, MONO } from './tokens'
import type { BloqueTecnica } from '../types'

/**
 * Desglose del eje tecnica por bloque.
 *
 * El puntaje total (73) no dice donde entrenar; el desglose si. Felipe saca
 * 19/20 en Educacion tecnica y 4/15 en Escucha: sabe explicar, no sabe
 * escuchar. Esa es la palanca, y solo se ve aqui.
 */
export function BloquesTecnica({ bloques }: { bloques: BloqueTecnica[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {bloques.map((b) => {
        const pct = (b.puntaje / b.puntajeMax) * 100
        const color = pct >= 75 ? C.brand : pct >= 45 ? C.high : C.crit
        return (
          <div
            key={b.orden}
            style={{ display: 'grid', gridTemplateColumns: '1fr 46px', gap: 12, alignItems: 'center' }}
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
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
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
              {b.puntaje}/{b.puntajeMax}
            </div>
          </div>
        )
      })}
    </div>
  )
}
