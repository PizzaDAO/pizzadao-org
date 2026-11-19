export function isValidEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export function isValidSolanaAddress(addr: string): boolean {
  // Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, I, O, l)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}
