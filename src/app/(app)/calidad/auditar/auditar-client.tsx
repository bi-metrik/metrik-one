'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { C, MONO } from '../components/tokens'
import {
  MAX_BYTES_AUDIO,
  MAX_SEGUNDOS_AUDIO,
  MINUTOS_MAX_AUDIO,
  mensajeAudioMuyLargo,
  mensajeAudioMuyPesado,
} from '@/lib/calidad/tope-audio'
import { leerRespuesta } from '@/lib/calidad/respuesta'
import { BUCKET_AUDIO } from '@/lib/calidad/audio-bucket'
import { createClient } from '@/lib/supabase/client'

/**
 * Auditar una llamada en vivo.
 *
 * En la reunión, Brayan arrastra una llamada suya y ve la auditoría ocurrir.
 * Todo lo demás de esta pantalla existe para que ese minuto no se rompa.
 *
 * LA BARRA REFLEJA ETAPAS VERDADERAS. Cada paso avanza cuando su petición
 * responde, no con un temporizador. Una barra que sube sola mientras el
 * servidor piensa es mentira, y si algo falla se queda clavada en un punto que
 * no significa nada: aquí el error cae en la etapa donde de verdad ocurrió.
 *
 * Y ahora "Subiendo el audio" es de verdad una etapa. Antes las dos primeras se
 * marcaban juntas al volver una sola petición, porque el archivo viajaba dentro
 * de ella; hoy la subida es su propio viaje y su propio tiempo.
 *
 * EL LÍMITE SE AVISA ANTES DE SUBIR, Y EL CRITERIO ES LA DURACIÓN. Cambió: el
 * archivo ya no viaja en el cuerpo de la petición, así que el techo dejó de ser
 * el peso y pasó a ser el reloj de la función, que depende de los minutos y no
 * de los megas. El peso sigue revisándose como red de abajo, sobre todo para el
 * caso en que no se pueda leer la duración. Ver `tope-audio.ts`.
 */

const ETAPAS = [
  { clave: 'subiendo', label: 'Subiendo el audio' },
  { clave: 'transcribiendo', label: 'Transcribiendo' },
  { clave: 'auditando', label: 'Auditando contra la rúbrica' },
  { clave: 'guardando', label: 'Guardando' },
] as const

type Clave = (typeof ETAPAS)[number]['clave']

interface Resultado {
  id: string
  puntajeTecnico: number
  semaforo: 'verde' | 'amarillo' | 'rojo'
  banderas: number
}

