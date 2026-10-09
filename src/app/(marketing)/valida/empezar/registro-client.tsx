'use client'

import { useEffect, useState } from 'react'
import MetrikLockup from '@/components/metrik-lockup'
import { createClient } from '@/lib/supabase/client'
import { fetchPropio } from '@/lib/version/fetch-propio'
import {
  TIPOS_ENTIDAD,
  nitConPuntos,
  problemaDelNit,
  soloDigitos,
  textoProblemaNit,
  type TipoEntidad,
} from '@/lib/valida-registro/datos'

const FONT = 'var(--font-schibsted), sans-serif'
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
/** Las señales de origen sobreviven a la recarga del paso del código. */
const LLAVE_ORIGEN = 'valida-empezar-origen'

/**
 * Prueba gratis de Valida: correo → código → «Tu empresa». Una columna, un campo por fila, botones
 * de ancho completo (§2.1, «Mobile»). Mismo mecanismo de entrada que `/secop` y el login: el código
 * de 8 dígitos ES la verificación del correo.
 *
 * Lo que esta pantalla NO decide: ni el NIT libre, ni el tope, ni el origen. Los manda al servidor
 * (`/api/valida/registro`) y muestra su respuesta. El DV sí se comprueba aquí mientras se escribe,
 * con la MISMA función que usa el servidor.
 */

type Paso = 'correo' | 'codigo' | 'empresa' | 'listo'
export type Origen = { ref: string | null; codigoAfi: string | null; utm: Record<string, string> }

function irAlEspacio(slug: string) {
  window.location.href = `https://${slug}.${BASE_DOMAIN}/valida`
}

function tieneSenales(o: Origen): boolean {
  return Boolean(o.ref || o.codigoAfi || Object.keys(o.utm).length > 0)
}

/**
 * Las señales de origen llegan en la URL de la landing (`?ref=afi`, `?codigo=`, UTM) y las lee el
 * servidor. Si la persona vuelve por el enlace del correo en vez del código, la URL ya no las trae:
 * se recuperan de la sesión del navegador.
 */
function origenInicial(deUrl: Origen): Origen {
  if (tieneSenales(deUrl) || typeof window === 'undefined') return deUrl
  try {
    const guardado = window.sessionStorage.getItem(LLAVE_ORIGEN)
    return guardado ? (JSON.parse(guardado) as Origen) : deUrl
  } catch {
    return deUrl
  }
}

interface Props {
  origenUrl: Origen
  abierto: boolean
  consultas: number
  dias: number
  condiciones: { version: string; titulo: string; texto: string }
  avisoDatos: string
  politica: { titulo: string; url: string }
}

