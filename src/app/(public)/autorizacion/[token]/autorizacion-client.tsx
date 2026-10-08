'use client'

import { useState, useTransition } from 'react'
import { bloquesMd, NOMBRE_CASILLA, type BloqueMd, type CasillasMarcadas, type ClaveCasilla, type Segmento } from '@/lib/autorizacion-datos/texto'
import { formatFecha } from '@/lib/dates/bogota'
import { responderEnlace } from './acciones'

/**
 * La pantalla del titular (piezas 1 y 2 de Emilio). Reglas de la pantalla:
 *  1. «Autorizo» queda apagado hasta marcar la casilla de datos generales; las demás NUNCA vienen
 *     marcadas.
 *  2. Ninguna casilla opcional condiciona el botón.
 *  3. «No autorizo» pide confirmación antes de registrarse.
 * Con un texto marcador o incompleto, el botón no existe: se dice por qué.
 */

interface Props {
  token: string
  medio: string | null
  marca: { nombre: string; logoUrl: string | null; color: string | null }
  nombreCliente: string
  textoId: string | null
  version: string
  esMarcador: boolean
  titulo: string
  cuerpo: string
  casillas: Array<{ clave: ClaveCasilla; texto: string }>
  autorizable: { motivo: 'marcador' | 'incompleto'; faltan: string[] } | null
  aceptado: { at: string; version: string; casillas: CasillasMarcadas } | null
  reaceptar: boolean
  rechazadoAt: string | null
  canalDatos: string | null
  tieneDetalle: boolean
}

function Segmentos({ s }: { s: Segmento[] }) {
  return <>{s.map((x, i) => (x.negrita ? <strong key={i}>{x.texto}</strong> : <span key={i}>{x.texto}</span>))}</>
}

export function TextoMd({ md }: { md: string }) {
  const bloques: BloqueMd[] = bloquesMd(md)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-tinta">
      {bloques.map((b, i) => {
        if (b.tipo === 'titulo') return <h2 key={i} className="pt-1 text-base font-bold"><Segmentos s={b.segmentos} /></h2>
        if (b.tipo === 'lista') return (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => <li key={j}><Segmentos s={it} /></li>)}
          </ul>
        )
        if (b.tipo === 'nota') return <p key={i} className="text-xs text-tinta-suave"><Segmentos s={b.segmentos} /></p>
        return <p key={i}><Segmentos s={b.segmentos} /></p>
      })}
    </div>
  )
}

function fecha(iso: string) {
  return formatFecha(iso, { day: 'numeric', month: 'long', year: 'numeric' }) ?? iso.slice(0, 10)
}

