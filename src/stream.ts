export const eos: unique symbol = Symbol();
export type EOS = typeof eos;

export interface Stream<T> {
  peek(): T | EOS;
  consume(): Stream<T>;
}
