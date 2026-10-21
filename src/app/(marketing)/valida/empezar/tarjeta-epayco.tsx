'use client'

import Image from 'next/image'
import Script from 'next/script'
import { Lock } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { INTEGRIDAD_JQUERY, SCRIPT_EPAYCO, SCRIPT_JQUERY } from '@/lib/valida-registro/csp'
import { asegurarSesionEpayco, textoErrorEpayco } from '@/lib/valida-registro/error-epayco'
import { TIPOS_DOCUMENTO_TITULAR, nombreEnTarjeta, type TipoDocumentoTitular } from '@/lib/valida-registro/documento-titular'

/**
 * La tarjeta para el cobro al cumplirse los 7 días de la prueba (numeral 7 de la v2.0, decisión A2). Solo se pinta cuando
 * el servidor dice que se pide (`pideMetodoPago`).
 *
 * ⚠️ El número, la fecha y el CVC NO tienen `name`: no viajan en ningún formulario de ONE. ePayco.js
 * (el script oficial) los lee de los atributos `data-epayco` de este bloque, los manda a ePayco y
 * devuelve un TOKEN. A ONE solo llegan el token, los nombres y apellidos del titular, su documento y el celular.
 *
 * El documento es el del TITULAR de la tarjeta (no el NIT de la empresa): el antifraude de ePayco lo
 * compara con el del medio de pago y, si no coincide, rechaza el cobro.
 *
 * ePayco.js usa `$.ajax`, así que se carga jQuery antes (documentación oficial de tokenización).
 *
 * Los campos de la tarjeta van dentro de un recuadro de ePayco, con su distintivo oficial (el de
 * franquicias, de https://epayco.com/recursos-graficos/, sin recortar ni recolorear): quien paga ve
 * que esos datos los recibe ePayco y no un formulario de METRIK. ePayco no ofrece una captura
 * alojada que devuelva un token reutilizable; ver la CSP de esta página en `lib/valida-registro/csp.ts`.
 */

/** Lo que dice el recuadro, encima de los campos. */
const TEXTO_RECUADRO_EPAYCO =
  'Tus datos los recibe ePayco directamente; METRIK nunca ve el número de tu tarjeta.'

type EpaycoGlobal = {
  setPublicKey: (k: string) => void
  setLanguage?: (l: string) => void
  token: { create: (form: HTMLElement, cb: (error: unknown, token: string | null) => void) => void }
}

export interface DatosTarjeta {
  token: string
  nombres: string
  apellidos: string
  tipoDocumento: TipoDocumentoTitular
  documento: string
  celular: string
}

export interface TarjetaEpaycoHandle {
  /** Pide el token a ePayco con lo que hay en los campos. Rechaza con un texto para la persona. */
  tokenizar: () => Promise<DatosTarjeta>
}

const claseCampo = 'h-11 w-full rounded-lg border border-border bg-white px-3 text-base text-foreground'

const FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
})

interface PropsTarjeta {
  llavePublica: string
  correo: string
  /** El texto del aviso §2.3, con `{fecha_y_hora_vence}` por llenar (no entra a la huella). */
  texto: string
  /** Cuánto dura la prueba desde que se abre: la fecha que se muestra es ahora más esto. */
  duracionMs: number
}

