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
/** Vocabulário do agendamento (`lib/db.ts`). Note o `auto` que a conversa não
 *  tem, e a ausência do `liberado` que ela tem — os dois conjuntos nunca foram
 *  o mesmo. */
export type ScheduleVocab = "leitura" | "padrao" | "auto"
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
 */
export function modeFromAutonomy(
  autonomy: AutonomyVocab,
  doProjeto: PermissionVocab,
): SessionMode {
  return autonomy === "auto" ? "auto" : doProjeto
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
