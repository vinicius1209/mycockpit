// A REDE do eixo de modo (docs/modos-de-sessao-plan.md, M0).
//
// O app tem hoje QUATRO vocabulários para a mesma decisão — "quanto o agente
// pode fazer sem me perguntar":
//
//   conversa/projeto  leitura · padrao · liberado          (lib/types.ts)
//   agendamento       leitura · padrao · auto              (lib/db.ts)
//   motor (Rust)      Leitura · Padrao · Auto · Liberado · FusionRo
//   plano             booleano `planFirst`, ORTOGONAL aos três
//
// Isto aqui não muda comportamento nenhum: é a rede que a refatoração vai
// precisar. Enquanto os quatro convivem, quem traduz é UMA função pura, testada
// valor a valor — em vez dos `match` espalhados que hoje divergem em silêncio
// (foi assim que `auto` ficou inalcançável da conversa e o plano precisou de um
// braço vazio no `adapters.rs` pra conviver com a permissão).
//
// A ordem de PERMISSIVIDADE é o coração do arquivo. Ela é o que deixa a
// invariante de segurança ser testada em vez de prometida: nenhuma migração
// pode devolver um modo mais frouxo que o de origem.

/** O eixo canônico — hoje é o superconjunto do que o Rust já entende, mais o
 *  plano, que deixa de ser flag paralela e vira um valor como os outros. */
export type SessionMode =
  | "plan"
  | "leitura"
  | "fusionRo"
  | "padrao"
  | "auto"
  | "liberado"

/**
 * Quanto cada modo LIBERA, em degraus comparáveis. Não é enfeite: é o que
 * permite afirmar "esta migração não afrouxou nada" com teste, e não com fé.
 *
 * Os três de escrita zero empatam de propósito — `plan`, `leitura` e `fusionRo`
 * diferem no PORQUÊ (planejar, só ler, candidato de disputa confinado), não no
 * quanto deixam o agente mexer. Empatar aqui evita inventar uma hierarquia
 * falsa entre eles.
 */
export const PERMISSIVIDADE: Record<SessionMode, number> = {
  plan: 0,
  leitura: 0,
  fusionRo: 0,
  padrao: 1, // escreve, mas pede
  auto: 2, // escreve sem pedir, com o freio de segurança da CLI
  liberado: 3, // escreve sem pedir e sem freio
}

/** Vocabulário da conversa/projeto (`lib/types.ts`). */
export type PermissionVocab = "leitura" | "padrao" | "liberado"
/**
 * Vocabulário do agendamento — SUBCONJUNTO do eixo, não lista paralela (M4).
 * O `Extract` amarra os dois: o compilador recusa id que o eixo não conheça, e
 * acrescentar modo aqui em cima não cria valor órfão lá.
 *
 * `liberado` fica FORA de propósito: bypass total numa execução sem ninguém na
 * frente não tem quem segure um erro; `auto` é o meio-termo (ADR-023). O teto é
 * TIPADO, não conselho no comentário.
 */
export type ScheduleVocab = Extract<SessionMode, "leitura" | "padrao" | "auto">

/** Nome que o banco e a UI de automações usam pro mesmo conjunto. */
export type SchedulePermission = ScheduleVocab
/** Vocabulário da fase de missão (`lib/missionDraft.ts`). `inherit` não é um
 *  modo: é "usa o do projeto". */
export type AutonomyVocab = "auto" | "inherit"

/**
 * Conversa → modo. `planFirst` VENCE, e é a tradução literal do que o motor já
 * faz: o `adapters.rs` substitui o `--permission-mode` do modo quando o turno é
 * de plano, com um braço vazio no match só pra isso. Aqui isso deixa de ser
 * exceção e vira o valor.
 */
export function modeFromConversation(
  permission: PermissionVocab,
  planFirst: boolean,
): SessionMode {
  return planFirst ? "plan" : permission
}

/** Agendamento → modo. Tradução 1:1; o conjunto é que é menor. */
export function modeFromSchedule(p: ScheduleVocab): SessionMode {
  return p
}

