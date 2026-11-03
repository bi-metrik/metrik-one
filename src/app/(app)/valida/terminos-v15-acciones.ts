'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { esUuid } from '@/lib/valida-api/reglas'
import { COOKIE_POSPONER_V15 } from '@/lib/valida-cda/terminos-v1-5'

/**
 * «Ahora no, recordármelo» de la pantalla de la v1.5: cierra la pantalla sin aceptar ni bloquear nada.
 * Solo deja una cookie de SESIÓN con la versión y el día (`pospuestaHoy`): la pantalla vuelve en un
 * ingreso posterior o al día siguiente. No escribe en la base ni decide nada: lo peor que puede hacer
 * alguien que la manipule es no ver la pantalla, y el aviso de arriba de `/valida` sigue ahí.
 */
export async function posponerTerminosV15(formData: FormData): Promise<void> {
  const id = String(formData.get('documento_id') ?? '')
  if (esUuid(id)) {
    ;(await cookies()).set(COOKIE_POSPONER_V15, `${id}:${todayBogotaISO()}`, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
  }
  redirect('/valida')
}
