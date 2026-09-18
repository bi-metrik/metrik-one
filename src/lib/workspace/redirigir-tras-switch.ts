/**
 * A donde va el navegador despues de que `switchWorkspace` movio
 * `profiles.workspace_id`.
 *
 * Las cookies de ONE son host-only (auth-js rechaza el dominio cross-subdominio), asi que
 * saltar al subdominio destino exige sembrar sesion alli: eso es lo que hace el enlace
 * magico que devuelve la server action. Sin el, el destino pediria login otra vez.
 *
 * Vive aca y no dentro de `platform-admin-bar.tsx` porque la pantalla de pestaña
 * desincronizada necesita EXACTAMENTE el mismo camino: dos copias de esta regla se
 * desincronizan, y el sintoma seria un boton que deja al usuario en el login.
 */
export function redirectAfterSwitch(targetSlug: string, actionLink: string | null | undefined) {
  if (typeof window === 'undefined') return
  if (actionLink) {
    window.location.href = actionLink
    return
  }
  // Fallback (dev local sin subdomain routing real, o si generateLink falla)
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co'
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.localhost')
  ) {
    window.location.reload()
    return
  }
  const protocol = window.location.protocol
  window.location.href = `${protocol}//${targetSlug}.${baseDomain}/`
}
