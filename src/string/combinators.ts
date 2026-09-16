import { createForToken } from "../combinators";
import { UnexpectedEOS, UnexpectedInput, type Parser } from "../parser";
import { eos } from "../stream";

const {
  between,
  bind,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  many,
  map,
  oneOf,
  optional,
  ref,
  sepBy,
  seq,
  some,
} = createForToken<string>();

export {
  between,
  bind,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  many,
  map,
  oneOf,
  optional,
  ref,
  sepBy,
  seq,
  some,
};

export function char<T extends string>(
  input: T,
  { caseSensitive = true }: { caseSensitive?: boolean } = {},
): Parser<T, string> {
  if (input.length !== 1)
    throw new Error(
      `'input' argument to string/char must be a single character`,
    );
  return (stream) => {
    const val = stream.peek();
    if (val === eos) return new UnexpectedEOS();
    if (
      caseSensitive ? val !== input : val.toLowerCase() !== input.toLowerCase()
    )
      return new UnexpectedInput();
    return [input, stream.consume()];
  };
}

export function string<T extends string>(
  input: T,
  { caseSensitive = true }: { caseSensitive?: boolean } = {},
): Parser<T, string> {
  return (stream) => {
    const val = stream.peek(input.length);
    if (val === eos) return new UnexpectedEOS();
    if (
      caseSensitive ? val !== input : val.toLowerCase() !== input.toLowerCase()
    )
      return new UnexpectedInput();
    return [input, stream.consume(input.length)];
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

export function enumOf<Ts extends [string, ...string[]]>(
  values: readonly [...Ts],
  opts: { caseSensitive?: boolean } = {},
): Parser<VectorEnum<Ts>, string> {
  return oneOf(
    values.map((x) => string(x, opts)) as [
      Parser<string, string>,
      ...Parser<string, string>[],
    ],
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

export function satisfies(
  testFn: (arg: string) => boolean,
): Parser<string, string> {
  return (stream) => {
    const out = stream.peek();
    if (out === eos) return new UnexpectedEOS();
    if (testFn(out)) return [out, stream.consume()];
    return new UnexpectedInput();
  };
}

export const digit = satisfies(isDigit);
export const letter = satisfies(isLetter);
export const alpha = satisfies(isAlphanum);
