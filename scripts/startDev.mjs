import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import webpack from "webpack";
import webpackConfig from "../webpack.config.js";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const rendererFiles = ["dashboard.js", "projector.js", "moduleSandbox.js"];

export function watchAndLaunch({
  compiler,
  launch,
  outputsReady,
  reportError = console.error,
  reportBuild = console.log,
  onStopped = () => {},
}) {
  let child = null;
  let launched = false;
  let stopped = false;
  let watcher;

  const stop = (code = 0) => {
    if (stopped) return;
    stopped = true;
    if (child) {
      child.kill();
      child = null;
    }
    watcher.close((watchError) => {
      compiler.close((compilerError) => {
        if (watchError || compilerError) {
          reportError("[Dev] Failed to close renderer watcher:", watchError || compilerError);
        }
        onStopped(watchError || compilerError ? 1 : code);
      });
    });
  };

  watcher = compiler.watch(compiler.options.watchOptions || {}, (error, stats) => {
    if (stopped) return;
    if (error) {
      reportError("[Dev] Renderer watcher failed:", error);
      stop(1);
      return;
    }
    reportBuild(
      stats.toString({ colors: Boolean(process.stdout.isTTY), preset: "errors-warnings" })
    );
    if (stats.hasErrors() || launched) return;
    if (!outputsReady()) {
      reportError("[Dev] Renderer build completed without all three output bundles.");
      return;
    }
    try {
      child = launch();
      launched = true;
      child.once("error", (launchError) => {
        reportError("[Dev] Electron failed to start:", launchError);
        stop(1);
      });
      child.once("exit", (code, signal) => {
        child = null;
        stop(code ?? (signal ? 1 : 0));
      });
    } catch (launchError) {
      reportError("[Dev] Electron failed to start:", launchError);
      stop(1);
    }
  });

  return { stop };
}

function main() {
  const config = webpackConfig({}, { mode: "development" });
  const compiler = webpack({ ...config, context: repoRoot });
  const runner = watchAndLaunch({
    compiler,
    launch: () => spawn(require("electron"), [path.join(repoRoot, "src")], { stdio: "inherit" }),
    outputsReady: () =>
      rendererFiles.every((name) => existsSync(path.join(repoRoot, "dist", name))),
    onStopped: (code) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      process.exitCode = code;
    },
  });
  const stop = () => runner.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
