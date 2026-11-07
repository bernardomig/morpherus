import { UnexpectedEOS, UnexpectedInput, type Parser } from "../parser";
import { eos, type EOS, type Stream } from "../stream";
import { createForToken } from "../combinators";
import type { UnionToIntersection } from "type-fest";

export type TokenNames<T> = keyof T;

type TokenType<T> = T extends { [K in keyof T]: unknown }
  ? {
      [K in keyof T]: [K, T[K] extends string ? T[K] : T[K] extends RegExp ? string : never];
    }[keyof T]
  : never;

export class Lexer<T extends Record<any, string | RegExp>> {
  private readonly rules: Array<[string, string | RegExp]>;

  constructor(public readonly def: T) {
    this.rules = Object.entries(def).map(([name, match]) => {
      if (typeof match === "string") {
        if (match.length === 0) {
          throw new Error(`Lexer rule '${name}' cannot be an empty string`);
        }
        return [name, match];
      }
      const flags = match.flags.includes("y") ? match.flags : `${match.flags}y`;
      return [name, new RegExp(match.source, flags)];
    });
  }

  *tokenize(input: string): Iterable<TokenType<T>> {
    let cursor = 0;
    while (cursor < input.length) {
      let matched = false;
      for (const [name, match] of this.rules) {
        if (typeof match === "string") {
          if (input.startsWith(match, cursor)) {
            yield [name, match] as TokenType<T>;
            cursor += match.length;
            matched = true;
            break;
          }
        } else {
          match.lastIndex = cursor;
          const m = match.exec(input);
          if (m !== null && m[0].length > 0) {
            yield [name, m[0]] as TokenType<T>;
            cursor += m[0].length;
            matched = true;
            break;
          }
        }
      }
      if (!matched)
        throw new Error(`failed to match token: '${input.substring(cursor, cursor + 10)}'`);
    }
  }
}

export type TokenValues<T extends readonly [string, unknown]> = UnionToIntersection<
  T extends readonly [infer N extends string, infer V] ? { [K in N]: V } : never
>;

export type ExtractNames<T extends readonly [string, unknown]> = T extends readonly [
  infer N extends string,
  unknown,
]
  ? N
  : never;

const createTokenFn =
  <T extends readonly [string, unknown]>() =>
  <Name extends ExtractNames<T>>(name: Name): Parser<TokenValues<T>[Name], T> => {
    return (stream) => {
      const tok = stream.peek();
      if (tok === eos) return new UnexpectedEOS(stream.position, undefined, undefined, name);
      else if (tok[0] === name) return [tok[1] as TokenValues<T>[Name], stream.consume()];
      else return new UnexpectedInput(stream.position, undefined, undefined, name);
    };
  };

export function createCombinators<T extends readonly [string, unknown]>() {
  return {
    token: createTokenFn<T>(),
    ...createForToken<T>(),
  };
}

export class TokenStream<T extends [string, unknown]> implements Stream<T, T[]> {
  constructor(
    public readonly tokens: T[],
    public readonly position: number = 0,
  ) {}

  peek(): T | EOS;
  peek(n: number): T[] | EOS;
  peek(n = 1): T | T[] | EOS {
    if (n === 1) {
      const value = this.tokens[this.position];
      if (value === undefined) return eos;
      const [name, v] = value;
      return [name, v] as T;
    }
    if (this.position + n > this.tokens.length) return eos;
    return this.tokens.slice(this.position, this.position + n);
  }

  consume(): TokenStream<T>;
  consume(n: number): TokenStream<T>;
  consume(n = 1): TokenStream<T> {
    if (n === 0) return this;
    return new TokenStream<T>(this.tokens, this.position + n);
  }
}
