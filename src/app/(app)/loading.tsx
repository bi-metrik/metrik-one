import { EsperaDeRuta } from '@/components/red/aviso-conexion'

/**
 * Estado de carga de las vistas de `(app)`: mientras la pagina trae sus datos, el hueco
 * lo ocupa la marca en su version liviana, dentro del shell (menu y barra ya pintados).
 *
 * No tapa nada que este listo: Next lo reemplaza en cuanto llega la pagina. Y no
 * parpadea en las navegaciones rapidas: la animacion aparece pasados 300 ms (CSS, sin
 * JavaScript). Un cambio de filtro por la URL dentro de la misma vista no lo vuelve a
 * mostrar: el limite de carga se monta por segmento, no por parametros de busqueda.
 *
 * Con tope (2026-10-06, Deisy en `/negocios/[id]`): si a los 45 s (antes 25; a los 8 s avisa que la conexion esta lenta) la pagina no llego (el
 * stream se corto o se quedo colgado), la animacion cede al aviso "No pudimos conectar con
 * ONE" con Reintentar. Lo hace CSS: funciona aunque este fallback nunca hidrate.
 */
export default function Loading() {
  return <EsperaDeRuta className="min-h-[60vh]" />
}
