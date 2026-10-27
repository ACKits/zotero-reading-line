import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { getPref } from "./utils/prefs";

// ==================== 样式 ====================

function buildWaveSvg(color: string, width: number): string {
  const encoded = color.replace("#", "%23");
  const w = Math.max(1, Math.min(5, width || 2));
  const h = Math.max(w * 4, 8);
  const period = h * 2;
  return (
    `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' ` +
    `width='${period}' height='${h}'>` +
    `<path d='M0 ${h / 2} Q ${period / 4} 0 ${period / 2} ${h / 2} ` +
    `T ${period} ${h / 2}' fill='none' stroke='${encoded}' ` +
    `stroke-width='${w}' stroke-linecap='round'/></svg>`
  );
}

function applyLineStyle(
  line: HTMLElement,
  style: string,
  color: string,
  width: number,
) {
  line.style.backgroundImage = "";
  line.style.backgroundColor = "";
  line.style.backgroundRepeat = "";
  line.style.backgroundSize = "";
  line.style.borderTop = "";

  const w = Math.max(1, Math.min(5, width || 2));

  if (style === "line") {
    line.style.backgroundColor = color;
    line.style.height = `${w}px`;
  } else if (style === "dashed") {
    line.style.borderTop = `${w}px dashed ${color}`;
    line.style.height = "0px";
  } else {
    const h = Math.max(w * 4, 8);
    const period = h * 2;
    line.style.backgroundImage = `url("${buildWaveSvg(color, w)}")`;
    line.style.backgroundRepeat = "repeat-x";
    line.style.backgroundSize = `${period}px ${h}px`;
    line.style.height = `${h}px`;
  }
}

function applyAnimation(line: HTMLElement, anim: string) {
  if (anim === "instant") {
    line.style.transition =
      "top 0.04s linear, left 0.15s ease, width 0.15s ease";
  } else if (anim === "fade") {
    line.style.transition =
      "opacity 0.25s ease, top 0.04s linear, left 0.15s ease, width 0.15s ease";
  } else {
    line.style.transition =
      "opacity 0.25s ease, transform 0.25s ease, top 0.04s linear, left 0.15s ease, width 0.15s ease";
  }
}

// ==================== 横线注入 ====================

function getPdfWindow(reader: any): Window | null {
  try {
    if (!reader?._iframeWindow) return null;
    const outerWin: Window =
      reader._iframeWindow.wrappedJSObject || reader._iframeWindow;
    const outerDoc = outerWin.document;
    if (!outerDoc) return outerWin;

    const frame =
      (outerDoc.getElementById("viewerFrame") as HTMLIFrameElement | null) ||
      (outerDoc.querySelector("iframe") as HTMLIFrameElement | null);

    if (frame && frame.contentWindow) return frame.contentWindow;
    return outerWin;
  } catch (e) {
    Zotero.debug("[ReadingLine] getPdfWindow error: " + e, 1);
    return null;
  }
}

