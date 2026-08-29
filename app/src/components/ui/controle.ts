// A GEOMETRIA DE CONTROLE — a escada fechada de altura, padding e fonte de
// tudo que se aperta (§13 do STYLEGUIDE).
//
// ── O QUE ELA MEDIU ANTES DE EXISTIR (29/08/2026) ──────────────────────────
// 75 arquivos escreviam geometria de controle à mão, em **43 combinações
// distintas** de altura/padding/fonte. Nenhuma errada sozinha; juntas, nenhum
// controle tinha o mesmo tamanho de outro sem que isso fosse coincidência.
//
// O curioso é que o app JÁ tinha convergido numa escada de 4px sem saber:
// `px-2.5 py-1` (39×), `px-2 py-1.5` (17×), `px-3 py-1.5` (16×) e `px-2 py-1`
// (13×) caem todos em 24, 28 e 32px de altura final. Faltava o lugar onde isso
// estivesse escrito, e um nome pra cada degrau.
//
// ── POR QUE QUATRO, E NÃO CINCO ────────────────────────────────────────────
// A escala de `button.tsx` tinha `lg` (40px, 4 usos), `icon` (0) e `icon-lg`
// (0), e NÃO tinha o degrau de 28px que o app mais escreve à mão (14 usos).
// "Ação primária, porém maior" não é um papel: é a mesma regra do §3, onde
// ênfase acima de 14px se faz com peso e não com tamanho. Os quatro degraus
// que sobraram têm papel distinto e nome que o diz.
//
// ── COMO USAR ──────────────────────────────────────────────────────────────
//   <Button size="padrao">           ← controle de superfície
//   className={controle("chip")}     ← botão à mão em chrome denso
//   className={controle("chip", { quadrado: true })}   ← só ícone
//
// A regra que fecha a escada (§13): **nunca encolha a fonte ou o padding de um
// controle localmente pra ele caber.** Se o contexto pede menor, ou o degrau
// certo é outro, ou o degrau está faltando — e degrau novo entra por ADR, como
// tamanho de fonte novo entra no §3.

/** Um degrau da escada. As classes são literais de propósito: é assim que o
 *  Tailwind as enxerga, e é assim que `grep` acha quem usa o quê. */
export const GEOMETRIA_DE_CONTROLE = {
  /** 24px · chrome denso: faixa de status, cabeçalho de painel, pill, chip. */
  chip: {
    altura: "h-6",
    quadrado: "size-6",
    padding: "px-2",
    fonte: "text-[11px]",
    icone: "size-3",
    /** A variante completa, LITERAL: o Tailwind varre texto, então classe
     *  montada por interpolação só existe se o literal aparecer em algum
     *  arquivo varrido. É aqui que ele aparece. */
    icone_forcado: "[&_svg:not([class*='size-'])]:size-3",
    gap: "gap-1",
    raio: "rounded-md",
  },
  /** 28px · secundário dentro de um painel: filtro, aba, ação de linha. */
  compacto: {
    altura: "h-7",
    quadrado: "size-7",
    padding: "px-2.5",
    fonte: "text-[12px]",
    icone: "size-3.5",
    /** A variante completa, LITERAL: o Tailwind varre texto, então classe
     *  montada por interpolação só existe se o literal aparecer em algum
     *  arquivo varrido. É aqui que ele aparece. */
    icone_forcado: "[&_svg:not([class*='size-'])]:size-3.5",
    gap: "gap-1.5",
    raio: "rounded-md",
  },
  /** 32px · o controle de superfície. Na dúvida, é este. */
  padrao: {
    altura: "h-8",
    quadrado: "size-8",
    padding: "px-3",
    fonte: "text-[13px]",
    icone: "size-4",
    /** A variante completa, LITERAL: o Tailwind varre texto, então classe
     *  montada por interpolação só existe se o literal aparecer em algum
     *  arquivo varrido. É aqui que ele aparece. */
    icone_forcado: "[&_svg:not([class*='size-'])]:size-4",
    gap: "gap-1.5",
    raio: "rounded-md",
  },
  /** 36px · ação primária de dialog e de formulário. */
  destaque: {
    altura: "h-9",
    quadrado: "size-9",
    padding: "px-4",
    fonte: "text-[13px]",
    icone: "size-4",
    /** A variante completa, LITERAL: o Tailwind varre texto, então classe
     *  montada por interpolação só existe se o literal aparecer em algum
     *  arquivo varrido. É aqui que ele aparece. */
    icone_forcado: "[&_svg:not([class*='size-'])]:size-4",
    gap: "gap-2",
    raio: "rounded-md",
  },
} as const

export type NivelDeControle = keyof typeof GEOMETRIA_DE_CONTROLE

/** Os degraus em ordem, pra guarda e pra doc não repetirem a lista. */
export const NIVEIS_DE_CONTROLE = [
  "chip",
  "compacto",
  "padrao",
  "destaque",
] as const satisfies readonly NivelDeControle[]

/**
 * A receita de um degrau, pronta pro `className`.
 *
 * Existe pro botão escrito à mão — o que vive no chrome denso e não quer o
 * `<Button>` inteiro. Ele ganha a MESMA geometria sem copiá-la, que é a única
 * forma de a escada valer pros 89 arquivos que não importam `<Button>`.
 *
 * `quadrado`: controle só de ícone. Ele não tem padding lateral, tem lado.
 */
export function controle(
  nivel: NivelDeControle,
  opcoes: { quadrado?: boolean } = {},
): string {
  const g = GEOMETRIA_DE_CONTROLE[nivel]
  const base = `inline-flex shrink-0 items-center ${g.gap} ${g.raio} ${g.fonte}`
  return opcoes.quadrado
    ? `${base} justify-center ${g.quadrado}`
    : `${base} ${g.altura} ${g.padding}`
}

/** O tamanho do ícone DENTRO de um controle daquele degrau. Ícone que não
 *  acompanha o degrau é o jeito mais fácil de a escada parecer errada mesmo
 *  estando certa. */
export function iconeDeControle(nivel: NivelDeControle): string {
  return GEOMETRIA_DE_CONTROLE[nivel].icone
}
