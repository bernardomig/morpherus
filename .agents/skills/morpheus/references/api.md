# Morpheus API reference

Exact signatures and semantics. Chunk-type parameter `C` is omitted where irrelevant.

## Entry points

| Specifier | Runtime exports | Type-only exports |
|---|---|---|
| `morpheus` | all core combinators, `eos`, `runParser`, `ParseError`, `UnexpectedEOS`, `UnexpectedInput`, `ignored`, `createForToken` | `EOS`, `Stream`, `Parser`, `ParseResult`, `ParserType`, `TokenOf`, `Ignored`, `OneOf`, `Seq`, `PrattTree` |
| `morpheus/string` | core combinators bound to `string`, `StringStream`, `string`, `enumOf`, `satisfies`, `digit`, `letter`, `alpha` | `Parser<T>` (one param), `VectorEnum` |
| `morpheus/lexer` | `Lexer`, `TokenStream`, `createCombinators` | `TokenNames`, `TokenValues`, `ExtractNames` |

## Core types

```ts
const eos: unique symbol;
type EOS = typeof eos;

interface Stream<T, C = T[]> {
  readonly position: number;
  peek(): T | EOS;
  peek(n: number): C | EOS;          // exactly n items, or eos
  consume(): Stream<T, C>;           // never mutates
  consume(n: number): Stream<T, C>;  // consume(0) returns `this`
}

type Parser<T, Tok> = (stream: Stream<Tok, any>) => ParseResult<T, Tok>;
type ParseResult<T, Tok> = [T, Stream<Tok, any>] | ParseError;

type ParserType<P extends Parser<any, any>> =
  P extends Parser<infer T, any> ? T : never;
type TokenOf<P extends Parser<any, any>> =
  P extends Parser<any, infer Tok> ? Tok : never;
```

`runParser(parser, stream): T` runs the parser, throws the `ParseError` on failure, then throws
`UnexpectedInput(s.position, undefined, undefined, "eof")` if `s.peek() !== eos`.

## Errors

```ts
class ParseError extends Error {
  readonly position: number;
  label?: string;
  expected: string[];
  readonly customMessage?: string; // raw message passed to the constructor
  constructor(position: number, message?: string, label?: string, expected?: string | string[]);
}
class UnexpectedEOS extends ParseError {}
class UnexpectedInput extends ParseError {}
```

When `message` is omitted the message is `Expected <expected.join(" or ")> at position <n>`.
`expected` is the machine-readable list; assertions usually check `position` and `expected`.

## Core combinators (`morpheus`)

```ts
pure<Tok, T>(value: T): Parser<T, Tok>
fail<Tok>(message?: string): Parser<never, Tok>

label<Tok, T>(parser: Parser<T, Tok>, expected: string): Parser<T, Tok>
lookAhead<Tok, T>(parser: Parser<T, Tok>): Parser<T, Tok>
notFollowedBy<Tok>(parser: Parser<unknown, Tok>): Parser<undefined, Tok>

map<Tok, I, O>(parser: Parser<I, Tok>, fn: (value: I) => O): Parser<O, Tok>
bind<Tok, T, U>(parser: Parser<T, Tok>, fn: (value: T) => Parser<U, Tok>): Parser<U, Tok>
ignore<T, Tok>(parser: Parser<T, Tok>): Parser<Ignored, Tok>   // `ignored` symbol

oneOf<Ps extends readonly [Parser<any, any>, ...Parser<any, any>[]], Tok = TokenOf<Ps[number]>>(
  parsers: readonly [...Ps],
): Parser<OneOf<Tok, [...Ps]>, Tok>

seq<Ps extends readonly Parser<any, any>[], Tok = TokenOf<Ps[number]>>(
  parsers: readonly [...Ps],
): Parser<Seq<Tok, Ps>, Tok>

optional<Tok, T>(parser: Parser<T, Tok>): Parser<T | undefined, Tok>
many<Tok, T>(parser: Parser<T, Tok>): Parser<T[], Tok>
some<Tok, T>(parser: Parser<T, Tok>): Parser<[T, ...T[]], Tok>

keepOnly<Ps extends readonly Parser<any, any>[], Ix extends keyof Ps & number, Tok = TokenOf<Ps[number]>>(
  parsers: readonly [...Ps], ix: Ix,
): Parser<ParserType<Ps[Ix]>, Tok>
keepLeft<Tok, T>(left: Parser<T, Tok>, right: Parser<unknown, Tok>): Parser<T, Tok>
keepRight<Tok, T>(left: Parser<unknown, Tok>, right: Parser<T, Tok>): Parser<T, Tok>
between<Tok, L, T, R>(left: Parser<L, Tok>, parser: Parser<T, Tok>, right: Parser<R, Tok>): Parser<T, Tok>

eof<Tok>(stream: Stream<Tok, any>): ParseResult<EOS, Tok>   // use as a parser value

sepBy<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<T[], Tok>
sepBy1<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<[T, ...T[]], Tok>
sepEndBy<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<T[], Tok>
sepEndBy1<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<[T, ...T[]], Tok>
endBy<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<T[], Tok>
endBy1<Tok, T>(item: Parser<T, Tok>, sep: Parser<unknown, Tok>): Parser<[T, ...T[]], Tok>

chainl1<Tok, T>(item: Parser<T, Tok>, op: Parser<(left: T, right: T) => T, Tok>): Parser<T, Tok>
chainr1<Tok, T>(item: Parser<T, Tok>, op: Parser<(left: T, right: T) => T, Tok>): Parser<T, Tok>

pratt<Tok, T, Op extends PropertyKey>(
  value: Parser<T, Tok>, operator: Parser<Op, Tok>, priority: Record<Op, number>,
): Parser<PrattTree<T, Op>, Tok>
type PrattTree<T, Op> = T | [PrattTree<T, Op>, Op, PrattTree<T, Op>];

ref<Tok, T>(fn: (self: Parser<T, Tok>) => Parser<T, Tok>): Parser<T, Tok>

createForToken<Tok>(): { /* every combinator above, pre-bound to Tok */ }
```

