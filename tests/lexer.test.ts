import { describe, expect, test } from "bun:test";
import { runParser } from "../src";
import { Lexer, TokenStream, createCombinators } from "../src/lexer";

describe("Lexer rule validation", () => {
  test("rejects an empty string rule", () => {
    expect(() => new Lexer({ bad: "" })).toThrow(/cannot be an empty string/);
  });

  test("rejects regexes that can match the empty string", () => {
    expect(() => new Lexer({ ws: /\s*/ })).toThrow(/can match an empty string/);
    expect(() => new Lexer({ opt: /x?/ })).toThrow(/can match an empty string/);
  });

  test("accepts normal string and regex rules", () => {
    expect(() => new Lexer({ num: /\d+/, plus: "+", ws: /\s+/ })).not.toThrow();
  });
});

describe("Lexer error reporting", () => {
  test("unmatched input reports the offset", () => {
    const lexer = new Lexer({ num: /\d+/ });
    expect(() => [...lexer.tokenize("12x")]).toThrow("offset 2");
    expect(() => [...lexer.tokenize("12x")]).toThrow("'x'");
  });

  test("unmatched input at a later offset reports that offset", () => {
    const lexer = new Lexer({ num: /\d+/, plus: "+" });
    expect(() => [...lexer.tokenize("1+2?")]).toThrow("offset 3");
  });
});

describe("Token payload typing", () => {
  test("token() resolves the payload for each name", () => {
    const lexer = new Lexer({ num: /\d+/, plus: "+" });
    const tokens = new TokenStream([...lexer.tokenize("1+2")]);
    const { token, seq } = createCombinators<(typeof tokens)["tokens"][number]>();
    const parser = seq([token("num"), token("plus"), token("num")]);
    expect(runParser(parser, tokens)).toEqual(["1", "+", "2"]);
  });

  test("wrong token name fails with that name as expected", () => {
    const lexer = new Lexer({ num: /\d+/, plus: "+" });
    const tokens = new TokenStream([...lexer.tokenize("+")]);
    const { token } = createCombinators<(typeof tokens)["tokens"][number]>();
    const out = token("num")(tokens);
    expect(out).toBeInstanceOf(Error);
    expect((out as { expected: string[] }).expected).toEqual(["num"]);
  });
});
