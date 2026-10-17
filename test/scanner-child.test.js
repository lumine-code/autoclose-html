const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const runScannerChild = require("./helpers/scanner-child");
const scanner = path.resolve(__dirname, "../lib/tag-scanner.js");

test("separate delayed bootstrap from actual long-name scanning", { timeout: 15000 }, async (t) => {
  const spawn = childProcess.spawn.bind(childProcess);
  t.mock.method(childProcess, "spawn", (binary, args, options) =>
    spawn(
      binary,
      [
        args[0],
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2700);\n" + args[1],
        ...args.slice(2),
      ],
      options,
    ),
  );
  const result = await runScannerChild(
    process.execPath,
    'const {openingTagBefore}=require(process.argv[1]);const text="<"+"a".repeat(100000)+"/>";console.log(JSON.stringify(openingTagBefore(text,text.length)));',
    scanner,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "null");
  assert.ok(result.startupMs >= 2700);
  assert.ok(result.executionMs < 2500);
  assert.equal(result.reaped, true);
});

test("terminate and reap a scanner child stuck after RUN", { timeout: 15000 }, async () => {
  const result = await runScannerChild(process.execPath, "while(true){}", scanner);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.match(result.error.message, /execution timed out after 2500ms/);
  assert.equal(result.phase, "execution");
  assert.notEqual(result.status, 0);
  assert.equal(result.reaped, true);
});

test("preserve an actual nonzero scanner child exit", { timeout: 15000 }, async () => {
  const result = await runScannerChild(process.execPath, "process.exit(23)", scanner);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 23);
  assert.equal(result.reaped, true);
});

test("preserve an unavailable scanner executable error", { timeout: 15000 }, async () => {
  const result = await runScannerChild(
    path.join(__dirname, "missing-scanner-executable"),
    "",
    scanner,
  );
  assert.equal(result.error?.code, "ENOENT");
  assert.notEqual(result.status, 0);
  assert.equal(result.reaped, true);
});
