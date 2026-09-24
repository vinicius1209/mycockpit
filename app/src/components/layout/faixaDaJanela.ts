// A FAIXA DA JANELA: a janela usa a barra de título em overlay
// (`titleBarStyle: "Overlay"` em `tauri.conf.json`), então os botões de
// fechar, minimizar e expandir são desenhados POR CIMA do conteúdo, no canto
// de cima à esquerda. Quem ocupa esse canto reserva a mesma faixa que a barra
// do app, senão o conteúdo fica embaixo dos botões (o visualizador de imagem
// ficou, com o nome do arquivo sob eles, em 24/09/2026).
//
// Strings literais de propósito: o Tailwind varre o texto do fonte.

/** Altura da faixa. Os botões são centrados nela pelo Rust
 *  (`TRAFFIC_LIGHTS_Y` em `src-tauri/src/lib.rs`, calibrado para 56px): mudar
 *  um sem o outro descentraliza os botões. */
export const ALTURA_DA_FAIXA = "h-14"

/** O recuo à esquerda que deixa os três botões livres. */
export const RECUO_DOS_BOTOES = "pl-20"
