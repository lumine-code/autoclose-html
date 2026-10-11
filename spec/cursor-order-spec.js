describe("Autoclose HTML cursor creation order", () => {
  let editor, main, closed;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      spyOn(lumine.shell, method).and.resolveTo();
    }
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open();
    main = (await lumine.packages.activatePackage("autoclose-html")).mainModule;
    lumine.config.set("autoclose-html.grammars", [editor.getGrammar().scopeName]);
    const close = main.closeTagsAt.bind(main);
    closed = false;
    spyOn(main, "closeTagsAt").and.callFake((...args) => {
      close(...args);
      closed = true;
    });
  });

  afterEach(async () => {
    editor?.destroy();
    if (lumine.packages.isPackageLoaded("autoclose-html")) {
      await lumine.packages.unloadPackage("autoclose-html");
    }
    await lumine.fileWatchClient.settlePendingTeardown();
  });

  async function closesAt(positions) {
    editor.setText("<span\n<span");
    editor.setCursorBufferPosition(positions[0]);
    for (const position of positions.slice(1)) editor.addCursorAtBufferPosition(position);
    expect(editor.getCursorBufferPositions().map((p) => p.toArray())).toEqual(positions);
    editor.insertText(">");
    await conditionPromise(() => closed, "the real deferred closing pass");
    expect(editor.getText()).toBe("<span></span>\n<span></span>");
    const expected = positions.map(([row]) => [row, 6]);
    expect(editor.getCursorBufferPositions().map((p) => p.toArray())).toEqual(expected);
    expect(editor.getCursorBufferPosition()).toEqual(expected.at(-1));
  }

  it("retains an upper primary cursor added after a lower cursor", async () => {
    await closesAt([
      [1, 5],
      [0, 5],
    ]);
  });

  it("retains ordinary top-to-bottom cursor creation", async () => {
    await closesAt([
      [0, 5],
      [1, 5],
    ]);
  });

  it("keeps a single cursor between its opening and closing tag", async () => {
    editor.setText("<span");
    editor.setCursorBufferPosition([0, 5]);
    editor.insertText(">");
    await conditionPromise(() => closed, "the single closing pass");
    expect(editor.getText()).toBe("<span></span>");
    expect(editor.getCursorBufferPositions().map((p) => p.toArray())).toEqual([[0, 6]]);
  });
});
