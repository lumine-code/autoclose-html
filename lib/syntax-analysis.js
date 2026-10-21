const { openingTagBefore, hasMatchingClosingTag } = require("./tag-scanner");
const OPEN_TAG_TYPES = new Set(["start_tag", "jsx_opening_element", "STag"]);
const CLOSE_TAG_TYPES = new Set(["end_tag", "jsx_closing_element", "ETag"]);

function tagName(node) {
  return (
    node?.childForFieldName("name") ??
    node?.namedChildren.find((child) => ["tag_name", "Name"].includes(child.type))
  )?.text;
}

function parsedTagAt(editor, position) {
  const node = editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1]);
  const opening = node?.parent;
  if (node?.type !== ">" || !OPEN_TAG_TYPES.has(opening?.type)) return null;
  const tag = tagName(opening);
  if (!tag) return null;
  const element = opening.parent;
  const closing =
    element?.childForFieldName("close_tag") ??
    element?.namedChildren.find((child) => CLOSE_TAG_TYPES.has(child.type));
  const caseSensitive = opening.type !== "start_tag";
  const normalize = (name) => (caseSensitive ? name : name?.toLowerCase());
  return {
    tag,
    hasClosingTag:
      closing != null &&
      closing.endIndex > closing.startIndex &&
      normalize(tagName(closing)) === normalize(tag),
  };
}

function bufferTextAfter(editor, position) {
  const buffer = editor.getBuffer();
  return buffer.getTextInRange([position, buffer.getEndPosition()]);
}

exports.plan = function (editor, { positions, options }) {
  const entries = positions.map((position) => {
    const parsed = parsedTagAt(editor, position);
    if (parsed) return { position, ...parsed };
    const scopeName = editor.getGrammar()?.scopeName ?? "";
    const jsx = /^source\.(?:tsx|jsx|js)(?:\.|$)/.test(scopeName);
    // A parsed JSX token that is not an opening tag is an expression, a
    // string, or another delimiter. Text heuristics must not override it.
    if (jsx && editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1])) {
      return { position, tag: null };
    }
    const line = editor.lineTextForBufferRow(position.row);
    const tag = line == null ? null : openingTagBefore(line, position.column, { jsx });
    return {
      position,
      tag,
      hasClosingTag:
        tag != null &&
        hasMatchingClosingTag(bufferTextAfter(editor, position), tag, {
          caseSensitive: jsx || scopeName.startsWith("text.xml"),
          neverClose: options.neverClose,
        }),
    };
  });

  return entries;
};
