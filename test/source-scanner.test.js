const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SourceScanner, UNKNOWN } = require("../lib/source-scanner");
const { openingTagBefore, hasMatchingClosingTag } = require("../lib/tag-scanner");

const source = (text) => ({ length: text.length, slice: (start, end) => text.slice(start, end) });

test("source prefix masking preserves HTML/JSX quote, expression and delimiter semantics", async () => {
  const values = [
    "<div>",
    "<DIV>",
    "<my-element>",
    "<svg:rect>",
    "<div><span>",
    "</div>",
    "<br/>",
    "<div / data>",
    "<!-- a -->",
    "<!DOCTYPE html>",
    "<?xml version='1.0'?>",
    '<a title="x<y">',
    '<a title="x>y">',
    '<a title="x>',
    "a >",
    ">",
    "<button onClick={() =>",
    '<button onClick={() => { return "}"; }} disabled={count > 1}>',
    '<button value={"\\"} >"}>',
    "<button value={`text > ${count}`}>",
    '<button callback={() => { /* } > */ return "ok"; }}>',
    "<a data-value={text>",
  ];
  for (const text of values)
    for (const jsx of [false, true]) {
      const scanner = new SourceScanner(source(text), { maxMilliseconds: Infinity });
      const actual = await scanner.run(scanner.opening(0, text.length, { jsx }));
      assert.equal(
        actual,
        openingTagBefore(text, text.length, { jsx }),
        JSON.stringify([text, jsx]),
      );
    }
});

test("source suffix tokenization preserves nesting, comments, CDATA, raw text and name case", async () => {
  const fixtures = [
    "",
    "text</span>",
    "<span>inner</span>outer</span>",
    "<span>inner</span>",
    '<!-- </span> --><img title="</span>">',
    '<script>const text="</span>";</script></span>',
    "<![CDATA[</span>]]></span>",
    "<![cdata[</span>]]]></span>",
    "<!-- ---></span>",
    "<a data='a>b'>text</a></span>",
    "<a />tail</span>",
    "<img>tail</span>",
    "</other></span>",
    "<!-- unfinished </span>",
    "<![CDATA[unfinished </span>",
    "<SPAN>text</SPAN></span>",
    "<x\n data=foo>text</x></span>",
  ];
  for (const text of fixtures)
    for (const caseSensitive of [true, false]) {
      const options = { caseSensitive, neverClose: ["img"] };
      const scanner = new SourceScanner(source(text), { maxMilliseconds: Infinity });
      assert.equal(
        await scanner.run(scanner.hasClosing(0, "span", options)),
        hasMatchingClosingTag(text, "span", options),
        JSON.stringify([text, caseSensitive]),
      );
    }
});

test("exhausted name, token, stack and input budgets are unknown, never absence", async () => {
  for (const [text, settings] of [
    ["x".repeat(5000) + "</span>", { maxUnits: 100 }],
    ["<long-name></long-name></span>", { maxName: 4 }],
    ["<a><b></b></a></span>", { maxDepth: 2 }],
    ["<br/><br/></span>", { maxTokens: 1 }],
  ]) {
    const scanner = new SourceScanner(source(text), { ...settings, maxMilliseconds: Infinity });
    assert.equal(await scanner.run(scanner.hasClosing(0, "span")), UNKNOWN);
  }
  const text = "x".repeat(5000) + "<span>";
  const scanner = new SourceScanner(source(text), { maxUnits: 100, maxMilliseconds: Infinity });
  assert.equal(await scanner.run(scanner.opening(0, text.length)), UNKNOWN);
});

test("large work yields and cancellation terminates it before a plan can be returned", async () => {
  const text = '<a title="' + "x".repeat(2 * 1024 * 1024) + '">';
  const controller = new AbortController();
  const scanner = new SourceScanner(source(text), {
    signal: controller.signal,
    maxUnits: Infinity,
    maxMilliseconds: Infinity,
  });
  const pending = scanner.run(scanner.opening(0, text.length));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
