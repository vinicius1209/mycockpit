/**
 * Fatiador de fonte TS/TSX em regiões: código, comentário e literal de string.
 *
 * Existe porque a guarda de copy (§7 do STYLEGUIDE: sem travessão em prosa de
 * UI) precisa distinguir "—" que o usuário LÊ de "—" que só o dev lê. O repo
 * usa travessão à vontade em comentário e em JSDoc; proibir por grep cru daria
 * centenas de falsos positivos e a guarda morreria no primeiro dia.
 *
 * Não é um parser de verdade e não precisa ser: só precisa saber, para cada
 * caractere, se ele está dentro de comentário, dentro de literal ou solto no
 * corpo (onde texto JSX vive).
 *
 * O ponto delicado é o `/`: ambíguo entre divisão, comentário e literal de
 * regex. Literal de regex PRECISA ser reconhecido, porque o repo tem
 * `/[#>\-*+`|]/u` — a crase ali dentro abria uma template string e desandava o
 * resto do arquivo (era assim que 800 travessões de comentário viravam falso
 * positivo). A heurística é a clássica (o caractere significativo anterior diz
 * se um valor pode começar ali) com uma trava a mais: só vale como regex se
 * fechar na MESMA linha. Sem a trava, o `/` de `</div>` e de `{x} />` engolia
 * o resto da linha de JSX.
 */

/**
 * @typedef {{kind: "code"|"comment"|"string"|"regex", start: number, end: number, text: string}} Span
 */

// Um regex pode começar quando o anterior não é um valor. `<` fica DE FORA de
// propósito: em TSX ele quase sempre é o `</` de tag fechando.
const ANTES_DE_REGEX = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", ">", "~", "^",
]);
const PALAVRAS_ANTES_DE_REGEX = new Set([
  "return", "typeof", "instanceof", "in", "of", "case", "do", "else", "yield", "await", "delete",
  "void", "new", "throw",
]);

/**
 * @param {string} ultimoChar último caractere significativo do código
 * @param {string} ultimaPalavra identificador imediatamente anterior
 */
export function podeAbrirRegex(ultimoChar, ultimaPalavra) {
  if (PALAVRAS_ANTES_DE_REGEX.has(ultimaPalavra)) return true;
  if (/[A-Za-z0-9_$)\]]/.test(ultimoChar)) return false;
  return ultimoChar === "" || ANTES_DE_REGEX.has(ultimoChar);
}

/**
 * Divide o fonte em regiões contíguas.
 *
 * @param {string} source
 * @returns {Span[]}
 */
