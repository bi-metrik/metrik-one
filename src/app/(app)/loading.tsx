import AnimacionMarca from '@/components/marca/animacion-marca'

/**
 * Estado de carga de las vistas de `(app)`: mientras la pagina trae sus datos, el hueco
 * lo ocupa la marca en su version liviana, dentro del shell (menu y barra ya pintados).
 *
 * No tapa nada que este listo: Next lo reemplaza en cuanto llega la pagina. Y no
 * parpadea en las navegaciones rapidas: la animacion aparece pasados 300 ms (CSS, sin
 * JavaScript). Un cambio de filtro por la URL dentro de la misma vista no lo vuelve a
 * mostrar: el limite de carga se monta por segmento, no por parametros de busqueda.
 */
export default function Loading() {
  return (
    <AnimacionMarca
      variante="liviana"
      tamano="clamp(1.6rem, 4vw, 2.2rem)"
      className="min-h-[60vh]"
    />
  )
}
