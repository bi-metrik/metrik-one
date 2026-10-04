'use client'

import { useEffect, useState } from 'react'
import MetrikLockup from '@/components/metrik-lockup'
import { createClient } from '@/lib/supabase/client'
import { fetchPropio } from '@/lib/version/fetch-propio'
import { derivarSlug, problemaDelSlug, textoProblemaSlug } from '@/lib/secop-registro/slug'

const FONT = 'var(--font-schibsted), sans-serif'
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'

/**
 * El registro, en tres pasos y una sola pantalla.
 *
 * Mauricio, §0-quater: «esto no puede ser nada tedioso… la herramienta realmente no justifica que sea
 * nada tedioso». De ahí tres decisiones de esta pantalla:
 *
 *   1. **No hay formulario de contraseña ni pantalla de verificación aparte.** Se pide el correo, y
 *      el código que llega ES la verificación. Se reusa el mismo mecanismo del login (OTP de GoTrue),
 *      que además existe porque los filtros de correo corporativo gastan el enlace antes que la
 *      persona (ver `login-client.tsx`).
 *   2. **La dirección se propone desde el nombre y queda editable.** El campo nunca nace vacío con
 *      reglas al lado. Lo que el navegador propone es una sugerencia: quien valida es el servidor
 *      (§3.1), y esta pantalla usa la MISMA función para no mostrar como válido algo que el servidor
 *      va a rechazar.
 *   3. **No se pide tarjeta.** El flujo publicado en los términos es registro → aceptación → trial →
 *      enlace de pago, y pedirla antes es un cambio de producto, no de pantalla.
 *
 * Lo que esta pantalla NO decide: ni el slug final, ni si el NIT está libre, ni el tope por IP. Todo
 * eso se resuelve en `/api/secop/registro` y aquí solo se muestra su respuesta.
 */

type Paso = 'correo' | 'codigo' | 'espacio' | 'listo'

/**
 * Salir al subdominio del espacio recién creado.
 *
 * Fuera del componente a propósito: la regla del compilador de React no admite escribir
 * `window.location` desde dentro (es una mutación de algo que vive afuera del render). No es una
 * navegación de Next: hay que cambiar de HOST para que la sesión quede sembrada en el subdominio.
 */
function irAlEspacio(slug: string) {
  window.location.href = `https://${slug}.${BASE_DOMAIN}/radar`
}

