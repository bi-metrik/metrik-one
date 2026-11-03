import { describe, expect, it } from 'vitest'
import { PROMPT_TRANSCRIPCION_LITERAL, textoDeRespuesta } from '../../../transcripcion'
import { PROMPT_NOTA_DE_VOZ } from '../../publico/transcribir'
import { correr, pedidoDe, promptDe, reporte, trabajos } from './corrida'
import { GUIONES, pistasDe, referencia } from './guiones'
import { argsFfmpeg, audioDeRespuesta, entradaManifiesto, nombreSintetico, pedidoTts } from './sintesis'

const g = (id: string) => GUIONES.find((x) => x.id === id)!

describe('la corrida (seca, sin red)', () => {
  it('cada nota con y sin pistas, k veces, por modelo, intercalado', () => {
    const ts = trabajos(GUIONES, ['a', 'b'], 3)
    expect(ts).toHaveLength(20 * 2 * 2 * 3)
    expect(ts.slice(0, 4).map((t) => `${t.guion.id}/${t.modelo}/${t.conPistas}`)).toEqual(['imp-01/a/false', 'imp-01/a/true', 'imp-01/b/false', 'imp-01/b/true'])
    expect(ts.find((t) => t.repeticion === 2)!.conPistas).toBe(true)
  })

  it('arma el pedido de producción según quién habla; sin pistas, el prompt de siempre', () => {
    const imp = pedidoDe({ guion: g('imp-03'), modelo: 'gemini-2.5-flash-lite', conPistas: false, repeticion: 1 }, { mime: 'audio/ogg', base64: 'QQ==' }, 'llave-x')
    const cuerpo = JSON.parse(String(imp.init.body))
    expect(cuerpo.contents[0].parts[0].text).toBe(PROMPT_TRANSCRIPCION_LITERAL)
    expect(cuerpo.generationConfig).toEqual({ temperature: 0.1, maxOutputTokens: 8192 })
    expect(imp.url).not.toContain('llave-x')
    expect((imp.init.headers as Record<string, string>)['x-goog-api-key']).toBe('llave-x')
    const sab = pedidoDe({ guion: g('sab-01'), modelo: 'gemini-3.5-flash-lite', conPistas: true, repeticion: 1 }, { mime: 'audio/ogg', base64: 'QQ==' }, 'k')
    const c2 = JSON.parse(String(sab.init.body))
    expect(c2.contents[0].parts[0].text).toBe(`${PROMPT_NOTA_DE_VOZ}\n\n${pistasDe(g('sab-01'))}`)
    expect(c2.generationConfig).toEqual({ maxOutputTokens: 4096 })
    expect(promptDe({ guion: g('lau-01'), modelo: 'm', conPistas: true, repeticion: 1 })).toContain('Yeimy Castaño')
  })

  it('lee la respuesta con las reglas de producción', () => {
    expect(textoDeRespuesta({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ' hola ' }] } }] })).toEqual({ texto: 'hola' })
    expect(textoDeRespuesta({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'ho' }] } }] })).toHaveProperty('error')
    expect(textoDeRespuesta({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'INAUDIBLE' }] } }] })).toHaveProperty('error')
    expect(textoDeRespuesta({ promptFeedback: { blockReason: 'OTHER' } })).toHaveProperty('error')
  })

  it('mide de punta a punta con transcripciones fijas y arma el reporte', async () => {
    const r = await correr({
      guiones: [g('lau-02'), g('imp-03')], modelos: ['m'], k: 1,
      transcribir: async (t) => {
        if (t.guion.id === 'imp-03' && !t.conPistas) throw new Error('caída')
        if (t.guion.id === 'lau-02') return { texto: t.conPistas ? referencia(t.guion) : 'Marcia vino a lifting de pestañas, 60.000, me pagó 40.' }
        return { texto: 'Registra un anticipo de Inversiones Iguazú para el negocio I1 26 5, son 8.000.000 de pesos, entró por transferencia.' }
      },
    })
    expect(r.intentos).toHaveLength(4)
    expect(r.intentos.find((i) => i.guion === 'imp-03' && !i.conPistas)!.error).toMatch(/EXCEPCION/)
    const [sin, con] = r.agregados
    expect(sin).toMatchObject({ conPistas: false, fallos: 1, nombres: 0.5 })
    expect(con).toMatchObject({ conPistas: true, fallos: 0, nombres: 1, codigos: 1, cifras: 1 })
    const texto = reporte(r, 'prueba')
    expect(texto).toContain('== Todas las notas ==')
    expect(texto).toContain('== laura ==')
    expect(texto).toContain('m · sin · lau-02 · Marcela: 1')
    expect(texto).toContain('m · sin · lau-02 #1: marcia')
    expect(texto).toContain('m: ADOPTAR pistas')
  })
})

