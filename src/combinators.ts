import {
  ParseError,
  UnexpectedInput,
  type Parser,
  type ParseResult,
} from "./parser";

export function bind<Tok, T, U>(
  parser: Parser<T, Tok>,
  fmap: (value: T) => Parser<U, Tok>,
): Parser<U, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return out;
    const [value, s] = out;
    return fmap(value)(s);
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

export type OneOf<
  Tok,
  Ps extends [Parser<unknown, Tok>, ...Parser<unknown, Tok>[]],
> = Ps extends [
  Parser<infer T, Tok>,
  infer Snd extends Parser<unknown, Tok>,
  ...infer Rest extends readonly Parser<unknown, Tok>[],
]
  ? T | OneOf<Tok, [Snd, ...Rest]>
  : Ps extends readonly [Parser<infer T, Tok>]
    ? T
    : never;

export function oneOf<
  Tok,
  Ps extends readonly [Parser<unknown, Tok>, ...Parser<unknown, Tok>[]],
>(parserList: readonly [...Ps]): Parser<OneOf<Tok, [...Ps]>, Tok> {
  return (stream) => {
    for (const parser of parserList) {
      const out = parser(stream) as ParseResult<OneOf<Tok, [...Ps]>, Tok>;
      if (out instanceof ParseError) continue;
      return out;
    }
    return new UnexpectedInput();
  };
}

export type Seq<Tok, Ps extends readonly Parser<unknown, Tok>[]> = Ps extends [
  Parser<infer T, Tok>,
  ...infer Rest extends Parser<unknown, Tok>[],
]
  ? T extends Ignored
    ? Seq<Tok, Rest>
    : [T, ...Seq<Tok, Rest>]
  : [];

export function seq<Tok, Ps extends readonly Parser<unknown, Tok>[]>(
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

export function optional<Tok, T>(
  parser: Parser<T, Tok>,
): Parser<T | undefined, Tok> {
  return (stream) => {
    const out = parser(stream);
    if (out instanceof ParseError) return [undefined, stream];
    return out;
  };
}

export function map<Tok, I, O>(
  parser: Parser<I, Tok>,
  mapFn: (arg: I) => O,
): Parser<O, Tok> {
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
    let out = parser(s);
    while (!(out instanceof ParseError)) {
      const value = out[0];
      s = out[1];
      outputs.push(value);
      out = parser(s);
    }
    return [[first[0], ...outputs], s];
  };
}

type ParseType<P> = P extends Parser<infer T, any> ? T : never;

export function keepOnly<
  Tok,
  Ps extends readonly Parser<unknown, Tok>[],
  Ix extends keyof Ps & number,
>(parsers: readonly [...Ps], ix: Ix): Parser<ParseType<Ps[Ix]>, Tok> {
  return (stream) => {
    let s = stream;
    let result: unknown = undefined;

    for (let i = 0; i < parsers.length; i++) {
      const out = parsers[i](s);
      if (out instanceof ParseError) return out;
      if (i === ix) result = out[0];
      s = out[1];
    }

    return [result as ParseType<Ps[Ix]>, s];
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

export function sepBy<Tok, T>(
  itemParser: Parser<T, Tok>,
  sepParser: Parser<unknown, Tok>,
): Parser<[T, ...T[]], Tok> {
  return (stream) => {
    const first = itemParser(stream);
    if (first instanceof ParseError) return first;
    const rest: T[] = [];
    const restP = keepRight(sepParser, itemParser);
    let s = first[1];
    let out = restP(s);
    while (!(out instanceof ParseError)) {
      const value = out[0];
      s = out[1];
      rest.push(value);
      out = restP(s);
    }
    return [[first[0], ...rest], s];
  };
}

export function ref<Tok, T>(
  fn: (self: Parser<T, Tok>) => Parser<T, Tok>,
): Parser<T, Tok> {
  const self: Parser<T, Tok> = (stream) => {
    return fn(self)(stream);
  };
  return fn(self);
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
    bind: <T, U>(parser: Parser<T, Tok>, fmap: (arg: T) => Parser<U, Tok>) =>
      bind(parser, fmap),
    ignore: <T>(parser: Parser<T, Tok>) => ignore<T, Tok>(parser),
    oneOf: <
      Ps extends readonly [Parser<unknown, Tok>, ...Parser<unknown, Tok>[]],
    >(
      parserList: readonly [...Ps],
    ) => oneOf<Tok, Ps>(parserList),
    seq: <Ps extends readonly Parser<unknown, Tok>[]>(
      parsers: readonly [...Ps],
    ) => seq<Tok, Ps>(parsers),
    optional: <T>(parser: Parser<T, Tok>) => optional(parser),
    map: <I, O>(parser: Parser<I, Tok>, mapFn: (arg: I) => O) =>
      map<Tok, I, O>(parser, mapFn),
    many: <T>(parser: Parser<T, Tok>) => many<Tok, T>(parser),
    some: <T>(parser: Parser<T, Tok>) => some<Tok, T>(parser),
    keepOnly: <
      Ps extends readonly Parser<unknown, Tok>[],
      Ix extends keyof Ps & number,
    >(
      parsers: readonly [...Ps],
      ix: Ix,
    ) => keepOnly<Tok, Ps, Ix>(parsers, ix),
    keepLeft: <T>(left: Parser<T, Tok>, right: Parser<unknown, Tok>) =>
      keepLeft<Tok, T>(left, right),
    keepRight: <T>(left: Parser<unknown, Tok>, right: Parser<T, Tok>) =>
      keepRight<Tok, T>(left, right),
    between: <L, R, T>(
      left: Parser<L, Tok>,
      parser: Parser<T, Tok>,
      right: Parser<R, Tok>,
    ) => between(left, parser, right),
    sepBy: <T>(itemParser: Parser<T, Tok>, sepParser: Parser<unknown, Tok>) =>
      sepBy<Tok, T>(itemParser, sepParser),
    ref: <T>(fn: (self: Parser<T, Tok>) => Parser<T, Tok>) => ref<Tok, T>(fn),
  };
}