export default function RegistroValidaClient({ origenUrl, abierto, consultas, dias, condiciones, avisoDatos, politica }: Props) {
  const [paso, setPaso] = useState<Paso>('correo')
  const [correo, setCorreo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [nit, setNit] = useState('')
  const [dv, setDv] = useState('')
  const [tipoEntidad, setTipoEntidad] = useState<TipoEntidad | ''>('')
  const [recomendadoAfi, setRecomendadoAfi] = useState<boolean | null>(origenUrl.codigoAfi ? true : null)
  const [codigoAfi, setCodigoAfi] = useState(origenUrl.codigoAfi ?? '')
  const [acepta, setAcepta] = useState(false)
  const [origen] = useState<Origen>(() => origenInicial(origenUrl))
  const [error, setError] = useState('')
  const [errorCampo, setErrorCampo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (tieneSenales(origenUrl)) window.sessionStorage.setItem(LLAVE_ORIGEN, JSON.stringify(origenUrl))
  }, [origenUrl])

  useEffect(() => {
    let vivo = true
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!vivo || !data.user?.email) return
        setCorreo(data.user.email)
        setPaso((p) => (p === 'correo' ? 'empresa' : p))
      })
    return () => {
      vivo = false
    }
  }, [])

  const claseCampo =
    'flex h-12 w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
  const claseBoton =
    'inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50'

  if (!abierto) {
    return (
      <Marco consultas={consultas} dias={dias}>
        <p className="text-center text-sm text-muted-foreground">
          La prueba gratis abre muy pronto. Mientras tanto, escríbenos a mauricio.moreno@metrik.com.co.
        </p>
      </Marco>
    )
  }

  const pedirCodigo = async (e: React.FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError('')
    const { error } = await createClient().auth.signInWithOtp({
      email: correo.trim(),
      options: { emailRedirectTo: `${window.location.origin}/valida/empezar` },
    })
    if (error) setError('No pudimos enviar el código. Revisa el correo e inténtalo de nuevo.')
    else setPaso('codigo')
    setOcupado(false)
  }

  const verificarCodigo = async (e: React.FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError('')
    const { error } = await createClient().auth.verifyOtp({
      email: correo.trim(),
      token: codigo.replace(/\D/g, ''),
      type: 'email',
    })
    if (error) setError('Ese código no sirvió. Revisa que sea el del último correo, o pide uno nuevo.')
    else setPaso('empresa')
    setOcupado(false)
  }

  const problemaNit = nit || dv ? problemaDelNit(nit, dv) : null
  // Mientras escribe el NIT sin DV todavía, no se le grita: el aviso sale cuando hay DV.
  const avisoNit = problemaNit && (problemaNit === 'dv_no_coincide' || problemaNit === 'nit_forma') && dv ? textoProblemaNit(problemaNit) : ''

  const empezar = async (e: React.FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError('')
    setErrorCampo('')
    const r = await fetchPropio('/api/valida/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razon_social: razonSocial,
        nit,
        dv,
        tipo_entidad: tipoEntidad,
        acepta,
        condiciones_version: condiciones.version,
        recomendado_afi: recomendadoAfi,
        codigo_afi: recomendadoAfi ? codigoAfi || null : null,
        ref: origen.ref,
        utm: origen.utm,
      }),
    })
    const cuerpo = (await r.json().catch(() => ({}))) as {
      ok?: boolean
      slug?: string | null
      texto?: string
      campo?: string
      yaTiene?: boolean
      pruebaPendiente?: boolean
    }
    if (cuerpo.ok && cuerpo.slug) {
      window.sessionStorage.removeItem(LLAVE_ORIGEN)
      setPaso('listo')
      irAlEspacio(cuerpo.slug)
      return
    }
    if (cuerpo.yaTiene && cuerpo.slug) {
      irAlEspacio(cuerpo.slug)
      return
    }
    if (cuerpo.pruebaPendiente) {
      setAviso('Tu espacio quedó abierto, pero no pudimos activar las consultas de prueba. Vuelve a tocar el botón en un momento.')
      setOcupado(false)
      return
    }
    if (r.status === 401) setPaso('correo')
    setErrorCampo(cuerpo.campo ?? '')
    setError(cuerpo.texto || 'No pudimos abrir tu prueba. Inténtalo de nuevo.')
    setOcupado(false)
  }

  const listoParaEnviar = razonSocial.trim().length >= 3 && !problemaNit && !!tipoEntidad && acepta && recomendadoAfi !== null

  return (
    <Marco consultas={consultas} dias={dias}>
      {paso === 'correo' && (
        <form onSubmit={pedirCodigo} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="correo" className="text-sm font-medium text-foreground">
              Tu correo
            </label>
            <input
              id="correo"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="tu@empresa.com"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              className={claseCampo}
            />
            <p className="text-xs text-muted-foreground">Te mandamos un código. No hay contraseña que recordar.</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={ocupado} className={claseBoton}>
            {ocupado ? 'Enviando...' : 'Continuar'}
          </button>
        </form>
      )}

      {paso === 'codigo' && (
        <form onSubmit={verificarCodigo} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Le enviamos un código a <strong className="text-foreground">{correo}</strong>.
          </p>
          <div className="space-y-2">
            <label htmlFor="codigo" className="text-sm font-medium text-foreground">
              Código del correo
            </label>
            <input
              id="codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              placeholder="12345678"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={`${claseCampo} text-center text-lg tracking-[0.3em]`}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={ocupado} className={claseBoton}>
            {ocupado ? 'Entrando...' : 'Entrar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPaso('correo')
              setCodigo('')
              setError('')
            }}
            className="w-full text-center text-xs text-muted-foreground underline"
          >
            Usar otro correo
          </button>
        </form>
      )}

      {paso === 'empresa' && (
        <form onSubmit={empezar} className="space-y-5">
          <h2 className="text-base font-semibold text-foreground">Tu empresa</h2>

          <div className="space-y-2">
            <label htmlFor="razon" className="text-sm font-medium text-foreground">
              Razón social
            </label>
            <input
              id="razon"
              type="text"
              autoComplete="organization"
              required
              autoFocus
              placeholder="CDA Ejemplo S.A.S."
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              className={claseCampo}
            />
            {errorCampo === 'razon_social' && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="nit" className="text-sm font-medium text-foreground">
              NIT
            </label>
            <div className="flex items-center gap-2">
              <input
                id="nit"
                type="text"
                inputMode="numeric"
                required
                placeholder="900123456"
                value={nitConPuntos(nit)}
                onChange={(e) => setNit(soloDigitos(e.target.value).slice(0, 10))}
                className={claseCampo}
                aria-describedby="ayuda-nit"
              />
              <span className="text-lg text-muted-foreground">-</span>
              <input
                id="dv"
                type="text"
                inputMode="numeric"
                required
                aria-label="Dígito de verificación"
                placeholder="DV"
                value={dv}
                onChange={(e) => setDv(soloDigitos(e.target.value).slice(0, 1))}
                className={`${claseCampo} w-16 text-center`}
              />
            </div>
            {avisoNit ? (
              <p className="text-xs text-amber-600">{avisoNit}</p>
            ) : (
              <p id="ayuda-nit" className="text-xs text-muted-foreground">
                Sin puntos. El dígito de verificación va en la casilla de la derecha.
              </p>
            )}
            {(errorCampo === 'nit' || errorCampo === 'dv') && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Tipo de empresa</legend>
            {TIPOS_ENTIDAD.map((t) => (
              <label key={t.valor} className="flex h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm">
                <input
                  type="radio"
                  name="tipo_entidad"
                  value={t.valor}
                  checked={tipoEntidad === t.valor}
                  onChange={() => setTipoEntidad(t.valor)}
                />
                {t.etiqueta}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">¿Te recomendó AFI?</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, t: 'Sí' },
                { v: false, t: 'No' },
              ].map((o) => (
                <label key={o.t} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border text-sm">
                  <input type="radio" name="recomendado_afi" checked={recomendadoAfi === o.v} onChange={() => setRecomendadoAfi(o.v)} />
                  {o.t}
                </label>
              ))}
            </div>
            {recomendadoAfi && (
              <input
                type="text"
                aria-label="Código de AFI"
                placeholder="Código de AFI (si te lo dieron)"
                value={codigoAfi}
                onChange={(e) => setCodigoAfi(e.target.value.toUpperCase())}
                className={claseCampo}
              />
            )}
          </fieldset>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-foreground">{condiciones.titulo}</summary>
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line text-xs text-muted-foreground">{condiciones.texto}</div>
            </details>
            <p className="text-xs text-muted-foreground">
              {avisoDatos}{' '}
              <a href={politica.url} target="_blank" rel="noreferrer" className="underline">
                {politica.titulo}
              </a>
              .
            </p>
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
              <span>Acepto las Condiciones de la prueba y la Política de Datos.</span>
            </label>
            {errorCampo === 'acepta' && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {error && !['razon_social', 'nit', 'dv', 'acepta'].includes(errorCampo) && <p className="text-sm text-red-500">{error}</p>}
          {aviso && <p className="text-sm text-amber-700">{aviso}</p>}

          <button type="submit" disabled={ocupado || !listoParaEnviar} className={claseBoton}>
            {ocupado ? 'Abriendo tu prueba...' : `Empezar con ${consultas} consultas gratis`}
          </button>
        </form>
      )}

      {paso === 'listo' && <p className="text-center text-sm text-muted-foreground">Listo. Te estamos llevando a Valida.</p>}
    </Marco>
  )
}

function Marco({ consultas, dias, children }: { consultas: number; dias: number; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center space-y-5">
          <MetrikLockup size="md" linkTo="/" />
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
              Valida: prueba gratis
            </h1>
            <p className="text-sm text-muted-foreground">
              Consulta listas vinculantes SARLAFT. {consultas} consultas en {dias} días, sin tarjeta.
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
