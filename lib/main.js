const { CompositeDisposable } = require("lumine");
const { isInline, isNeverClosed } = require("./tags");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "autoclose-html",
      tips: [
        "You can have a closing tag written for you as soon as you finish typing an opening one.",
      ],
    };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.pending = new Map();
    this.requests = new Map();
    const subscriptions = this.subscriptions;

    subscriptions.add(
      lumine.commands.add("lumine-workspace", {
        "autoclose-html:toggle": () => this.toggle(),
      }),
      lumine.workspace.observeTextEditors((editor) => {
        if (this.subscriptions === subscriptions && !subscriptions.disposed)
          this.watchEditor(editor);
      }),
    );
  },

  deactivate() {
    const subscriptions = this.subscriptions;
    this.subscriptions = null;
    this.pending?.clear();
    for (const controller of this.requests?.values() ?? []) controller.abort();
    this.requests?.clear();
    subscriptions?.dispose();
  },

  toggle() {
    const enabled = !lumine.config.get("autoclose-html.enabled");
    lumine.config.set("autoclose-html.enabled", enabled);
    lumine.notifications.addHint(
      `Closing tags are ${enabled ? "inserted automatically" : "no longer inserted"}.`,
    );
  },

  watchEditor(editor) {
    const subscriptions = this.subscriptions;
    if (!subscriptions || subscriptions.disposed) return;
    const pending = this.pending;
    const requests = this.requests;
    const editorSubscriptions = new CompositeDisposable();

    editorSubscriptions.add(
      editor.onDidInsertText((event) => {
        if (this.subscriptions === subscriptions && !subscriptions.disposed)
          this.onDidInsertText(editor, event);
      }),
      editor.onDidChangeGrammar(() => {
        pending.delete(editor);
        requests.get(editor)?.abort();
      }),
      editor.onDidDestroy(() => {
        pending.delete(editor);
        requests.get(editor)?.abort();
        editorSubscriptions.dispose();
        subscriptions.remove(editorSubscriptions);
      }),
    );

    subscriptions.add(editorSubscriptions);
  },

  handlesGrammar(editor) {
    if (editor.getGrammar() === lumine.grammars.nullGrammar) return false;
    const scopeName = editor.getGrammar()?.scopeName;
    if (!scopeName) return false;
    return (lumine.config.get("autoclose-html.grammars") ?? []).includes(scopeName);
  },

  onDidInsertText(editor, event) {
    const subscriptions = this.subscriptions;
    if (!subscriptions || subscriptions.disposed) return;
    // Every insertion in a multicursor paste advances the captured revision,
    // including a cursor that receives something other than a tag delimiter.
    const previous = this.pending.get(editor);
    if (previous) previous.revision = editor.getBuffer().getTextRevision();
    // Only a single delimiter triggers closing, never the closing tag itself.
    if (event?.text !== ">") return;
    if (!lumine.config.get("autoclose-html.enabled")) return;
    if (!this.handlesGrammar(editor)) return;

    // `did-insert-text` is emitted from inside `mutateSelectedText`, once per
    // selection, while the editor is still iterating them. Editing the buffer
    // from here would mutate that collection mid-walk, so the work is deferred
    // to a microtask and runs once the whole `insertText` call has returned.
    let insertion = this.pending.get(editor);
    if (!insertion) {
      insertion = { positions: [] };
      this.pending.set(editor, insertion);
      const pending = this.pending;
      Promise.resolve().then(() => {
        if (
          this.subscriptions === subscriptions &&
          !subscriptions.disposed &&
          this.pending === pending
        )
          return this.flush(editor);
      });
    }
    insertion.positions.push(event.range.end);
    insertion.revision = editor.getBuffer().getTextRevision();
  },

  async flush(editor) {
    const insertion = this.pending.get(editor);
    this.pending.delete(editor);
    if (!insertion || editor.isDestroyed() || editor.isReadOnly()) return;
    if (!this.handlesGrammar(editor)) return;
    const subscriptions = this.subscriptions;
    const buffer = editor.getBuffer();
    if (buffer.getTextRevision() !== insertion.revision) return;
    const { positions } = insertion;
    const languageMode = buffer.getLanguageMode();
    const syntaxEpoch = languageMode.getSyntaxRequestEpoch?.();
    const options = {
      forceInline: lumine.config.get("autoclose-html.forceInline") ?? [],
      forceBlock: lumine.config.get("autoclose-html.forceBlock") ?? [],
      neverClose: lumine.config.get("autoclose-html.neverClose") ?? [],
      selfClose: lumine.config.get("autoclose-html.makeNeverCloseSelfClosing"),
    };
    let entries;
    const selections = editor.getSelections().map((selection) => ({
      range: selection.getBufferRange(),
      reversed: selection.isReversed(),
    }));
    const insertedAt = new Set(positions.map(({ row, column }) => `${row}:${column}`));
    const selectedAt = new Set(
      selections.map(({ range }) => `${range.end.row}:${range.end.column}`),
    );
    // The delimiter still belongs to its cursor, even when a mixed clipboard
    // inserted different text at the other cursors.
    if (
      selections.some(({ range }) => !range.isEmpty()) ||
      [...insertedAt].some((position) => !selectedAt.has(position))
    )
      return;
    const requests = this.requests;
    requests.get(editor)?.abort();
    const controller = new AbortController();
    requests.set(editor, controller);
    const cancel = () => controller.abort();
    const changes = new CompositeDisposable(
      buffer.onDidChangeText(cancel),
      editor.onDidChangeGrammar(cancel),
      lumine.config.onDidChange("autoclose-html", cancel),
    );
    subscriptions.add(changes);
    try {
      entries = await editor.analyzeSyntax(
        require.resolve("./syntax-analysis"),
        "plan",
        { positions, options },
        { signal: controller.signal },
      );
    } catch {
      return;
    } finally {
      subscriptions.remove(changes);
      changes.dispose();
      if (requests.get(editor) === controller) requests.delete(editor);
    }
    if (
      !entries ||
      controller.signal.aborted ||
      editor.isDestroyed() ||
      editor.isReadOnly() ||
      buffer.getTextRevision() !== insertion.revision ||
      this.subscriptions !== subscriptions ||
      buffer.getLanguageMode() !== languageMode ||
      languageMode.getSyntaxRequestEpoch?.() !== syntaxEpoch ||
      !lumine.config.get("autoclose-html.enabled") ||
      !this.handlesGrammar(editor)
    ) {
      return;
    }
    const currentSelections = editor.getSelections();
    if (
      currentSelections.length !== selections.length ||
      currentSelections.some(
        (selection, index) =>
          !selection.getBufferRange().isEqual(selections[index].range) ||
          selection.isReversed() !== selections[index].reversed,
      )
    ) {
      return;
    }
    const untouched = selections
      .filter(({ range }) => !insertedAt.has(`${range.end.row}:${range.end.column}`))
      .map(({ range }) => ({ position: range.end }));
    this.closeTagsAt(editor, entries.concat(untouched), options);
  },

  closeTagsAt(editor, entries, options) {
    if (!entries.some((entry) => entry.tag)) return;

    // Core emits insertions in buffer order. Preserve the user's cursor order
    // when rebuilding them so the most recently added cursor stays primary.
    const cursorOrder = new Map(
      editor
        .getCursorBufferPositions()
        .map((position, index) => [`${position.row}:${position.column}`, index]),
    );
    const orderFor = ({ position }) =>
      cursorOrder.get(`${position.row}:${position.column}`) ?? Infinity;
    entries.sort((a, b) => orderFor(a) - orderFor(b));

    // Applied bottom-up, so an insertion can never shift a position that has
    // not been handled yet. The cursor each entry should end on is held by a
    // marker rather than a plain point, because an insertion higher up the
    // buffer still moves the positions already decided further down.
    const bottomUp = [...entries].sort(
      (a, b) => b.position.row - a.position.row || b.position.column - a.position.column,
    );

    editor.transact(() => {
      for (const entry of bottomUp) {
        const cursor = entry.tag ? this.closeTag(editor, entry, options) : entry.position;
        entry.marker = editor.markBufferPosition(cursor, { invalidate: "never" });
      }
    });

    // The `>` landed in its own transaction before parsing. Fold an actual
    // closing edit into it so a single undo removes the whole insertion; a
    // no-op must leave the preceding transaction untouched.
    const inserted = entries.some(({ tag, hasClosingTag }) => {
      if (!tag) return false;
      return isNeverClosed(tag, options.neverClose) ? options.selfClose : !hasClosingTag;
    });
    if (inserted) editor.getBuffer().groupLastChanges();

    const cursors = entries.map((entry) => {
      const position = entry.marker.getHeadBufferPosition();
      entry.marker.destroy();
      return position;
    });

    editor.setCursorBufferPosition(cursors[0]);
    for (const cursor of cursors.slice(1)) editor.addCursorAtBufferPosition(cursor);
  },

  // Writes the closing tag for a single `>` and returns where its cursor
  // belongs afterwards.
  closeTag(editor, { position, tag, hasClosingTag }, options) {
    const buffer = editor.getBuffer();

    if (isNeverClosed(tag, options.neverClose)) {
      if (!options.selfClose) return position;

      // Replace the `>` itself, keeping a single space in front of the slash.
      // Upstream tested the character *after* the one it meant to, so it always
      // added a space and turned `<br >` into `<br  />`.
      const slashStart = [position.row, position.column - 1];
      const preceding = editor.getTextInBufferRange([
        [position.row, Math.max(0, position.column - 2)],
        slashStart,
      ]);
      const replacement = preceding === " " ? "/>" : " />";
      buffer.setTextInRange([slashStart, position], replacement);
      return [position.row, position.column - 1 + replacement.length];
    }

    if (hasClosingTag) return position;

    if (isInline(tag, options)) {
      buffer.insert(position, `</${tag}>`);
      return position;
    }

    const indent = editor.indentationForBufferRow(position.row);
    buffer.insert(position, `\n\n</${tag}>`);
    // Indent explicitly rather than leaning on the grammar's auto-indent: the
    // result is the same for every HTML-ish grammar, respects soft tabs and tab
    // length, and is what a spec can actually assert.
    editor.setIndentationForBufferRow(position.row + 1, indent + 1);
    editor.setIndentationForBufferRow(position.row + 2, indent);
    return [position.row + 1, buffer.lineLengthForRow(position.row + 1)];
  },
};
