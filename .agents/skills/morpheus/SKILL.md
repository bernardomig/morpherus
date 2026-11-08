---
name: morpheus
description: Write TypeScript parsers with the Morpheus parser-combinator library (morpheus, morpheus/string, morpheus/lexer). Use when building or debugging grammars, scanners, lexers, tokenizers, expression/operator-precedence parsers, or when a repo depends on morpheus.
---

# Morpheus parser combinators

Morpheus is a Parsec/Megaparsec-inspired parser combinator library for TypeScript.
A parser is a plain function: `(stream) => [value, restStream] | ParseError`.

## Before writing code

1. **Pick the entry point — this decides the `Parser` type arity:**

   | You are parsing                    | Import from       | `Parser<T>`                           |
   | ---------------------------------- | ----------------- | ------------------------------------- |
   | Characters / strings (scannerless) | `morpheus/string` | one type param (`Tok` = `string`)     |
   | Tokens from a lexer                | `morpheus/lexer`  | use `createCombinators<TokenTuple>()` |
   | A custom token stream              | `morpheus`        | two params: `Parser<T, Tok>`          |

   Importing combinators from `morpheus` while working with strings works, but you must then
   write `Parser<T, string>`; prefer the `morpheus/string` entry point so `Parser<T>` suffices.

2. **`char` does not exist.** Use `string("a")` for single characters; it also handles
   astral-plane characters (`string("😀")`).

3. `morpheus/string` re-exports every core combinator pre-bound to `Tok = string`, plus
   `StringStream`, `string`, `enumOf`, `satisfies`, `digit`, `letter`, `alpha`.

## Minimal example

```ts
import { runParser } from "morpheus";
import { StringStream, digit, many, map, seq, some, string } from "morpheus/string";

const number = map(some(digit), (ds) => Number(ds.join("")));
const parser = seq([string("let"), number, string(";")]);

runParser(parser, new StringStream("let123;")); // => ["let", 123, ";"]
```

`runParser` **throws** the `ParseError` on failure and also throws `UnexpectedInput` if input
remains after the parser finishes. Tests should use `expect(() => runParser(...)).toThrow(...)`
or inspect the raw parser result (`parser(stream)`) to assert on error fields.

## Mental model

- **Streams are immutable cursors.** Backtracking is free: reuse an earlier stream reference.
  `consume(0)` returns the same instance.
- **Parsers never throw.** They return a `[value, stream]` tuple or a `ParseError` instance.
  Check with `out instanceof ParseError`.
- **Errors carry `position`, `expected: string[]`, `label?`, `message`, `customMessage?`.**
- **No whitespace handling.** Compose a `lexeme` helper yourself (see `references/patterns.md`).
- **Zero-progress loops stop.** `many`, `some`, `sepBy1`, `chainl1`, `chainr1`, `pratt` break
  instead of looping forever on zero-width parsers.
- **Repetition swallows failures.** `many`, `optional`, `sepBy` turn a failure into "stop
  here" and never propagate the inner error; leftovers surface via `runParser`'s EOF check.

## Combinator cheat sheet

| Need                                     | Combinator                                                 |
| ---------------------------------------- | ---------------------------------------------------------- |
| Literal / alternatives                   | `string`, `enumOf` (tries **longest-first**), `satisfies`  |
| Sequence, keep all (drops `ignore(...)`) | `seq([...])`                                               |
| Ordered choice                           | `oneOf([...])` (furthest error wins)                       |
| Keep one element                         | `keepOnly([...], i)`, `keepLeft`, `keepRight`, `between`   |
| Optional / repetition                    | `optional`, `many`, `some`                                 |
| Separated lists                          | `sepBy`/`sepBy1`, `sepEndBy`/`sepEndBy1`, `endBy`/`endBy1` |
| Operators                                | `chainl1`, `chainr1`, `pratt`                              |
| Recursion / laziness                     | `ref((self) => ...)`                                       |
| Transform / chain                        | `map`, `bind`                                              |
| Context / errors                         | `label`, `fail`, `lookAhead`, `notFollowedBy`, `eof`       |
| Zero-cost                                | `pure`, `ignore` (yields `ignored`, filtered by `seq`)     |

## Behaviors that bite

- **`pratt` commits.** Once an operator matches, a failing RHS returns that error instead of
  backtracking (unlike `chainl1`/`chainr1`, which stop and leave input for the EOF check).
  Operators missing from the priority table, or matching zero-width, stop the climb.
- **`label` is Parsec `<?>`.** It rewrites `label`/`expected`/`message` only when the error
  consumed no input (or had no `expected`). Custom `fail("...")` messages survive.
- **`oneOf` merges errors** at the furthest position and prefers `UnexpectedEOS` on ties.
- **`eof` is a parser value**, not a factory: `keepLeft(p, eof)`.
- **`keepOnly` does not strip `ignore(...)`** — only `seq` does.
- **Lexer rules are ordered, first match wins.** Declare longer/prefix-overlapping rules first
  (`{ eqeq: "==", eq: "=" }`). Rules able to match the empty string throw at construction.
- **`TokenStream` positions count tokens**, not characters. `StringStream` positions are UTF-16
  code units.
- **Token parsers are typed** via `createCombinators<(typeof tokens)["tokens"][number]>()`.

## Recipes and full API

- `references/patterns.md` — copy-paste grammars: lexeme/whitespace, numbers, Pratt
  expressions, statement lists, recursive grammars, lexer → token pipeline, error reporting.
- `references/api.md` — exact signatures, semantics, and exported types for all three entry
  points.

## Verify your work

In a repo that depends on morpheus, run its test command. In this repository:

```bash
bun test            # runnable specs
bun run typecheck   # tsc over src + tests
bun run check       # both
```

Always add a failure-case assertion alongside the happy path; error positions and `expected`
lists are part of the contract.
