import {
  ParseError,
  UnexpectedEOS,
  UnexpectedInput,
  type Parser,
  type ParseResult,
  type ParserType,
  type TokenOf,
} from "./parser";
import { eos, type EOS, type Stream } from "./stream";

export function pure<Tok, T>(value: T): Parser<T, Tok> {
  return (stream) => [value, stream];
}

export function fail<Tok>(message?: string): Parser<never, Tok> {
  return (stream) => new ParseError(stream.position, message);
}

// Parsec `<?>` semantics: only relabel errors that consumed no input (or that
// carry no expected tokens at all). A deeper error that consumed input is more
// specific than the outer label, so it passes through untouched.
export function label<Tok, T>(parser: Parser<T, Tok>, expected: string): Parser<T, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) {
      if (out.position === stream.position || out.expected.length === 0) {
        out.label = expected;
        out.expected = [expected];
        // Preserve user-supplied messages (e.g. `fail("...")`); only regenerate
        // the default "Expected ... at position ..." text.
        if (out.customMessage === undefined) {
          out.message = `Expected ${expected} at position ${out.position}`;
        }
      }
      return out;
    }
    return out;
  };
}

export function lookAhead<Tok, T>(parser: Parser<T, Tok>): Parser<T, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return out;
    return [out[0], stream];
  };
}

export function notFollowedBy<Tok>(parser: Parser<unknown, Tok>): Parser<undefined, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return [undefined, stream];
    return new UnexpectedInput(stream.position, `Unexpected input at position ${stream.position}`);
  };
}

export function bind<Tok, T, U>(
  parser: Parser<T, Tok>,
  fn: (value: T) => Parser<U, Tok>,
): Parser<U, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return out;
    const [value, s] = out;
    return fn(value)(s);
  };
}

export const ignored: unique symbol = Symbol();
export type Ignored = typeof ignored;

export function ignore<T, Tok>(parser: Parser<T, Tok>): Parser<Ignored, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return out;
    const [_, s] = out;
    return [ignored, s];
  };
}

export type OneOf<Tok, Ps extends readonly [Parser<any, any>, ...Parser<any, any>[]]> = Ps extends [
  Parser<infer T, any>,
  infer Snd extends Parser<any, any>,
  ...infer Rest extends readonly Parser<any, any>[],
]
  ? T | OneOf<Tok, [Snd, ...Rest]>
  : Ps extends readonly [Parser<infer T, any>]
    ? T
    : never;

function mergeErrors(a: ParseError, b: ParseError): ParseError {
  if (b.position > a.position) return b;
  if (a.position > b.position) return a;

  const mergedExpected = Array.from(new Set([...a.expected, ...b.expected]));
  const label = b.label ?? a.label;
  // Leave `message` undefined when we can regenerate it from `expected`, so the
  // error is not marked as carrying a custom message (which would stop `label`
  // from reformatting it).
  const message =
    mergedExpected.length > 0 ? undefined : b.customMessage || a.customMessage || undefined;

  if (a instanceof UnexpectedEOS || b instanceof UnexpectedEOS) {
    return new UnexpectedEOS(a.position, message, label, mergedExpected);
  }
  if (a instanceof UnexpectedInput || b instanceof UnexpectedInput) {
    return new UnexpectedInput(a.position, message, label, mergedExpected);
  }
  return new ParseError(a.position, message, label, mergedExpected);
}

export function oneOf<
  Ps extends readonly [Parser<any, any>, ...Parser<any, any>[]],
  Tok = TokenOf<Ps[number]>,
>(parserList: readonly [...Ps]): Parser<OneOf<Tok, [...Ps]>, Tok> {
  return (stream) => {
    let furthestError: ParseError | undefined = undefined;
    for (const parser of parserList) {
      const out = parser(stream) as ParseResult<OneOf<Tok, [...Ps]>, Tok>;
      if (out instanceof ParseError) {
        furthestError = furthestError === undefined ? out : mergeErrors(furthestError, out);
        continue;
      }
      return out;
    }
    return (
      furthestError ??
      (stream.peek() === eos
        ? new UnexpectedEOS(stream.position)
        : new UnexpectedInput(stream.position))
    );
  };
}

export type Seq<Tok, Ps extends readonly Parser<any, any>[]> = Ps extends [
  Parser<infer T, any>,
  ...infer Rest extends Parser<any, any>[],
]
  ? T extends Ignored
    ? Seq<Tok, Rest>
    : [T, ...Seq<Tok, Rest>]
  : [];

