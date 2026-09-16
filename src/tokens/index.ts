import type { UnionToIntersection } from "type-fest";
import { UnexpectedEOS, UnexpectedInput, type Parser } from "../parser";
import { eos } from "../stream";

export type TokenDef<Name extends string, T = string> = {
  readonly name: Name;
  readonly match: RegExp | string;
  readonly mapFn?: (arg: string) => T;
};

export type TokenType<Ts extends readonly TokenDef<any, unknown>[]> =
  Ts extends readonly [
    infer T extends TokenDef<any, unknown>,
    ...infer Rest extends readonly TokenDef<any, unknown>[],
  ]
    ? | [T["name"], T["mapFn"] extends (arg: string) => infer T ? T : string]
      | TokenType<Rest>
    : never;

export type TokenizerOutput<T extends readonly TokenDef<any, unknown>[]> = [
  ...TokenType<T>,
  number,
];

export class Tokenizer<const T extends readonly TokenDef<any, unknown>[]> {
  constructor(public readonly def: T) {}

  *tokenize(input: string): Iterable<TokenizerOutput<T>> {
    let cursor = 0;
    while (cursor < input.length) {
      let matched = false;
      for (const { name, match, mapFn } of this.def) {
        if (typeof match === "string") {
          if (match === input.substring(cursor, cursor + match.length)) {
            yield [
              ...([name, mapFn ? mapFn(match) : match] as TokenType<T>),
              cursor,
            ];
            cursor += match.length;
            matched = true;
            break;
          } else continue;
        } else if (match instanceof RegExp) {
          const r = new RegExp(match, "y");
          r.lastIndex = cursor;
          const m = input.match(r);
          if (m !== null) {
            yield [
              ...([
                name,
                mapFn !== undefined ? mapFn(m[0]) : m[0],
              ] as TokenType<T>),
              cursor,
            ];
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

export const createTokenFn =
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
