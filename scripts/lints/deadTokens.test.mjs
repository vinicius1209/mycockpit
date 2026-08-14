import { describe, expect, it } from "vitest";

import {
  acharTravessaoEmCopy,
  avaliarTokensMortos,
  DEAD_TOKEN_RULES,
  matchLiteral,
} from "./deadTokens.mjs";

const regra = (id) => DEAD_TOKEN_RULES.find((r) => r.id === id);
const linhas = (source) => acharTravessaoEmCopy(source).map((h) => h.linha);

describe("matcher literal", () => {
  it("acha todas as ocorrências com a linha certa", () => {
    const hits = matchLiteral("a\nshadow-lg\nb shadow-2xl", /\bshadow-(?:md|lg|xl|2xl)\b/g);
    expect(hits.map((h) => [h.linha, h.trecho])).toEqual([
      [2, "shadow-lg"],
      [3, "shadow-2xl"],
    ]);
  });

  it("não casa prefixo de outro utilitário", () => {
    expect(matchLiteral("shadow-sm shadow-pop", /\bshadow-(?:md|lg|xl|2xl)\b/g)).toEqual([]);
  });
});

describe("regra: sombra fora das 3 elevações", () => {
  const detectar = regra("shadow-pesada").detectar;

  it("pega shadow-md/lg/xl/2xl", () => {
    expect(detectar("shadow-md shadow-lg shadow-xl shadow-2xl")).toHaveLength(4);
  });

  it("deixa passar as receitas do §4", () => {
    expect(detectar("shadow-[var(--shadow-sm)] shadow-[var(--shadow-pop)]")).toEqual([]);
  });
});

describe("regra: verde como estado ambiente", () => {
  const detectar = regra("verde-ambiente").detectar;

  it("pega text-st-success", () => {
    expect(detectar('className="text-st-success"')).toHaveLength(1);
  });

  it("não pega bg-st-success (a regra é sobre TEXTO verde)", () => {
    expect(detectar('className="bg-st-success/10"')).toEqual([]);
  });
});

describe("regra: travessão em copy de UI", () => {
  it("ignora travessão em comentário, que é conversa entre devs", () => {
    expect(linhas("// P2 — vigia de turno\nconst a = 1")).toEqual([]);
    expect(linhas("/** doc — com travessão */")).toEqual([]);
  });

  it("pega travessão dentro de literal de string", () => {
    expect(linhas('const t = "Arquivo binário — sem diff"')).toEqual([1]);
  });

  it("pega travessão em texto JSX", () => {
    expect(linhas("<p>A missão está pausada — responda pra continuar</p>")).toEqual([1]);
  });

  it("tolera o glifo de valor ausente como literal inteiro", () => {
    expect(linhas('const v = custo ?? "—"')).toEqual([]);
    expect(linhas("const v = custo ?? '—'")).toEqual([]);
  });

  it("tolera o glifo de valor ausente sozinho numa célula JSX", () => {
    expect(linhas("<td>—</td>")).toEqual([]);
    expect(linhas("<span className='x'>\n  —\n</span>")).toEqual([]);
  });

  it("não tolera o travessão quando ele acompanha prosa na mesma célula", () => {
    expect(linhas("<td>total — sem dado</td>")).toEqual([1]);
  });

  it("ignora argumento de console, que é saída de dev e não copy", () => {
    expect(linhas('console.warn("[chat] payload malformado — ignorado", p)')).toEqual([]);
    expect(linhas('console.error(\n  "[chat] payload malformado — ignorado",\n)')).toEqual([]);
    // template com interpolação: o `${…}` parte o literal em vários spans, e o
    // span do travessão passa a vir depois de um `)`, não do `console.warn(`.
    // Sem o carve-out por linha, a MESMA frase de dev passava ou não dependendo
    // de ter uma variável no meio (caso real: detect.ts, agy models).
    expect(
      linhas('console.warn(`agy models: indisponível (${f.kind}) — ${f.message}`)'),
    ).toEqual([]);
  });

  it("não deixa o console cobrir a copy da linha seguinte", () => {
    const source = 'console.warn("x — y")\nconst titulo = "Missão pausada — responda"';
    expect(linhas(source)).toEqual([2]);
  });

  it("aceita os separadores permitidos pelo §7", () => {
    expect(linhas('const t = "3 turnos · 4s → concluído"')).toEqual([]);
  });

  it("acha a copy mesmo depois de um regex com crase (o bug que zerava a guarda)", () => {
    const source = ["if (/[#>`|]/u.test(x)) return", 'const t = "Plano — execute"'].join("\n");
    expect(linhas(source)).toEqual([2]);
  });

  it("acha a copy dentro de template com interpolação", () => {
    expect(linhas("const t = `${nome} — retomando em ${s}s`")).toEqual([1]);
  });
});

