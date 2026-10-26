const { TextBuffer } = require("lumine");

describe("Autoclose bounded source analysis", () => {
  let buffer, plan;
  beforeEach(() => {
    jasmine.useRealClock();
    ({ plan } = require("../lib/syntax-analysis"));
    buffer = new TextBuffer();
  });
  afterEach(() => buffer.destroy());
  const options = { neverClose: ["img", "br"] };
  const context = (buffer, node = null) => ({
    getBuffer: () => buffer,
    getGrammar: () => ({ scopeName: "text.plain" }),
    getSyntaxNodeAtBufferPosition: () => node,
  });

  it("finds a nearby closing tag in a source larger than the string limit without flattening its suffix", async () => {
    let tail = TextBuffer.createTextSnapshot("x".repeat(65536));
    for (let i = 0; i < 14; i++) tail = tail.replace(tail.length, tail.length, tail);
    const source = tail.replace(0, 0, "<span>text</span>");
    buffer.setTextInRange(buffer.getRange(), source);
    spyOn(buffer, "getTextInRange").and.throwError("Never materialize the full suffix");
    spyOn(buffer, "lineForRow").and.throwError("Never materialize the full prefix line");
    const result = await plan(context(buffer), { positions: [{ row: 0, column: 6 }], options });
    expect(result[0].tag).toBe("span");
    expect(result[0].hasClosingTag).toBe(true);
  });

  it("declines automatic edits when an unscanned suffix may still contain a closing tag", async () => {
    let tail = TextBuffer.createTextSnapshot("x".repeat(65536));
    for (let i = 0; i < 14; i++) tail = tail.replace(tail.length, tail.length, tail);
    let source = tail.replace(0, 0, "<span>");
    source = source.replace(source.length, source.length, "</span>");
    buffer.setTextInRange(buffer.getRange(), source);
    const result = await plan(context(buffer), { positions: [{ row: 0, column: 6 }], options });
    expect(result[0].tag).toBeNull();
    expect(result[0].unknown).toBe(true);
    expect(result[0].hasClosingTag).toBeUndefined();
  });

  it("reads parsed names through bounded source spans without touching node.text or child arrays", async () => {
    buffer.setText("<SPAN></span>");
    const name = (startIndex, endIndex) => ({
      startIndex,
      endIndex,
      get text() {
        throw new Error("Unbounded native node text");
      },
    });
    const closing = {
      type: "end_tag",
      startIndex: 6,
      endIndex: 13,
      childForFieldName: () => name(8, 12),
    };
    const element = {
      childForFieldName: () => closing,
      get namedChildren() {
        throw new Error("Unbounded child array");
      },
    };
    const opening = { type: "start_tag", parent: element, childForFieldName: () => name(1, 5) };
    const result = await plan(context(buffer, { type: ">", parent: opening }), {
      positions: [{ row: 0, column: 6 }],
      options,
    });
    expect(result[0]).toEqual({
      position: { row: 0, column: 6 },
      tag: "SPAN",
      hasClosingTag: true,
    });
    opening.childForFieldName = () => name(0, 5000);
    const unknown = await plan(context(buffer, { type: ">", parent: opening }), {
      positions: [{ row: 0, column: 6 }],
      options,
    });
    expect(unknown[0].unknown).toBe(true);
    expect(unknown[0].tag).toBeNull();
  });

  it("does not enter unbounded automatic indentation through the parsed fast path", async () => {
    buffer.setText(" ".repeat(70000) + "<div>");
    const name = { startIndex: 70001, endIndex: 70004 };
    const opening = { type: "start_tag", childForFieldName: () => name };
    opening.parent = {
      childForFieldName: () => null,
      namedChildCount: 1,
      namedChild: () => opening,
    };
    const result = await plan(context(buffer, { type: ">", parent: opening }), {
      positions: [{ row: 0, column: 70005 }],
      options,
    });
    expect(result[0].tag).toBeNull();
    expect(result[0].unknown).toBe(true);
  });
});
