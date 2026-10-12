'use client'

import { useState, useTransition } from 'react'
import { activarPlan } from './acciones'

/**
 * El botón «Activar plan» con la subida opcional del RUT. Una columna, botón de ancho completo, la
 * subida abre la cámara en el celular (§2.1 «Mobile»).
 */
export default function ActivarClient({ abierta }: { abierta: boolean }) {
  const [error, setError] = useState('')
  const [pendiente, iniciar] = useTransition()

  function enviar(formulario: FormData) {
    setError('')
    iniciar(async () => {
      const r = await activarPlan(formulario)
      if (r.ok) window.location.href = r.destino
      else setError(r.error)
    })
  }

  if (!abierta) {
    return (
      <p className="rounded-lg border border-border bg-white p-4 text-sm text-tinta-suave">
        La activación en línea abre pronto. Mientras tanto, escríbenos a{' '}
        <a className="underline" href="mailto:mauricio.moreno@metrik.com.co">
          mauricio.moreno@metrik.com.co
        </a>{' '}
        y activamos tu plan contigo.
      </p>
    )
  }

  return (
    <form action={enviar} className="space-y-4">
      <label className="block space-y-1 text-sm text-tinta">
        <span className="font-medium">RUT de la empresa (opcional)</span>
        <span className="block text-xs text-tinta-suave">
          En PDF o una foto. Si lo subes, verificamos la razón social y el NIT. Si no, puedes subirlo después.
        </span>
        <input type="file" name="rut" accept="application/pdf,image/*" capture="environment" className="block w-full text-sm" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-acento px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pendiente ? 'Activando tu plan...' : 'Activar plan'}
      </button>
    </form>
  )
}
