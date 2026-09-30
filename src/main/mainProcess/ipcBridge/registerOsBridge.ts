import { clipboard, ipcMain, shell } from "electron";

import { normalizeOpenExternalUrl } from "../../../shared/validation/openExternalValidation";

export function registerOsBridge(): void {
  ipcMain.on("bridge:os:clipboardWriteText", async (event, text) => {
    try {
      await clipboard.writeText(String(text ?? ""));
      event.returnValue = true;
    } catch (error) {
      console.error("[Main] Clipboard write failed:", error);
      event.returnValue = false;
    }
  });

  ipcMain.on("bridge:os:clipboardReadText", async (event) => {
    try {
      event.returnValue = await clipboard.readText();
    } catch (error) {
      console.error("[Main] Clipboard read failed:", error);
      event.returnValue = "";
    }
  });

  ipcMain.on("bridge:os:openExternal", (event, url) => {
    try {
      const normalized = normalizeOpenExternalUrl(url);
      if (!normalized) {
        event.returnValue = false;
        return;
      }
      shell.openExternal(normalized).catch(() => {});
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
}
