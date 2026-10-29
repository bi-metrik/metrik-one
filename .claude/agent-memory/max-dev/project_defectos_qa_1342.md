---
name: defectos-qa-1342
description: Trappvel 2026-10-29, defectos de la prueba real en navegador del #1342 (bloqueo con Pública) — costo de agencia, «Opción N», «Incluye» de ONE sin revisar, swap seguro de la Recomendada; sin migración
metadata:
  type: project
---

Rama fix/defectos-qa-1342 (un PR, sin migración). Lo no obvio:

- **Costo en pantalla = `costoDeAgencia(cascada)`** (`itinerarios.ts`): costo de venta − comisión de las
  Públicas; `null` con una Pública sin comisión. `cascada.costoDeVenta` SIGUE siendo el precio público
  (lo usan el PDF y el margen): no cambiarlo, solo lo que se pinta junto a «ganas».
- En paralelo #1354 metió `calculoEnPantalla` (calculo-en-pantalla.ts) para «Ver el cálculo» y el resumen del
  editor de 4 pasos: misma idea (costo − comisión). Dos funciones hermanas; si se unifican, `costoDeAgencia`
  devuelve `null` sin comisión y `calculoEnPantalla.costoDeVenta` no.
- `margenDelEncabezado` devuelve `null` con una Pública sin comisión (antes caía a `margenRealPct` = 0 %);
  `LoQueSuma` recibe `sinComision` para decir «falta la comisión».
- **Nombres**: `nombresVisiblesDeTarifas` (tarifas.ts) numera como `bloquesParaPDF`: principal primero,
  luego las que van por orden, luego las que no van. `tarifasCalculadas` pone el visible en `nombre` y el
  guardado en `nombreGuardado`.
- **«Incluye» del PDF**: sin texto revisado el PDF caía a la lista plana (1 versión: solo el nombre del
  paquete; 2+: sin sección). Ahora `textoParaElViaje(..., { incluyeSinRevisar })` y la opción
  `generateCotizacionPDF({ incluyePorOne })` (la pasan editor y ruta vista-previa con la pieza; N4).
- **Swap de la Recomendada** (`paqueteEnPropuesta`): insert primero, deletes después, compensación si
  falla. La atomicidad real pediría una RPC (no hecha). El doble acepta `base.fallar` para inyectar fallas.
- Aviso del PDF de borrador: toast con id `pdf-borrador:<cot>`, se descarta cuando cambia
  `huellaDelAvisoDelPdf`.
- Worktree: el node_modules del repo principal está viejo (sin happy-dom, ai, unpdf, puppeteer). Para
  las pruebas DOM armé node_modules como carpeta de symlinks + happy-dom instalado en el scratchpad.

**How to apply:** si otra vista pinta costo/ganancia o un nombre de tarifa, usar estas dos funciones; no
volver a `t.nombre ?? 'Tarifa'`. Relacionado: [[decisiones-1029-cotizacion]], [[bloqueo-trappvel]].
