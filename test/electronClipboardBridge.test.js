const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const bridgePath = path.join(
  __dirname,
  "..",
  "dist",
  "runtime",
  "main",
  "mainProcess",
  "ipcBridge",
  "registerOsBridge.js"
);

const loadBridge = (clipboard) => {
  const handlers = new Map();
  const errors = [];
  const module = { exports: {} };
  const runtimeRequire = createRequire(bridgePath);
  vm.runInNewContext(
    fs.readFileSync(bridgePath, "utf8"),
    {
      module,
      exports: module.exports,
      require: (id) =>
        id === "electron"
          ? {
              clipboard,
              ipcMain: { on: (channel, handler) => handlers.set(channel, handler) },
              shell: {},
            }
          : runtimeRequire(id),
      console: { error: (...args) => errors.push(args) },
    },
    { filename: bridgePath }
  );
  module.exports.registerOsBridge();
  return { handlers, errors };
};

test("clipboard bridge preserves string and boolean replies with sync or async APIs", async () => {
  for (const asynchronous of [false, true]) {
    const written = [];
    const { handlers, errors } = loadBridge({
      readText: () => (asynchronous ? Promise.resolve("clipboard text") : "clipboard text"),
      writeText: (text) => {
        written.push(text);
        return asynchronous ? Promise.resolve() : undefined;
      },
    });
    const readEvent = {};
    const writeEvent = {};
    await handlers.get("bridge:os:clipboardReadText")(readEvent);
    await handlers.get("bridge:os:clipboardWriteText")(writeEvent, 123);
    assert.equal(readEvent.returnValue, "clipboard text");
    assert.equal(writeEvent.returnValue, true);
    assert.deepEqual(written, ["123"]);
    assert.deepEqual(errors, []);
  }
});

test("clipboard write does not report success before the operation finishes", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { handlers } = loadBridge({ writeText: () => pending });
  const event = {};
  const result = handlers.get("bridge:os:clipboardWriteText")(event, "text");
  assert.equal(event.returnValue, undefined);
  finish();
  await result;
  assert.equal(event.returnValue, true);
});

test("clipboard failures preserve failure replies and log rejected operations", async () => {
  for (const asynchronous of [false, true]) {
    const failure = () => {
      const error = new Error("Clipboard unavailable");
      if (asynchronous) return Promise.reject(error);
      throw error;
    };
    const { handlers, errors } = loadBridge({ readText: failure, writeText: failure });
    const readEvent = {};
    const writeEvent = {};
    await handlers.get("bridge:os:clipboardReadText")(readEvent);
    await handlers.get("bridge:os:clipboardWriteText")(writeEvent, "text");
    assert.equal(readEvent.returnValue, "");
    assert.equal(writeEvent.returnValue, false);
    assert.equal(errors.length, 2);
  }
});