describe('las notas sintéticas provisionales', () => {
  it('el TTS de Gemini: llave en la cabecera, la voz del guion y el texto como se dice', () => {
    const { url, init } = pedidoTts(g('imp-03'), { llave: 'llave-tts' })
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('llave-tts')
    const b = JSON.parse(String(init.body))
    expect(b.model).toBe('gemini-3.8-flash-tts')
    expect(b.generation_config.speech_config).toEqual([{ voice: 'Kore' }])
    expect(b.input[0].content[0].text).toContain('i uno veintiséis cinco')
    expect(b.input[0].content[0].annotations[0].style).toMatch(/hablando rápido/)
    expect(String(init.body)).not.toContain('llave-tts')
  })

  it('saca el último audio de la respuesta', () => {
    expect(audioDeRespuesta({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'AAA' }, { type: 'audio', data: 'BBB' }] }] })).toBe('BBB')
    expect(audioDeRespuesta({ steps: [{ type: 'thought', content: [{ type: 'audio', data: 'X' }] }] })).toBeNull()
    expect(audioDeRespuesta({})).toBeNull()
  })

  it('ffmpeg: OGG/Opus mono 48 kHz; rápido, corte y ruido según el guion', () => {
    const corte = argsFfmpeg(g('imp-06'), { voz: 'v.wav', salida: 'o.ogg' }).join(' ')
    expect(corte).toContain('areverse,atrim=start=0.7,areverse,asetpts=N/SR/TB')
    expect(corte).toContain('anoisesrc=color=brown')
    expect(corte).toMatch(/-c:a libopus -b:a 24k -application voip o\.ogg$/)
    expect(corte).toContain('-ac 1 -ar 48000')
    const rapido = argsFfmpeg(g('lau-03'), { voz: 'v.wav', salida: 'o.ogg' }).join(' ')
    expect(rapido).not.toContain('amix')
    expect(rapido).toContain('apad')
    expect(argsFfmpeg(g('imp-03'), { voz: 'v.wav', salida: 'o.ogg' }).join(' ')).toContain('atempo=1.15')
    const grabado = argsFfmpeg(g('imp-02'), { voz: { seco: true }, salida: 'o.ogg', ruidoArchivo: 'calle.ogg' })
    expect(grabado.join(' ')).toContain('-stream_loop -1 -i calle.ogg')
    expect(grabado.join(' ')).toContain('sine=frequency=220')
  })

  it('cada nota queda marcada como sintética en el nombre y en el manifiesto', () => {
    expect(nombreSintetico(g('sab-02'))).toBe('sab-02.sintetico.ogg')
    const m = entradaManifiesto(g('sab-02'), { seco: false, modeloTts: 'gemini-3.8-flash-tts', ruidoGrabado: false, ahora: '2026-10-26T00:00:00Z' })
    expect(m).toMatchObject({ sintetico: true, seco: false, archivo: 'sab-02.sintetico.ogg', modelo_tts: 'gemini-3.8-flash-tts', ruido: null })
  })
})
