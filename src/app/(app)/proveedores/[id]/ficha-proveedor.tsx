'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ImagePlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import type { ElementoVista } from '@/lib/fotos/vista'
import { NOMBRE_TIPO_PROVEEDOR } from '@/lib/proveedores/tipos'
import { moverFoto, quitarFotoDeBiblioteca, separarNombreDelPerfil, subirFotoAlProveedor } from '../../fotos/actions'
import PerfilFotos, { textoAgregarFotos, type AccionesPerfil } from '../../fotos/perfil-fotos'
import { confirmarCiudad, type CuentaVista, type ExtraccionVista, type FichaProveedor, type PersonaEquipo } from '../actions'
import SeccionExtraccion from './seccion-extraccion'
import PedirTarifas from './pedir-tarifas'
import SeccionCuentas from './seccion-cuentas'
import SeccionDatos from './seccion-datos'
import SeccionTarifarios from './seccion-tarifarios'

const ORIGEN = { cotizacion: 'Llegó desde una cotización', importacion: 'Importado de Airtable', manual: 'Creado a mano' } as const

/**
 * La ficha del proveedor en una sola página (Noor, 2026-10-18): Datos · Tarifarios · Fotos ·
 * Cuenta bancaria. En celular, una columna sin scroll lateral.
 */
export default function FichaProveedorVista({
  ficha,
  equipo,
  mayoristas,
  editable,
  yo,
  fotos,
  cuentas,
  errorCuentas,
  agencia,
  extraccion = null,
}: {
  agencia: string
  /** La última extracción del motor de tarifarios (`null` = no hay). */
  extraccion?: ExtraccionVista | null
  ficha: FichaProveedor
  equipo: PersonaEquipo[]
  mayoristas: PersonaEquipo[]
  editable: boolean
  yo: string | null
  /** `null` = este tipo no tiene fotos (un mayorista, un transportador). */
  fotos: { elemento: ElementoVista | null } | null
  /** `null` = sin permiso financiero (la sección no existe). */
  cuentas: CuentaVista[] | null
  errorCuentas: string | null
}) {
  const router = useRouter()
  const refrescar = () => router.refresh()
  const [elemento, setElemento] = useState<ElementoVista | null>(fotos?.elemento ?? null)
  const [fotosAbiertas, setFotosAbiertas] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const confirmar = async () => {
    if (confirmando) return
    setConfirmando(true)
    try {
      const r = await confirmarCiudad(ficha.id)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Ciudad confirmada')
      refrescar()
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setConfirmando(false)
    }
  }
  const tipoFoto = ficha.espacio === 'hotel' ? 'hotel' : 'actividad'
  // La foto va al perfil por su id: la llave no cambia aunque la ficha cambie de nombre o ciudad.
  const acciones: AccionesPerfil = {
    subir: (_p, dataUrl, reemplaza, categoria, autorizacion) => subirFotoAlProveedor(ficha.id, dataUrl, reemplaza, categoria, autorizacion),
    mover: moverFoto,
    quitar: quitarFotoDeBiblioteca,
    separar: separarNombreDelPerfil,
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6" data-ficha-proveedor={ficha.id}>
      <div className="space-y-1">
        <Link href="/proveedores" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ChevronLeft className="h-3.5 w-3.5" /> Proveedores
        </Link>
        <h1 className="text-lg font-semibold break-words">{ficha.nombre}</h1>
        <p className="m-0 text-xs text-muted-foreground">
          {[NOMBRE_TIPO_PROVEEDOR[ficha.tipoProveedor], ficha.ciudad, ficha.destino, ORIGEN[ficha.origen]].filter(Boolean).join(' · ')}
        </p>
      </div>

      {ficha.faltas.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-[#F4D7A1] bg-[#FFF8EC] p-3 text-xs" data-ficha-incompleta>
          <p className="m-0 font-semibold text-[#7A4B08]">Ficha por clasificar: no se usa para cotizar hasta completarla.</p>
          <ul className="m-0 list-disc pl-4 text-[#7A4B08]">
            {ficha.faltas.map((f) => (
              <li key={f.texto}>{f.texto}</li>
            ))}
          </ul>
          {editable && ficha.ciudadPorConfirmar && ficha.ciudad && ficha.ciudadEsDepartamento && (
            <p className="m-0 text-[#7A4B08]" data-ciudad-es-departamento>
              No se puede confirmar: «{ficha.ciudad}» es un departamento. Escribe el municipio en «Ciudad» y guarda.
            </p>
          )}
          {editable && ficha.ciudadPorConfirmar && ficha.ciudad && !ficha.ciudadEsDepartamento && (
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={confirmando}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E0B566] bg-background px-3 font-medium disabled:opacity-50"
              data-confirmar-ciudad
            >
              {confirmando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirmar que la ciudad es {ficha.ciudad}
            </button>
          )}
        </div>
      )}

      <SeccionDatos key={`datos-${ficha.id}`} ficha={ficha} equipo={equipo} mayoristas={mayoristas} editable={editable} onGuardado={refrescar} />

      <hr />
      <SeccionTarifarios ficha={ficha} editable={editable} onCambio={refrescar} />
      <PedirTarifas ficha={ficha} agencia={agencia} editable={editable} onCambio={refrescar} />
      <SeccionExtraccion proveedorId={ficha.id} extraccion={extraccion} editable={editable} onCambio={refrescar} />

      {fotos && (
        <>
          <hr />
          <section className="space-y-2" data-seccion="fotos">
            <h2 className="text-sm font-semibold">Fotos</h2>
            <p className="m-0 text-[11px] text-muted-foreground">Hasta 3. Entran solas en la propuesta cada vez que una cotización nombra este {tipoFoto === 'hotel' ? 'hotel' : 'tour'}.</p>
            <button type="button" onClick={() => setFotosAbiertas(true)} className="flex w-full flex-wrap items-center gap-2 rounded-lg border p-2 text-left hover:bg-accent/30">
              {elemento && elemento.fotos.length > 0 ? (
                elemento.fotos.map((f) => (
                  <span
                    key={f.id}
                    className={`block rounded bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd] bg-cover bg-center ${f.principal ? 'h-16 w-24' : 'h-16 w-12'}`}
                    style={f.url ? { backgroundImage: `url(${JSON.stringify(f.url)})` } : undefined}
                  />
                ))
              ) : (
                <span className="flex h-16 w-24 items-center justify-center rounded border-2 border-dashed text-muted-foreground" aria-hidden>
                  <ImagePlus className="h-4 w-4" />
                </span>
              )}
              <span className="text-xs text-muted-foreground">{elemento && elemento.fotos.length > 0 ? 'Ver y cambiar fotos' : textoAgregarFotos(tipoFoto)}</span>
            </button>
            {fotosAbiertas && (
              <PerfilFotos
                elemento={elemento}
                pedido={{ tipo: tipoFoto, nombre: elemento?.nombre ?? ficha.nombre, ciudad: elemento?.ciudad ?? ficha.ciudad }}
                abierto
                editable={editable}
                acciones={acciones}
                onCerrar={() => setFotosAbiertas(false)}
                onCambio={(e) => setElemento(e)}
              />
            )}
          </section>
        </>
      )}

      {cuentas && (
        <>
          <hr />
          <SeccionCuentas proveedorId={ficha.id} cuentas={cuentas} yo={yo} error={errorCuentas} onCambio={refrescar} />
        </>
      )}
    </div>
  )
}
