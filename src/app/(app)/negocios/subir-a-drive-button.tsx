'use client'
import { useState } from 'react'
import { ExternalLink, Loader2, Table2 } from 'lucide-react'
import { toast } from 'sonner'
import { subirExportNegociosADrive } from './exportar-drive-actions'

/**
 * «Enviar a Drive» de la lista de negocios.
 *
 * Manda los mismos ids que la descarga a Excel (los de la lista visible, ya filtrados,
 * que resuelve el servidor) y la server action publica la tabla como hoja NATIVA de Google Sheets en la
 * carpeta del espacio.
 *
 * Un solo archivo: el primer clic lo crea, los siguientes le reemplazan el contenido. El
 * enlace no cambia nunca, así que quien lo tenga guardado ve el dato de hoy.
 *
 * Lo que el usuario tiene que poder ver, y por qué está cada cosa:
 *   - el ENLACE, que es a lo que vino, y se queda en pantalla hasta que navegue;
 *   - si el archivo se creó o se actualizó (no es lo mismo «ya existía» que «lo hice yo»);
 *   - el error COMPLETO si Drive falla, en rojo y con rol de alerta. Nada de fallar en
 *     silencio: un botón que no hace nada visible se oprime tres veces más.
 *
 * El gate real está en la server action; este botón solo se pinta para los roles que
 * pasan (`puedeDescargarNegocios`, resuelto en el servidor, el mismo que la descarga).
 */

type Estado =
  | { fase: 'quieto' }
  | { fase: 'subiendo' }
  | { fase: 'listo'; url: string; creado: boolean; filas: number; compartidoCon: string[]; aviso?: string }
  | { fase: 'error'; mensaje: string }

export default function SubirADriveButton({
  total,
  obtenerIds,
}: {
  /** Largo de la lista visible: sin negocios no se ofrece. */
  total: number
  /** Ids de la lista visible COMPLETA, en su orden (los resuelve el servidor). */
  obtenerIds: () => Promise<string[]>
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'quieto' })

  const subiendo = estado.fase === 'subiendo'

  const subir = async () => {
    if (subiendo || total === 0) return
    setEstado({ fase: 'subiendo' })
    try {
      const ids = await obtenerIds()
      if (ids.length === 0) throw new Error('La vista quedó sin negocios. Recarga la lista.')
      const r = await subirExportNegociosADrive(ids)
      if (!r.ok) {
        setEstado({ fase: 'error', mensaje: r.error })
        toast.error(r.error)
        return
      }
      setEstado({
        fase: 'listo',
        url: r.url,
        creado: r.creado,
        filas: r.filas,
        compartidoCon: r.compartidoCon,
        aviso: r.aviso,
      })
      toast.success(r.creado ? 'Hoja creada en Drive' : 'Hoja actualizada en Drive')
    } catch (e) {
      // Una server action puede fallar por red o por un error no capturado del servidor.
      // Se dice; no se deja el botón girando.
      const msg = e instanceof Error ? e.message : 'No se pudo subir el archivo a Drive'
      setEstado({ fase: 'error', mensaje: msg })
      toast.error(msg)
    }
  }

  const n = total
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={subir}
        disabled={subiendo || n === 0}
        aria-busy={subiendo}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-tinta transition-colors hover:border-tinta/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {subiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Table2 className="h-3 w-3" />}
        {subiendo ? 'Enviando…' : 'Enviar a Drive'}
      </button>

      {estado.fase === 'listo' && (
        <div className="flex flex-col items-end gap-0.5">
          <a
            href={estado.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-acento underline underline-offset-2"
          >
            Abrir la hoja en Drive
            <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-[11px] text-tinta-suave">
            {estado.creado ? 'Hoja creada' : 'Hoja actualizada'} · {estado.filas} negocio
            {estado.filas !== 1 ? 's' : ''}
            {estado.compartidoCon.length > 0 &&
              ` · acceso nuevo para ${estado.compartidoCon.length}`}
          </p>
          {estado.aviso && (
            <p role="alert" className="max-w-xs text-right text-[11px] text-advertencia">
              {estado.aviso}
            </p>
          )}
        </div>
      )}

      {estado.fase === 'error' && (
        <p role="alert" className="max-w-xs text-right text-[11px] text-alerta">
          {estado.mensaje}
        </p>
      )}
    </div>
  )
}