describe("avaliação com exceções", () => {
  const arquivos = [{ relPath: "x.tsx", source: "text-st-success text-st-success" }];
  const regraDeTeste = {
    id: "verde",
    descricao: "verde",
    regra: "§2",
    extensoes: new Set([".tsx"]),
    detectar: (source) => matchLiteral(source, /text-st-success/g),
  };

  it("sem exceção declarada, toda ocorrência é violação", () => {
    const { violacoes } = avaliarTokensMortos(arquivos, [{ ...regraDeTeste, excecoes: {} }]);
    expect(violacoes).toHaveLength(2);
  });

  it("a exceção cobre até o número declarado e o excedente cai", () => {
    const { violacoes } = avaliarTokensMortos(arquivos, [
      { ...regraDeTeste, excecoes: { "x.tsx": { max: 1, motivo: "marco do fio" } } },
    ]);
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ permitido: 1, encontrado: 2 });
  });

  it("exceção exata deixa passar", () => {
    const { violacoes } = avaliarTokensMortos(arquivos, [
      { ...regraDeTeste, excecoes: { "x.tsx": { max: 2, motivo: "marco do fio" } } },
    ]);
    expect(violacoes).toEqual([]);
  });

  it("exceção que sobrou folgada é ratchet a apertar, e não derruba o CI", () => {
    const { violacoes, excecoesFolgadas } = avaliarTokensMortos(arquivos, [
      { ...regraDeTeste, excecoes: { "x.tsx": { max: 5, motivo: "marco do fio" } } },
    ]);
    expect(violacoes).toEqual([]);
    expect(excecoesFolgadas).toEqual([{ ruleId: "verde", relPath: "x.tsx", max: 5, uso: 2 }]);
  });

  it("exceção é por arquivo, não vale pro vizinho", () => {
    const { violacoes } = avaliarTokensMortos(
      [...arquivos, { relPath: "y.tsx", source: "text-st-success" }],
      [{ ...regraDeTeste, excecoes: { "x.tsx": { max: 2, motivo: "marco do fio" } } }],
    );
    expect(violacoes.map((v) => v.relPath)).toEqual(["y.tsx"]);
  });

  it("respeita a extensão e o filtro de ignorar da regra", () => {
    const { violacoes } = avaliarTokensMortos(
      [
        { relPath: "x.ts", source: "text-st-success" },
        { relPath: "z.tsx", source: "text-st-success" },
      ],
      [{ ...regraDeTeste, ignorar: (p) => p === "z.tsx", excecoes: {} }],
    );
    expect(violacoes).toEqual([]);
  });
});

describe("as regras declaradas", () => {
  it("toda exceção carrega motivo escrito", () => {
    for (const rule of DEAD_TOKEN_RULES) {
      for (const [relPath, excecao] of Object.entries(rule.excecoes ?? {})) {
        expect(excecao.motivo, `${rule.id}:${relPath}`).toBeTruthy();
        expect(excecao.max, `${rule.id}:${relPath}`).toBeGreaterThan(0);
      }
    }
  });

  it("sombra pesada não tem exceção: a passada de 12/08/2026 zerou o app", () => {
    expect(regra("shadow-pesada").excecoes).toEqual({});
  });
});
