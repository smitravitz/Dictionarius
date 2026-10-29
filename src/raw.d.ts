/** Vite's `?raw` imports: the file's text. */
declare module "*?raw" {
  const text: string;
  export default text;
}

/** The brotli package's decoder (pure JavaScript, MIT): compressed bytes in, bytes out. */
declare module "brotli/decompress.js" {
  export default function decompress(compressed: Uint8Array, outputSize?: number): Uint8Array;
}
