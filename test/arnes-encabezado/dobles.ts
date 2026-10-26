/**
 * Dobles del arnés del encabezado (`scripts/encabezado-pastilla.e2e.mjs`). Vite los pone en lugar
 * de `next/navigation`, `sonner` y el registro de actividad; las server actions las reemplaza un
 * plugin del mismo arnés. Nada de esto sale del navegador.
 */
export const useRouter = () => ({ push: () => {}, refresh: () => {}, back: () => {}, replace: () => {}, prefetch: () => {} })
export const useParams = () => ({ id: 'neg-arnes' })
export const usePathname = () => '/negocios/neg-arnes/cotizacion/cot-arnes'
export const useSearchParams = () => new URLSearchParams()
export const redirect = () => {}
export const notFound = () => {}
const nada = () => {}
export const toast = Object.assign(nada, { success: nada, error: nada, warning: nada, info: nada, loading: nada, dismiss: nada })
export const Toaster = () => null
export default function ActividadDoble() { return null }