function getPageAt(doc: Document, x: number, y: number): HTMLElement | null {
  try {
    const el = doc.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    if (typeof el.closest === "function") {
      return el.closest(".page") as HTMLElement | null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function injectReadingLine(reader: any): (() => void) | null {
  try {
    const win = getPdfWindow(reader);
    if (!win) return null;
    const doc = win.document;
    if (!doc?.body) return null;

    const existing = doc.getElementById("zotero-reading-line");
    if (existing) existing.remove();

    const line = doc.createElement("div");
    line.id = "zotero-reading-line";
    line.style.cssText = [
      "position:fixed",
      "left:0",
      "width:0",
      "pointer-events:none",
      "z-index:2147483647",
      "top:0",
      "opacity:0",
      "transform:translateY(-50%) scaleY(1)",
    ].join(";");

    const style = getPref("lineStyle") || "wave";
    const color = getPref("lineColor") || "#e11d48";
    const width = Number(getPref("lineWidth")) || 2;
    const anim = getPref("lineAnimation") || "fade";
    const delayPref = Number(getPref("lineDelay"));
    const SHOW_DELAY =
      !isNaN(delayPref) && delayPref >= 100 && delayPref <= 2000
        ? delayPref
        : 400;

    Zotero.debug(
      `[ReadingLine] apply style=${style} color=${color} width=${width} anim=${anim} delay=${SHOW_DELAY}`,
      1,
    );

    applyLineStyle(line, style, color, width);
    applyAnimation(line, anim);
    doc.body.appendChild(line);

    let showTimer: any = null;
    let lastMoveTime = 0;
    let pointerDown = false;

    const hiddenTransform =
      anim === "fade-slide"
        ? "translateY(-50%) scaleY(0.4)"
        : "translateY(-50%) scaleY(1)";
    const shownTransform = "translateY(-50%) scaleY(1)";

    const hideLine = () => {
      line.style.opacity = "0";
      if (anim === "fade-slide") {
        line.style.transform = hiddenTransform;
      }
    };
    const showLine = () => {
      line.style.opacity = "1";
      if (anim === "fade-slide") {
        line.style.transform = shownTransform;
      }
    };
    const clearShowTimer = () => {
      if (showTimer !== null) {
        win.clearTimeout(showTimer);
        showTimer = null;
      }
    };
    const cancelAndHide = () => {
      clearShowTimer();
      hideLine();
    };

    const hasActiveSelection = (): boolean => {
      try {
        const sel = win.getSelection();
        if (!sel) return false;
        if (sel.isCollapsed) return false;
        return sel.toString().length > 0;
      } catch (_) {
        return false;
      }
    };

    const updatePageBounds = (page: HTMLElement) => {
      try {
        const rect = page.getBoundingClientRect();
        line.style.left = `${rect.left}px`;
        line.style.width = `${rect.width}px`;
      } catch (_) {}
    };

    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastMoveTime < 16) return;
      lastMoveTime = now;

      const page = getPageAt(doc, e.clientX, e.clientY);
      if (page) updatePageBounds(page);

      line.style.top = `${e.clientY}px`;
      hideLine();
      clearShowTimer();

      if (pointerDown) return;
      if (!page) return;

      const x = e.clientX;
      const y = e.clientY;
      showTimer = win.setTimeout(() => {
        showTimer = null;
        if (pointerDown) return;
        if (hasActiveSelection()) return;
        const pageNow = getPageAt(doc, x, y);
        if (!pageNow) return;
        updatePageBounds(pageNow);
        showLine();
      }, SHOW_DELAY);
    };

    const onMouseDown = () => {
      pointerDown = true;
      cancelAndHide();
    };
    const onMouseUp = () => {
      pointerDown = false;
      cancelAndHide();
    };
    const onLeave = () => {
      cancelAndHide();
    };
    const onKeyDown = () => {
      cancelAndHide();
    };
    const onSelectionChange = () => {
      if (hasActiveSelection()) cancelAndHide();
    };
    const onWheel = () => {
      cancelAndHide();
    };
    const onScroll = () => {
      cancelAndHide();
    };

    win.addEventListener("mousemove", onMove, true);
    win.addEventListener("mousedown", onMouseDown, true);
    win.addEventListener("mouseup", onMouseUp, true);
    win.addEventListener("mouseleave", onLeave, true);
    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("wheel", onWheel, true);
    doc.addEventListener("selectionchange", onSelectionChange, true);
    doc.addEventListener("scroll", onScroll, true);

    return () => {
      clearShowTimer();
      win.removeEventListener("mousemove", onMove, true);
      win.removeEventListener("mousedown", onMouseDown, true);
      win.removeEventListener("mouseup", onMouseUp, true);
      win.removeEventListener("mouseleave", onLeave, true);
      win.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("wheel", onWheel, true);
      doc.removeEventListener("selectionchange", onSelectionChange, true);
      doc.removeEventListener("scroll", onScroll, true);
      line.remove();
    };
  } catch (e) {
    Zotero.debug("[ReadingLine] inject error: " + e, 1);
    return null;
  }
}

function attachToReader(reader: any, addon: any): void {
  if (!reader || !reader._iframeWindow) return;
  if ((reader as any).__readingLineInjected) return;
  const cleanup = injectReadingLine(reader);
  if (!cleanup) return;
  (reader as any).__readingLineInjected = true;
  addon.data.lineCleanups.push(() => {
    cleanup();
    (reader as any).__readingLineInjected = false;
  });
}

function scanAllTabs(addon: any): void {
  try {
    const readers: any[] = (Zotero.Reader as any)._readers || [];
    for (const r of readers) attachToReader(r, addon);
  } catch (e) {
    Zotero.debug("[ReadingLine] scan error: " + e, 1);
  }
}

function reapplyAll(addon: any): void {
  Zotero.debug("[ReadingLine] reapplyAll", 1);
  for (const fn of addon.data.lineCleanups) {
    try {
      fn();
    } catch (_) {}
  }
  addon.data.lineCleanups = [];
  scanAllTabs(addon);
}

// ==================== 注册首选项面板 ====================

async function registerPreferencePane(addon: any): Promise<void> {
  try {
    const src = `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`;
    await Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src,
    });
    Zotero.debug("[ReadingLine] preference pane registered", 1);
  } catch (e) {
    Zotero.debug("[ReadingLine] preference pane register failed: " + e, 1);
  }
}

