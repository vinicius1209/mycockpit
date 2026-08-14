/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BETA_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