### Semantics worth knowing

- `seq` filters `ignore(...)` results out of the tuple **at runtime and in the type** (`Seq`).
  `keepOnly` does not filter; an `ignore`d element yields the `ignored` symbol.
- `oneOf` tries branches in order and returns the **furthest** error; ties merge `expected`
  lists and prefer `UnexpectedEOS`.
- `optional`, `many`, `some`'s loop, and `sepBy` treat a failure as "stop". They never surface
  the inner error; use `oneOf`/`label` if you need a diagnosis.
- `sepBy`/`sepEndBy`/`endBy` return `[]` if the first item fails. The `1` variants propagate
  the first failure.
- `sepEndBy1` accepts an optional trailing separator. `endBy1` requires a separator after every
  item.
- `chainl1`/`chainr1` **backtrack** on a missing/invalid RHS: they return the accumulated value
  and leave the remaining input for the caller (usually `runParser`'s EOF check).
- `pratt` **commits** on a matched operator whose RHS fails: the error is returned as-is.
  Unknown `Op` (missing `priority` entry) or a zero-width operator stops the climb, leaving the
  operator unconsumed.
- `label` follows Parsec `<?>`: only errors with no consumed input (or no `expected` entries)
  are relabelled. Custom `fail` messages are preserved.
- `notFollowedBy` returns `UnexpectedInput(pos, "Unexpected input at position <pos>")`.
- `ref(fn)` memoizes the parser built by `fn(self)` once; recursion goes through `self`.

## String entry point (`morpheus/string`)

```ts
class StringStream implements Stream<string, string> {
  constructor(input: string, position?: number);
}

type VectorEnum<Ts extends string[]> = /* union of the literal strings */;

string<T extends string>(input: T, opts?: { caseSensitive?: boolean }): Parser<T>;
enumOf<Ts extends [string, ...string[]]>(values: readonly [...Ts], opts?: { caseSensitive?: boolean }): Parser<VectorEnum<Ts>>;
satisfies(predicate: (ch: string) => boolean, description?: string): Parser<string>;

const digit: Parser<string>;    // [0-9], labelled "digit"
const letter: Parser<string>;   // [A-Za-z], labelled "letter"
const alpha: Parser<string>;    // [0-9A-Za-z], labelled "alphanumeric"
```

- `string` compares whole chunks via `peek(input.length)`; on mismatch it walks character by
  character to report the exact offset. Positions are UTF-16 code units, so `"😀"` occupies 2.
- `enumOf` tries alternatives **longest-first** (stable for equal lengths).
- `satisfies` defaults its expected description to `"character"`.
- All other combinators are the core ones pre-bound to `Tok = string`, and `Parser<T>` takes a
  single type argument here.

## Lexer entry point (`morpheus/lexer`)

```ts
class Lexer<T extends Record<any, string | RegExp>> {
  constructor(def: T);
  tokenize(input: string): Iterable<TokenType<T>>; // yields [name, matchedText]
}

class TokenStream<T extends [string, unknown]> implements Stream<T, T[]> {
  constructor(tokens: T[], position?: number);
}

createCombinators<T extends readonly [string, unknown]>(): {
  token<Name extends ExtractNames<T>>(name: Name): Parser<TokenValues<T>[Name], T>;
} & /* all core combinators */;
```

- Rules are tried in **declaration order; first match wins**. Declare longer prefixes first.
- String rules must be non-empty. Regexes are compiled with the sticky (`y`) flag (existing
  flags preserved); rules that can match the empty string throw in the constructor.
- `tokenize` throws a plain `Error` on unmatched input:
  `failed to match token at offset <n>: '<snippet>'`.
- `token(name)` fails with `expected: [name]`, and its value type is the payload type declared
  by the lexer mapping (string literal keeps its literal type, regex yields `string`).

## Naming notes

- `bind`'s callback parameter is `fn` (previously `fmap`).
- `char` has been removed; use `string`.
