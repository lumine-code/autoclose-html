const { SourceScanner, UNKNOWN, MAX_NAME } = require("./source-scanner");
const { isInline, isNeverClosed } = require("./tags");
const OPEN_TAG_TYPES = new Set(["start_tag", "jsx_opening_element", "STag"]);
const CLOSE_TAG_TYPES = new Set(["end_tag", "jsx_closing_element", "ETag"]);
const NAME_TYPES = new Set(["tag_name", "Name"]);

function boundedBlockIndent(source, row) {
  const start = source.lineStart(row);
  const next = row + 1 < source.lineCount ? source.lineStart(row + 1) : source.length;
  const end = Math.min(next, start + 65537);
  for (let offset = start; offset < end; offset += 16384)
    if (/\S/u.test(source.slice(offset, Math.min(end, offset + 16384)))) return true;
  return false;
}

function canApplyEntry(source, position, tag, hasClosingTag, options) {
  return (
    hasClosingTag ||
    isInline(tag, options) ||
    isNeverClosed(tag, options.neverClose) ||
    boundedBlockIndent(source, position.row)
  );
}

function namedChild(node, types) {
  if (!node) return null;
  const count = node.namedChildCount;
  if (!Number.isSafeInteger(count) || typeof node.namedChild !== "function") return UNKNOWN;
  if (count) {
    const first = node.namedChild(0);
    if (types.has(first?.type)) return first;
  }
  // Closing tags are normally the final child even in a huge element. This
  // avoids allocating or walking its complete list of nested descendants.
  if (count) {
    const last = node.namedChild(count - 1);
    if (types.has(last?.type)) return last;
  }
  if (count > 256) return UNKNOWN;
  for (let index = 0; index < count; index++) {
    const child = node.namedChild(index);
    if (types.has(child?.type)) return child;
  }
  return null;
}

function tagName(node, source, scanner) {
  const name = node?.childForFieldName("name") ?? namedChild(node, NAME_TYPES);
  if (name === UNKNOWN) return UNKNOWN;
  if (!name) return null;
  if (
    !Number.isSafeInteger(name.startIndex) ||
    !Number.isSafeInteger(name.endIndex) ||
    name.startIndex < 0 ||
    name.endIndex < name.startIndex ||
    name.endIndex > source.length ||
    name.endIndex - name.startIndex > MAX_NAME
  )
    return UNKNOWN;
  scanner.remaining -= name.endIndex - name.startIndex;
  if (scanner.remaining < 0) return UNKNOWN;
  return source.slice(name.startIndex, name.endIndex);
}

function parsedTagAt(editor, position, source, scanner) {
  const node = editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1]);
  const opening = node?.parent;
  if (node?.type !== ">" || !OPEN_TAG_TYPES.has(opening?.type)) return null;
  const tag = tagName(opening, source, scanner);
  if (tag === UNKNOWN) return UNKNOWN;
  if (!tag) return null;
  const element = opening.parent;
  const closing = element?.childForFieldName("close_tag") ?? namedChild(element, CLOSE_TAG_TYPES);
  if (closing === UNKNOWN) return UNKNOWN;
  const closingName = closing ? tagName(closing, source, scanner) : null;
  if (closingName === UNKNOWN) return UNKNOWN;
  const caseSensitive = opening.type !== "start_tag";
  const normalize = (name) => (caseSensitive ? name : name?.toLowerCase());
  return {
    tag,
    hasClosingTag:
      closing != null &&
      closing.endIndex > closing.startIndex &&
      normalize(closingName) === normalize(tag),
  };
}

exports.plan = async function (editor, { positions, options }) {
  const buffer = editor.getBuffer(),
    source = buffer.getTextSnapshot();
  const scanner = new SourceScanner(source, { signal: editor.signal });
  const entries = [];
  let nextYield = performance.now() + 4;
  for (const position of positions) {
    editor.signal?.throwIfAborted();
    if (performance.now() >= nextYield) {
      await new Promise((resolve) => setImmediate(resolve));
      nextYield = performance.now() + 4;
      editor.signal?.throwIfAborted();
    }
    if (scanner.remaining < 0 || performance.now() > scanner.deadline) {
      entries.push({ position, tag: null, unknown: true });
      continue;
    }
    const parsed = parsedTagAt(editor, position, source, scanner);
    if (parsed === UNKNOWN) {
      entries.push({ position, tag: null, unknown: true });
      continue;
    }
    if (parsed) {
      entries.push(
        canApplyEntry(source, position, parsed.tag, parsed.hasClosingTag, options)
          ? { position, ...parsed }
          : { position, tag: null, unknown: true },
      );
      continue;
    }
    const scopeName = editor.getGrammar()?.scopeName ?? "";
    const jsx = /^source\.(?:tsx|jsx|js)(?:\.|$)/.test(scopeName);
    if (jsx && editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1])) {
      entries.push({ position, tag: null });
      continue;
    }
    const offset = buffer.characterIndexForPosition(position);
    const tag = await scanner.run(scanner.opening(source.lineStart(position.row), offset, { jsx }));
    if (tag === UNKNOWN) {
      entries.push({ position, tag: null, unknown: true });
      continue;
    }
    const closing =
      tag == null
        ? false
        : await scanner.run(
            scanner.hasClosing(offset, tag, {
              caseSensitive: jsx || scopeName.startsWith("text.xml"),
              neverClose: options.neverClose,
            }),
          );
    entries.push(
      closing === UNKNOWN || (tag && !canApplyEntry(source, position, tag, closing, options))
        ? { position, tag: null, unknown: true }
        : { position, tag, hasClosingTag: closing },
    );
  }
  return entries;
};
