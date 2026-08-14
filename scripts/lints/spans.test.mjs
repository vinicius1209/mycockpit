import { describe, expect, it } from "vitest";

import { lineAt, podeAbrirRegex, splitSpans } from "./spans.mjs";

const tipos = (source) => splitSpans(source).map((s) => `${s.kind}:${s.text}`);
const textoDe = (source, kind) =>
  splitSpans(source)
    .filter((s) => s.kind === kind)
    .map((s) => s.text);

describe("fatiamento de fonte", () => {
  it("separa comentário de linha do código", () => {
    expect(tipos("const a = 1 // nota")).toEqual(["code:const a = 1 ", "comment:// nota"]);
  });

  it("separa comentário de bloco, inclusive JSDoc", () => {
    expect(textoDe("/** doc — aqui */\nconst a = 1", "comment")).toEqual(["/** doc — aqui */"]);
  });

  it("reconhece string de aspa simples e dupla", () => {
    expect(textoDe(`const a = "um"; const b = 'dois'`, "string")).toEqual(['"um"', "'dois'"]);
  });

  it("não deixa aspa não fechada engolir o arquivo", () => {
    const spans = splitSpans("const a = 'nao fecha\nconst b = 2");
    expect(spans.at(-1).text).toContain("const b = 2");
  });

  it("volta ao código dentro da interpolação de template", () => {
    const source = "const a = `oi ${nome} tudo bem`";
    expect(textoDe(source, "string")).toEqual(["`oi ", " tudo bem`"]);
    expect(textoDe(source, "code").join("")).toContain("nome");
  });

  it("aguenta interpolação com objeto dentro (a chave do `${` não conta na profundidade)", () => {
    const source = "const a = `x ${f({ k: 1 })} y`\nconst depois = 2";
    expect(textoDe(source, "string")).toEqual(["`x ", " y`"]);
    expect(textoDe(source, "code").join("")).toContain("const depois = 2");
  });

  it("aguenta template aninhado dentro da interpolação", () => {
    const source = "const a = `x ${`y ${z}`} w`";
    expect(splitSpans(source).at(-1).text).toBe(" w`");
  });
});

describe("literal de regex", () => {
  it("é região própria, não string, mesmo carregando crase", () => {
    // Este é o caso real de `messageNodes.ts`: a crase dentro da classe de
    // caracteres abria uma template string e desandava o resto do arquivo.
    const source = "if (/[#>\\-*+`|]/u.test(first)) return false\nconst depois = 1";
    expect(textoDe(source, "regex")).toEqual(["/[#>\\-*+`|]/u"]);
    expect(textoDe(source, "string")).toEqual([]);
    expect(textoDe(source, "code").join("")).toContain("const depois = 1");
  });

  it("aguenta aspa dentro de classe de caracteres", () => {
    const source = `const re = /['"]/g\nconst depois = 1`;
    expect(textoDe(source, "regex")).toEqual([`/['"]/g`]);
    expect(textoDe(source, "code").join("")).toContain("const depois = 1");
  });

  it("divisão não vira regex", () => {
    const source = "const media = total / n / 2";
    expect(textoDe(source, "regex")).toEqual([]);
  });

  it("a barra de tag JSX fechando não vira regex", () => {
    const source = "<div>texto</div>";
    expect(textoDe(source, "regex")).toEqual([]);
  });

  it("a barra de tag JSX auto-fechada depois de prop não vira regex", () => {
    const source = "<Foo bar={x} />\n<p>texto</p>";
    expect(textoDe(source, "regex")).toEqual([]);
  });
});

describe("contexto que decide se um regex pode abrir", () => {
  it("depois de operador ou abertura, pode", () => {
    expect(podeAbrirRegex("=", "")).toBe(true);
    expect(podeAbrirRegex("(", "")).toBe(true);
    expect(podeAbrirRegex("", "")).toBe(true);
  });

  it("depois de valor, não pode (é divisão)", () => {
    expect(podeAbrirRegex("a", "total")).toBe(false);
    expect(podeAbrirRegex(")", "")).toBe(false);
    expect(podeAbrirRegex("]", "")).toBe(false);
  });

  it("depois de palavra-chave, pode", () => {
    expect(podeAbrirRegex("n", "return")).toBe(true);
    expect(podeAbrirRegex("f", "typeof")).toBe(true);
  });

  it("`<` fica de fora de propósito, porque em TSX quase sempre é tag fechando", () => {
    expect(podeAbrirRegex("<", "")).toBe(false);
  });
});

describe("número da linha", () => {
  it("é 1-based e conta as quebras anteriores", () => {
    const source = "a\nb\nc";
    expect(lineAt(source, 0)).toBe(1);
    expect(lineAt(source, 2)).toBe(2);
    expect(lineAt(source, 4)).toBe(3);
  });
});
