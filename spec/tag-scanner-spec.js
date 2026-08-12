const { openingTagBefore, maskQuotedValues } = require("../lib/tag-scanner");
const { isInline, isNeverClosed, VOID_ELEMENTS } = require("../lib/tags");

describe("tag-scanner", () => {
  // Every case passes the column *after* the `>`, which is where the cursor
  // sits once the character has been typed.
  function tagIn(line) {
    return openingTagBefore(line, line.length);
  }

  describe("maskQuotedValues", () => {
    it("blanks a quoted value while preserving length", () => {
      expect(maskQuotedValues('<a b="cd">')).toBe('<a b="  ">');
      expect(maskQuotedValues("<a b='cd'>")).toBe("<a b='  '>");
    });

    it("leaves the other quote character alone inside a value", () => {
      expect(maskQuotedValues(`<a b="it's">`)).toBe('<a b="    ">');
    });

    it("returns null when a quote is left open", () => {
      expect(maskQuotedValues('<a b="cd')).toBe(null);
    });
  });

  describe("openingTagBefore", () => {
    it("finds a bare tag", () => {
      expect(tagIn("<div>")).toBe("div");
      expect(tagIn("<span>")).toBe("span");
    });

    it("finds a tag carrying attributes", () => {
      expect(tagIn('<div class="a b" id="c">')).toBe("div");
    });

    it("finds the last tag on a line", () => {
      expect(tagIn("<div><span>")).toBe("span");
    });

    it("keeps the case the tag was written in", () => {
      expect(tagIn("<DIV>")).toBe("DIV");
    });

    it("accepts names with digits, hyphens and colons", () => {
      expect(tagIn("<h1>")).toBe("h1");
      expect(tagIn("<my-element>")).toBe("my-element");
      expect(tagIn("<svg:rect>")).toBe("svg:rect");
    });

    it("rejects a closing tag", () => {
      expect(tagIn("</div>")).toBe(null);
    });

    it("rejects a comment, a doctype and a processing instruction", () => {
      expect(tagIn("<!-- a -->")).toBe(null);
      expect(tagIn("<!DOCTYPE html>")).toBe(null);
      expect(tagIn("<?xml version='1.0'?>")).toBe(null);
    });

    it("rejects a tag that already closes itself", () => {
      expect(tagIn("<br />")).toBe(null);
      expect(tagIn("<br/>")).toBe(null);
    });

    it("rejects a line whose cursor is not just past a `>`", () => {
      expect(openingTagBefore("<div>", 3)).toBe(null);
    });

    it("ignores `<` and `>` inside a quoted attribute value", () => {
      // Upstream searched for the last `<` before looking at quotes, so the
      // `<` inside the value won and the tag was missed.
      expect(tagIn('<a title="x<y">')).toBe("a");
      expect(tagIn('<a title="x>y">')).toBe("a");
    });

    it("rejects a `>` that is itself inside an unterminated value", () => {
      expect(tagIn('<a title="x>')).toBe(null);
    });

    it("rejects a `>` with no `<` in front of it at all", () => {
      // Upstream indexed with a raw -1 here, so `substr(-1)` quietly handed the
      // regex the final character instead of bailing out.
      expect(tagIn("a >")).toBe(null);
      expect(tagIn(">")).toBe(null);
    });
  });

  describe("isInline", () => {
    it("treats block elements as block", () => {
      expect(isInline("div")).toBe(false);
      expect(isInline("ul")).toBe(false);
      expect(isInline("li")).toBe(false);
      expect(isInline("table")).toBe(false);
      expect(isInline("td")).toBe(false);
    });

    it("treats inline and unknown elements as inline", () => {
      expect(isInline("span")).toBe(true);
      expect(isInline("a")).toBe(true);
      expect(isInline("button")).toBe(true);
      expect(isInline("my-element")).toBe(true);
    });

    it("is case insensitive", () => {
      expect(isInline("DIV")).toBe(false);
      expect(isInline("SPAN")).toBe(true);
    });

    it("honours forceInline and forceBlock", () => {
      expect(isInline("h1", { forceInline: ["h1"] })).toBe(true);
      expect(isInline("span", { forceBlock: ["span"] })).toBe(false);
    });

    it("lets forceBlock win over forceInline, as upstream did", () => {
      expect(isInline("p", { forceInline: ["p"], forceBlock: ["p"] })).toBe(false);
    });

    it("lets a `*` in forceInline outrank everything", () => {
      expect(isInline("div", { forceInline: ["*"], forceBlock: ["div"] })).toBe(true);
    });
  });

  describe("isNeverClosed", () => {
    it("matches the configured list case insensitively", () => {
      expect(isNeverClosed("BR", VOID_ELEMENTS)).toBe(true);
      expect(isNeverClosed("div", VOID_ELEMENTS)).toBe(false);
    });

    it("covers every void element of the HTML standard", () => {
      for (const element of ["area", "base", "br", "col", "embed", "hr", "img"]) {
        expect(isNeverClosed(element, VOID_ELEMENTS)).toBe(true);
      }
    });
  });
});
