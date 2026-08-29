import { invoke } from "@tauri-apps/api/core"

export interface OpenCodeCredential {
  provider: string
  providerId: string
  authKind: string
}

export function listOpenCodeCredentials(): Promise<OpenCodeCredential[]> {
  return invoke("opencode_credentials")
}

export function loginOpenCodeApiKey(provider: string, apiKey: string): Promise<void> {
  return invoke("opencode_login_api_key", { provider, apiKey })
}

export function loginOpenCodeOAuth(provider: string, method: string): Promise<void> {
  return invoke("opencode_login_oauth", { provider, method })
}

export function logoutOpenCode(provider: string): Promise<void> {
  return invoke("opencode_logout", { provider })
}
