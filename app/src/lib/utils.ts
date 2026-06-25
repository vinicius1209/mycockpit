import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Abrevia o $HOME do usuário para "~" em caminhos exibidos. */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~")
}
