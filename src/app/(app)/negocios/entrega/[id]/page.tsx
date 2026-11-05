import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import type { Entrega } from '@/lib/cotizaciones/entrega-unica/flujo'
import { lineaDeLoQueEntendi } from '@/lib/cotizaciones/entrega-unica/mensaje'

export const dynamic = 'force-dynamic'

/**
 * La revisión de una ENTREGA ÚNICA del bloqueo (brief del 2026-11-04): lo que Trappi entendió del pedido de
 * WhatsApp, qué preguntó y por qué (regla del código), lo que contestó la asesora, el chequeo, los totales,
 * la hora de cada paso y el PDF. Solo lectura: lo que se corrige va en el viaje y la cotización de ONE.
 */

const ESTADO: Record<string, string> = {
  recibiendo: 'Recibiendo el pedido', procesando: 'Armando', tipo_por_confirmar: '¿Bloqueo o a medida?', por_confirmar: 'Por confirmar',
  aplicando: 'Aplicando la respuesta', listo: 'PDF enviado', frenado: 'Frenado por el chequeo', a_medida: 'Era a medida', error: 'Error', descartada: 'Descartada',
}
const PASOS: [keyof Entrega['tiempos'], string][] = [
  ['primerMensaje', 'Primer mensaje'], ['modelo', 'Respuesta del modelo'], ['etapaSolicitud', 'Viaje en Solicitud'], ['etapaCotizacion', 'Viaje en Cotización'],
  ['confirmacionEnviada', 'Mensaje a la asesora'], ['respuesta', 'Respuesta de la asesora'], ['pdf', 'PDF'],
]
const peso = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`
const hora = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }) : '—')
const abrir = (ref: string) => `/api/archivos/abrir?ref=${encodeURIComponent(ref)}`

export default async function RevisionEntregaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) notFound()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: f } = await sb.from('entregas_bloqueo').select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  if (!f) notFound()
  const { data: pz } = await sb.from('entregas_bloqueo_piezas').select('id, direccion, tipo, texto, media_ref, created_at').eq('entrega_id', id).order('created_at')
  const piezas = (pz ?? []) as { id: string; direccion: string; tipo: string; texto: string | null; media_ref: string | null; created_at: string }[]
  const salida = f.salida as Entrega['salida']
  const preguntas = (f.preguntas ?? []) as Entrega['preguntas']
  const validacion = f.validacion as Entrega['validacion']
  const tiempos = (f.tiempos ?? {}) as Entrega['tiempos']
  const r = salida?.requisitos
  const b = salida?.borrador

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">Entrega por WhatsApp · {ESTADO[f.estado] ?? f.estado}</p>
        <h1 className="text-xl font-semibold">{f.codigo ?? 'Pedido sin código'}{r ? ` · ${lineaDeLoQueEntendi(r, b ?? null)}` : ''}</h1>
        <div className="flex flex-wrap gap-3 text-sm">
          {f.negocio_id && <Link className="underline" href={`/negocios/${f.negocio_id}`}>Abrir el viaje</Link>}
          {f.pdf_ref && <a className="underline" href={abrir(f.pdf_ref)} target="_blank" rel="noreferrer">Ver el PDF</a>}
        </div>
        {f.error && <p className="text-sm text-red-600">Último error: {f.error}</p>}
      </header>

      {preguntas.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Preguntas pendientes</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {preguntas.map(q => <li key={q.numero}>{q.texto} <span className="text-muted-foreground">— regla: {q.motivo}</span></li>)}
          </ol>
        </section>
      )}

      {b && (
        <section className="space-y-2">
          <h2 className="font-medium">Versiones</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Versión</th><th>Hotel</th><th>Habitación</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {b.hoteles.map(h => (
                <tr key={h.pantallazo} className="border-t">
                  <td>{h.version}</td><td>{h.nombre}{h.zona ? ` · ${h.zona}` : ''}<div className="text-xs text-muted-foreground">Temporada en el pantallazo: {h.temporadaEnPantallazo ?? '—'} · tarifa {h.tipoTarifa}</div></td>
                  <td>{h.habitacion}</td><td className="text-right">{validacion?.totales?.[h.version] !== undefined ? peso(validacion.totales[h.version] as number) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.dudas.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">{b.dudas.map((d, i) => <li key={i}>{d.pregunta} (mientras tanto: {d.queSePusoMientras})</li>)}</ul>
          )}
        </section>
      )}

      {validacion && validacion.hallazgos.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Chequeo del código</h2>
          <ul className="space-y-1 text-sm">
            {validacion.hallazgos.map((h, i) => <li key={i} className={h.nivel === 'error' ? 'text-red-600' : 'text-amber-700'}>{h.nivel === 'error' ? 'Frena' : 'Aviso'}: {h.mensaje}</li>)}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Tiempos</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {PASOS.map(([k, t]) => <div key={k} className="contents"><dt className="text-muted-foreground">{t}</dt><dd>{hora(tiempos[k])}</dd></div>)}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">El chat</h2>
        <ul className="space-y-2 text-sm">
          {piezas.map(p => (
            <li key={p.id} className={p.direccion === 'saliente' ? 'rounded bg-muted p-2' : 'p-2'}>
              <span className="text-xs text-muted-foreground">{p.direccion === 'saliente' ? 'Trappi' : 'Asesora'} · {hora(p.created_at)}</span>
              {p.tipo === 'imagen' && p.media_ref
                ? <a className="block underline" href={abrir(p.media_ref)} target="_blank" rel="noreferrer">Pantallazo</a>
                : <p className="whitespace-pre-wrap">{p.texto}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
