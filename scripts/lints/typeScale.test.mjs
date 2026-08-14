import { describe, expect, it } from "vitest";

import {
  acharViolacoesDeEscala,
  ESCALA,
  estaNaEscala,
  explicarViolacao,
  isPrimitiveUi,
  paradaMaisProxima,
  paraPx,
} from "./typeScale.mjs";

describe("parser de tamanho de fonte", () => {
  it("lê px como está", () => {
    expect(paraPx("13", "px")).toBe(13);
  });

  it("converte rem e em pela raiz de 16px", () => {
    expect(paraPx("0.6875", "rem")).toBe(11);
    expect(paraPx("0.875", "em")).toBe(14);
  });

  it("devolve null pra unidade que não sabe converter", () => {
    expect(paraPx("2", "vw")).toBeNull();
    expect(paraPx("abc", "px")).toBeNull();
  });

  it("reconhece as 7 paradas da escala e recusa o meio-pixel", () => {
    for (const parada of ESCALA) expect(estaNaEscala(parada)).toBe(true);
    expect(estaNaEscala(11.5)).toBe(false);
    expect(estaNaEscala(15)).toBe(false);
  });
});

describe("parada mais próxima", () => {
  it("repete o mapa de migração do §3 em vez de inventar régua própria", () => {
    expect(paradaMaisProxima(9.5)).toBe(11);
    expect(paradaMaisProxima(10.5)).toBe(11);
    expect(paradaMaisProxima(11.5)).toBe(12);
    expect(paradaMaisProxima(12.5)).toBe(13);
    expect(paradaMaisProxima(15)).toBe(14);
    expect(paradaMaisProxima(17)).toBe(14);
    expect(paradaMaisProxima(19)).toBe(20);
    expect(paradaMaisProxima(34)).toBe(30);
  });

  it("fora do mapa cai na parada mais próxima", () => {
    expect(paradaMaisProxima(18)).toBe(20);
    expect(paradaMaisProxima(14.4)).toBe(14);
    expect(paradaMaisProxima(28)).toBe(30);
  });

  it("no empate desce, porque ênfase se faz com peso e não com tamanho", () => {
    expect(paradaMaisProxima(25)).toBe(20);
  });
});

describe("varredura de escala", () => {
  it("deixa passar as 7 paradas em px", () => {
    const src = ESCALA.map((px) => `text-[${px}px]`).join(" ");
    expect(acharViolacoesDeEscala(src, "components/chat/X.tsx")).toEqual([]);
  });

  it("acusa px fora da escala dizendo a parada mais próxima", () => {
    const [violacao] = acharViolacoesDeEscala('className="text-[15px]"', "components/chat/X.tsx");
    expect(violacao.tipo).toBe("px-fora-da-escala");
    expect(violacao.px).toBe(15);
    expect(violacao.alvo).toBe(14);
  });

  it("acusa rem arbitrário no utilitário, que re-fragmenta igual ao px", () => {
    const [violacao] = acharViolacoesDeEscala('className="text-[0.9rem]"', "components/chat/X.tsx");
    expect(violacao.tipo).toBe("unidade-arbitraria");
    expect(violacao.alvo).toBe(14);
  });

  it("acusa rem no utilitário mesmo quando o valor bate numa parada", () => {
    const hits = acharViolacoesDeEscala('className="text-[0.6875rem]"', "components/chat/X.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].px).toBe(11);
  });

  it("aceita rem em CSS quando o px equivalente está na escala", () => {
    expect(acharViolacoesDeEscala(".label-mono { font-size: 0.6875rem; }", "index.css")).toEqual([]);
  });

  it("acusa font-size em px fora da escala", () => {
    const [violacao] = acharViolacoesDeEscala(".x { font-size: 15px; }", "index.css");
    expect(violacao.tipo).toBe("css");
    expect(violacao.alvo).toBe(14);
  });

  it("não confunde custom property com font-size", () => {
    expect(acharViolacoesDeEscala(".x { --font-size: 15px; }", "index.css")).toEqual([]);
  });

  it("não confunde cor arbitrária com tamanho", () => {
    expect(acharViolacoesDeEscala('className="text-[#D97757] text-[var(--x)]"', "components/common/AgentLogo.tsx")).toEqual([]);
  });

  it("acusa classe nomeada do Tailwind em componente do app", () => {
    const [violacao] = acharViolacoesDeEscala('className="text-sm"', "components/chat/X.tsx");
    expect(violacao.tipo).toBe("classe-tailwind");
  });

  it("deixa a classe nomeada passar nos primitives shadcn", () => {
    expect(isPrimitiveUi("components/ui/button.tsx")).toBe(true);
    expect(acharViolacoesDeEscala('className="text-sm"', "components/ui/button.tsx")).toEqual([]);
  });

  it("não confunde text-start nem text-shadow com tamanho", () => {
    expect(acharViolacoesDeEscala('className="text-start text-shadow-sm"', "components/chat/X.tsx")).toEqual([]);
  });

  it("reporta a linha da ocorrência", () => {
    const src = 'linha1\nlinha2\nclassName="text-[15px]"';
    expect(acharViolacoesDeEscala(src, "components/chat/X.tsx")[0].linha).toBe(3);
  });
});

describe("mensagem de erro", () => {
  it("diz arquivo, linha, valor achado e o alvo da escala", () => {
    const [violacao] = acharViolacoesDeEscala('\n\nclassName="text-[15px]"', "components/chat/X.tsx");
    const texto = explicarViolacao({ relPath: "components/chat/X.tsx", ...violacao });
    expect(texto).toContain("components/chat/X.tsx:3");
    expect(texto).toContain("text-[15px]");
    expect(texto).toContain("14px");
  });

  it("mostra o px equivalente quando o valor veio em rem", () => {
    const [violacao] = acharViolacoesDeEscala('className="text-[0.9rem]"', "components/chat/X.tsx");
    const texto = explicarViolacao({ relPath: "components/chat/X.tsx", ...violacao });
    expect(texto).toContain("14.4px");
    expect(texto).toContain("text-[14px]");
  });
});
