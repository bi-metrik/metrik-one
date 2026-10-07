'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CalendarCheck } from 'lucide-react'
import { TextoDocumento } from '@/components/terminos/entrada-terminos'
import { useIntencion } from '@/hooks/use-intencion'
import { formatCOP } from '@/lib/cobros/format'
import {
  fechaLarga,
  PLAN_ANUAL,
  renderAnexoPlanAnual,
  textoMencionAutoriza,
  textoRevocacionMencion,
  TIPOS_DOCUMENTO_ACEPTANTE,
  validarAceptante,
  type TipoDocumentoAceptante,
} from '@/lib/valida-cda/plan-anual'
import type { OpcionesPago as Opciones } from '@/lib/valida-cda/plan-anual-servidor'
import { cambiarMencionPlanAnual, elegirPlanAnual, pagarElMes } from './acciones'

/**
 * Las dos formas de pagar de un CDA, arriba de sus cuotas en la pestaña Pagos de `/suscripcion`:
 * «Pagar el mes» (la cuota pendiente) y «Pagar 12 meses» (el Plan Anual). El anual pide antes leer y
 * aceptar el anexo; al aceptar, el servidor genera el enlace y la pantalla lleva a la pasarela.
 *
 * Lo que se acepta se arma con la MISMA función que usa el servidor (`renderAnexoPlanAnual`), con el
 * nombre y el documento que escribe la persona; el servidor la vuelve a armar y compara la casilla y la
 * huella del texto antes de registrar nada.
 *
 * La autorización de mención (numeral 11 del anexo) es una casilla APARTE: desmarcada por defecto, fuera
 * del botón de pago, que no habilita ni bloquea nada. Con el plan activo se puede revocar (o volver a dar)
 * desde aquí mismo.
 */

type OpcionesOk = Extract<Opciones, { tipo: 'ok' }>

const ETIQUETA_DOC: Record<TipoDocumentoAceptante, string> = { CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PA: 'Pasaporte' }

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const BOTON = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50'

