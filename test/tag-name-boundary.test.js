const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { openingTagBefore } = require("../lib/tag-scanner");

for (const suffix of ["/>", " / data>"]) {
  test(`reject a long tag name with ${suffix} within a bounded process`, () => {
    const scanner = path.resolve(__dirname, "../lib/tag-scanner.js");
    const code = `const scanner = require(${JSON.stringify(scanner)}); const line = "<" + "a".repeat(100000) + ${JSON.stringify(suffix)}; console.log(JSON.stringify(scanner.openingTagBefore(line, line.length)));`;
    const result = spawnSync(process.execPath, ["-e", code], {
      timeout: 2500,
      windowsHide: true,
      encoding: "utf8",
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "null");
  });
}

test("preserve whole names, quoted attributes and previously rejected syntax", () => {
  const fixtures = [
    ["<My.Widget title='a/b'>", "My.Widget"],
    ['<x-custom data-key="a>b">', "x-custom"],
    ["<foo:bar>", "foo:bar"],
    ["<br />", null],
    ["<div / data>", null],
    ["</div>", null],
  ];
  for (const [line, expected] of fixtures) {
    assert.equal(openingTagBefore(line, line.length), expected, line);
  }
  const name = "a".repeat(100000),
    line = `<${name}>`;
  assert.equal(openingTagBefore(line, line.length), name);
});