export function seq<Ps extends readonly Parser<any, any>[], Tok = TokenOf<Ps[number]>>(
  parsers: readonly [...Ps],
): Parser<Seq<Tok, Ps>, Tok> {
  return (stream) => {
    const outs: any[] = [];
    let s = stream;
    for (const p of parsers) {
      const out = p(s);
      if (out instanceof ParseError) return out;
      const value = out[0];
      s = out[1];
      if (value !== ignored) outs.push(value);
    }
    return [outs as Seq<Tok, Ps>, s];
  };
}

export function optional<Tok, T>(parser: Parser<T, Tok>): Parser<T | undefined, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return [undefined, stream];
    return out;
  };
}

export function map<Tok, I, O>(parser: Parser<I, Tok>, mapFn: (arg: I) => O): Parser<O, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return out;
    const [value, stream_] = out;
    return [mapFn(value), stream_];
  };
}

export function many<Tok, T>(parser: Parser<T, Tok>): Parser<T[], Tok> {
  return (stream) => {
    const outputs: T[] = [];
    let s = stream;
    let out = parser(s);
    while (!(out instanceof ParseError)) {
      if (out[1] === s) break;
      const value = out[0];
      s = out[1];
      outputs.push(value);
      out = parser(s);
    }
    return [outputs, s];
  };
}

export function some<Tok, T>(parser: Parser<T, Tok>): Parser<[T, ...T[]], Tok> {
  return (stream) => {
    const first = parser(stream);
    if (first instanceof ParseError) return first;
    const outputs: T[] = [];
    let s = first[1];
    if (s === stream) return [[first[0]], s];
    let out = parser(s);
    while (!(out instanceof ParseError)) {
      if (out[1] === s) break;
      const value = out[0];
      s = out[1];
      outputs.push(value);
      out = parser(s);
    }
    return [[first[0], ...outputs], s];
  };
}

export function keepOnly<
  Ps extends readonly Parser<any, any>[],
  Ix extends keyof Ps & number,
  Tok = TokenOf<Ps[number]>,
>(parsers: readonly [...Ps], ix: Ix): Parser<ParserType<Ps[Ix]>, Tok> {
  return (stream) => {
    let s = stream;
    let result: unknown = undefined;

    for (let i = 0; i < parsers.length; i++) {
      const p = parsers[i]!;
      const out = p(s);
      if (out instanceof ParseError) return out;
      if (i === ix) result = out[0];
      s = out[1];
    }

    return [result as ParserType<Ps[Ix]>, s];
  };
}

export function keepLeft<Tok, T>(
  left: Parser<T, Tok>,
  right: Parser<unknown, Tok>,
): Parser<T, Tok> {
  return keepOnly([left, right], 0);
}

export function keepRight<Tok, T>(
  left: Parser<unknown, Tok>,
  right: Parser<T, Tok>,
): Parser<T, Tok> {
  return keepOnly([left, right], 1);
}

export function eof<Tok>(stream: Stream<Tok, any>): ParseResult<EOS, Tok> {
  if (stream.peek() === eos) return [eos, stream];
  return new UnexpectedInput(stream.position, undefined, undefined, "eof");
}

export function sepBy1<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<[T, ...T[]], Tok> {
  const restP = keepRight(sepParser, itemParser);
  return (stream) => {
    const first = itemParser(stream);
    if (first instanceof ParseError) return first;
    const rest: T[] = [];
    let s = first[1];
    let out = restP(s);
    while (!(out instanceof ParseError)) {
      if (out[1] === s) break;
      const value = out[0];
      s = out[1];
      rest.push(value);
      out = restP(s);
    }
    return [[first[0], ...rest], s];
  };
}

export function sepBy<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<T[], Tok> {
  const nonEmpty = sepBy1(itemParser, sepParser);
  return (stream) => {
    const out = nonEmpty(stream);
    if (out instanceof ParseError) return [[], stream];
    return out;
  };
}

export function sepEndBy1<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<[T, ...T[]], Tok> {
  const itemsP = sepBy1(itemParser, sepParser);
  const trailingSep = optional(sepParser);
  return (stream) => {
    const out = itemsP(stream);
    if (out instanceof ParseError) return out;
    const [items, s] = out;
    const afterSep = trailingSep(s);
    if (afterSep instanceof ParseError) return [items, s];
    return [items, afterSep[1]];
  };
}

