// Paleta de rótulos de cor (conversa/projeto). Guarda o HEX direto no banco;
// cores fixas entre temas (convenção Linear/Notion). null = sem cor.
export interface LabelColor {
  id: string
  name: string
  hex: string
}

export const LABEL_COLORS: LabelColor[] = [
  { id: "red", name: "Vermelho", hex: "#f87171" },
  { id: "amber", name: "Âmbar", hex: "#fbbf24" },
  { id: "green", name: "Verde", hex: "#34d399" },
  { id: "blue", name: "Azul", hex: "#60a5fa" },
  { id: "purple", name: "Roxo", hex: "#a78bfa" },
  { id: "pink", name: "Rosa", hex: "#f472b6" },
]