export function splitSpans(source) {
  /** @type {Span[]} */
  const spans = [];
  let codeStart = 0;
  let index = 0;

  const pushCode = (end) => {
    if (end > codeStart) {
      spans.push({
        kind: "code",
        start: codeStart,
        end,
        text: source.slice(codeStart, end),
      });
    }
  };
  const pushRegion = (kind, start, end) => {
    spans.push({ kind, start, end, text: source.slice(start, end) });
    codeStart = end;
  };

  // Pilha de templates abertos: cada `${` dentro de uma template string volta
  // ao modo código, e o `}` que fecha volta à template. Sem isso, um
  // `` `texto ${x} texto` `` engoliria o resto do arquivo como string.
  /** @type {number[]} */
  const templateBraceDepth = [];

  // Contexto pra desambiguar o `/`. Depois de string, regex ou comentário o
  // "anterior" vira um valor (`"` faz as vezes), então ali `/` é divisão.
  let ultimoChar = "";
  let ultimaPalavra = "";
  const marcarValor = () => {
    ultimoChar = '"';
    ultimaPalavra = "";
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      pushCode(index);
      let end = source.indexOf("\n", index);
      if (end === -1) end = source.length;
      pushRegion("comment", index, end);
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      pushCode(index);
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      pushRegion("comment", index, end);
      index = end;
      continue;
    }

    if (char === "/" && podeAbrirRegex(ultimoChar, ultimaPalavra)) {
      const fim = scanRegex(source, index);
      if (fim != null) {
        pushCode(index);
        pushRegion("regex", index, fim);
        index = fim;
        marcarValor();
        continue;
      }
      // Não fechou na linha: não era regex (é o `/` de `</div>` ou de `/>`).
    }

    if (char === '"' || char === "'") {
      pushCode(index);
      const end = scanQuoted(source, index, char);
      pushRegion("string", index, end);
      index = end;
      marcarValor();
      continue;
    }

    if (char === "`") {
      pushCode(index);
      const stop = scanTemplateChunk(source, index + 1);
      pushRegion("string", index, stop.end);
      codeStart = stop.resume;
      index = stop.resume;
      marcarValor();
      if (stop.reason === "interpolation") {
        templateBraceDepth.push(0);
      }
      continue;
    }

    if (templateBraceDepth.length > 0) {
      if (char === "{") {
        templateBraceDepth[templateBraceDepth.length - 1] += 1;
      } else if (char === "}") {
        if (templateBraceDepth[templateBraceDepth.length - 1] === 0) {
          // Fecha o `${`: o texto a seguir volta a ser template.
          templateBraceDepth.pop();
          pushCode(index + 1);
          const stop = scanTemplateChunk(source, index + 1);
          pushRegion("string", index + 1, stop.end);
          codeStart = stop.resume;
          index = stop.resume;
          marcarValor();
          if (stop.reason === "interpolation") {
            templateBraceDepth.push(0);
          }
          continue;
        }
        templateBraceDepth[templateBraceDepth.length - 1] -= 1;
      }
    }

    // Espaço em branco não mexe no contexto: `const re =\n  /x/` precisa
    // lembrar do `=`, e `return /x/` precisa lembrar da palavra.
    if (/[A-Za-z0-9_$]/.test(char)) {
      if (!/[A-Za-z0-9_$]/.test(ultimoChar)) ultimaPalavra = "";
      ultimaPalavra += char;
      ultimoChar = char;
    } else if (!/\s/.test(char)) {
      ultimaPalavra = "";
      ultimoChar = char;
    }

    index += 1;
  }

  pushCode(source.length);
  return spans;
}

/**
 * Fim de um literal de regex que abre em `openIndex`, incluindo as flags.
 * `null` quando não fecha na mesma linha, e aí não era regex.
 *
 * @param {string} source
 * @param {number} openIndex
 * @returns {number|null}
 */
function scanRegex(source, openIndex) {
  let index = openIndex + 1;
  let dentroDeClasse = false;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\n") return null;
    if (dentroDeClasse) {
      if (char === "]") dentroDeClasse = false;
    } else if (char === "[") {
      dentroDeClasse = true;
    } else if (char === "/") {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index])) index += 1;
      return index;
    }
    index += 1;
  }
  return null;
}

function scanQuoted(source, openIndex, quote) {
  let index = openIndex + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    // String de aspa simples/dupla não atravessa linha em fonte válido; se
    // atravessou, o scanner errou em algum ponto anterior e é melhor cortar
    // aqui do que engolir o arquivo inteiro.
    if (char === "\n") return index;
    index += 1;
  }
  return source.length;
}

function scanTemplateChunk(source, from) {
  let index = from;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") return { end: index + 1, reason: "close", resume: index + 1 };
    if (char === "$" && source[index + 1] === "{") {
      // `resume` pula o `${` inteiro: a chave que abre a interpolação NÃO
      // conta na profundidade, senão o `}` que fecha nunca é reconhecido e o
      // scanner desanda o resto do arquivo (era este o bug).
      return { end: index, reason: "interpolation", resume: index + 2 };
    }
    index += 1;
  }
  return { end: source.length, reason: "close", resume: source.length };
}

/**
 * Número da linha (1-based) de um offset.
 *
 * @param {string} source
 * @param {number} offset
 */
export function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}
