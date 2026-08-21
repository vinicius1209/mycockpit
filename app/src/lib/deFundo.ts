// A promessa que a PRODUÇÃO não espera — e que o TESTE precisa poder esperar.
//
// Nasceu de um CI vermelho intermitente: `EnvironmentTeardownError: Cannot load
// react ... after the environment was torn down`. Mesmo erro em duas runs, com
// runs verdes no meio e a suíte passando 3019/3019 no Mac. Não era o runner
// lento — era um `void import("@/lib/planGate").then(...)` disparado dentro de
// uma ação síncrona do store. Ninguém segurava a promessa: o teste acabava, o
// vitest derrubava o ambiente, e a promessa acordava depois tentando carregar
// um módulo que já não existia. No Mac o grafo já estava quente e ela ganhava a
// corrida; no runner, às vezes, não.
//
// O import dinâmico está CERTO onde está — é o que quebra ciclo de módulo
// (`store/chat → lib/planGate → store/interactions → store/chat`, o mesmo ciclo
// que já custou um "window is not defined" na suíte de missão). O errado era o
// `void` puro: trabalho que ninguém consegue observar não é assíncrono, é
// invisível. Aqui ele passa a ser CONTÁVEL sem deixar de ser não-bloqueante.
//
// Não é utilitário de teste com nome bonito: em produção o custo é um `Set.add`
// e um `Set.delete`, e a semântica ("não trave o turno por causa disto") fica
// idêntica. O que muda é que a suíte tem como perguntar "sobrou alguma?" antes
// de apagar a luz.

/** Rodadas máximas de drenagem. Trabalho de fundo pode agendar mais trabalho de
 *  fundo; o limite existe pra que isso vire ERRO visível em vez de suíte
 *  pendurada esperando para sempre. */
const MAX_RODADAS = 20

const emVoo = new Set<Promise<unknown>>()

/**
 * Registra uma promessa de fundo e a devolve intacta.
 *
 * Uso: `void deFundo(import("@/store/cards").then(...).catch(...))`. O `void`
 * continua sendo a declaração de intenção ("não espero por isto"); o `deFundo`
 * é o recibo de que ela existiu.
 */
export function deFundo<T>(p: Promise<T>): Promise<T> {
  emVoo.add(p)
  const solta = () => {
    emVoo.delete(p)
  }
  // `then(solta, solta)` e não `finally`: o segundo braço TAMBÉM marca a
  // promessa como tratada, então uma falha de fundo não vira unhandled
  // rejection só por ter sido registrada aqui.
  p.then(solta, solta)
  return p
}

/**
 * Espera o trabalho de fundo acabar. Para os testes — a produção nunca chama.
 *
 * Drena em rodadas porque uma promessa de fundo pode disparar outra (o import
 * resolve, o `.then` chama a store, a store agenda um persist). Estourar o
 * limite LANÇA: é sinal de laço, e laço silencioso vira suíte travada sem
 * ninguém entender por quê.
 */
export async function aguardeFundo(): Promise<void> {
  for (let i = 0; i < MAX_RODADAS; i++) {
    if (emVoo.size === 0) return
    await Promise.allSettled([...emVoo])
  }
  const restantes = emVoo.size
  emVoo.clear() // não deixa o próximo teste herdar a bagunça deste
  throw new Error(
    `trabalho de fundo não drenou em ${MAX_RODADAS} rodadas (${restantes} pendente(s)): ` +
      "alguma promessa de fundo está agendando outra em laço",
  )
}

/** Quantas promessas de fundo estão em voo agora. Só para diagnóstico/teste. */
export function emVooAgora(): number {
  return emVoo.size
}
