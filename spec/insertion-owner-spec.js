describe("Autoclose insertion observer owner", () => {
  let main, editor, interrupt, early, observedFlush;
  beforeEach(async () => {
    observedFlush = null;
    editor = await lumine.workspace.open();
    interrupt = () => {};
    early = editor.onDidInsertText(() => interrupt());
    main = (await lumine.packages.activatePackage("autoclose-html")).mainModule;
    lumine.config.set("autoclose-html.grammars", [editor.getGrammar().scopeName]);
    const flush = main.flush.bind(main);
    spyOn(main, "flush").and.callFake((...args) => {
      observedFlush = flush(...args);
      void observedFlush.catch(() => {});
      // Keep the scheduling wrapper fulfilled while observing the actual helper result.
    });
  });
  afterEach(() => early.dispose());

  it("ignores an emitter snapshot callback whose owner was retired by an earlier listener", async () => {
    editor.setText("<span");
    editor.setCursorBufferPosition([0, 5]);
    interrupt = () => main.deactivate();

    editor.insertText(">");
    await Promise.resolve();
    await expectAsync(observedFlush ?? Promise.resolve()).toBeResolved();

    expect(main.pending.size).toBe(0);
    expect(editor.getText()).toBe("<span>");
    main.activate();
  });

  it("does not process a retired insertion callback as a replacement activation", async () => {
    editor.setText("<span");
    editor.setCursorBufferPosition([0, 5]);
    interrupt = () => {
      main.deactivate();
      main.activate();
      interrupt = () => {};
    };

    editor.insertText(">");
    await Promise.resolve();
    if (observedFlush) await observedFlush;

    expect(editor.getText()).toBe("<span>");
    expect(main.pending.size).toBe(0);
    expect(main.flush).not.toHaveBeenCalled();

    editor.setText("<b");
    editor.setCursorBufferPosition([0, 2]);
    editor.insertText(">");
    await Promise.resolve();
    await observedFlush;
    expect(editor.getText()).toBe("<b></b>");
  });
});