// ==================== 启动 ====================

function startReadingLine(addon: any) {
  Zotero.debug("[ReadingLine] starting", 1);

  let notifierID: any = null;
  try {
    notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (event: string, type: string, ids: any[], extraData: any) => {
          if (type !== "tab") return;
          if (event !== "add" && event !== "select") return;
          for (const id of ids) {
            const data = extraData?.[id];
            if (data?.type !== "reader") continue;
            setTimeout(() => {
              try {
                const reader = Zotero.Reader.getByTabID(id);
                if (reader) attachToReader(reader, addon);
              } catch (_) {}
            }, 800);
          }
        },
      },
      ["tab"],
      addon.data.config.addonRef,
    );
  } catch (e) {
    Zotero.debug("[ReadingLine] notifier error: " + e, 1);
  }

  const prefObserverIDs: symbol[] = [];
  const prefKeys = [
    "lineStyle",
    "lineColor",
    "lineWidth",
    "lineAnimation",
    "lineDelay",
  ];
  for (const k of prefKeys) {
    const fullKey = `${addon.data.config.prefsPrefix}.${k}`;
    const handler = () => reapplyAll(addon);
    try {
      const observerID = Zotero.Prefs.registerObserver(fullKey, handler, true);
      if (observerID) {
        prefObserverIDs.push(observerID);
      }
      Zotero.debug("[ReadingLine] observer registered: " + fullKey, 1);
    } catch (e) {
      Zotero.debug("[ReadingLine] prefs observer error: " + e, 1);
    }
  }

  const timer = setInterval(() => {
    if (!addon.data.alive) return;
    scanAllTabs(addon);
  }, 2000);

  scanAllTabs(addon);

  addon.data.cleanupHook = () => {
    clearInterval(timer);
    if (notifierID) {
      try {
        Zotero.Notifier.unregisterObserver(notifierID);
      } catch (_) {}
    }
    for (const id of prefObserverIDs) {
      try {
        Zotero.Prefs.unregisterObserver(id);
      } catch (_) {}
    }
    for (const fn of addon.data.lineCleanups) {
      try {
        fn();
      } catch (_) {}
    }
    addon.data.lineCleanups = [];
  };

  Zotero.debug("[ReadingLine] started", 1);
}

// ==================== 生命周期 ====================

async function onStartup() {
  try {
    initLocale();
  } catch (_) {}

  await registerPreferencePane(addon);

  setTimeout(() => startReadingLine(addon), 2000);
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  try {
    addon.data.ztoolkit = createZToolkit();
    win.MozXULElement.insertFTLIfNeeded(
      `${addon.data.config.addonRef}-mainWindow.ftl`,
    );
  } catch (_) {}
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  try {
    ztoolkit.unregisterAll();
  } catch (_) {}
}

function onShutdown(): void {
  try {
    addon.data.cleanupHook?.();
  } catch (_) {}
  addon.data.cleanupHook = undefined;
  try {
    ztoolkit.unregisterAll();
  } catch (_) {}
  addon.data.alive = false;
  try {
    // @ts-expect-error - Plugin instance is not typed
    delete Zotero[addon.data.config.addonInstance];
  } catch (_) {}
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {}
async function onPrefsEvent(_type: string, _data: { [key: string]: any }) {}
function onShortcuts(_type: string) {}
function onDialogEvents(_type: string) {}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};