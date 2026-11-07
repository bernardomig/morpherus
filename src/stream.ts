export const eos: unique symbol = Symbol();
export type EOS = typeof eos;

/**
 * An immutable input stream of `T` items.
 *
 * `C` is the "chunk" type returned by `peek(n)`: the result of reading `n`
 * items at once. For `StringStream` this is `string` (a slice of the input),
 * for token streams it is `T[]`. It defaults to `T[]`, and generic combinators
 * use `Stream<Tok, any>` so that any chunk type can flow through them.
 */
export interface Stream<T, C> {
  readonly position: number;
  /** Returns the next item, or `eos` at end of stream. */
  peek(): T | EOS;
  /**
   * Returns the next `n` items as a single chunk, or `eos` if fewer than `n`
   * items remain. `n` must be a positive integer; a successful result always
   * contains exactly `n` items.
   */
  peek(n: number): C | EOS;
  /** Returns a new stream advanced by one item. */
  consume(): Stream<T, C>;
  /**
   * Returns a new stream advanced by `n` items. `consume(0)` returns the same
   * stream instance, preserving reference-equality zero-progress checks.
   */
  consume(n: number): Stream<T, C>;
}
