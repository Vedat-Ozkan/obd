// Verbatim from docs/ARCHITECTURE.md "Core interfaces".
export interface Transport {
  /** Send raw bytes. Resolves when the bytes are handed to the underlying layer. */
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to incoming bytes. Chunk boundaries are meaningless. */
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
  /** true only when the far end cannot be mid-command when a session starts (a recording replay).
   *  Unset: the session assumes the ELM may be busy (docs/ELM327.md §Write safety). */
  readonly startsIdle?: boolean;
}
