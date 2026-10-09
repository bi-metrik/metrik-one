import type { Metadata } from 'next'
import { registroAbierto, tamanoPrueba } from '@/lib/valida-registro/llave'
import { AVISO_DATOS_FORMULARIO, CONDICIONES_PRUEBA } from '@/lib/valida-registro/condiciones'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { LLAVES_UTM } from '@/lib/valida-registro/datos'
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
  description: 'Consulta listas vinculantes SARLAFT. Prueba gratis sin tarjeta.',
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
  return (
    <RegistroValidaClient
      origenUrl={{ ref: uno(q.ref)?.slice(0, 60) ?? null, codigoAfi: uno(q.codigo)?.slice(0, 24) ?? null, utm }}
      abierto={registroAbierto()}
      consultas={consultas}
      dias={dias}
      condiciones={{ version: CONDICIONES_PRUEBA.version, titulo: CONDICIONES_PRUEBA.titulo, texto: CONDICIONES_PRUEBA.texto }}
      avisoDatos={AVISO_DATOS_FORMULARIO}
      politica={{ titulo: POLITICA_DATOS_VALIDA.titulo, url: POLITICA_DATOS_VALIDA.url }}
    />
  )
}
