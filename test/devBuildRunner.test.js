const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

async function harness() {
  const { watchAndLaunch } = await import("../scripts/startDev.mjs");
  const child = new EventEmitter();
  let complete;
  const state = {
    launches: 0,
    kills: 0,
    watchCloses: 0,
    compilerCloses: 0,
    outputsReady: true,
    errors: [],
    exitCodes: [],
    launchError: null,
  };
  child.kill = () => {
    state.kills += 1;
  };
  const runner = watchAndLaunch({
    compiler: {
      options: { watchOptions: { ignored: /userData\.json$/ } },
      watch: (_options, callback) => {
        complete = callback;
        return {
          close: (done) => {
            state.watchCloses += 1;
            done();
          },
        };
      },
      close: (done) => {
        state.compilerCloses += 1;
        done();
      },
    },
    launch: () => {
      if (state.launchError) throw state.launchError;
      state.launches += 1;
      return child;
    },
    outputsReady: () => state.outputsReady,
    reportError: (...args) => state.errors.push(args),
    reportBuild: () => {},
    onStopped: (code) => state.exitCodes.push(code),
  });
  return {
    state,
    child,
    stop: runner.stop,
    complete: (hasErrors = false, error = null) =>
      complete(error, { hasErrors: () => hasErrors, toString: () => "" }),
  };
}

test("old bundles do not launch Electron before this watcher's successful build", async () => {
  const h = await harness();
  assert.equal(h.state.launches, 0);
  h.complete(true);
  assert.equal(h.state.launches, 0);
  h.complete();
  assert.equal(h.state.launches, 1);
  h.complete();
  assert.equal(h.state.launches, 1, "rebuilds must not launch another app");
  h.stop();
});

test("a fresh successful build must include all renderer outputs", async () => {
  const h = await harness();
  h.state.outputsReady = false;
  h.complete();
  assert.equal(h.state.launches, 0);
  assert.equal(h.state.errors.length, 1);
  h.state.outputsReady = true;
  h.complete();
  assert.equal(h.state.launches, 1);
  h.stop();
});

test("stopping closes the watcher and its app exactly once", async () => {
  const h = await harness();
  h.complete();
  h.stop();
  h.stop();
  h.complete();
  assert.equal(h.state.kills, 1);
  assert.equal(h.state.watchCloses, 1);
  assert.equal(h.state.compilerCloses, 1);
  assert.deepEqual(h.state.exitCodes, [0]);
  assert.equal(h.state.launches, 1);
});

test("normal app exit closes the watcher without restarting or killing an exited app", async () => {
  const h = await harness();
  h.complete();
  h.child.emit("exit", 0, null);
  assert.equal(h.state.kills, 0);
  assert.equal(h.state.watchCloses, 1);
  assert.deepEqual(h.state.exitCodes, [0]);
});

test("watch and launch failures are reported with failing exit status", async () => {
  for (const failure of ["watch", "throw", "child-error"]) {
    const h = await harness();
    if (failure === "watch") h.complete(false, new Error("Watch failed"));
    else if (failure === "throw") {
      h.state.launchError = new Error("Spawn failed");
      h.complete();
    } else {
      h.complete();
      h.child.emit("error", new Error("Spawn failed"));
    }
    assert.equal(h.state.errors.length, 1);
    assert.equal(h.state.watchCloses, 1);
    assert.deepEqual(h.state.exitCodes, [1]);
  }
});