const TarjetaEpayco = forwardRef<TarjetaEpaycoHandle, PropsTarjeta>(function TarjetaEpayco(
  { llavePublica, correo, texto, duracionMs },
  ref,
) {
  const bloque = useRef<HTMLDivElement>(null)
  const [cargado, setCargado] = useState(false)
  // El titular en DOS campos (nombres y apellidos): partir un nombre completo en la primera palabra
  // mandaba «Diana» / «Estefany Sierra Martinez» a ePayco (prueba 390432324, 2026-10-19). ePayco.js lee
  // UN campo `card[name]`: es un oculto que se llena con los dos justo antes de tokenizar, con
  // `setAttribute('value')` porque ePayco.js lee el atributo antes que `.value`.
  const campoNombreTarjeta = useRef<HTMLInputElement>(null)
  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [celular, setCelular] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumentoTitular>('CC')
  const [documento, setDocumento] = useState('')
  // Se calcula una vez, al pintar: la prueba abre al enviar, minutos después.
  const [vence] = useState(() => FECHA_HORA.format(new Date(Date.now() + duracionMs)))

  useImperativeHandle(ref, () => ({
    tokenizar: () =>
      new Promise((resolver, rechazar) => {
        const ePayco = (window as unknown as { ePayco?: EpaycoGlobal }).ePayco
        if (!ePayco || !bloque.current) {
          rechazar(new Error('La pasarela de pago todavía está cargando. Espera un momento.'))
          return
        }
        const completo = nombreEnTarjeta(nombres, apellidos)
        campoNombreTarjeta.current?.setAttribute('value', completo)
        if (campoNombreTarjeta.current) campoNombreTarjeta.current.value = completo
        asegurarSesionEpayco(window.localStorage, () => crypto.randomUUID())
        ePayco.setPublicKey(llavePublica)
        ePayco.setLanguage?.('es')
        ePayco.token.create(bloque.current, (error, token) => {
          if (error || !token) {
            // El objeto de ePayco entero, para diagnosticar: no trae datos de la tarjeta (ver error-epayco.ts).
            console.error('[ePayco] no tokenizó', error ?? { token })
            rechazar(new Error(textoErrorEpayco(error)))
            return
          }
          resolver({ token, nombres, apellidos, tipoDocumento, documento, celular })
        })
      }),
  }))

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3" data-tarjeta-epayco>
      <Script src={SCRIPT_JQUERY} integrity={INTEGRIDAD_JQUERY} crossOrigin="anonymous" strategy="afterInteractive" />
      <Script src={SCRIPT_EPAYCO} strategy="afterInteractive" onLoad={() => setCargado(true)} />
      <legend className="px-1 text-sm font-medium text-foreground">Tarjeta para el plan</legend>
      <p className="text-xs text-muted-foreground">{texto.replace('{fecha_y_hora_vence}', vence)}</p>
      {/* El recuadro de ePayco: solo lo que va a ePayco. El documento y el celular quedan afuera porque los recibe ONE. */}
      <section
        aria-label="Pago seguro con ePayco"
        className="space-y-3 rounded-xl border-2 border-neutral-900 bg-white p-3"
        data-recuadro-epayco
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <Lock className="size-4" aria-hidden />
          Pago seguro con ePayco
        </div>
        <Image
          src="/pasarela/epayco-franquicias.png"
          alt="ePayco: Visa, Mastercard, American Express, Diners Club y Codensa"
          width={664}
          height={210}
          className="h-auto w-full max-w-[240px]"
        />
        <p className="text-xs text-neutral-700">{TEXTO_RECUADRO_EPAYCO}</p>
        {/* Lo que lee ePayco.js. Sin `name`: estos datos no se envían a ONE. */}
        <div ref={bloque} className="space-y-3">
          <input type="hidden" data-epayco="card[email]" value={correo} readOnly />
          <input ref={campoNombreTarjeta} type="hidden" data-epayco="card[name]" defaultValue="" />
          <input className={claseCampo} aria-label="Nombres del titular" placeholder="Nombres del titular" autoComplete="cc-given-name" value={nombres} onChange={(e) => setNombres(e.target.value)} />
          <input className={claseCampo} aria-label="Apellidos del titular" placeholder="Apellidos del titular" autoComplete="cc-family-name" value={apellidos} onChange={(e) => setApellidos(e.target.value)} />
          <input className={claseCampo} data-epayco="card[number]" aria-label="Número de la tarjeta" placeholder="Número de la tarjeta" inputMode="numeric" autoComplete="cc-number" />
          <div className="flex gap-2">
            <input className={claseCampo} data-epayco="card[exp_month]" aria-label="Mes (MM)" placeholder="MM" inputMode="numeric" autoComplete="cc-exp-month" maxLength={2} />
            <input className={claseCampo} data-epayco="card[exp_year]" aria-label="Año (AAAA)" placeholder="AAAA" inputMode="numeric" autoComplete="cc-exp-year" maxLength={4} />
            <input className={claseCampo} data-epayco="card[cvc]" aria-label="CVC" placeholder="CVC" inputMode="numeric" autoComplete="cc-csc" maxLength={4} />
          </div>
        </div>
        {!cargado && <p className="text-xs text-neutral-700">Cargando la pasarela de pago...</p>}
      </section>
      <div className="space-y-1.5">
        <label htmlFor="documento-titular" className="text-sm font-medium text-foreground">
          Documento del titular de la tarjeta
        </label>
        {/* Selector angosto y el número con todo el resto: en una fila de 320 px el número se lee entero. */}
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2" data-documento-titular>
          <select
            aria-label="Tipo de documento del titular"
            className={`${claseCampo} px-2`}
            value={tipoDocumento}
            onChange={(e) => setTipoDocumento(e.target.value as TipoDocumentoTitular)}
          >
            {TIPOS_DOCUMENTO_TITULAR.map((t) => (
              <option key={t.codigo} value={t.codigo} title={t.nombre}>
                {t.codigo}
              </option>
            ))}
          </select>
          <input
            id="documento-titular"
            className={`${claseCampo} min-w-0`}
            placeholder="Número, sin puntos"
            inputMode={tipoDocumento === 'PP' ? 'text' : 'numeric'}
            autoComplete="off"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">El de la persona o empresa dueña de la tarjeta.</p>
      </div>
      <input
        className={claseCampo}
        aria-label="Celular"
        placeholder="Celular (10 dígitos)"
        inputMode="tel"
        autoComplete="tel-national"
        value={celular}
        onChange={(e) => setCelular(e.target.value)}
      />
    </fieldset>
  )
})

export default TarjetaEpayco
