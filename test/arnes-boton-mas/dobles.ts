/**
 * Dobles del arnés del «+» (`scripts/boton-mas-barra.e2e.mjs`). Vite los pone en lugar de
 * `next/navigation`, `next/dynamic` y `sonner`; las server actions las reemplaza un plugin del
 * mismo arnés. Nada de esto sale del navegador.
 */
export const useRouter = () => ({ push: () => {}, refresh: () => {}, back: () => {}, replace: () => {}, prefetch: () => {} })
export const usePathname = () => '/negocios/00000000-0000-4000-8000-000000000001/cotizacion/c'
export const useParams = () => ({})
export const useSearchParams = () => new URLSearchParams()
const nada = () => {}
export const toast = Object.assign(nada, { success: nada, error: nada, warning: nada, info: nada, loading: nada, dismiss: nada })
export default function dinamico() { return () => null }
