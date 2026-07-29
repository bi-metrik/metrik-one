import Link from 'next/link'
import { C, MONO } from './components/tokens'

/**
 * Pantalla de "no existe" del modulo de calidad.
 *
 * Cubre tambien el caso en que SI existe pero no es tuyo: un ejecutor que abre
 * la llamada de otro agente recibe un 404, no un "no tienes permiso". La
 * diferencia importa — decir "existe pero no puedes verla" ya es filtrar algo
 * sobre esa llamada.
 *
 * Antes de esto el aislamiento funcionaba pero la pagina quedaba en blanco: el
 * cascaron con el area de contenido vacia y ningun mensaje. Funcionaba y se
 * veia roto, que en una demo es lo mismo que estar roto.
 */
export default function CalidadNotFound() {
  return (
    <div style={{ padding: '64px 30px', maxWidth: 560, color: C.ink }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: C.inkMuted,
          marginBottom: 8,
        }}
      >
        No disponible
      </div>
      <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.3px', margin: 0 }}>
        Esta llamada no está en tu lista
      </h1>
      <p style={{ color: C.inkMuted, marginTop: 8, fontSize: 14, lineHeight: 1.55 }}>
        O no existe, o pertenece a otro agente. Cada quien ve las llamadas que tiene asignadas.
      </p>
      <Link
        href="/calidad"
        style={{
          display: 'inline-block',
          marginTop: 18,
          fontSize: 13.5,
          color: C.brandDeep,
          textDecoration: 'none',
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        ← Volver a mis llamadas
      </Link>
    </div>
  )
}