export function sepEndBy<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<T[], Tok> {
  const nonEmpty = sepEndBy1(itemParser, sepParser);
  return (stream) => {
    const out = nonEmpty(stream);
    if (out instanceof ParseError) return [[], stream];
    return out;
  };
}

export function endBy1<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<[T, ...T[]], Tok> {
  return some(keepLeft(itemParser, sepParser));
}

export function endBy<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<T[], Tok> {
  return many(keepLeft(itemParser, sepParser));
}

export function chainl1<Tok, T>(
  itemParser: Parser<T, Tok>,
  opParser: Parser<(left: T, right: T) => T, Tok>,
): Parser<T, Tok> {
  return (stream) => {
    const first = itemParser(stream);
    if (first instanceof ParseError) return first;
    let acc = first[0];
    let s = first[1];
    while (true) {
      const opOut = opParser(s);
      if (opOut instanceof ParseError) break;
      const rhsOut = itemParser(opOut[1]);
      if (rhsOut instanceof ParseError) break;
      if (rhsOut[1] === s) break;
      acc = opOut[0](acc, rhsOut[0]);
      s = rhsOut[1];
    }
    return [acc, s];
  };
}

export function chainr1<Tok, T>(
  itemParser: Parser<T, Tok>,
  opParser: Parser<(left: T, right: T) => T, Tok>,
): Parser<T, Tok> {
  return (stream) => {
    const first = itemParser(stream);
    if (first instanceof ParseError) return first;
    const ops: Array<[(left: T, right: T) => T, T]> = [];
    let s = first[1];
    while (true) {
      const opOut = opParser(s);
      if (opOut instanceof ParseError) break;
      const rhsOut = itemParser(opOut[1]);
      if (rhsOut instanceof ParseError) break;
      if (rhsOut[1] === s) break;
      ops.push([opOut[0], rhsOut[0]]);
      s = rhsOut[1];
    }
    if (ops.length === 0) return [first[0], s];
    let acc = ops[ops.length - 1]![1];
    for (let i = ops.length - 1; i >= 1; i--) {
      acc = ops[i]![0](ops[i - 1]![1], acc);
    }
    acc = ops[0]![0](first[0], acc);
    return [acc, s];
  };
}

export type PrattTree<T, Op> = T | [PrattTree<T, Op>, Op, PrattTree<T, Op>];

/**
 * Higher-order Pratt precedence-climbing parser. Takes an atom parser, an
 * operator parser, and a precedence table, returning a
 * `PrattTree<T, Op>` (`T | [left, Op, right]`, left-associative for equal
 * precedence).
 *
 * **Committing semantics:** unlike `chainl1` / `chainr1`, once an operator has
 * been matched, a failure in its right-hand side is *committed* — the error is
 * returned as-is (pointing at the deepest failure position) instead of
 * backtracking and yielding the left-hand accumulator. This yields better
 * syntax errors, at the cost of reporting a failure rather than silently
 * truncating a partially matched expression.
 *
 * **Non-progress / unknown operators:** an operator parser that succeeds
 * without consuming input, or an operator with no entry in `priority` (possible
 * for JS consumers or a mismatched operator parser), stops the climb with the
 * operator left unconsumed instead of looping or comparing against `NaN`.
 */
export function pratt<Tok, T, Op extends PropertyKey>(
  value: Parser<T, Tok>,
  operator: Parser<Op, Tok>,
  priority: Record<Op, number>,
): Parser<PrattTree<T, Op>, Tok> {
  function parseExpr(
    stream: Stream<Tok, any>,
    minPriority: number,
  ): ParseResult<PrattTree<T, Op>, Tok> {
    const first = value(stream);
    if (first instanceof ParseError) return first;

    let lhs: PrattTree<T, Op> = first[0];
    let s = first[1];

    while (true) {
      const opOut = operator(s);
      if (opOut instanceof ParseError) break;

      const [op, afterOp] = opOut;
      // Zero-width operator: no progress, stop before recursing.
      if (afterOp === s) break;

      const opPriority: number | undefined = priority[op];
      // Unknown operator (JS consumers / mismatched parser): leave it unconsumed
      // rather than comparing against NaN.
      if (opPriority === undefined) break;
      if (opPriority < minPriority) break;

      const rhsOut = parseExpr(afterOp, opPriority + 1);
      if (rhsOut instanceof ParseError) return rhsOut;
      if (rhsOut[1] === s) break;

      lhs = [lhs, op, rhsOut[0]];
      s = rhsOut[1];
    }

    return [lhs, s];
  }

  return (stream) => parseExpr(stream, -Infinity);
}

