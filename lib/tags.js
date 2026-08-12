// The HTML element tables, reduced to the two questions this package asks:
// is the element allowed to have a closing tag at all, and does that closing
// tag belong on its own line?
//
// Upstream answered the second question by creating the element, appending it
// to `document.body`, reading `getComputedStyle().display` and removing it
// again -- on every typed `>`. That forced a synchronous layout per keystroke,
// mutated the workspace DOM, and, worst of all, resolved the display against
// *the editor's* stylesheet rather than the stylesheet of the document being
// edited. A custom element therefore answered with whatever Lumine's own CSS
// happened to say about it, which is meaningless. A static table is both free
// and more correct.

// Elements the HTML rendering spec gives a block-ish default display: `block`,
// `list-item`, or one of the `table-*` roles. Everything absent from this set
// -- inline, inline-block, `display: none`, and unknown or custom elements,
// which default to inline -- is treated as inline.
//
// `display: none` elements (head, title, script, style, ...) land on the inline
// side, which matches the behaviour the computed-style probe used to produce:
// it accepted `none` alongside `inline` and `inline-block`. The `forceBlock`
// default carries `head` back over the line, exactly as it did before.
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "legend",
  "li",
  "listing",
  "main",
  "menu",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "plaintext",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "xmp",
]);

// The void elements of the HTML standard -- the ones that take no closing tag.
// `command` and `keygen` rode along in the upstream default; both were dropped
// from HTML before they were ever widely implemented, so they are not here.
const VOID_ELEMENTS = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
];

// `forceBlock` is consulted before `forceInline`, preserving the upstream
// precedence, and a `*` in `forceInline` outranks both.
function isInline(tag, { forceInline = [], forceBlock = [] } = {}) {
  if (forceInline.includes("*")) return true;

  const name = tag.toLowerCase();
  if (forceBlock.includes(name)) return false;
  if (forceInline.includes(name)) return true;

  return !BLOCK_ELEMENTS.has(name);
}

function isNeverClosed(tag, neverClose = []) {
  return neverClose.includes(tag.toLowerCase());
}

module.exports = { BLOCK_ELEMENTS, VOID_ELEMENTS, isInline, isNeverClosed };
