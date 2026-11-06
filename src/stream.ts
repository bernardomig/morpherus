export const eos: unique symbol = Symbol();
export type EOS = typeof eos;

export interface Stream<T> {
  readonly position: number;
  peek(): T | EOS;
  consume(): Stream<T>;
}
