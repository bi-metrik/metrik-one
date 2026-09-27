---
name: cardumen-polaridad-matiz
description: PR #928 (sin mergear, benchmark primero) — guarda de polaridad G22 y matiz de un polo G13 en el lector de diadas de Navigate
metadata:
  type: project
---

PR #928 (`fix/cardumen-lector-g22-g13`, commit ed48c2dc) NO se mergea hasta correr el benchmark golden v1.

- G22: 3.5-flash-lite ubicaba "nada nuevo" en el polo "completamente nuevo". La causa fue el cambio del prompt de la diada (7648048); el filtro dio R en las dos corridas. `niegaPolo` descarta la lectura si se niega el polo elegido.
- G13: `matizDeUnPolo` ("A pero con B" sin fuerza en el matiz) impide `both_intense` en `medioQueEsAmbas` y `evidenciaEspecial`; devuelve `claro:false` con el lado principal.

- Benchmark v3: la línea de negación que se había sumado al prompt de la díada hacía que 3.5 ubicara G10 en ancla 1 (4 de 5); se quitó en 190de9e1. La polaridad la cuidan las guardas en código, y un test exige que esa línea NO esté en el prompt.

**Why:** ubicar al revés es peor que no ubicar (el brief de Mik). Una instrucción extra en el prompt de un modelo lite mueve casos que no tienen nada que ver; una guarda determinista no.
**How to apply:** para saber si una falla viene del prompt o del filtro, comparar el texto CRUDO del lector entre `resultados-vN.json` (campo `llamadas[].text`, rol `lector`), no solo la salida final. Relacionado: [[cardumen-filtro-blindaje]].
