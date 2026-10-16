'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CancelarPrueba } from '../valida/cobro-prueba'

/**
 * «Cancelar prueba» en `/suscripcion`: la MISMA acción que la franja de `/valida`
 * (`cancelarPruebaValida`, que llama a `cancelarCobroDelEspacio`). Al cancelar, la página se vuelve a
 * leer y muestra la prueba cancelada.
 */
export function CancelarPruebaSuscripcion({ boton }: { boton: string }) {
  const router = useRouter()
  const [hecho, setHecho] = useState<string | null>(null)
  if (hecho) return <p className="text-sm text-tinta">{hecho}</p>
  return (
    <CancelarPrueba
      boton={boton}
      onCancelada={(texto) => {
        setHecho(texto)
        router.refresh()
      }}
    />
  )
}
