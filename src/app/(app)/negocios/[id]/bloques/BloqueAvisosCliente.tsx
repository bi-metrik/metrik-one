'use client'

import { useEffect, useState } from 'react'
import { MailCheck, MailWarning, Mail } from 'lucide-react'
import { leerEnviosDelBloque } from './avisos-cliente-actions'
import { fechaHoraBogota, type EnvioVista } from '@/lib/avisos-cliente/envios-del-bloque'

/**
 * Bloque de solo lectura `avisos_cliente` (SOE-031): a qué correo se le envió al cliente lo
 * de esta etapa, cuándo, y si llegó o rebotó. Los datos salen de `avisos_cliente`; la marca
 * de la confirmación de entrega y el aviso de rebote los hace la base al llegar el acuse.
 */
export default function BloqueAvisosCliente({
  negocioId,
  bloqueConfigId,
}: {
  negocioId: string
  bloqueConfigId: string
}) {
  const [envios, setEnvios] = useState<EnvioVista[] | null>(null)
  const [queSeEnvio, setQueSeEnvio] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    leerEnviosDelBloque(negocioId, bloqueConfigId)
      .then(r => {
        if (!vivo) return
        setEnvios(r.envios)
        setQueSeEnvio(r.queSeEnvio)
        setError(r.error)
      })
      .catch(() => {
        if (vivo) setError('No se pudieron leer los envíos')
      })
    return () => {
      vivo = false
    }
  }, [negocioId, bloqueConfigId])

  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (envios === null) return <p className="text-xs text-tinta-suave">Cargando envíos…</p>
  if (envios.length === 0) {
    return (
      <p className="text-xs text-tinta-suave">
        Todavía no se le ha enviado {queSeEnvio ?? 'nada'} al cliente por correo desde esta etapa.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {envios.map(e => {
        const Icono = e.tono === 'ok' ? MailCheck : e.tono === 'problema' ? MailWarning : Mail
        const color =
          e.tono === 'ok'
            ? 'bg-green-100 text-green-700'
            : e.tono === 'problema'
              ? 'bg-red-100 text-red-700'
              : 'bg-muted text-muted-foreground'
        return (
          <li key={e.id} className="rounded-lg border border-border bg-card p-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <Icono className="mt-0.5 h-4 w-4 shrink-0 text-tinta-suave" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-tinta">{e.destino ?? 'Sin correo del cliente'}</p>
                  {e.titulo && <p className="truncate text-tinta-suave">{e.titulo}</p>}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
                {e.etiqueta}
              </span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-tinta-suave">
              <dt>Enviado</dt>
              <dd>{fechaHoraBogota(e.enviadoAt)}</dd>
              {e.entregadoAt && (
                <>
                  <dt>Entregado</dt>
                  <dd>{fechaHoraBogota(e.entregadoAt)}</dd>
                </>
              )}
              {e.copiaA && (
                <>
                  <dt>Copia oculta</dt>
                  <dd className="truncate">{e.copiaA}</dd>
                </>
              )}
            </dl>
            {e.explicacion && <p className="mt-1.5 text-[11px] text-red-700">{e.explicacion}</p>}
          </li>
        )
      })}
    </ul>
  )
}
