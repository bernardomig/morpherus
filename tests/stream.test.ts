import { describe, expect, test } from "bun:test";
import { eos, runParser, UnexpectedEOS, UnexpectedInput, seq, some, map } from "../src";
import { string, digit, StringStream } from "../src/string";
import { Lexer, TokenStream, createCombinators } from "../src/lexer";

describe("StringStream chunk access", () => {
  test("peek() returns the next character or eos", () => {
    const s = new StringStream("ab");
    expect(s.peek()).toBe("a");
    expect(s.consume().peek()).toBe("b");
    expect(s.consume(2).peek()).toBe(eos);
  });

  test("peek(n) returns an exact slice of n characters", () => {
    const s = new StringStream("hello world");
    expect(s.peek(5)).toBe("hello");
    expect(s.consume(6).peek(5)).toBe("world");
  });

  test("peek(n) returns eos when fewer than n characters remain", () => {
    const s = new StringStream("abc");
    expect(s.peek(3)).toBe("abc"); // exactly n remaining succeeds
    expect(s.peek(4)).toBe(eos);
    expect(s.consume(3).peek(1)).toBe(eos);
  });

  test("consume(n) advances by n without mutating the original stream", () => {
    const s = new StringStream("abcdef");
    const s2 = s.consume(4);
    expect(s.position).toBe(0);
    expect(s2.position).toBe(4);
    expect(s2.peek()).toBe("e");
    expect(s.consume().position).toBe(1);
  });

  test("consume(0) returns the same stream instance", () => {
    const s = new StringStream("abc");
    expect(s.consume(0)).toBe(s);
    expect(s.consume(1)).not.toBe(s);
  });
});

describe("TokenStream chunk access", () => {
  const lexer = new Lexer({ num: /\d+/, plus: "+", ws: /\s+/ });
  const tokens = new TokenStream([...lexer.tokenize("1+22")].filter(([n]) => n !== "ws"));

  test("peek() returns the next token or eos", () => {
    expect(tokens.peek()).toEqual(["num", "1"]);
    expect(tokens.consume(3).peek()).toBe(eos);
  });

  test("peek(n) returns an array of n tokens", () => {
    expect(tokens.peek(2)).toEqual([
      ["num", "1"],
      ["plus", "+"],
    ]);
    expect(tokens.peek(3)).toHaveLength(3);
  });

  test("peek(n) returns eos when fewer than n tokens remain", () => {
    expect(tokens.peek(4)).toBe(eos);
    expect(tokens.consume(1).peek(3)).toBe(eos);
  });

  test("consume(n) advances by n, consume(0) preserves identity", () => {
    const t2 = tokens.consume(2);
    expect(t2.position).toBe(2);
    expect(t2.peek()).toEqual(["num", "22"]);
    expect(tokens.position).toBe(0);
    expect(tokens.consume(0)).toBe(tokens);
  });

  test("token streams flow through generic combinators", () => {
    const { token } = createCombinators<(typeof tokens)["tokens"][number]>();
    const parser = map(
      seq([token("num"), token("plus"), token("num")]),
      ([a, , b]) => Number(a) + Number(b),
    );
    expect(runParser(parser, tokens)).toBe(23);
  });
});

describe("string() chunk fast path", () => {
  test("matches astral-plane characters (multiple UTF-16 code units)", () => {
    const out = string("😀")(new StringStream("😀!"));
    expect(out).toEqual(["😀", expect.objectContaining({ position: 2 })]);
    expect(runParser(string("😀"), new StringStream("😀"))).toBe("😀");
  });

  test("matches and consumes the whole input in one step", () => {
    const out = string("hello")(new StringStream("hello world"));
    expect(out).toEqual(["hello", expect.objectContaining({ position: 5 })]);
  });

  test("matches case-insensitively", () => {
    const out = string("hello", { caseSensitive: false })(new StringStream("HeLLo!"));
    expect(out).toEqual(["hello", expect.objectContaining({ position: 5 })]);
  });

  test("empty string matches without consuming (zero-width)", () => {
    const s = new StringStream("x");
    const out = string("")(s);
    expect(out).toEqual(["", s]);
  });

  test("reports UnexpectedEOS at the end of input on partial match", () => {
    const out = string("true")(new StringStream("tru"));
    expect(out).toBeInstanceOf(UnexpectedEOS);
    expect((out as UnexpectedEOS).position).toBe(3);
  });

  test("reports UnexpectedInput at the exact mismatch offset", () => {
    const out = string("hello")(new StringStream("help"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).position).toBe(3);
  });

  test("case-insensitive mismatch reports the exact offset", () => {
    const out = string("true", { caseSensitive: false })(new StringStream("TRxE"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).position).toBe(2);
  });

  test("integrates with runParser and repetition combinators", () => {
    const number = map(some(digit), (ds) => Number(ds.join("")));
    const parser = seq([string("let"), number, string(";")]);
    expect(runParser(parser, new StringStream("let123;"))).toEqual(["let", 123, ";"]);
  });
});
