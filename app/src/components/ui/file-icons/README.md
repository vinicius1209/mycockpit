# Ícones de tipo de arquivo

Subconjunto do [Symbols](https://github.com/miguelsolorio/vscode-symbols)
(Miguel Solorio, MIT, licença em `LICENSE.symbols`), no commit
`296ef1b62287fb2315cb5651e552e09e8c8e1de8`. Chegou pelo estudo do Zeron
(`docs/competitors-zeron.md`), que embute o mesmo conjunto.

A única porta é `components/ui/file-icon.tsx` (ADR-241). Ícone novo entra aqui
como SVG cru, sem `width`/`height` no `<svg>` raiz, e ganha linha no mapa de
extensões dela. As cores são as do autor; o tema escuro clareia a paleta por
substituição de hex, na mesma primitiva.