export default function AutorizacionClient(p: Props) {
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  const [fase, setFase] = useState<'leer' | 'confirmar_no' | 'autorizado' | 'rechazado'>('leer')
  const [copia, setCopia] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const color = p.marca.color && /^#[0-9a-f]{3,8}$/i.test(p.marca.color) ? p.marca.color : '#10B981'

  function responder(decision: 'autorizo' | 'no_autorizo') {
    setError(null)
    startTransition(async () => {
      const r = await responderEnlace({ token: p.token, decision, textoId: p.textoId, casillas: marcadas, medio: p.medio })
      if (!r.ok) { setError(r.error); return }
      setCopia(r.copiaEnviada)
      setFase(decision === 'autorizo' ? 'autorizado' : 'rechazado')
    })
  }

  const cabecera = (
    <header className="mb-6 flex items-center gap-3">
      {p.marca.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.marca.logoUrl} alt={p.marca.nombre} className="h-10 w-auto" />
        : <span className="text-lg font-bold" style={{ color }}>{p.marca.nombre}</span>}
    </header>
  )
  const pie = (
    <p className="mt-8 text-center text-[11px] text-tinta-suave">
      Versión {p.version} · Plataforma MéTRIK ONE
    </p>
  )

  if (fase === 'autorizado') {
    return (
      <main className="mx-auto max-w-xl p-5">
        {cabecera}
        <p className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-4 text-[15px] text-tinta">
          Listo, {p.nombreCliente}. Quedó registrada su autorización. Su asesor de {p.marca.nombre} ya puede preparar su cotización.
          Puede ver lo que autorizó en este mismo enlace cuando quiera{copia ? ', y le enviamos una copia a su correo.' : '.'}
        </p>
        {pie}
      </main>
    )
  }
  if (fase === 'rechazado') {
    return (
      <main className="mx-auto max-w-xl p-5">
        {cabecera}
        <p className="rounded-lg border border-[#E5E7EB] bg-white p-4 text-[15px] text-tinta">
          Quedó registrado que no autoriza. {p.marca.nombre} no usará sus datos para preparar este viaje. Si cambia de opinión, abra de nuevo este enlace.
        </p>
        {pie}
      </main>
    )
  }

  // Ya autorizó la versión vigente: «ver lo que autorizó».
  if (p.aceptado) {
    return (
      <main className="mx-auto max-w-xl p-5">
        {cabecera}
        <p className="mb-6 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-4 text-[15px] text-tinta">
          Usted ya autorizó el uso de sus datos el {fecha(p.aceptado.at)}.
          {p.canalDatos ? ` Para retirarla o pedir cambios, escriba a ${p.canalDatos}.` : ''}
        </p>
        <h1 className="mb-4 text-xl font-bold text-tinta">{p.titulo}</h1>
        <TextoMd md={p.cuerpo} />
        <ul className="mt-6 space-y-2">
          {p.casillas.map(c => (
            <li key={c.clave} className="flex gap-2 text-[14px] text-tinta">
              <span className="font-semibold">{p.aceptado!.casillas[c.clave] ? 'Sí' : 'No'}</span>
              <span>· {c.texto}</span>
            </li>
          ))}
        </ul>
        {p.tieneDetalle && <a href={`/autorizacion/${p.token}/detalle`} className="mt-4 inline-block text-sm underline" style={{ color }}>Ver el detalle completo</a>}
        <p className="mt-6 text-[11px] text-tinta-suave">Autorizó la versión {p.aceptado.version}.</p>
        {pie}
      </main>
    )
  }

  const generalMarcada = marcadas.generales === true
  return (
    <main className="mx-auto max-w-xl p-5">
      {cabecera}
      {p.reaceptar && (
        <p className="mb-6 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 text-[14px] text-tinta">
          {p.marca.nombre} actualizó para qué usa sus datos. Lea los cambios y, si está de acuerdo, autorice de nuevo.
        </p>
      )}
      {p.rechazadoAt && (
        <p className="mb-6 rounded-lg border border-[#E5E7EB] bg-white p-4 text-[14px] text-tinta-suave">
          El {fecha(p.rechazadoAt)} registró que no autoriza. Si cambió de opinión, puede autorizar aquí.
        </p>
      )}
      {p.esMarcador && (
        <p className="mb-6 rounded-lg border-2 border-dashed border-[#F59E0B] bg-[#FFFBEB] p-3 text-xs font-semibold text-[#92400E]">
          TEXTO MARCADOR: el texto de esta autorización todavía no está publicado. Este enlace no se puede firmar.
        </p>
      )}
      <h1 className="mb-4 text-xl font-bold text-tinta">{p.titulo}</h1>
      <TextoMd md={p.cuerpo} />
      {p.tieneDetalle && (
        <a href={`/autorizacion/${p.token}/detalle`} className="mt-3 inline-block text-sm underline" style={{ color }}>
          Lea el detalle completo
        </a>
      )}

      <div className="mt-6 space-y-3">
        {p.casillas.map(c => (
          <label key={c.clave} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
            <input
              type="checkbox"
              checked={marcadas[c.clave] === true}
              onChange={e => setMarcadas(prev => ({ ...prev, [c.clave]: e.target.checked }))}
              disabled={!!p.autorizable || pendiente}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: color }}
              aria-label={NOMBRE_CASILLA[c.clave]}
            />
            <span className="text-[14px] leading-snug text-tinta">
              {c.texto}
              {c.clave === 'generales' && <span className="ml-1 text-red-600">*</span>}
            </span>
          </label>
        ))}
      </div>

      {p.autorizable ? (
        <p className="mt-6 rounded-lg bg-[#F3F4F6] p-3 text-xs text-tinta-suave">
          {p.autorizable.motivo === 'marcador'
            ? 'Este enlace todavía no se puede firmar: falta publicar el texto.'
            : `Este texto todavía no se puede firmar: le faltan datos (${p.autorizable.faltan.join(', ')}).`}
        </p>
      ) : fase === 'confirmar_no' ? (
        <div className="mt-6 space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-4">
          <p className="text-[14px] text-tinta">
            Sin su autorización, {p.marca.nombre} no puede preparar su cotización con estos datos.
            {p.canalDatos ? ` Si tiene dudas, hable con su asesor o escriba a ${p.canalDatos}.` : ' Si tiene dudas, hable con su asesor.'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFase('leer')} disabled={pendiente} className="flex-1 rounded-lg border border-[#E5E7EB] py-2.5 text-sm">Volver</button>
            <button type="button" onClick={() => responder('no_autorizo')} disabled={pendiente} className="flex-1 rounded-lg bg-[#374151] py-2.5 text-sm font-semibold text-white">
              {pendiente ? 'Guardando…' : 'Confirmar que no autorizo'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => responder('autorizo')}
            disabled={!generalMarcada || pendiente}
            className="w-full rounded-lg py-3 text-base font-semibold text-white disabled:opacity-40"
            style={{ background: color }}
          >
            {pendiente ? 'Guardando…' : 'Autorizo'}
          </button>
          <button type="button" onClick={() => setFase('confirmar_no')} disabled={pendiente} className="w-full text-center text-sm text-tinta-suave underline">
            No autorizo
          </button>
          <p className="text-[11px] text-tinta-suave">
            Versión {p.version}. Al tocar «Autorizo» queda registrada la fecha y hora, el medio por el que le llegó este enlace y el texto exacto que leyó.
          </p>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {pie}
    </main>
  )
}
