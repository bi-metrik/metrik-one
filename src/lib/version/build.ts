import 'server-only'

/**
 * Identidad del build que esta sirviendo esta peticion.
 *
 * En Vercel es el id del deployment (`VERCEL_DEPLOYMENT_ID`), que cambia con
 * cada push a `main`. Fuera de Vercel (dev, tests) no existe y se devuelve
 * `'dev'`, un valor estable: sin el, cada render inventaria una version nueva y
 * el vigilante recargaria en bucle.
 *
 * Es el MISMO valor que `next.config.ts` pasa como `deploymentId`, asi que la
 * version que el vigilante compara y la que Vercel usa para servir los assets
 * son una sola cosa y no pueden desincronizarse.
 */
export function versionDelBuild(): string {
  return process.env.VERCEL_DEPLOYMENT_ID ?? 'dev'
}
