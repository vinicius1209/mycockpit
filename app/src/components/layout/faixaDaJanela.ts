// Faixa da janela: como a janela usa titleBarStyle: "Overlay", os botões
// de fechar, minimizar e expandir desenham por cima do conteúdo.
// Quem ocupa esse canto superior esquerdo deve reservar esta faixa.
// Strings literais para o Tailwind varrer o fonte.

/** Altura da faixa. Os botões são centrados nela pelo Rust
 *  (`TRAFFIC_LIGHTS_Y` em `src-tauri/src/lib.rs`, calibrado para 56px): mudar
 *  um sem o outro descentraliza os botões. */
export const ALTURA_DA_FAIXA = "h-14"

/** O recuo à esquerda que deixa os três botões livres. */
export const RECUO_DOS_BOTOES = "pl-20"
