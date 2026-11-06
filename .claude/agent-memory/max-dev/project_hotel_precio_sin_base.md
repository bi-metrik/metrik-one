---
name: hotel-precio-sin-base
description: Hotel con base_precio null se toma como total con aviso (Trappvel, 6-nov); label_aviso para frases de RX2; hash del prompt hotel en reserva-habitaciones.test
metadata:
  type: project
---

Desde #1413 (Haiku lee capturas) toda tarjeta de hotel de Trappvel salía RX2 «No se ve el precio mostrado es»:
Haiku obedecía «null si no lo dice con claridad» en base_precio. Arreglo (rama fix/hotel-precio-sin-base, 6-nov):
red en `evaluarLectura` (solo hotel, no manual, sin tabla por tipo de pax, con precio y moneda) toma `total`,
confianza 0, alerta y aviso; el prompt del hotel dice que precio + estadía + ocupación sin «por persona» = total.

**Why:** el `label` del campo es LLAVE de guardado (ficha-linea, correcciones, estadia leen por label): no se
cambia para arreglar un texto. Para frases se usa `label_aviso` / `etiquetaDeAviso()`.

**How to apply:** cualquier cambio a una `descripcion_ai` mueve el hash `DE_MAIN` de
`reserva-habitaciones.test.ts`; actualizar solo la ranura tocada (las demás deben quedar iguales: es la prueba
de que no se movió nada más). Mutaciones de la red: [[pruebas-por-mutacion]].
