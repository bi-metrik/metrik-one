# Entradas pendientes del PR #1041 (bandeja de Trappvel, caso Alejandra)

Estas entradas se sacaron de los archivos compartidos para que el PR #1041 no choque con cada merge a `main`.
Van al PR de documentación después del merge de #1041; al llevarlas, borrar este archivo.

## `docs/bitacora/2026-10.md` (antes de «2026-10-05 — Emisión de factura: la marca primero»)

```markdown
## 2026-10-05 — Trappvel: la bandeja reintenta, explica y registra lo que no llegó (fix/trappvel-bandeja-retroceso-alejandra)

Sin migración. Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-bandeja-retroceso-alejandra.md`,
caso Alejandra en N1 26 1 (COT-2026-0023, 6A + 1N + 1I, dos vuelos, hoteles por habitación).

- **Causa medida:** las cuatro peticiones que fallaron (detectar y «Aceptar» de Cabañas Agua Dulce, leer
  de los dos pegados juntos) NUNCA llegaron a Vercel: `vercel metrics vercel.request.count` (cuenta del
  borde, antes del firewall y de la función) da 4 detectar, 3 leer y 2 aceptar, todos 200, y el firewall
  dejó pasar todo. El tercer «aceptar 200» que se contó en el brief era de OTRA cotización del mismo
  negocio (cde0a67e, 16:35:43). Con las lecturas reales de Gemini el servidor acepta los 8, Cabañas
  2A + 1N incluida. El texto de la fila salió del `fetch` que lanzó: sin reintento ni registro desde #907.
- `bandeja-red.ts`: 3 intentos (1,5 s y 4 s) cuando no hubo respuesta legible; agotado, `ErrorDeEnvio`
  (`RED`, `RESPUESTA`, `PESADA`) y la fila dice qué pasó y qué hacer, con «Reintentar» sin volver a pegar.
- «Aceptar» idempotente por `idAceptacion` (`aceptacion-idempotente.ts`): la lectura escrita guarda la
  llave y un reintento que sí había llegado devuelve lo que ya quedó.
- Toda salida `ok:false` de las cuatro rutas sale con mensaje y deja `[bandeja]` en el log
  (`bandeja-registro.ts`); una excepción sale como `ok:false` `ERROR`. Lo que no llega lo cuenta el
  navegador por `/api/errores-cliente` con `origen: 'bandeja'` (ruta, código, cotización, bytes, intentos).
- Prueba fija `caso-alejandra-e2e.test.ts` con las lecturas grabadas; contra Gemini real con
  `CASO_ALEJANDRA=gemini` (y `GRABAR=1` para regrabar).
```

## `docs/gotchas.md` (antes de «Una página SIN `maxDuration` corre con el tope del proyecto»)

```markdown
- **Una petición que no llegó a Vercel no deja rastro en ningún log de Vercel.** `vercel logs` y
  `function_invocation` solo ven lo que entró; para saber si un `fetch` del navegador llegó, contar en
  `vercel metrics vercel.request.count` (el borde, antes del firewall) filtrando por `request_path`, y
  `vercel.firewall_action.count` para descartar un bloqueo. El caso Alejandra (2026-10-05) se cerró así:
  sus 4 envíos fallidos no estaban ni como error. Lo que el navegador no logró mandar lo cuenta él
  después por `/api/errores-cliente` (`origen: 'bandeja'` en la bandeja de Trappvel).
```

## `.claude/agent-memory/max-dev/MEMORY.md` (reemplaza la línea de «Cotización Trappvel (30 frentes)»)

```markdown
- ⚠️⚠️ [Cotización Trappvel (31 frentes)](indice_cotizacion_trappvel.md) — ranuras, tarifas, pasajeros, PDF, captura A/B; bandeja caso Alejandra
```

## `.claude/agent-memory/max-dev/indice_cotizacion_trappvel.md` (al final de la lista)

```markdown
- ⚠️ [Retroceso de la bandeja: caso Alejandra (2026-10-05)](project_bandeja_retroceso_alejandra.md) — envíos que NUNCA llegaron a Vercel; reintento + idempotencia + registro; prueba fija con Gemini grabado
```
