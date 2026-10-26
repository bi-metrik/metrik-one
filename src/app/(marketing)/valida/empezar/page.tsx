import type { Metadata } from 'next'
import { registroAbierto, tamanoPrueba } from '@/lib/valida-registro/llave'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { TEXTO_JUNTO_A_TARJETA, condicionesVigentes, versionAceptada } from '@/lib/valida-registro/condiciones'
import { minutosDePruebaAcortada } from '@/lib/valida-registro/cobro-prueba'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { LLAVES_UTM } from '@/lib/valida-registro/datos'
import { llavePublicaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { pideMetodoPago } from '@/lib/valida-registro/metodo-pago'
import { duracionPruebaMs, huellaParteII } from '@/lib/valida-registro/terminos-registro-servidor'
import RegistroValidaClient from './registro-client'

/**
 * Alta autogestionada de Valida (`18-recorrido-baja-friccion.md` §2.1, pantallas 2 a 4). Vive en el
 * DOMINIO BASE (`metrikone.co/valida/empezar`), como `/secop`: quien llega aún no tiene espacio.
 *
 * Detrás de una llave: sin `VALIDA_REGISTRO_ABIERTO=1` (y, en producción, sin los textos legales
 * escritos) la página dice que la prueba abre pronto y no muestra el formulario.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Prueba gratis — Valida',
  description: 'Consulta listas vinculantes SARLAFT. Prueba gratis de 10 consultas.',
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function EmpezarValidaPage({ searchParams }: Props) {
  const q = await searchParams
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const utm: Record<string, string> = {}
  for (const k of LLAVES_UTM) {
    const v = uno(q[k])
    if (v) utm[k] = v.slice(0, 100)
  }
  const { consultas, dias } = tamanoPrueba()
  // El correo de la sesión, si ya entró: en producción decide la lista de pruebas del cobro
  // (`VALIDA_COBRO_CORREOS_PRUEBA`). Al entrar con el código, la pantalla pide otra vuelta del servidor.
  const { user } = await getCachedUser()
  const condiciones = condicionesVigentes(process.env, undefined, user?.email ?? null)
  const llavePublica = llavePublicaEpayco()
  // La fecha y la hora junto a la tarjeta: la apertura más 7 días (o los minutos de la prueba acortada
  // de un preview). La exacta se muestra en la cuenta apenas abre la prueba (7.1).
  const minutos = minutosDePruebaAcortada()
  const tarjeta =
    pideMetodoPago(condiciones.conCobro) && llavePublica
      ? { llavePublica, texto: TEXTO_JUNTO_A_TARJETA, duracionMs: minutos !== null ? minutos * 60_000 : dias * 86_400_000 }
      : null
  // Con cobro, la casilla acepta también los Términos de Uso: se muestran enteros en la misma pantalla,
  // con la Orden llena con lo que la persona va escribiendo (Términos, sección B). Lo que se guarda lo
  // arma el servidor al aceptar.
  const terminos = condiciones.terminos
    ? { titulo: condiciones.terminos.titulo, version: condiciones.terminos.version, huella: huellaParteII(), duracionMs: duracionPruebaMs() }
    : null
  return (
    <RegistroValidaClient
      origenUrl={{ ref: uno(q.ref)?.slice(0, 60) ?? null, codigoAfi: uno(q.codigo)?.slice(0, 24) ?? null, utm }}
      abierto={registroAbierto()}
      consultas={consultas}
      dias={dias}
      condiciones={{ version: versionAceptada(condiciones), titulo: condiciones.titulo, texto: condiciones.texto }}
      // El aviso y la casilla de la versión vigente: son los que entran a la huella (fila 15 de Vera).
      avisoDatos={condiciones.aviso.texto}
      textoCasilla={condiciones.casilla}
      conCobro={condiciones.conCobro}
      politica={{ titulo: POLITICA_DATOS_VALIDA.titulo, url: POLITICA_DATOS_VALIDA.url }}
      tarjeta={tarjeta}
      terminos={terminos}
    />
  )
}
