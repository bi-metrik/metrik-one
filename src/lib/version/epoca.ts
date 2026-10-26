/**
 * Época de compatibilidad entre la pestaña abierta y el servidor.
 *
 * Un deploy normal NO recarga a nadie: la pestaña sigue en su versión y Skew Protection
 * le sirve sus propios assets, sus navegaciones y sus server actions durante 7 días
 * (Maximum Age medido el 2026-10-02). Recargar por cada deploy costaba caro: 76 deploys
 * en 7 días, ~771 KB de JS por recarga, y el 64 % del tráfico colombiano entra por
 * Telmex/Claro, que pierde 9 de cada 20 descargas a Vercel.
 *
 * Lo que Skew Protection NO cubre es la base de datos: es una sola para todos los
 * deployments. Cuando un PR deja a las pestañas viejas sin poder trabajar (una columna o
 * una función que se borra o se renombra, un contrato que cambia), SUBE este número en el
 * MISMO PR. `/api/version` devuelve la época viva, la pestaña la compara con la que cargó,
 * y si la viva es mayor se recarga (o avisa, si hay trabajo en curso).
 *
 * Solo sube, de a uno. Bajarla no recarga a nadie (una reversión de deploy no debe
 * tumbar pestañas). El check `scripts/check-migracion-epoca.mjs` exige subirla cuando una
 * migración del PR trae DROP, RENAME o ALTER … TYPE, salvo marca `-- epoca: no-rompe`.
 */
export const EPOCA = 1
