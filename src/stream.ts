export const eos: unique symbol = Symbol();
export type EOS = typeof eos;

export interface Stream<T> {
  peek(n?: number): T | EOS;
  consume(n?: number): Stream<T>;
}
