/**
 * Una persona, un contacto: el guardián de duplicados del directorio.
 *
 * ONE tenía cuatro puertas para crear un contacto y solo una (el webhook de Meta)
 * comprobaba si esa persona ya estaba. Medido el 2026-09-02 en un solo workspace:
 * 46 números de celular repetidos en contactos distintos, con negocios colgando
 * de unos y no de otros.
 *
 * ⚠️ **La regla vive en SQL, no aquí.** `buscar_contacto_duplicado` (migración
 * `20260902000007`) es la única respuesta, y este módulo solo la consulta. Está
 * así por dos razones que se pagaron caro en producción: el teléfono se guarda
 * con formatos distintos (con y sin indicativo) y comparar texto deja pasar el
 * duplicado; y traer todos los contactos para comparar en memoria choca contra
 * el techo de 1.000 filas de PostgREST, que este workspace ya superó.
 *
 * Reimplementar la comparación en TypeScript crearía una segunda verdad que se
 * desincroniza en el primer cambio. Si hace falta en un sitio nuevo, se llama a
 * la función; no se copia.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ContactoDuplicado {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  /** Por cuál de los dos datos chocó. Decide qué campo marca el formulario. */
  motivo: 'telefono' | 'email'
}

/**
 * ¿Este teléfono o este correo ya son de otro contacto del workspace?
 *
 * `excluirId` deja editar un contacto sin que choque contra sí mismo.
 *
 * Un contacto sin teléfono ni correo nunca choca: no hay con qué compararlo.
 * Exigir uno de los dos para poder registrar a alguien es otra decisión y no
 * la toma este módulo.
 */
export async function buscarContactoDuplicado(
  // El cliente de Supabase llega tipado desde varios sitios con genéricos
  // distintos; lo que importa aquí es que sepa hacer `rpc`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  workspaceId: string,
  datos: { telefono?: string | null; email?: string | null },
  excluirId?: string | null,
): Promise<ContactoDuplicado | null> {
  const telefono = datos.telefono?.trim() || null
  const email = datos.email?.trim() || null
  if (!telefono && !email) return null

  const { data, error } = await supabase.rpc('buscar_contacto_duplicado', {
    p_workspace_id: workspaceId,
    p_telefono: telefono,
    p_email: email,
    p_excluir_id: excluirId ?? null,
  })

  // ⚠️ Un error aquí NO puede devolver "no hay duplicado": eso convertiría un
  // fallo de la consulta en permiso para crear el duplicado, en silencio, que es
  // exactamente el modo de falla que este módulo existe para cerrar. Se propaga.
  if (error) throw new Error(`No se pudo comprobar duplicados: ${error.message}`)

  const filas = (data ?? []) as ContactoDuplicado[]
  return filas[0] ?? null
}

/** Mensaje que ve quien intenta crear el duplicado. Uno solo para las cuatro puertas. */
export function mensajeDuplicado(d: ContactoDuplicado): string {
  const dato = d.motivo === 'telefono' ? 'Ese teléfono' : 'Ese correo'
  return `${dato} ya es de ${d.nombre}. Abre ese contacto en vez de crear uno nuevo.`
}
