/**
 * GUARDA: a superfície nasce da primitiva certa, e a primitiva mora em
 * `components/ui/` (§12 do STYLEGUIDE).
 *
 * ── O QUE ELA MEDIU ANTES DE EXISTIR (29/08/2026) ──────────────────────────
 * Dois lugares faziam o MESMO gesto — um painel ancorado num elemento, que
 * informa sem interromper — de dois jeitos diferentes:
 *
 *   `components/notes/StickyNotesTrigger.tsx`  →  `Popover` cru do `radix-ui`
 *   `components/layout/statusBarChrome.tsx`    →  `DropdownMenu` vestido de painel
 *
 * A causa das duas era a mesma: **não existia `components/ui/popover.tsx`**.
 * Sem porta oficial, um consumidor foi buscar no vendor e o outro forçou o
 * vizinho mais próximo. Nenhum dos dois estava sendo desleixado; faltava o
 * lugar onde a decisão já estivesse tomada.
 *
 * ── AS DUAS REGRAS, E POR QUE SÃO DUAS ─────────────────────────────────────
 * 1. **Vendor só em `components/ui/`.** Import de `radix-ui` (ou de
 *    `@radix-ui/*`) fora de lá significa que uma primitiva está faltando. A
 *    correção é criá-la, nunca importar direto: primitiva no consumidor não
 *    tem onde carregar a decisão de elevação, movimento e teclado.
 *
 * 2. **Menu que não tem item não é menu.** Arquivo que monta um
 *    `DropdownMenuContent` e nunca usa um item de menu está usando a semântica
 *    de lista de COMANDOS (roving tabindex, typeahead, foco devolvido ao
 *    gatilho) para exibir dados. O sintoma é sempre o mesmo: o consumidor
 *    começa a desarmar comportamento na mão. A porta certa é `ui/popover`.
 *
 * Sem baseline, e de propósito. Baseline existe para débito grande e
 * conhecido, que se paga aos poucos (é o caso da catraca de tamanho). Aqui o
 * repositório já está em zero: congelar zero é a própria regra.
 */

/** Import do vendor Radix, nas duas formas que o repo já viu. */
const VENDOR = /^\s*import\s[^;]*?from\s+["'](radix-ui|@radix-ui\/[^"']+)["']/gm;

/** Onde o vendor PODE ser importado: é lá que a primitiva mora. */
const CASA_DAS_PRIMITIVAS = /^components\/ui\//;

/** Os itens que fazem de um `DropdownMenu` um menu de verdade. */
const ITENS_DE_MENU = [
  "DropdownMenuItem",
  "DropdownMenuCheckboxItem",
  "DropdownMenuRadioItem",
  "DropdownMenuSubTrigger",
];

const TESTE = /\.test\.[cm]?[jt]sx?$/;

/** @param {string} relPath */
function ehTeste(relPath) {
  return TESTE.test(relPath);
}

/** @param {string} source @param {RegExp} re */
function acharLinhas(source, re) {
  const linhas = source.split("\n");
  /** @type {Array<{linha: number, trecho: string}>} */
  const achados = [];
  for (let i = 0; i < linhas.length; i++) {
    re.lastIndex = 0;
    if (new RegExp(re.source).test(linhas[i])) {
      achados.push({ linha: i + 1, trecho: linhas[i].trim() });
    }
  }
  return achados;
}

/**
 * @param {Array<{relPath: string, source: string}>} arquivos
 * @returns {Array<{relPath: string, linha: number, trecho: string, regra: "vendor" | "menu-sem-item"}>}
 */
export function acharPrimitivasErradas(arquivos) {
  /** @type {Array<{relPath: string, linha: number, trecho: string, regra: "vendor" | "menu-sem-item"}>} */
  const violacoes = [];

  for (const { relPath, source } of arquivos) {
    if (ehTeste(relPath)) continue;

    if (!CASA_DAS_PRIMITIVAS.test(relPath)) {
      for (const achado of acharLinhas(source, VENDOR)) {
        violacoes.push({ ...achado, relPath, regra: "vendor" });
      }
    }

    // O próprio `ui/dropdown-menu.tsx` declara os itens; ele é a primitiva.
    if (CASA_DAS_PRIMITIVAS.test(relPath)) continue;

    const usaConteudoDeMenu = source.includes("DropdownMenuContent");
    const temItem = ITENS_DE_MENU.some((item) => source.includes(item));
    if (usaConteudoDeMenu && !temItem) {
      const achados = acharLinhas(source, /DropdownMenuContent/);
      violacoes.push({
        relPath,
        linha: achados[0]?.linha ?? 1,
        trecho: achados[0]?.trecho ?? "DropdownMenuContent",
        regra: "menu-sem-item",
      });
    }
  }

  return violacoes;
}

/** @param {"vendor" | "menu-sem-item"} regra */
export function comoConsertar(regra) {
  if (regra === "vendor") {
    return (
      "primitiva do vendor fora de `components/ui/`. Se falta uma primitiva, " +
      "crie-a lá e importe de lá: é o único lugar onde elevação, movimento e " +
      "teclado ficam decididos uma vez (§12)."
    );
  }
  return (
    "`DropdownMenu` sem item de menu é um PAINEL vestido de lista de comandos: " +
    "ele traz roving tabindex, typeahead e foco devolvido ao gatilho, e o " +
    "consumidor acaba desarmando tudo na mão. Use `@/components/ui/popover` (§12)."
  );
}
