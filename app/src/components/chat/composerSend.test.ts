// O GATE DO ENVIO, caso a caso.
//
// A guarda principal aqui não é "envia quando pode", é **o que NÃO sai**: um
// composer que despacha o que não devia, na faixa que decide se o agente
// executa comando na sua máquina, é o pior defeito possível desta tela. E a
// segunda guarda é a simetria: enviar e enfileirar passam pelo MESMO gate, com
// as MESMAS exigências de conteúdo — foi ramo gêmeo divergindo que deixou anexo
// pra trás uma vez.
import { describe, expect, it } from "vitest"
import {
  despachoDoEnter,
  podeEnviar,
  type EstadoDoComposer,
} from "./composerSend"

/** Composer em repouso, com uma linha digitada. */
function composer(over: Partial<EstadoDoComposer> = {}): EstadoDoComposer {
  return {
    texto: "roda os testes e me mostra o resultado",
    anexos: 0,
    anexosSuportados: true,
    disabled: false,
    running: false,
    finalizing: false,
    missionRunning: false,
    ...over,
  }
}

describe("o vazio não sai", () => {
  it("sem texto e sem anexo, barrado", () => {
    expect(despachoDoEnter(composer({ texto: "" }))).toBe("barrado")
  })

  it("sem texto e sem anexo, barrado TAMBÉM com turno em andamento", () => {
    // A fila não existe pra guardar mensagem vazia: Enter num composer limpo
    // durante um turno não pode empilhar nada.
    expect(
      despachoDoEnter(composer({ texto: "", running: true })),
    ).toBe("barrado")
  })

  it("só anexo, sem texto, ENVIA (a imagem é a mensagem)", () => {
    expect(despachoDoEnter(composer({ texto: "", anexos: 1 }))).toBe("enviar")
  })

  it("só anexo, sem texto, ENFILEIRA com turno em andamento", () => {
    expect(
      despachoDoEnter(composer({ texto: "", anexos: 1, running: true })),
    ).toBe("enfileirar")
  })
})

describe("anexo que o motor não lê barra a mensagem INTEIRA", () => {
  it("em repouso, barrado", () => {
    // Enviar "a metade que dá" faria o usuário achar que o agente viu a imagem.
    expect(
      despachoDoEnter(composer({ anexos: 1, anexosSuportados: false })),
    ).toBe("barrado")
  })

  it("com turno em andamento, também barrado (a fila não é atalho)", () => {
    expect(
      despachoDoEnter(
        composer({ anexos: 1, anexosSuportados: false, running: true }),
      ),
    ).toBe("barrado")
  })
})

describe("turno em andamento enfileira, não envia", () => {
  it("running: enfileirar", () => {
    expect(despachoDoEnter(composer({ running: true }))).toBe("enfileirar")
  })

  it("finalizing (o CLI ainda fecha a conta): enfileirar", () => {
    expect(despachoDoEnter(composer({ finalizing: true }))).toBe("enfileirar")
  })

  it("com texto E anexo, enfileira os dois pelo mesmo gate", () => {
    expect(
      despachoDoEnter(composer({ anexos: 2, running: true })),
    ).toBe("enfileirar")
  })
})

describe("o que trava o composer trava a fila junto", () => {
  it("disabled barra em repouso", () => {
    expect(despachoDoEnter(composer({ disabled: true }))).toBe("barrado")
  })

  it("disabled barra também com turno em andamento", () => {
    expect(
      despachoDoEnter(composer({ disabled: true, running: true })),
    ).toBe("barrado")
  })

  it("missão em andamento barra o envio manual", () => {
    // M2: as fases compartilham o worktree; um envio manual em paralelo
    // embolaria o diff e o handoff.
    expect(despachoDoEnter(composer({ missionRunning: true }))).toBe("barrado")
  })

  it("missão em andamento barra ATÉ a fila, com turno linear em voo", () => {
    // O caso que o composer errava: o placeholder já dizia "pare a missão para
    // enviar manualmente" e o Enter empilhava assim mesmo. No fim do turno a
    // drenagem esvazia a fila e o despacho recusa por causa da missão — as
    // mensagens somem sem voltar pra fila e sem aviso. Fila que o despacho vai
    // recusar é pior que Enter que não faz nada: ela promete um envio.
    expect(
      despachoDoEnter(composer({ missionRunning: true, running: true })),
    ).toBe("barrado")
    expect(
      despachoDoEnter(composer({ missionRunning: true, finalizing: true })),
    ).toBe("barrado")
  })
})

describe("o botão primário só acende no que de fato ENVIA", () => {
  it("acende com conteúdo em repouso", () => {
    expect(podeEnviar(composer())).toBe(true)
  })

  it("não acende com turno em andamento (ali o botão já é Parar)", () => {
    expect(podeEnviar(composer({ running: true }))).toBe(false)
  })

  it("não acende com o composer vazio", () => {
    expect(podeEnviar(composer({ texto: "" }))).toBe(false)
  })

  it("não acende com missão em andamento", () => {
    expect(podeEnviar(composer({ missionRunning: true }))).toBe(false)
  })
})

describe("nenhuma combinação inventa um quarto desfecho", () => {
  it("as 128 combinações de flags caem nos três desfechos conhecidos", () => {
    // Varredura exaustiva das 7 entradas booleanas (texto vazio ou não conta
    // como uma delas): o gate é a última coisa antes de um processo nascer na
    // sua máquina, então "provavelmente cobre" não serve.
    const desfechos = new Set<string>()
    for (let mascara = 0; mascara < 128; mascara++) {
      const bit = (i: number) => (mascara >> i) % 2 === 1
      const e = composer({
        texto: bit(0) ? "oi" : "",
        anexos: bit(1) ? 1 : 0,
        anexosSuportados: bit(2),
        disabled: bit(3),
        running: bit(4),
        finalizing: bit(5),
        missionRunning: bit(6),
      })
      const d = despachoDoEnter(e)
      desfechos.add(d)
      // Invariante que vale em TODA combinação: sem conteúdo, nada sai.
      if (e.texto === "" && e.anexos === 0) expect(d).toBe("barrado")
      // E: o que envia jamais tem missão ou turno em voo por trás.
      if (d === "enviar") {
        expect(e.missionRunning).toBe(false)
        expect(e.running || e.finalizing).toBe(false)
        expect(e.disabled).toBe(false)
        expect(e.anexosSuportados).toBe(true)
      }
      // E nada entra na fila sob missão: a drenagem no fim do turno seria
      // recusada pelo despacho e o conteúdo se perderia no caminho.
      if (d === "enfileirar") expect(e.missionRunning).toBe(false)
    }
    expect([...desfechos].sort()).toEqual(["barrado", "enfileirar", "enviar"])
  })
})
