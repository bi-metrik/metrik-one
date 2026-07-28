import { C, MONO } from './tokens'
import { SEMAFORO_LABEL, SEVERIDAD_LABEL, type Semaforo, type Severidad } from '../types'

const COLOR: Record<Semaforo, { bg: string; fg: string; lamp: string }> = {
  rojo: { bg: C.critSoft, fg: C.crit, lamp: C.crit },
  amarillo: { bg: C.highSoft, fg: C.high, lamp: C.high },
  verde: { bg: C.okSoft, fg: C.ok, lamp: C.ok },
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  padding: '2px 7px',
  borderRadius: 3,
  whiteSpace: 'nowrap',
}

export function SemaforoBadge({ semaforo }: { semaforo: Semaforo }) {
  const c = COLOR[semaforo]
  return (
    <span style={{ ...chip, background: c.bg, color: c.fg }}>
      <i style={{ width: 9, height: 9, borderRadius: '50%', background: c.lamp, flex: 'none' }} />
      {SEMAFORO_LABEL[semaforo]}
    </span>
  )
}

const SEV_A_SEMAFORO: Record<Severidad, Semaforo> = {
  critica: 'rojo',
  alta: 'amarillo',
  media: 'verde',
}

export function SeveridadBadge({ severidad }: { severidad: Severidad }) {
  // Media no es "bien": se pinta neutra, no verde. Solo critica y alta llevan
  // color propio para que el ojo salte a lo que importa.
  if (severidad === 'media') {
    return (
      <span style={{ ...chip, background: 'transparent', color: C.inkMuted, border: `1px solid ${C.lineStrong}`, fontWeight: 500 }}>
        {SEVERIDAD_LABEL.media}
      </span>
    )
  }
  const c = COLOR[SEV_A_SEMAFORO[severidad]]
  return (
    <span style={{ ...chip, background: c.bg, color: c.fg }}>{SEVERIDAD_LABEL[severidad]}</span>
  )
}

/**
 * Rotulo permanente de procedencia del dato. La llamada real va marcada como
 * real; todo lo demas va marcado como demostracion, sin excepcion y sin que se
 * pueda pasar por alto: si la muestra se lee como "analizaron nuestra data" es
 * exactamente lo que prometimos no hacer sin NDA.
 */
export function OrigenBadge({ esReal }: { esReal: boolean }) {
  if (esReal) {
    return <span style={{ ...chip, background: C.ink, color: C.surface }}>real</span>
  }
  return (
    <span style={{ ...chip, background: 'transparent', color: C.inkMuted, border: `1px dashed ${C.lineStrong}`, fontWeight: 500 }}>
      demostración
    </span>
  )
}
