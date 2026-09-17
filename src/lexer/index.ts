import { UnexpectedEOS, UnexpectedInput, type Parser } from "../parser";
import { eos, type Stream } from "../stream";
import { createForToken } from "../combinators";
import type { UnionToIntersection } from "type-fest";

export type TokenNames<T> = keyof T;

type TokenType<T> = T extends { [K in keyof T]: unknown }
  ? {
      [K in keyof T]: [
        K,
        T[K] extends string ? T[K] : T[K] extends RegExp ? string : never,
      ];
    }[keyof T]
  : never;

export class Lexer<T extends Record<any, string | RegExp>> {
  constructor(public readonly def: T) {}

  *tokenize(input: string): Iterable<TokenType<T>> {
    let cursor = 0;
    while (cursor < input.length) {
      let matched = false;
      for (const [name, match] of Object.entries(this.def)) {
        if (typeof match === "string") {
          if (match === input.substring(cursor, cursor + match.length)) {
            yield [name, match] as TokenType<T>;
            cursor += match.length;
            matched = true;
            break;
          } else continue;
        } else if (match instanceof RegExp) {
          const r = new RegExp(match, "y");
          r.lastIndex = cursor;
          const m = input.match(r);
          if (m !== null) {
            yield [name, m[0]] as TokenType<T>;
            cursor += m[0].length;
            matched = true;
            break;
          }
        }
      }
      if (!matched)
        throw new Error(
          `failed to match token: '${input.substring(cursor, cursor + 10)}'`,
        );
    }
  }
}

export type TokenValues<T extends readonly [string, unknown]> =
  UnionToIntersection<
    T extends readonly [infer N extends string, infer V]
      ? { [K in N]: V }
      : never
  >;

export type ExtractNames<T extends readonly [string, unknown]> =
  T extends readonly [infer N extends string, unknown] ? N : never;

const createTokenFn =
  <T extends readonly [string, unknown]>() =>
  <Name extends ExtractNames<T>>(
    name: Name,
  ): Parser<TokenValues<T>[Name], T> => {
    return (stream) => {
      const tok = stream.peek();
      if (tok === eos) return new UnexpectedEOS();
      else if (tok[0] === name)
        return [tok[1] as TokenValues<T>[Name], stream.consume()];
      else return new UnexpectedInput();
    };
  };

export function createCombinators<T extends readonly [string, unknown]>() {
  return {
    token: createTokenFn<T>(),
    ...createForToken<T>(),
  };
}

export class TokenStream<T extends [string, unknown]> implements Stream<T> {
  constructor(
    public readonly tokens: T[],
    public cursor: number = 0,
  ) {}

  consume() {
    return new TokenStream<T>(this.tokens, this.cursor + 1);
  }

  peek() {
    const value = this.tokens[this.cursor];
    if (value === undefined) return eos;
    const [n, v, _] = value;
    return [n, v] as T;
  }
}
