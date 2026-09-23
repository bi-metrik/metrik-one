---
name: soena-parse-monto-cop
description: "#842 (2026-09-23): siete lectores de montos de SOENA pasan por parseMontoCop; el regex viejo daba NaN con varios puntos de miles, así que una factura de carro quedaba «sin valor» en silencio"
metadata:
  type: project
---

PR [#842](https://github.com/bi-metrik/metrik-one/pull/842). Sin migración. Continuación de
[[captura-cotizacion-parte-a]] (#839), donde nació `parseMontoCop`.

**El daño real no era 350,906: era NaN.** `Number(v.replace(/[^\d.-]/g, ''))` con un solo
punto da un decimal (350,906), pero con dos o más (`$ 98.500.000`, que es el valor de un carro)
da **NaN**, y todos los llamadores trataban NaN como «la Factura aún no tiene valor». En
`getNegocioDetalle` eso significa que la tarifa UPME de referencia **nunca se inicializa**, y
nada avisa. Lo que decide si hubo daño es cuántos `valor_unitario_sin_iva` en producción traen
punto; el extractor (`extract-fields.ts`) normaliza a entero, así que el riesgo real son las
ediciones a mano y los datos migrados.

**Why:** se cambiaron solo los lectores de SOENA; los genéricos quedaron listados en el PR.

**How to apply:**
- Todo monto leído de texto pasa por `parseMontoCop`; el valor sin IVA de la Factura, por
  `valorSinIvaDeFactura` (`src/lib/upme/valor-factura.ts`).
- ✅ Cerrado en #843 (2026-09-23): el extractor (`src/lib/ai/monto-extraido.ts`) manda a
  `parseMontoCop` SOLO la forma exacta de miles con coma; todo lo demás sigue la regla vieja
  copiada tal cual, para no mover ninguna lectura que ya estuviera bien. `350,906` = miles.
  Los valores ya guardados NO se corrigieron: un mal leído se ve como monto diminuto
  (`::numeric < 1000`) en `negocio_bloques.data->'campos'-><slug>->>'value'`.
- ⚠️ `parseMontoCop('$ -5.000')` da **+5000**: solo cuenta el signo si el texto empieza por
  `-` o va entre paréntesis. No se tocó porque lo comparte Trappvel (un «Descuento -$50.000»
  leído de un pantallazo saldría positivo).
- En esta sesión el clasificador bloqueó la lectura de producción (PostgREST por `.env.local`,
  categoría «Production Reads»). La R6 quedó argumentada por código y por equivalencia de
  entradas, no medida.
