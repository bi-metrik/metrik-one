# Eval de Claude Haiku 5.5 con casos reales

Mide el cambio de Gemini a `claude-haiku-5-5` (Mauricio, 2026-10-20) con la función real de cada sitio: mismo prompt,
mismo esquema y mismo manejo de errores, con el modelo puesto por `fetchModelo`
(`supabase/functions/_shared/llm-anthropic.ts`). El oráculo es lo que quedó guardado en producción. No llama a
Gemini y no escribe en la base: `entorno.ts` lo bloquea.

## 1. Casos (solo SELECT)

Correr cada bloque de `consultas.sql` por el MCP de Supabase y guardar cada resultado como arreglo JSON en
`casos/<familia>.json`. La carpeta `casos/` está en `.gitignore`: trae datos de clientes y no se commitea.

## 2. Llave

`ANTHROPIC_API_KEY=<llave>` en `.env.local` del worktree (gitignored). Para `documento`, `rut` y `acta` hacen falta
además `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y las credenciales de Drive de la app, solo para leer
archivos: el arnés también lee el `.env.local` del repo principal.

## 3. Correr

```bash
# Prueba en seco: modelo simulado, casos de demostración, sin llave ni gasto
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts --mock --demo

# De verdad: todos los casos de casos/*.json
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts

# Una familia, con tope de casos
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts --familia gastos,intencion_wa --limite 20
```

`--conditions=react-server` hace que `import 'server-only'` resuelva al módulo vacío fuera de Next.

Sale una tabla por familia (casos, aciertos por campo, aciertos en campos corregidos por una persona, JSON válido,
errores, latencia p50/p95 y costo con USD 0,10 / 0,50 por MTok) y la lista de fallos. El detalle con los valores
queda en `resultados/` (gitignored).

## Bot conversacional

El núcleo con herramientas tiene su arnés propio (Deno), que ya pasa por `fetchModelo`:

```bash
LLM_PROVEEDOR=anthropic ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none \
  supabase/functions/_shared/agente/arnes/correr.ts --salida /tmp/arnes-haiku --conjunto todo
```

Ojo: ese arnés calcula el gasto con los precios de Gemini de su tabla `PRECIOS_312`; para Haiku hay que recalcular
con los tokens que reporta.

## Familias sin casos de la base

- `decidir-destino`: la decisión del modelo no se guarda.
- capturas (`detectar-tipo-captura`, `extraer-ranura`): la imagen llega como data URL y no se guarda.