export default function RegistroSecopClient() {
  const [paso, setPaso] = useState<Paso>('correo')
  const [correo, setCorreo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  // Mientras nadie toque el campo de la dirección, sigue al nombre. En cuanto lo tocan, manda lo que
  // escribieron: nada es peor que un campo que se reescribe solo mientras se teclea.
  const [slugTocado, setSlugTocado] = useState(false)
  const [identificacion, setIdentificacion] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [slugFinal, setSlugFinal] = useState('')

  // Si ya hay sesión (volvió a la pantalla con el correo ya verificado), se salta los dos primeros
  // pasos. Sin esto, quien recarga vuelve a pedir un código que no necesita.
  useEffect(() => {
    let vivo = true
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!vivo || !data.user?.email) return
        setCorreo(data.user.email)
        setPaso((p) => (p === 'correo' ? 'espacio' : p))
      })
    return () => {
      vivo = false
    }
  }, [])

  const slugPropuesto = slugTocado ? slug : derivarSlug(nombre)
  const problemaSlug = slugPropuesto ? problemaDelSlug(slugPropuesto) : null

  const pedirCodigo = async (e: React.FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError('')
    const { error } = await createClient().auth.signInWithOtp({
      email: correo.trim(),
      options: { emailRedirectTo: `${window.location.origin}/secop` },
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
    else setPaso('espacio')
    setOcupado(false)
  }

  const abrirEspacio = async (e: React.FormEvent) => {
    e.preventDefault()
    setOcupado(true)
    setError('')
    const r = await fetchPropio('/api/secop/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, slug: slugPropuesto, identificacion }),
    })
    const cuerpo = (await r.json().catch(() => ({}))) as {
      ok?: boolean
      slug?: string
      texto?: string
      yaTiene?: boolean
    }
    if (cuerpo.ok && cuerpo.slug) {
      setSlugFinal(cuerpo.slug)
      setPaso('listo')
      // La sesión está sembrada en el dominio base; al llegar al subdominio el middleware manda al
      // login de ESE subdominio, que es donde tiene que quedar la sesión del inquilino.
      irAlEspacio(cuerpo.slug)
      setOcupado(false)
      return
    }
    if (cuerpo.yaTiene && cuerpo.slug) {
      irAlEspacio(cuerpo.slug)
      return
    }
    if (r.status === 401) setPaso('correo')
    setError(cuerpo.texto || 'No pudimos abrir el espacio. Inténtalo de nuevo.')
    setOcupado(false)
  }

  const claseCampo =
    'flex h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
  const claseBoton =
    'inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center space-y-5">
          <MetrikLockup size="md" linkTo="/" />
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
              Radar SECOP
            </h1>
            <p className="text-sm text-muted-foreground">
              Las convocatorias públicas cruzadas con lo que tu empresa hace. Cinco días de prueba.
            </p>
          </div>
        </div>

        {paso === 'correo' && (
          <form onSubmit={pedirCodigo} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="correo" className="text-sm font-medium text-foreground">
                Tu correo
              </label>
              <input
                id="correo"
                type="email"
                required
                autoFocus
                placeholder="tu@empresa.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className={claseCampo}
              />
              <p className="text-xs text-muted-foreground">
                Te mandamos un código. No hay contraseña que recordar.
              </p>
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

        {paso === 'espacio' && (
          <form onSubmit={abrirEspacio} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="nombre" className="text-sm font-medium text-foreground">
                Nombre de tu empresa
              </label>
              <input
                id="nombre"
                type="text"
                required
                autoFocus
                placeholder="Fabri Ingeniería"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className={claseCampo}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium text-foreground">
                La dirección de tu espacio
              </label>
              <div className="flex items-center rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary/30">
                <input
                  id="slug"
                  type="text"
                  required
                  placeholder="tuempresa"
                  value={slugPropuesto}
                  onChange={(e) => {
                    setSlugTocado(true)
                    setSlug(e.target.value.toLowerCase())
                  }}
                  className="h-11 w-full min-w-0 rounded-l-lg bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
                />
                <span className="shrink-0 px-3 text-sm text-muted-foreground">.{BASE_DOMAIN}</span>
              </div>
              {problemaSlug ? (
                <p className="text-xs text-amber-600">{textoProblemaSlug(problemaSlug)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">La proponemos desde el nombre. Puedes cambiarla.</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="identificacion" className="text-sm font-medium text-foreground">
                NIT o cédula
              </label>
              <input
                id="identificacion"
                type="text"
                inputMode="numeric"
                required
                placeholder="900123456-7"
                value={identificacion}
                onChange={(e) => setIdentificacion(e.target.value)}
                className={claseCampo}
              />
              <p className="text-xs text-muted-foreground">
                Es con lo que te facturamos. Si escribes el dígito de verificación, sepáralo con guion.
              </p>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button type="submit" disabled={ocupado || !!problemaSlug} className={claseBoton}>
              {ocupado ? 'Abriendo...' : 'Abrir mi espacio'}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Al entrar vas a leer y aceptar los términos del servicio. La prueba de cinco días arranca
              cuando los aceptas.
            </p>
          </form>
        )}

        {paso === 'listo' && (
          <p className="text-center text-sm text-muted-foreground">
            Listo. Te estamos llevando a {slugFinal}.{BASE_DOMAIN}
          </p>
        )}
      </div>
    </div>
  )
}
