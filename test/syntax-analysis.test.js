const { test } = require("node:test");
const assert = require("node:assert/strict");
const { plan } = require("../lib/syntax-analysis");

function fixture(text, { scopeName = "text.plain", signal, read, offset } = {}) {
  const source = {
    length: text.length,
    lineCount: 1,
    lineStart: () => 0,
    slice(start, end) {
      read?.();
      return text.slice(start, end);
    },
  };
  return {
    signal,
    getBuffer: () => ({
      getTextSnapshot: () => source,
      characterIndexForPosition(position) {
        offset?.();
        return position.column;
      },
    }),
    getGrammar: () => ({ scopeName }),
    getSyntaxNodeAtBufferPosition: () => null,
  };
}

const analyze = (editor, column, options = { neverClose: [] }) =>
  plan(editor, { positions: [{ row: 0, column }], options });
const unknown = [{ position: { row: 0, column: 5 }, tag: null, unknown: true }];

test("finishes a short fallback decision before delivering a queued microtask", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const editor = fixture("<div>", {
    offset: () => queueMicrotask(() => (clock = 101)),
  });
  assert.deepEqual(await analyze(editor, 5), [
    { position: { row: 0, column: 5 }, tag: "div", hasClosingTag: false },
  ]);
  assert.equal(clock, 101);
});

test("declines a fallback when its deadline expired before the position lookup", async (t) => {
  let calls = 0;
  t.mock.method(performance, "now", () => (calls++ === 0 ? 0 : 101));
  const editor = fixture("<div>");
  editor.getSyntaxNodeAtBufferPosition = () => assert.fail("Expired work must not enter lookup");
  assert.deepEqual(await analyze(editor, 5), unknown);
});

test("preserves deadline exhaustion during opening before checking the suffix", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const editor = fixture("<div>", { read: () => (clock = 101) });
  assert.deepEqual(await analyze(editor, 5), unknown);
});

test("preserves cancellation during opening before checking the suffix", async (t) => {
  t.mock.method(performance, "now", () => 0);
  const controller = new AbortController();
  const reason = new Error("Opening was cancelled");
  const editor = fixture("<div>", {
    signal: controller.signal,
    read: () => controller.abort(reason),
  });
  await assert.rejects(analyze(editor, 5), (error) => error === reason);
});

test("retains null tags, matching rules, JSX attributes and void elements", async (t) => {
  t.mock.method(performance, "now", () => 0);
  const jsx = '<button onClick={() => { return "}"; }}>';
  for (const [text, column, settings, options, tag, hasClosingTag] of [
    ["</div>", 6, {}, {}, null, false],
    ["<br />", 6, {}, {}, null, false],
    ["<SPAN>text</span>", 6, {}, {}, "SPAN", true],
    ["<Root>text</root>", 6, { scopeName: "text.xml" }, {}, "Root", false],
    ["<Root>text</Root>", 6, { scopeName: "text.xml" }, {}, "Root", true],
    ["<span><img></span>", 6, {}, { neverClose: ["img"] }, "span", true],
    ["<span><img></span>", 6, {}, {}, "span", false],
    [jsx, jsx.length, { scopeName: "source.tsx" }, {}, "button", false],
  ]) {
    assert.deepEqual(
      await analyze(fixture(text, settings), column, options),
      [{ position: { row: 0, column }, tag, hasClosingTag }],
      text,
    );
  }
});

for (const [name, text, column] of [
  ["name", "<" + "a".repeat(4097) + ">", 4099],
  ["tokens", "<div>" + "<br/>".repeat(16385), 5],
  ["depth", "<div>" + "<a>".repeat(512), 5],
  ["input", "<div>" + "x".repeat(4 * 1024 * 1024) + "</div>", 5],
]) {
  test(`retains the default ${name} cap as unknown`, async (t) => {
    t.mock.method(performance, "now", () => 0);
    assert.deepEqual(await analyze(fixture(text), column), [
      { position: { row: 0, column }, tag: null, unknown: true },
    ]);
  });
}

test("large fallback work still yields and preserves cancellation identity", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock++);
  const controller = new AbortController();
  const reason = new Error("Cooperative scan was cancelled");
  const text = '<div title="' + "x".repeat(65536) + '">';
  const pending = analyze(fixture(text, { signal: controller.signal }), text.length);
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});
