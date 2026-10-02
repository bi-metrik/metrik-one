// Lo que comparten la prueba del banco (`wa-interprete-banco.test.ts`, modelo falso, en el CI) y la
// corrida de QA con Gemini real (fuera del CI): la decisión del validador en la forma del `esperado`
// de la simulación, y cuándo cumple. Solo para pruebas: no se despliega con ninguna función.
import { norm, type Decision } from '../wa-interprete-reglas.ts';

/** La decisión en la forma del `esperado` de la simulación (la del prototipo). */
export function resumir(d: Decision): Record<string, unknown> {
  if (d.tipo === 'fallback') return { accion: 'fallback' };
  const p = d.paso;
  switch (p.p) {
    case 'registrar': {
      const i = p.interpretacion;
      if (i.accion === 'abrir_viaje' && i.viaje_id) return { accion: 'abrir_viaje', viaje: i.viaje_id, ...(i.con_contenido ? { con_contenido: true } : {}) };
      if (i.accion === 'abrir_viaje' && i.nuevo) return { accion: 'abrir_viaje', nuevo: norm(i.nuevo), ...(i.con_contenido ? { con_contenido: true } : {}) };
      if (i.accion === 'abrir_viaje') return { accion: 'pedir_nombre' };
      if (i.accion === 'nombre') return { accion: 'abrir_viaje', nuevo: norm(i.nuevo) };
      if (i.accion === 'preguntar_viaje') return { accion: 'preguntar_viaje', candidatos: i.candidatos };
      if (i.accion === 'contenido' && i.varios) return { accion: 'contenido_varios', viajes: i.varios };
      return { accion: 'contenido' };
    }
    case 'responder_bandeja': {
      const i = p.interpretacion;
      if (i.accion === 'confirmar') return { accion: 'confirmar' };
      if (i.accion === 'mover') return { accion: 'mover', n: Number(/el (\d+)/.exec(p.canonico)?.[1]), viaje: i.viaje_id };
      if (i.accion === 'descartar') return { accion: 'responder', opcion: 'descartar' };
      if (i.nuevo) return { accion: 'responder', opcion: 'nuevo', nuevo: norm(i.nuevo) };
      return { accion: 'responder', opcion: i.viaje_id };
    }
    case 'nota_interna': return { accion: 'nota_interna' };
    case 'cerrar_tanda': return { accion: 'cerrar_tanda' };
    case 'descartar': return { accion: 'descartar', alcance: p.alcance };
    case 'bot_gastos': return { accion: 'gasto', gastos: p.gastos.map(g => ({ monto: g.monto, negocio: g.negocio === 'empresa' ? 'empresa' : g.negocio?.id ?? null, desc: g.descripcion ? norm(g.descripcion) : null })) };
    case 'bot_corregir': {
      const c = p.cambios[0];
      return { accion: 'corregir_gasto', campo: c.campo, valor: c.campo === 'negocio' ? (c.valor === 'empresa' ? 'empresa' : c.valor?.id) : c.campo === 'descripcion' ? norm(c.valor) : c.valor };
    }
    case 'bot_boton': return { accion: p.boton === 'btn_confirm' ? 'confirmar' : p.boton === 'btn_cancel' ? 'cancelar' : 'responder', ...(p.boton === 'btn_sin_soporte' ? { opcion: 'no_tengo' } : {}) };
    case 'bot_texto': return { accion: 'responder', valor: Number(p.texto.replace(/\D/g, '')) * (/mil/.test(p.texto) ? 1000 : 1) };
    case 'bot_consulta': return { accion: 'consulta' };
    case 'bot_ayuda': return { accion: 'saludo' };
    case 'nada': return { accion: 'acuse' };
    case 'decir': return { accion: d.accion === 'fuera_de_alcance' ? 'fuera_de_alcance' : d.accion };
    default: return { accion: p.p };
  }
}

/** Lo que el `esperado` exige: sus claves, con `gastos` comparados solo en lo que el banco fija. */
export function cumple(r: Record<string, unknown>, e: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(e)) {
    if (k === 'gastos') {
      const gs = r.gastos as Array<Record<string, unknown>> | undefined;
      const es = v as Array<Record<string, unknown>>;
      if (!gs || gs.length !== es.length) return false;
      if (!es.every((g, i) => Object.entries(g).every(([kk, vv]) => (kk === 'desc' ? String(gs[i].desc ?? '').includes(String(vv)) : gs[i][kk] === vv)))) return false;
      continue;
    }
    if (k === 'nuevo') { if (norm(r.nuevo) !== norm(v)) return false; continue; }
    if (k === 'valor' && typeof v === 'string') { if (norm(r.valor) !== norm(v)) return false; continue; }
    if (JSON.stringify(r[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