/**
 * Fase de missão → modo. `inherit` precisa do modo do PROJETO pra resolver — sem
 * ele não há resposta, e chutar seria justamente o fail-open que o §9 proíbe.
 *
 * `auto` CLAMPA, e este detalhe quase passou batido: ligar autonomia numa fase
 * NÃO libera escrita num projeto que está em "Só lê". Ele só "morde" no modo
 * que pausa (`padrao`) — nos demais é no-op. A primeira versão desta função
 * devolvia `"auto"` sempre, e teria dado permissão de escrita a missões de
 * projeto read-only na hora em que o M4 migrasse a tradução pra cá. Quem
 * segurava era o `phasePermission`, que hoje delega pra este ponto único.
 */
export function modeFromAutonomy(
  autonomy: AutonomyVocab,
  doProjeto: PermissionVocab,
): SessionMode {
  if (autonomy !== "auto") return doProjeto
  return doProjeto === "padrao" ? "auto" : doProjeto
}

/**
 * A migração pode ir de `antes` para `depois`?
 *
 * `false` = afrouxou, e afrouxar em silêncio no eixo de segurança é o pior
 * desfecho possível desta refatoração: ninguém percebe até um agente escrever
 * onde não devia. Apertar é permitido (o usuário nota e reclama); afrouxar, não.
 */
export function naoAlarga(antes: SessionMode, depois: SessionMode): boolean {
  return PERMISSIVIDADE[depois] <= PERMISSIVIDADE[antes]
}

/** Escreve sem pedir aprovação (o `isUnattended` do Paseo). Derivado da mesma
 *  régua, pra não existir uma segunda lista pra manter em sincronia. */
export function ehDesassistido(m: SessionMode): boolean {
  return PERMISSIVIDADE[m] >= PERMISSIVIDADE.auto
}

/**
 * O modo que o SPAWN vai usar: conversa vence projeto, projeto é o default.
 *
 * # O bug que esta função existe pra matar (23/08/2026)
 *
 * O M3 fez o modo virar da CONVERSA e persistir. O M4 unificou o eixo. E o
 * `ChatPanel` continuou mandando `project.permissionMode ?? "padrao"` pro
 * `runAgent` — o último metro nunca foi ligado.
 *
 * O sintoma que o usuário viu: conversa NOVA aberta em "Liberado", e o Claude
 * pedindo permissão a cada Bash. O chip mostrava o modo da conversa; o processo
 * nascia com o do projeto. `conv.sessionMode` era lido em exatamente dois
 * lugares — desenhar o chip e derivar o `planFirst` — e em nenhum deles chegava
 * ao spawn.
 *
 * **E contaminava o sandbox.** O confinamento decide pelo `req.permission`, que
 * vinha do projeto: escolher "Só lê" no chip NÃO confinava, a menos que o
 * projeto inteiro já estivesse em leitura. Uma garantia de segurança pendurada
 * num controle desconectado é pior que nenhuma, porque ela é exibida.
 *
 * A lição, e ela se repete: construir o eixo não é ligá-lo. O M0–M4 tinha rede,
 * teste e ADR — e nada disso perguntava "o valor chega no processo?".
 */
export function modoEfetivoDoSpawn(
  daConversa: SessionMode | null | undefined,
  /**
   * O modo do projeto. Tipado como `SessionMode` e NÃO como `PermissionVocab`
   * porque o compilador achou uma inconsistência do M0 ao ligar isto: o
   * `PermissionVocab` se descreve como "vocabulário da conversa/projeto", mas
   * lista três valores enquanto o `PermissionMode` do `lib/types.ts` tem
   * QUATRO — o `auto` do projeto não cabia nele. Projeto em "auto" é
   * configuração legítima, então quem tem que ceder é o tipo estreito.
   */
  doProjeto: SessionMode | null | undefined,
): SessionMode {
  return daConversa ?? doProjeto ?? "padrao"
}

/**
 * Eixo → vocabulário que o Rust aceita (`Permission::parse`).
 *
 * `plan` NÃO é permissão: ele é ortogonal e viaja no `planFirst`. Traduzir aqui
 * exige dizer sob QUE permissão o plano roda — e a resposta é a mais apertada
 * que não quebra o turno, porque planejar não escreve.
 */
export function permissaoDoSpawn(m: SessionMode): string {
  if (m === "fusionRo") return "fusion-ro"
  // Planejar não edita: a permissão que acompanha é a de leitura. O `planFirst`
  // continua indo junto, e é ele que o adapter usa pra montar o modo de plano.
  if (m === "plan") return "leitura"
  return m
}
