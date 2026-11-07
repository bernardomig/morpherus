import { describe, expect, test } from "bun:test";
import {
  fail,
  label,
  map,
  notFollowedBy,
  oneOf,
  pratt,
  pure,
  runParser,
  ParseError,
  UnexpectedInput,
} from "../src";
import { digit, enumOf, satisfies, string, StringStream, type Parser } from "../src/string";

// Bug 1: label must not destroy custom fail() messages.
describe("label preserves custom messages", () => {
  test("keeps a fail() message while attaching the label", () => {
    const parser = label(fail("my custom message"), "my-label");
    try {
      runParser(parser, new StringStream("x"));
      expect.unreachable("should have failed");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const out = err as ParseError;
      expect(out.label).toBe("my-label");
      expect(out.expected).toEqual(["my-label"]);
      expect(out.message).toBe("my custom message");
    }
  });

  test("still regenerates the default message when none was supplied", () => {
    const parser = label(string("a"), "letter a");
    const out = parser(new StringStream("b"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).message).toBe("Expected letter a at position 0");
  });

  test("oneOf + label keeps the label able to rewrite merged messages", () => {
    const parser = label(oneOf([string("a"), string("b")]), "a or b input");
    const out = parser(new StringStream("z"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).message).toBe("Expected a or b input at position 0");
  });
});

// Bug 6: non-empty error messages from notFollowedBy / satisfies.
describe("descriptive errors", () => {
  test("notFollowedBy reports a message", () => {
    const out = notFollowedBy(string("a"))(new StringStream("a"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).message).toBe("Unexpected input at position 0");
  });

  test("satisfies accepts a description used as `expected`", () => {
    const vowel = satisfies((c) => "aeiou".includes(c), "vowel");
    const out = vowel(new StringStream("x"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).expected).toEqual(["vowel"]);
    expect((out as UnexpectedInput).message).toBe("Expected vowel at position 0");
  });

  test("satisfies has a non-empty default message", () => {
    const anyChar = satisfies(() => false);
    const out = anyChar(new StringStream("x"));
    expect(out).toBeInstanceOf(UnexpectedInput);
    expect((out as UnexpectedInput).expected).toEqual(["character"]);
    expect((out as UnexpectedInput).message).toBe("Expected character at position 0");
  });

  test("satisfies reports the description at end of input", () => {
    const vowel = satisfies((c) => "aeiou".includes(c), "vowel");
    const out = vowel(new StringStream(""));
    expect((out as UnexpectedInput).message).toBe("Expected vowel at position 0");
  });
});

// Bug 5: enumOf must not let shorter values shadow longer ones.
describe("enumOf longest-first matching", () => {
  test("matches a longer alternative that shares a prefix", () => {
    const parser = enumOf(["let", "letter"]);
    expect(runParser(parser, new StringStream("letter"))).toBe("letter");
    expect(runParser(parser, new StringStream("let"))).toBe("let");
  });

  test("handles operator prefixes like = and ==", () => {
    const parser = enumOf(["=", "==", "==="]);
    expect(runParser(parser, new StringStream("==="))).toBe("===");
    expect(runParser(parser, new StringStream("=="))).toBe("==");
    expect(runParser(parser, new StringStream("="))).toBe("=");
  });

  test("keeps declaration order for equal-length values", () => {
    const parser = enumOf(["ab", "cd", "ef"]);
    expect(runParser(parser, new StringStream("cd"))).toBe("cd");
  });
});

// Bug 4: pratt must not treat unknown operators as NaN precedence.
describe("pratt unknown operators", () => {
  const atom = map(digit, (d) => Number(d));
  const operator = enumOf(["+", "^"]) as Parser<"+" | "^">;
  // Deliberately incomplete: `^` is missing (e.g. a JS consumer's table).
  const priority = { "+": 1 } as Record<"+" | "^", number>;

  test("parses known operators", () => {
    expect(runParser(pratt(atom, operator, priority), new StringStream("2+3"))).toEqual([
      2,
      "+",
      3,
    ]);
  });

  test("stops at an operator with no priority instead of misparsing", () => {
    try {
      runParser(pratt(atom, operator, priority), new StringStream("2^3"));
      expect.unreachable("should not silently treat '^' as lowest precedence");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as UnexpectedInput).position).toBe(1);
    }
  });
});

// Bug 3: pratt must not commit when the operator made no progress.
describe("pratt non-progress", () => {
  test("stops when the operator parser succeeds without consuming", () => {
    const atom = map(digit, (d) => Number(d));
    const zeroWidthOperator = pure("+") as Parser<"+">;
    const parser = pratt(atom, zeroWidthOperator, { "+": 1 });
    expect(runParser(parser, new StringStream("2"))).toBe(2);
  });
});

// Guard that ignore/seq interplay from the bug-3 type fix still works with labels.
test("string() failure keeps its expectation under a label", () => {
  const parser = label(string("foo"), "foo literal");
  const out = parser(new StringStream("fX"));
  expect(out).toBeInstanceOf(UnexpectedInput);
  expect((out as UnexpectedInput).position).toBe(1);
  expect((out as UnexpectedInput).expected).toEqual(["foo"]);
  expect((out as UnexpectedInput).label).toBeUndefined();
});
