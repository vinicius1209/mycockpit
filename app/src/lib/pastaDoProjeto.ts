// A pasta do projeto ainda está lá?
//
// Um projeto aponta pra uma pasta que o usuário move, renomeia ou apaga pelo
// Finder — sem o app saber. Até aqui ele seguia na lista como se estivesse tudo
// bem, e o erro só aparecia quando alguém tentava RODAR algo: o agent nascia
// num `cwd` inexistente e morria com uma mensagem do CLI, longe da causa.
//
// A régua é a do §5: **não-configurado esconde; configurado com ERRO fica** —
// visível, com o erro dito. Sumir da lista seria pior: quem cadastrou aquilo
// merece saber por que parou de funcionar.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export type EstadoDaPasta = "Sumiu" | "NaoEPasta"

/** Caminho → o que há de errado com ele. Só os problemáticos entram. */
export type PastasComProblema = Record<string, EstadoDaPasta>

export const COPY_DA_PASTA: Record<EstadoDaPasta, string> = {
  // Duas frases diferentes porque são dois problemas diferentes: uma manda
  // procurar, a outra manda olhar o que está bem ali.
  Sumiu: "A pasta deste projeto não existe mais neste caminho.",
  NaoEPasta: "O caminho deste projeto existe, mas não é uma pasta.",
}

/**
 * Confere os caminhos em UMA chamada e devolve só os problemáticos.
 *
 * Lote de propósito: são `stat`s baratos, e uma ida ao backend por projeto
 * responderia N vezes a mesma pergunta. Lista vazia (o caso normal) não custa
 * tráfego nenhum.
 */
export async function conferirPastas(
  caminhos: readonly string[],
): Promise<PastasComProblema> {
  if (!isTauri() || caminhos.length === 0) return {}
  try {
    const pares = await invoke<[string, EstadoDaPasta][]>("conferir_pastas", {
      caminhos: [...caminhos],
    })
    return Object.fromEntries(pares)
  } catch {
    // Best-effort: não conseguir conferir não pode marcar projeto bom como
    // quebrado. Silêncio aqui é mais honesto que um alarme por falha nossa.
    return {}
  }
}
