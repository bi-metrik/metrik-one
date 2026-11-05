---
name: project-soe041-descuento-factura
description: SOE-041 factura del vehículo SOENA — derivar.resta y coherencia_pct (IVA) en derivar.ts; SQL de config SIN aplicar, va después del deploy
metadata:
  type: project
---

SOE-041 (5-nov): `valor_unitario_sin_iva` de la Factura Venta Vehículo (bloque_configs f2227f75…) lo calcula el código: `derivar.resta [valor_antes_descuento, descuento]`; `valor_iva.coherencia_pct` alerta. Lógica en `src/lib/documentos/derivar.ts`; helpers de confianza en `confianza.ts` (la pantalla importa derivar.ts, normalizaciones.ts arrastra DIVIPOLA).

**Why:** el prompt solo (desde 3-sep) no garantizaba la resta (V0552 falló con prompt nuevo). Patrón «el modelo lee, el código hace la aritmética».

**How to apply:**
- `sql/soena/2026-11-05_soe041-factura-descuento.sql` SIN aplicar; dry-run por defecto (`v_aplicar`); correr DESPUÉS del deploy. Probado en PGlite con la config viva (16 → 18).
- Decisión propia fuera del brief: con descuento 0, si `valor_antes_descuento` ≠ valor leído, el valor baja a Verificar. Sin eso V0650 (IVA cuadra con la lista correcta) pasaba limpio porque coherencia acepta cualquier base.
- `valor_iva` es el IVA TOTAL (incluye 19 % de accesorios): esas facturas saldrán en Verificar por coherencia. Falso positivo aceptado (solo alerta).
- Documentos ya leídos no cambian; reprocesar borra correcciones a mano.
