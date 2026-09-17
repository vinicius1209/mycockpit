// QUANTO a memória de uma conversa pode ocupar — derivado, não herdado.
//
// # Por que este arquivo existe
//
// O `RESUME_FALLBACK_BUDGET` era `3_000` chars. Ninguém sabia de onde vinha, e
// eu o herdei sem questionar até o usuário perguntar: *"quem define orçamento?
// de onde você tira esses números? somos livres para fazer o que queremos"*.
//
// Ele estava errado por uma ordem de grandeza. 3.000 chars ≈ 1.000 tokens ≈
// **0,5%** da janela de 200k do Claude. Não havia restrição nenhuma sustentando
// isso: não é a janela (sobrariam 99,5%), não é o custo (~$0,01 por
// transplante), e não é qualidade — é justamente o pouco que faz a memória
// perder o miolo.
//
// # A pesquisa (23/08/2026)
//
// | fonte | limiar de compactação | cauda retida |
// |---|---|---|
// | DeepSeek Harness (`compaction-basic`, código no disco) | `thresholdRatio` 0,80 | `retainRatio` **0,16** |
// | Claude Code (recomendação pública) | **0,70–0,75** | — |
// | Deep Agents / LangChain | — | **0,10** |
// | literatura de "context rot" | degrada já em 0,70–0,80 | — |
//
// Duas coisas convergem: os números são **razões da janela**, nunca constantes;
// e a cauda retida fica na casa de 0,10–0,16.
//
// # Onde o nosso caso DIFERE, e por que ele comporta mais
//
// Todas essas fontes descrevem AUTO-COMPACTAÇÃO: comprimir uma sessão que já
// encheu a janela. O retain de 10–16% é o que sobra depois de 80% ocupados.
//
// A nossa memória entra numa janela **VAZIA** — sessão nova, transplante ou
// resume que falhou. Não disputamos espaço com nada. Então a mesma fração vira
// um teto MUITO mais folgado na prática, e ainda deixa 90% pro trabalho.
//
// # Frequência é o eixo que o número único escondia
//
// O `3_000` era usado num evento que acontece UMA vez por conversa. Mas o agy
// não tem resume nativo: o recap dele viaja em TODO turno (`buildMemoryPrompt`).
// Um número só pra duas frequências é errado nos dois sentidos — generoso demais
// pra quem paga por turno, apertado demais pra quem paga uma vez.
//
// # Chars × tokens: a distinção que o DSH deixa explícita
//
// > "Character budgets are not token budgets — provider token density varies."
//
// A montagem é determinística e trabalha em CHARS (barato, testável, sem
// tokenizer). A conversão usa 3 chars/token, que SUBESTIMA de propósito: em
// português com acentos a densidade real fica acima disso, então o orçamento em
// chars sai menor que o teto em tokens. Errar pro lado apertado é o lado seguro.

/** Conservador de propósito — ver o cabeçalho. */
export const CHARS_POR_TOKEN = 3

/**
 * Quando a memória é montada. Não é enfeite: decide a fração.
 *
 * - `transplante`: uma vez por conversa (troca de motor, resume que falhou). A
 *   janela está vazia e o custo é pago uma vez.
 * - `porTurno`: todo envio (motor sem resume nativo, hoje o agy). Paga sempre e
 *   ACUMULA na janela junto com o trabalho.
 */
export type Frequencia = "transplante" | "porTurno"

/** Fração da janela por frequência.
 *
 *  `transplante` em 0,10 acompanha o retain do Deep Agents — e aqui é sobre
 *  janela vazia, então sobram 90% pro trabalho.
 *
 *  `porTurno` em 0,03 porque é pago a cada envio: em 10 turnos a memória
 *  ocuparia 30% se fosse 0,10, competindo com o próprio trabalho que ela
 *  deveria viabilizar. Um terço da fração do transplante mantém 10 turnos
 *  abaixo de um terço da janela. */
const FRACAO: Record<Frequencia, number> = {
  transplante: 0.1,
  porTurno: 0.03,
}

/** Piso quando a janela é desconhecida.
 *
 *  Fail-closed do §9: sem saber a janela, NÃO se chuta pra cima. Este é o valor
 *  herdado (3k) promovido a piso — ele nunca foi um bom teto, mas é um piso
 *  seguro, já provado em produção. */
export const PISO_CHARS = 3_000

/** Teto POR FREQUÊNCIA, e ele é o número que de fato manda nos modelos reais.
 *
 *  Primeira versão usou um teto único de 60k e a medição mostrou o defeito: numa
 *  janela de 200k a razão já bate no teto, então ela não fazia nada — era
 *  constante disfarçada de razão. E 60k chars EM TODO TURNO (agy) seria caro
 *  demais.
 *
 *  Por que existir um teto: acima de certo ponto o limite deixa de ser a janela
 *  e passa a ser a ATENÇÃO. A literatura de "context rot" mostra degradação bem
 *  antes de a janela encher; despejar 600k chars numa janela de 2M não melhora
 *  resposta nenhuma, piora.
 *
 *  A razão continua tendo função: ela é quem PROTEGE a janela pequena. Num
 *  modelo de 32k, `transplante` dá ~9,6k chars, bem abaixo do teto. */
export const TETO_CHARS: Record<Frequencia, number> = {
  // ~20k tokens de preâmbulo, uma vez, numa janela vazia.
  transplante: 60_000,
  // ~4k tokens por turno: dez turnos ainda cabem em 40k, folgado num 200k. O
  // valor herdado aqui era 4.000 chars (AGY_RECAP_BUDGET); 3x mais, e derivado.
  porTurno: 12_000,
}

/**
 * O orçamento em CHARS para esta janela e esta frequência.
 *
 * `janelaTokens = null` (modelo desconhecido) cai no piso — o app não inventa
 * porcentagem de janela que não conhece, mesma postura do `ContextRing`.
 */
export function orcamentoDaMemoria(
  janelaTokens: number | null,
  frequencia: Frequencia,
): number {
  if (janelaTokens == null || janelaTokens <= 0) return PISO_CHARS
  const chars = Math.floor(janelaTokens * FRACAO[frequencia] * CHARS_POR_TOKEN)
  return Math.min(TETO_CHARS[frequencia], Math.max(PISO_CHARS, chars))
}
