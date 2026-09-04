/** SHA-256 em hex. WebCrypto existe no WebView e no ambiente de teste atual. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function stableClaimId(
  kind: string,
  text: string,
  evidenceIds: readonly string[],
): Promise<string> {
  const raw = [kind, text, [...evidenceIds].sort().join("\u0000")].join("\u0000")
  return `claim_${(await sha256Hex(raw)).slice(0, 16)}`
}
