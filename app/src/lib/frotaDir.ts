// A PASTA DA FROTA no projeto, espelho TS de `mycockpit.rs::pasta_da_frota`.
//
// O nome mudou de `.mycockpit/` para `.frota/` (ADR-222), e a leitura dupla é
// a janela do rename: a pasta existe em TODO projeto aberto antes de
// 21/09/2026, e nesses projetos `instructions.md`, `agents/` e `commands/`
// estão commitados. O app não renomeia repositório de terceiro sem gesto.
//
// Aqui só se DECIDE nome; quem toca disco é o Rust, que resolve de verdade
// olhando qual das duas existe. Por isso o TS constrói com o nome NOVO e
// RECONHECE os dois: escrever é o backend que faz (e ele acerta), reconhecer é
// o front que faz (e ele não pode errar nem no projeto legado).

/** A pasta de hoje. É o que se constrói daqui pra frente. */
export const PASTA = ".frota"

/** A pasta legada, ainda reconhecida durante a janela. */
export const PASTA_LEGADA = ".mycockpit"

/** As duas, na ordem de preferência. */
export const PASTAS = [PASTA, PASTA_LEGADA] as const

/**
 * O caminho está sob a pasta da Frota? Aceita as duas grafias.
 *
 * @param sub subcaminho opcional dentro da pasta, ex: `"agents/"`.
 */
export function sobAPasta(caminho: string, sub = ""): boolean {
  return PASTAS.some((p) => caminho.startsWith(`${p}/${sub}`))
}

/** Monta um caminho relativo sob a pasta NOVA. */
export function caminhoNaPasta(sub: string): string {
  return `${PASTA}/${sub}`
}
