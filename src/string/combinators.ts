import { createForToken } from "../combinators";
import { UnexpectedEOS, UnexpectedInput, type Parser } from "../parser";
import { eos, type Stream } from "../stream";

const {
  between,
  bind,
  chainl1,
  chainr1,
  endBy,
  endBy1,
  eof,
  fail,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  label,
  lookAhead,
  many,
  map,
  notFollowedBy,
  oneOf,
  optional,
  pratt,
  pure,
  ref,
  sepBy,
  sepBy1,
  sepEndBy,
  sepEndBy1,
  seq,
  some,
} = createForToken<string>();

export {
  between,
  bind,
  chainl1,
  chainr1,
  endBy,
  endBy1,
  eof,
  fail,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  label,
  lookAhead,
  many,
  map,
  notFollowedBy,
  oneOf,
  optional,
  pratt,
  pure,
  ref,
  sepBy,
  sepBy1,
  sepEndBy,
  sepEndBy1,
  seq,
  some,
};

export function string<T extends string>(
  input: T,
  { caseSensitive = true }: { caseSensitive?: boolean } = {},
): Parser<T, string> {
  const folded = caseSensitive ? input : input.toLowerCase();
  return (stream: Stream<string, string>) => {
    // Fast path: compare the whole chunk in one slice, allocating a single
    // stream instead of one per character.
    const chunk = stream.peek(input.length);
    if (chunk !== eos && (caseSensitive ? chunk === input : chunk.toLowerCase() === folded)) {
      return [input, stream.consume(input.length)];
    }
    // Slow path: walk character-by-character to report the exact failure position.
    let s = stream;
    for (let i = 0; i < input.length; i++) {
      const val = s.peek();
      if (val === eos) return new UnexpectedEOS(s.position, undefined, undefined, input);
      const target = input[i]!;
      if (caseSensitive ? val !== target : val.toLowerCase() !== target.toLowerCase())
        return new UnexpectedInput(s.position, undefined, undefined, input);
      s = s.consume();
    }
    return [input, s];
  };
}

export type VectorEnum<Ts extends string[]> = Ts extends [
  infer T,
  infer Snd extends string,
  ...infer R extends string[],
]
  ? T | VectorEnum<[Snd, ...R]>
  : Ts extends [infer T]
    ? T
    : never;

/**
 * Matches one of the given literal strings.
 *
 * Alternatives are tried **longest-first**, so a shorter value cannot shadow a
 * longer one that shares its prefix (e.g. `["let", "letter"]` tries `"letter"`
 * before `"let"`). Equal-length values keep their declaration order.
 */
export function enumOf<Ts extends [string, ...string[]]>(
  values: readonly [...Ts],
  opts: { caseSensitive?: boolean } = {},
): Parser<VectorEnum<Ts>, string> {
  const sorted = [...values].sort((a, b) => b.length - a.length);
  return oneOf(
    sorted.map((x) => string(x, opts)) as [Parser<string, string>, ...Parser<string, string>[]],
  ) as Parser<VectorEnum<Ts>, string>;
}

function isDigit(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57; // 0-9
}

function isLetter(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // A-Z or a-z
}

function isAlphanum(char: string): boolean {
  return isDigit(char) || isLetter(char);
}

/**
 * Matches a single character satisfying `testFn`. An optional `description` is
 * reported as the expected input on failure (defaults to `"character"`), so
 * errors never carry empty messages.
 */
export function satisfies(
  testFn: (arg: string) => boolean,
  description?: string,
): Parser<string, string> {
  const expected = description ?? "character";
  return (stream) => {
    const out = stream.peek();
    if (out === eos) return new UnexpectedEOS(stream.position, undefined, undefined, expected);
    if (testFn(out)) return [out, stream.consume()];
    return new UnexpectedInput(stream.position, undefined, undefined, expected);
  };
}

export const digit = label(satisfies(isDigit), "digit");
export const letter = label(satisfies(isLetter), "letter");
export const alpha = label(satisfies(isAlphanum), "alphanumeric");
