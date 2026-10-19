import { notFound } from 'next/navigation'

import { elementoDelPerfil } from '../../fotos/actions'
import { leerCuentas, leerExtraccion, leerFicha, type CuentaVista } from '../actions'
import FichaProveedorVista from './ficha-proveedor'

/** «Extraer con el motor» corre como acción de esta página y puede tardar minutos (punto 6). */
export const maxDuration = 300

/**
 * La ficha de un proveedor en una sola página (Noor, 2026-10-18): Datos · Tarifarios · Fotos ·
 * Cuenta bancaria (solo con permiso financiero).
 */
export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await leerFicha(id)
  if (!r.ok) {
    if (/no tiene|no está en este espacio/.test(r.error)) notFound()
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-lg font-semibold">Proveedor</h1>
        <p className="text-sm text-muted-foreground">{r.error}</p>
      </div>
    )
  }
  const conFotos = r.ficha.espacio === 'hotel' || r.ficha.espacio === 'actividad'
  const [fotos, cuentas, extraccion] = await Promise.all([
    conFotos ? elementoDelPerfil(r.ficha.espacio as 'hotel' | 'actividad', r.ficha.clave) : Promise.resolve(null),
    r.verCuentas ? leerCuentas(r.ficha.id) : Promise.resolve(null),
    leerExtraccion(r.ficha.id),
  ])
  return (
    <FichaProveedorVista
      ficha={r.ficha}
      agencia={r.agencia}
      extraccion={extraccion.ok ? extraccion.extraccion : null}
      usoTarifario={extraccion.ok ? extraccion.uso : null}
      equipo={r.equipo}
      mayoristas={r.mayoristas}
      editable={r.editable}
      yo={r.yo}
      fotos={conFotos ? { elemento: fotos && fotos.ok ? fotos.elemento : null } : null}
      cuentas={r.verCuentas ? (cuentas && cuentas.ok ? cuentas.cuentas : ([] as CuentaVista[])) : null}
      errorCuentas={cuentas && !cuentas.ok ? cuentas.error : null}
    />
  )
}
