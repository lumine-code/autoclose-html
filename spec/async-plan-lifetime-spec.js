describe("Autoclose HTML asynchronous plan lifetime", () => {
  let editor, main, release, pending, request;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("autoclose-html")).mainModule;
    editor = await lumine.workspace.open();
    lumine.config.set("autoclose-html.grammars", [editor.getGrammar().scopeName]);
    editor.setText("<span");
    editor.setCursorBufferPosition([0, 5]);
    const flush = main.flush.bind(main);
    spyOn(main, "flush").and.callFake((...args) => (pending = flush(...args)));
    spyOn(editor, "analyzeSyntax").and.callFake((_module, _method, _params, options) => {
      request = options;
      return new Promise((resolve) => {
        release = () => resolve([{ position: { row: 0, column: 6 }, tag: "span" }]);
      });
    });
  });

  afterEach(async () => {
    release?.();
    await pending;
    editor?.destroy();
    await lumine.packages.deactivatePackage("autoclose-html");
    release = pending = request = null;
  });

  async function start() {
    editor.insertText(">");
    await Promise.resolve();
    expect(editor.analyzeSyntax).toHaveBeenCalled();
  }

  it("does not write into an editor made read-only while parsing", async () => {
    await start();
    editor.setReadOnly(true);
    release();
    await pending;
    expect(editor.getText()).toBe("<span>");
  });

  it("ignores an insertion whose text changed before the deferred plan started", async () => {
    editor.insertText(">");
    editor.insertText("x");
    await Promise.resolve();
    release?.();
    await pending;
    expect(editor.getText()).toBe("<span>x");
    expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 7]);
    expect(editor.analyzeSyntax).not.toHaveBeenCalled();
  });

  it("cancels a syntax request when its package is deactivated", async () => {
    await start();
    await lumine.packages.deactivatePackage("autoclose-html");
    expect(request?.signal?.aborted).toBe(true);
    release();
    await pending;
    expect(editor.getText()).toBe("<span>");
  });

  it("ignores an insertion whose cursor moved before the deferred plan started", async () => {
    editor.insertText(">");
    editor.setCursorBufferPosition([0, 0]);
    await Promise.resolve();
    release?.();
    await pending;
    expect(editor.getText()).toBe("<span>");
    expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 0]);
    expect(editor.analyzeSyntax).not.toHaveBeenCalled();
  });

  it("closes a pasted delimiter while retaining cursors that received different text", async () => {
    editor.analyzeSyntax.and.callThrough();
    editor.setText("<span\n<span");
    editor.setCursorBufferPosition([0, 5]);
    editor.addCursorAtBufferPosition([1, 5]);
    await editor.pasteText({
      autoIndent: false,
      clipboard: {
        readWithMetadata: () => ({
          text: "x\n>",
          metadata: { selections: [{ text: "x" }, { text: ">" }] },
        }),
      },
    });
    release?.();
    await pending;
    expect(editor.getText()).toBe("<spanx\n<span></span>");
    expect(editor.getCursorBufferPositions().map((position) => position.toArray())).toEqual([
      [0, 6],
      [1, 6],
    ]);
    expect(editor.analyzeSyntax).toHaveBeenCalled();
  });

  it("retains a later mixed-paste cursor shifted by a closing tag on the same row", async () => {
    editor.analyzeSyntax.and.callThrough();
    editor.setText("<span <span");
    editor.setCursorBufferPosition([0, 5]);
    editor.addCursorAtBufferPosition([0, 11]);
    await editor.pasteText({
      autoIndent: false,
      clipboard: {
        readWithMetadata: () => ({
          text: ">\nx",
          metadata: { selections: [{ text: ">" }, { text: "x" }] },
        }),
      },
    });
    await pending;
    expect(editor.getText()).toBe("<span></span> <spanx");
    expect(editor.getCursorBufferPositions().map((position) => position.toArray())).toEqual([
      [0, 6],
      [0, 20],
    ]);
    editor.undo();
    expect(editor.getText()).toBe("<span <span");
  });

  it("cancels a syntax request when its editor closes", async () => {
    await start();
    editor.destroy();
    expect(request?.signal?.aborted).toBe(true);
  });

  it("cancels a syntax request after an intervening edit", async () => {
    await start();
    editor.insertText("x");
    expect(request?.signal?.aborted).toBe(true);
    release();
    await pending;
    expect(editor.getText()).toBe("<span>x");
  });

  it("discards a plan after tag closing rules change", async () => {
    await start();
    lumine.config.set("autoclose-html.neverClose", ["span"]);
    release();
    await pending;
    expect(editor.getText()).toBe("<span>");
  });
});