export default function AuditarClient() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [arrastrando, setArrastrando] = useState(false)
  const [etapa, setEtapa] = useState<Clave | null>(null)
  const [hechas, setHechas] = useState<Clave[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nota, setNota] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [agente, setAgente] = useState('')

  const corriendo = etapa !== null

  /** Duración real del archivo, leída de sus metadatos antes de subir nada. */
  function duracionDe(archivo: File): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(archivo)
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve(Number.isFinite(audio.duration) ? audio.duration : 0)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(0)
      }
      audio.src = url
    })
  }

  async function procesar(archivo: File) {
    setError(null)
    setNota(null)
    setResultado(null)
    setHechas([])

    // La DURACIÓN se lee primero porque ahora es el criterio, no un adorno.
    const duracionSeg = await duracionDe(archivo)
    if (duracionSeg > MAX_SEGUNDOS_AUDIO) {
      setError(mensajeAudioMuyLargo(duracionSeg))
      return
    }
    // El peso es la red de abajo, y la única que queda cuando el navegador no
    // logra leer los metadatos y `duracionDe` devuelve 0.
    if (archivo.size > MAX_BYTES_AUDIO) {
      setError(mensajeAudioMuyPesado(archivo.size))
      return
    }
    if (duracionSeg === 0) {
      setNota('No se pudo leer la duración del archivo; se intentará de todos modos.')
    }

    try {
      // ── 1. Subir ────────────────────────────────────────────────────────
      // El archivo va DIRECTO a Storage, no dentro de una petición nuestra, y
      // ahí es donde muere el techo de 4,5 MB que dejaba esto en 17 minutos.
      setEtapa('subiendo')
      const rP = await fetch('/api/calidad/audio-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombreArchivo: archivo.name,
          bytes: archivo.size,
          segundos: Math.round(duracionSeg),
        }),
      })
      const { datos: dP, error: eP } = await leerRespuesta(rP, 'No se pudo preparar la subida')
      if (eP) throw new Error(eP)

      const supabase = createClient()
      const { error: eSubir } = await supabase.storage
        .from(BUCKET_AUDIO)
        .uploadToSignedUrl(String(dP.ruta), String(dP.token), archivo)
      if (eSubir) throw new Error(`No se pudo subir el audio. ${eSubir.message}`)
      setHechas((h) => [...h, 'subiendo'])

      // ── 2. Transcribir ──────────────────────────────────────────────────
      setEtapa('transcribiendo')
      const rT = await fetch('/api/calidad/transcribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta: dP.ruta }),
      })
      const { datos: dT, error: eT } = await leerRespuesta(rT, 'Falló la transcripción')
      if (eT) throw new Error(eT)
      const turnos = Number(dT.turnos ?? 0)
      const redacciones = Number(dT.redacciones ?? 0)
      setHechas((h) => [...h, 'transcribiendo'])
      setNota(
        `${turnos} turnos transcritos · ${redacciones} dato${redacciones === 1 ? '' : 's'} sensible${redacciones === 1 ? '' : 's'} redactado${redacciones === 1 ? '' : 's'} antes de guardar nada`,
      )

      // ── 3. Auditar ──────────────────────────────────────────────────────
      setEtapa('auditando')
      const rA = await fetch('/api/calidad/auditar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcripcion: dT.transcripcion }),
      })
      const { datos: dA, error: eA } = await leerRespuesta(rA, 'Falló la auditoría')
      if (eA) throw new Error(eA)
      setHechas((h) => [...h, 'auditando'])

      // ── 4. Guardar ──────────────────────────────────────────────────────
      setEtapa('guardando')
      const rG = await fetch('/api/calidad/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auditoria: dA.auditoria,
          agenteNombre: agente,
          nombreArchivo: archivo.name,
          duracionSeg: Math.round(duracionSeg),
        }),
      })
      const { datos: dG, error: eG } = await leerRespuesta(rG, 'No se pudo guardar')
      if (eG) throw new Error(eG)
      setHechas((h) => [...h, 'guardando'])
      setEtapa(null)
      setResultado(dG as unknown as Resultado)
      router.refresh()
    } catch (e) {
      setEtapa(null)
      setError(e instanceof Error ? e.message : 'Algo falló')
    }
  }

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 860, color: C.ink }}>
      <div style={{ marginBottom: 22 }}>
        <div style={eyebrow}>Auditar una llamada</div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          Sube la grabación y mira qué encuentra
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '68ch', fontSize: 14, lineHeight: 1.55 }}>
          Se transcribe, se auditan los dos ejes contra la rúbrica y la llamada entra al tablero como
          una más. Los datos sensibles se borran solos antes de guardar nada.
        </p>
      </div>

      {/* Nombre del agente: sin esto la llamada entra sin dueño y no aparece en
          su perfil ni en el ranking. */}
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ ...eyebrow, marginBottom: 6, display: 'block' }}>Agente de la llamada</span>
        <input
          value={agente}
          onChange={(e) => setAgente(e.target.value)}
          placeholder="Nombre y apellido"
          disabled={corriendo}
          style={{
            width: '100%',
            maxWidth: 340,
            fontSize: 14,
            padding: '9px 11px',
            border: `1px solid ${C.lineStrong}`,
            borderRadius: 6,
            outline: 'none',
            color: C.ink,
            background: corriendo ? C.ground : C.surface,
          }}
        />
      </label>

      {/* ── Zona de arrastre ─────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!corriendo) setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastrando(false)
          if (corriendo) return
          const f = e.dataTransfer.files?.[0]
          if (f) void procesar(f)
        }}
        onClick={() => !corriendo && inputRef.current?.click()}
        style={{
          border: `2px dashed ${arrastrando ? C.brand : C.lineStrong}`,
          background: arrastrando ? C.okSoft : corriendo ? C.ground : C.surfaceAlt,
          borderRadius: 10,
          padding: '38px 24px',
          textAlign: 'center',
          cursor: corriendo ? 'default' : 'pointer',
          transition: 'border-color .15s, background .15s',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {corriendo ? 'Procesando…' : 'Arrastra el audio aquí'}
        </div>
        <div style={{ fontSize: 13, color: C.inkMuted, marginTop: 6 }}>
          {corriendo
            ? 'No cierres esta pestaña'
            : `MP3, M4A o WAV · hasta ${MINUTOS_MAX_AUDIO} minutos de llamada`}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void procesar(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* ── Etapas ───────────────────────────────────────────────────────── */}
      {(corriendo || hechas.length > 0) && (
        <div style={{ ...card, padding: '16px 18px', marginTop: 18 }}>
          {ETAPAS.map((e) => {
            const hecha = hechas.includes(e.clave)
            const activa = etapa === e.clave
            return (
              <div
                key={e.clave}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  color: hecha ? C.ink : activa ? C.ink : C.inkMuted,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    flex: 'none',
                    border: `2px solid ${hecha ? C.brand : activa ? C.brand : C.line}`,
                    background: hecha ? C.brand : 'transparent',
                    animation: activa ? 'pulso 1.1s ease-in-out infinite' : undefined,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: activa ? 600 : 400 }}>{e.label}</span>
                {activa && (
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.inkMuted }}>en curso</span>
                )}
              </div>
            )
          })}
          <style>{`@keyframes pulso { 0%,100% { opacity:1 } 50% { opacity:.35 } }`}</style>
        </div>
      )}

      {nota && !error && (
        <p style={{ ...aviso, borderColor: C.lineStrong, color: C.inkMuted }}>{nota}</p>
      )}

      {error && (
        <p style={{ ...aviso, borderColor: C.crit, background: C.critSoft, color: C.crit }}>
          {error}
        </p>
      )}

      {/* ── Resultado ────────────────────────────────────────────────────── */}
      {resultado && (
        <div style={{ ...card, padding: '18px 20px', marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, letterSpacing: '-1px' }}>
              {resultado.puntajeTecnico}
              <span style={{ fontSize: 15, color: C.inkMuted }}>/100</span>
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color:
                  resultado.semaforo === 'rojo'
                    ? C.crit
                    : resultado.semaforo === 'amarillo'
                      ? C.high
                      : C.ok,
              }}
            >
              {resultado.semaforo}
            </span>
            <span style={{ fontSize: 13.5, color: C.inkMuted }}>
              {resultado.banderas} bandera{resultado.banderas === 1 ? '' : 's'} con evidencia
            </span>
          </div>
          <p style={{ fontSize: 13.5, color: C.inkMuted, margin: '10px 0 0', lineHeight: 1.55 }}>
            La llamada ya está en el tablero: aparece en la lista, en el ranking y en el perfil del
            agente, con su cinta minuto a minuto.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/calidad/llamada/${resultado.id}`)}
            style={{
              marginTop: 14,
              fontSize: 13.5,
              fontWeight: 600,
              padding: '9px 16px',
              borderRadius: 6,
              border: 'none',
              background: C.brand,
              color: C.surface,
              cursor: 'pointer',
            }}
          >
            Ver la auditoría completa
          </button>
        </div>
      )}

      <p style={nota_legal}>
        La transcripción se redacta automáticamente antes de guardarse: los números de tarjeta,
        códigos de seguridad y documentos de identidad no quedan registrados. Se conserva lo que el
        agente pidió, porque es la evidencia de la bandera; se borra el dato que el cliente dictó.
        La grabación se guarda solo el tiempo que dura la transcripción y se borra enseguida: lo
        que queda de la llamada es su transcripción ya redactada, no el audio.
      </p>
    </div>
  )
}

const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 8,
}

const eyebrow: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: C.inkMuted,
  marginBottom: 5,
}

const aviso: React.CSSProperties = {
  fontSize: 13.5,
  border: '1px solid',
  borderRadius: 6,
  padding: '11px 13px',
  marginTop: 14,
  marginBottom: 0,
  lineHeight: 1.5,
}

const nota_legal: React.CSSProperties = {
  fontSize: 12.5,
  color: C.inkMuted,
  background: C.surfaceAlt,
  border: `1px dashed ${C.lineStrong}`,
  borderRadius: 6,
  padding: '11px 13px',
  marginTop: 22,
  lineHeight: 1.55,
}