export function OpcionesPago({ opciones, soloLectura, nombreSugerido }: { opciones: OpcionesOk; soloLectura: boolean; nombreSugerido: string | null }) {
  const [pendiente, iniciar] = useTransition()
  const { mes, anual } = opciones

  function irAlMes() {
    iniciar(async () => {
      const r = await pagarElMes()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      window.location.href = r.url
    })
  }

  const anualVisible = anual.estado !== 'no_disponible' || anual.motivo !== 'apagado'
  if (!mes && !anualVisible) return null

  return (
    <section data-opciones-pago className="space-y-3 rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-tinta">Cómo quieres pagar</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {mes &&
          (mes.enlace ? (
            <a
              href={mes.enlace}
              target="_blank"
              rel="noopener noreferrer"
              data-pagar-mes
              className={`${BOTON} border border-acento text-acento ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
            >
              Pagar el mes · {formatCOP(mes.saldo)}
            </a>
          ) : (
            <button type="button" data-pagar-mes disabled={soloLectura || pendiente} onClick={irAlMes} className={`${BOTON} border border-acento text-acento`}>
              Pagar el mes · {formatCOP(mes.saldo)}
            </button>
          ))}
        {anual.estado === 'elegido' && (
          <a
            href={anual.enlace}
            target="_blank"
            rel="noopener noreferrer"
            data-pagar-anual
            className={`${BOTON} bg-acento text-white ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
          >
            Pagar 12 meses · {formatCOP(PLAN_ANUAL.monto)}
          </a>
        )}
      </div>

      {anual.estado === 'activo' && (
        <>
          <p data-plan-anual-activo className="flex items-start gap-2 text-sm text-emerald-800">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Plan anual pagado: 12 períodos del {fechaLarga(anual.desde)} al {fechaLarga(anual.hasta)}.
          </p>
          {anual.razonSocial && (
            <Mencion razonSocial={anual.razonSocial} autoriza={anual.mencion?.autoriza ?? false} soloLectura={soloLectura} />
          )}
        </>
      )}
      {anual.estado === 'elegido' && (
        <p data-plan-anual-elegido className="text-xs text-tinta-suave">
          Elegiste el plan anual (del {fechaLarga(anual.desde)} al {fechaLarga(anual.hasta)}). Se activa cuando el pago quede
          aprobado; el enlace sirve hasta el día anterior al {fechaLarga(anual.desde)}.
        </p>
      )}
      {anual.estado === 'no_disponible' && anual.motivo !== 'apagado' && (
        <p data-plan-anual-no-disponible className="text-xs text-tinta-suave">
          {anual.texto}
        </p>
      )}
      {anual.estado === 'oferta' && <OfertaAnual datos={anual.datos} soloLectura={soloLectura} nombreSugerido={nombreSugerido} />}
    </section>
  )
}

export function OfertaAnual({
  datos,
  soloLectura,
  nombreSugerido,
  abiertoInicial = false,
}: {
  datos: Extract<OpcionesOk['anual'], { estado: 'oferta' }>['datos']
  soloLectura: boolean
  nombreSugerido: string | null
  /** Solo para las pruebas de render: el anexo ya abierto. */
  abiertoInicial?: boolean
}) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  const [nombre, setNombre] = useState(nombreSugerido ?? '')
  const [tipo, setTipo] = useState<TipoDocumentoAceptante>('CC')
  const [numero, setNumero] = useState('')
  const [acepta, setAcepta] = useState(false)
  // Numeral 11: desmarcada por defecto, y nada depende de ella.
  const [mencion, setMencion] = useState(false)
  const [pendiente, iniciar] = useTransition()
  const intencion = useIntencion()

  const aceptante = validarAceptante({ nombre, tipoDocumento: tipo, numeroDocumento: numero })
  const texto = useMemo(
    () =>
      renderAnexoPlanAnual({
        ...datos,
        nombreUsuario: aceptante.ok ? aceptante.nombre : nombre.trim() || '[tu nombre]',
        tipoDocumento: tipo,
        numeroDocumento: aceptante.ok ? aceptante.numeroDocumento : numero.trim() || '[número]',
      }),
    [datos, aceptante, nombre, tipo, numero],
  )

  function aceptar() {
    if (!aceptante.ok || !acepta) return
    iniciar(async () => {
      const r = await elegirPlanAnual(
        {
          nombre,
          tipoDocumento: tipo,
          numeroDocumento: numero,
          casillaMostrada: texto.casilla,
          anexoSha256: await sha256Hex(texto.anexo),
          aceptaCasilla: acepta,
          casillaMencionMostrada: texto.casillaMencion,
          autorizaMencion: mencion,
        },
        intencion.clave(),
      )
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      window.location.href = r.url
    })
  }

  if (!abierto) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          data-elegir-anual
          disabled={soloLectura}
          onClick={() => setAbierto(true)}
          className={`${BOTON} w-full bg-acento text-white sm:w-auto`}
        >
          Pagar 12 meses · {formatCOP(PLAN_ANUAL.monto)} (ahorras {formatCOP(PLAN_ANUAL.descuento)})
        </button>
        <p className="text-xs text-tinta-suave">
          Un solo pago por 12 períodos, del {fechaLarga(datos.plazo.desde)} al {fechaLarga(datos.plazo.hasta)}. Antes de pagar
          lees y aceptas el Anexo del Plan Anual. Oferta hasta el 31 de marzo de 2027.
        </p>
      </div>
    )
  }

  return (
    <div data-anexo-plan-anual className="space-y-3 rounded-md border border-border p-3">
      <div className="max-h-96 overflow-y-auto rounded-md bg-papel p-3 text-sm text-tinta">
        <TextoDocumento md={texto.anexo} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-tinta-suave sm:col-span-3">
          Nombre completo
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm text-tinta" />
        </label>
        <label className="text-xs text-tinta-suave">
          Tipo de documento
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDocumentoAceptante)}
            className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm text-tinta"
          >
            {TIPOS_DOCUMENTO_ACEPTANTE.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_DOC[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-tinta-suave sm:col-span-2">
          Número de documento
          <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm text-tinta" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-tinta">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} disabled={!aceptante.ok} className="mt-1" data-casilla-anual />
        <span>{texto.casilla}</span>
      </label>
      {!aceptante.ok && (nombre || numero) && <p className="text-xs text-amber-800">{aceptante.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-aceptar-anual
          disabled={soloLectura || pendiente || !aceptante.ok || !acepta}
          onClick={aceptar}
          className={`${BOTON} bg-acento text-white`}
        >
          {pendiente ? 'Preparando el pago…' : 'Acepto y voy a pagar'}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className={`${BOTON} text-tinta-suave`}>
          Ahora no
        </button>
      </div>
      <label className="flex items-start gap-2 border-t border-border pt-3 text-xs text-tinta-suave">
        <input
          type="checkbox"
          checked={mencion}
          onChange={(e) => setMencion(e.target.checked)}
          disabled={soloLectura || pendiente}
          className="mt-0.5"
          data-casilla-mencion
        />
        <span>{texto.casillaMencion}</span>
      </label>
    </div>
  )
}

/** Con el plan activo: la autorización de mención, revocable (o que se puede dar) en cualquier momento. */
function Mencion({ razonSocial, autoriza, soloLectura }: { razonSocial: string; autoriza: boolean; soloLectura: boolean }) {
  const [pendiente, iniciar] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const texto = autoriza ? textoRevocacionMencion(razonSocial) : textoMencionAutoriza(razonSocial)

  function cambiar() {
    iniciar(async () => {
      const r = await cambiarMencionPlanAnual({ autoriza: !autoriza, textoMostrado: texto })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setConfirmar(false)
      toast.success(autoriza ? 'Revocaste la autorización de mención.' : 'Autorizaste la mención.')
    })
  }

  return (
    <div data-mencion-plan-anual className="space-y-2 rounded-md border border-border p-3 text-xs text-tinta-suave">
      <p>
        {autoriza
          ? `Autorizaste a METRIK a decir que ${razonSocial} usa VALIDA, con su razón social y su logotipo (numeral 11 del anexo).`
          : `No has autorizado a METRIK a mencionar que ${razonSocial} usa VALIDA (numeral 11 del anexo, opcional).`}
      </p>
      {confirmar ? (
        <div className="space-y-2">
          <p className="text-tinta">{texto}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-confirmar-mencion disabled={soloLectura || pendiente} onClick={cambiar} className={`${BOTON} border border-border text-tinta`}>
              {autoriza ? 'Revocar' : 'Autorizar'}
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className={`${BOTON} text-tinta-suave`}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" data-cambiar-mencion disabled={soloLectura} onClick={() => setConfirmar(true)} className="underline">
          {autoriza ? 'Revocar la autorización' : 'Autorizar la mención'}
        </button>
      )}
    </div>
  )
}
