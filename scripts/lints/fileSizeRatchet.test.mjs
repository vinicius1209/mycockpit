import { describe, expect, it } from "vitest";

import {
  allowedLineCount,
  avaliarArquivo,
  avaliarRatchet,
  baselineDesatualizada,
  contarLinhas,
  regraPara,
  REGRAS_PADRAO,
} from "./fileSizeRatchet.mjs";

const REGRAS = [
  { id: "teste", maxLines: 20, casa: (p) => /\.test\.[cm]?[jt]sx?$/.test(p) },
  { id: "tsx", maxLines: 15, casa: (p) => p.endsWith(".tsx") },
  { id: "ts", maxLines: 10, casa: (p) => p.endsWith(".ts") },
];

describe("contagem de linhas", () => {
  it("conta arquivo vazio como zero", () => {
    expect(contarLinhas("")).toBe(0);
  });

  it("não dá linha de brinde pro \\n final", () => {
    expect(contarLinhas("a\nb\n")).toBe(2);
    expect(contarLinhas("a\nb")).toBe(2);
  });

  it("conta igual em CRLF", () => {
    expect(contarLinhas("a\r\nb\r\n")).toBe(2);
  });
});

describe("limite efetivo", () => {
  it("sem entrada na baseline, o limite é o teto do tipo", () => {
    expect(allowedLineCount(null, 500)).toBe(500);
    expect(allowedLineCount(undefined, 500)).toBe(500);
  });

  it("arquivo já acima do teto congela no tamanho que tinha", () => {
    expect(allowedLineCount(2801, 700)).toBe(2801);
  });

  it("baseline abaixo do teto não afrouxa o teto pra baixo", () => {
    expect(allowedLineCount(120, 500)).toBe(500);
  });
});

describe("avaliação de um arquivo", () => {
  it("arquivo novo acima do teto viola", () => {
    expect(avaliarArquivo({ baseLines: null, atual: 701, maxLines: 700 })).toEqual({
      limite: 700,
      violou: true,
    });
  });

  it("arquivo congelado não pode crescer nem uma linha", () => {
    expect(avaliarArquivo({ baseLines: 2801, atual: 2802, maxLines: 700 }).violou).toBe(true);
    expect(avaliarArquivo({ baseLines: 2801, atual: 2801, maxLines: 700 }).violou).toBe(false);
  });
});

describe("regra por tipo de arquivo", () => {
  it("teste ganha o teto de teste, não o de tsx", () => {
    expect(regraPara(REGRAS_PADRAO, "lib/fleet/send.test.ts").id).toBe("teste");
    expect(regraPara(REGRAS_PADRAO, "components/chat/X.test.tsx").id).toBe("teste");
  });

  it("tsx e ts têm tetos diferentes", () => {
    expect(regraPara(REGRAS_PADRAO, "components/chat/X.tsx").id).toBe("tsx");
    expect(regraPara(REGRAS_PADRAO, "lib/x.ts").id).toBe("ts");
  });

  it("arquivo de outro tipo fica fora da guarda", () => {
    expect(regraPara(REGRAS_PADRAO, "index.css")).toBeNull();
  });
});

describe("ratchet", () => {
  it("arquivo novo nasce abaixo do teto", () => {
    const { violacoes } = avaliarRatchet([{ relPath: "lib/novo.ts", linhas: 11 }], {}, REGRAS);
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ relPath: "lib/novo.ts", novo: true, limite: 10 });
  });

  it("legado congelado passa parado e falha ao crescer", () => {
    const baseline = { "lib/legado.ts": 300 };
    expect(avaliarRatchet([{ relPath: "lib/legado.ts", linhas: 300 }], baseline, REGRAS).violacoes).toEqual([]);
    const cresceu = avaliarRatchet([{ relPath: "lib/legado.ts", linhas: 301 }], baseline, REGRAS);
    expect(cresceu.violacoes[0]).toMatchObject({ baseLines: 300, linhas: 301, limite: 300 });
  });

  it("quando o arquivo encolhe, o número novo vira o limite dele", () => {
    const baseline = { "lib/legado.ts": 300 };
    const { encolheram, baselineNova } = avaliarRatchet(
      [{ relPath: "lib/legado.ts", linhas: 250 }],
      baseline,
      REGRAS,
    );
    expect(encolheram).toEqual([{ relPath: "lib/legado.ts", de: 300, para: 250 }]);
    expect(baselineNova).toEqual({ "lib/legado.ts": 250 });
  });

  it("arquivo que desceu abaixo do teto sai da baseline", () => {
    const { obsoletos, baselineNova } = avaliarRatchet(
      [{ relPath: "lib/legado.ts", linhas: 9 }],
      { "lib/legado.ts": 300 },
      REGRAS,
    );
    expect(obsoletos).toEqual(["lib/legado.ts"]);
    expect(baselineNova).toEqual({});
  });

  it("a baseline nunca sobe, mesmo se alguém regravar com o arquivo já estourado", () => {
    // A catraca só gira num sentido: `--update` recusa quando há violação, e
    // ainda assim o número gerado é limitado pelo limite vigente.
    const { baselineNova } = avaliarRatchet(
      [{ relPath: "lib/legado.ts", linhas: 999 }],
      { "lib/legado.ts": 300 },
      REGRAS,
    );
    expect(baselineNova["lib/legado.ts"]).toBe(300);
  });

  it("ignora arquivo de tipo não coberto", () => {
    const { violacoes, baselineNova } = avaliarRatchet(
      [{ relPath: "estilo.css", linhas: 5000 }],
      {},
      REGRAS,
    );
    expect(violacoes).toEqual([]);
    expect(baselineNova).toEqual({});
  });

  it("a baseline sai ordenada, pro diff ficar legível", () => {
    const { baselineNova } = avaliarRatchet(
      [
        { relPath: "z.ts", linhas: 50 },
        { relPath: "a.ts", linhas: 60 },
      ],
      {},
      REGRAS,
    );
    expect(Object.keys(baselineNova)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("baseline desatualizada", () => {
  it("baseline igual ao estado atual está em dia", () => {
    expect(baselineDesatualizada({ "a.ts": 300 }, { "a.ts": 300 })).toBe(false);
  });

  it("arquivo que encolheu deixa a baseline frouxa", () => {
    expect(baselineDesatualizada({ "a.ts": 300 }, { "a.ts": 250 })).toBe(true);
  });

  it("entrada que não existe mais deixa a baseline frouxa", () => {
    expect(baselineDesatualizada({ "a.ts": 300 }, {})).toBe(true);
  });

  it("arquivo novo acima do teto não é 'baseline frouxa' (é violação, com mensagem própria)", () => {
    expect(baselineDesatualizada({}, { "a.ts": 300 })).toBe(false);
  });
});
