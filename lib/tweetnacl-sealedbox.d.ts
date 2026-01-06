declare module "tweetnacl-sealedbox-js" {
  export function seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array
  export function open(
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null
  export const overheadLength: number
}