export function ref<Tok, T>(fn: (self: Parser<T, Tok>) => Parser<T, Tok>): Parser<T, Tok> {
  const self: Parser<T, Tok> = (stream) => {
    return parser(stream);
  };
  const parser = fn(self);
  return parser;
}

export function between<Tok, L, T, R>(
  left: Parser<L, Tok>,
  parser: Parser<T, Tok>,
  right: Parser<R, Tok>,
): Parser<T, Tok> {
  return keepOnly([left, parser, right], 1);
}

export function createForToken<Tok>() {
  return {
    eof: eof as Parser<EOS, Tok>,
    pure: <T>(value: T) => pure<Tok, T>(value),
    fail: (message?: string) => fail<Tok>(message),
    label: <T>(parser: Parser<T, Tok>, expected: string) => label<Tok, T>(parser, expected),
    lookAhead: <T>(parser: Parser<T, Tok>) => lookAhead<Tok, T>(parser),
    notFollowedBy: (parser: Parser<unknown, Tok>) => notFollowedBy<Tok>(parser),
    bind: <T, U>(parser: Parser<T, Tok>, fn: (arg: T) => Parser<U, Tok>) => bind(parser, fn),
    ignore: <T>(parser: Parser<T, Tok>) => ignore<T, Tok>(parser),
    oneOf: <Ps extends readonly [Parser<unknown, Tok>, ...Parser<unknown, Tok>[]]>(
      parserList: readonly [...Ps],
    ): Parser<OneOf<Tok, [...Ps]>, Tok> => oneOf(parserList),
    seq: <Ps extends readonly Parser<unknown, Tok>[]>(
      parsers: readonly [...Ps],
    ): Parser<Seq<Tok, Ps>, Tok> => seq(parsers),
    optional: <T>(parser: Parser<T, Tok>) => optional(parser),
    map: <I, O>(parser: Parser<I, Tok>, mapFn: (arg: I) => O) => map<Tok, I, O>(parser, mapFn),
    many: <T>(parser: Parser<T, Tok>) => many<Tok, T>(parser),
    some: <T>(parser: Parser<T, Tok>) => some<Tok, T>(parser),
    keepOnly: <Ps extends readonly Parser<unknown, Tok>[], Ix extends keyof Ps & number>(
      parsers: readonly [...Ps],
      ix: Ix,
    ): Parser<ParserType<Ps[Ix]>, Tok> => keepOnly(parsers, ix),
    keepLeft: <T>(left: Parser<T, Tok>, right: Parser<unknown, Tok>) =>
      keepLeft<Tok, T>(left, right),
    keepRight: <T>(left: Parser<unknown, Tok>, right: Parser<T, Tok>) =>
      keepRight<Tok, T>(left, right),
    between: <L, T, R>(left: Parser<L, Tok>, parser: Parser<T, Tok>, right: Parser<R, Tok>) =>
      between(left, parser, right),
    sepBy: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      sepBy<Tok, T>(itemParser, sepParser),
    sepBy1: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      sepBy1<Tok, T>(itemParser, sepParser),
    sepEndBy: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      sepEndBy<Tok, T>(itemParser, sepParser),
    sepEndBy1: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      sepEndBy1<Tok, T>(itemParser, sepParser),
    endBy: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      endBy<Tok, T>(itemParser, sepParser),
    endBy1: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      endBy1<Tok, T>(itemParser, sepParser),
    chainl1: <T>(itemParser: Parser<T, Tok>, opParser: Parser<(left: T, right: T) => T, Tok>) =>
      chainl1<Tok, T>(itemParser, opParser),
    chainr1: <T>(itemParser: Parser<T, Tok>, opParser: Parser<(left: T, right: T) => T, Tok>) =>
      chainr1<Tok, T>(itemParser, opParser),
    pratt: <T, Op extends PropertyKey>(
      value: Parser<T, Tok>,
      operator: Parser<Op, Tok>,
      priority: Record<Op, number>,
    ) => pratt<Tok, T, Op>(value, operator, priority),
    ref: <T>(fn: (self: Parser<T, Tok>) => Parser<T, Tok>) => ref<Tok, T>(fn),
  };
}
