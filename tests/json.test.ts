import { describe, expect, test } from "bun:test";
import { runParser } from "../src";
import { StringStream } from "../src/string/stringstream";
import {
  between,
  char,
  digit,
  eof,
  ignore,
  keepLeft,
  keepRight,
  many,
  map,
  oneOf,
  optional,
  ref,
  satisfies,
  sepBy,
  seq,
  some,
  string,
  type Parser,
} from "../src/string";

/** A JSON value. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Whitespace
// ---------------------------------------------------------------------------

const whitespace = ignore(
  many(satisfies((c) => c === " " || c === "\t" || c === "\n" || c === "\r")),
);

/** Parses `parser`, then consumes trailing whitespace. */
const lexeme = <T>(parser: Parser<T>): Parser<T> => keepLeft(parser, whitespace);

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const escapeMap: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const hexDigit = satisfies((c) => /[0-9a-fA-F]/.test(c));

/** `\uXXXX` */
const unicodeEscape = map(
  seq([char("u"), hexDigit, hexDigit, hexDigit, hexDigit]),
  ([, a, b, c, d]) => String.fromCharCode(parseInt(a + b + c + d, 16)),
);

const simpleEscape = map(
  oneOf([char('"'), char("\\"), char("/"), char("b"), char("f"), char("n"), char("r"), char("t")]),
  (c) => escapeMap[c]!,
);

const escape = keepRight(char("\\"), oneOf([unicodeEscape, simpleEscape]));

const jsonChar = oneOf([
  escape,
  // Unescaped control characters (U+0000..U+001F) are not valid JSON.
  satisfies((c) => c !== '"' && c !== "\\" && c >= " "),
]);

const jsonString: Parser<string> = map(
  keepLeft(between(char('"'), many(jsonChar), char('"')), whitespace),
  (chars) => chars.join(""),
);

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const exponent = seq([
  oneOf([char("e"), char("E")]),
  optional(oneOf([char("+"), char("-")])),
  some(digit),
]);

const fraction = seq([char("."), some(digit)]);

const nonZeroDigit = satisfies((c) => c >= "1" && c <= "9");

// JSON forbids leading zeroes: either a lone `0` or a non-zero digit
// followed by any number of digits.
const intPart = oneOf([
  char("0"),
  map(seq([nonZeroDigit, many(digit)]), ([first, rest]) => first + rest.join("")),
]);

const jsonNumber: Parser<number> = map(
  keepLeft(seq([optional(char("-")), intPart, optional(fraction), optional(exponent)]), whitespace),
  ([sign, int, frac, exp]) => {
    let text = sign ?? "";
    text += int;
    if (frac) text += "." + frac[1].join("");
    if (exp) text += "e" + (exp[1] ?? "") + exp[2].join("");
    return Number(text);
  },
);

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

const jsonBoolean: Parser<boolean> = oneOf([
  map(lexeme(string("true")), () => true),
  map(lexeme(string("false")), () => false),
]);

const jsonNull: Parser<null> = map(lexeme(string("null")), () => null);

// ---------------------------------------------------------------------------
// Containers (recursive)
// ---------------------------------------------------------------------------

const jsonValue: Parser<JsonValue> = ref((self) => {
  const member: Parser<[string, JsonValue]> = map(
    seq([jsonString, ignore(lexeme(char(":"))), self]),
    ([key, value]) => [key, value],
  );

  const jsonObject: Parser<{ [key: string]: JsonValue }> = map(
    between(lexeme(char("{")), sepBy(member, lexeme(char(","))), lexeme(char("}"))),
    (entries) => Object.fromEntries(entries),
  );

  const jsonArray: Parser<JsonValue[]> = between(
    lexeme(char("[")),
    sepBy(self, lexeme(char(","))),
    lexeme(char("]")),
  );

  return oneOf([jsonObject, jsonArray, jsonString, jsonNumber, jsonBoolean, jsonNull]);
});

/** A complete JSON document. */
const json: Parser<JsonValue> = keepRight(whitespace, jsonValue);

/** Parses a JSON document, throwing a `ParseError` on invalid input. */
function parseJson(input: string): JsonValue {
  return runParser(keepLeft(json, eof), new StringStream(input));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JSON parser", () => {
  test("parses a complete document", () => {
    const input = `{
      "name": "Morpheus",
      "version": 0.1,
      "private": true,
      "tags": ["parser", "combinators", "typescript"],
      "nested": { "empty": [], "nothing": null }
    }`;

    expect(parseJson(input)).toEqual({
      name: "Morpheus",
      version: 0.1,
      private: true,
      tags: ["parser", "combinators", "typescript"],
      nested: { empty: [], nothing: null },
    });
  });

  test("parses scalars and empty containers", () => {
    expect(parseJson("0")).toBe(0);
    expect(parseJson("-12.5e-3")).toBeCloseTo(-0.0125);
    expect(parseJson('"line\\nbreak \\u0041"')).toBe("line\nbreak A");
    expect(parseJson("true")).toBe(true);
    expect(parseJson("false")).toBe(false);
    expect(parseJson("null")).toBeNull();
    expect(parseJson("[]")).toEqual([]);
    expect(parseJson("{}")).toEqual({});
  });

  test("rejects invalid input", () => {
    for (const input of ["", "{", "[1 2]", '"unterminated', "tru", "01", '{"a":}', "[1, 2, 3,]"]) {
      expect(() => parseJson(input)).toThrow();
    }
  });
});
