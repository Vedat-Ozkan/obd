// Verbatim from docs/ARCHITECTURE.md "Core interfaces".
export interface Transport {
  /** Send raw bytes. Resolves when the bytes are handed to the underlying layer. */
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to incoming bytes. Chunk boundaries are meaningless. */
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
}
