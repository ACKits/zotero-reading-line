import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { getPref } from "./utils/prefs";

// ==================== 样式 ====================

/**
 * 生成波浪线的 SVG 背景图（data URI）。
 * 线越粗，波浪越高、周期越长，保持视觉比例协调。
 */
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

/**
 * 把线型、颜色、线宽应用到横线元素上。
 * 直线用 background-color，虚线用 border-top dashed，波浪用 SVG 背景。
 * mask-image 让线两端渐隐，避免和页面边缘硬碰硬。
 */
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

  line.style.maskImage =
    "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)";
  line.style.webkitMaskImage = line.style.maskImage;

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

/**
 * 根据显示效果设置 CSS 过渡。
 * instant 只过渡位置；fade 过渡透明度；fade-slide 额外过渡 transform 缩放。
 */
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

/**
 * 拿到 PDF.js 实际渲染所在的 window。
 * Zotero 阅读器外层是 reader.html，PDF 内容在 #viewerFrame 内层 iframe 里。
 * 鼠标事件和坐标都以内层 window 为准，找不到内层时回退到外层。
 */
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

/**
 * 判断鼠标坐标落在哪一页的 .page 容器上。
 * 返回 null 表示鼠标在工具栏、页面间隙、侧栏等非正文区域。
 */
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

/**
 * 创建可拖拽的悬浮开关按钮。
 * - 点击：切换横线开启/关闭。
 * - 按住拖动：移动按钮位置，松手后停在当前位置。
 * - 拖拽超过 4px 视为拖动，不触发点击，避免误触。
 * - 按钮是独立元素，pointer-events 只作用于自身，不影响 PDF 交互。
 */
function createToggleButton(
  doc: Document,
  win: Window,
  onToggle: () => void,
): { el: HTMLButtonElement; destroy: () => void } {
  const btn = doc.createElement("button");
  btn.id = "zotero-reading-line-toggle";
  btn.type = "button";
  btn.title = "阅读参考线：点击开关，可拖动";

  // 初始位置：右下角。位置用 left/top 记录，方便拖拽时更新。
  btn.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "width:42px",
    "height:42px",
    "border-radius:50%",
    "border:2px solid rgba(255,255,255,0.9)",
    "background:#e11d48",
    "color:#ffffff",
    "cursor:grab",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:0",
    "opacity:0.92",
    "transition:opacity 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease",
    "box-shadow:0 3px 10px rgba(225,29,72,0.45), 0 1px 3px rgba(0,0,0,0.25)",
    "pointer-events:auto",
    "user-select:none",
    "touch-action:none",
  ].join(";");

  // 图标：一条横线 + 一个圆点，代表阅读参考线
  btn.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 11 H19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="11" cy="11" r="2.8" fill="currentColor"/>' +
    "</svg>";

  // ---------- 拖拽状态 ----------
  let dragging = false; // 是否正在拖动
  let moved = false; // 本次按下后是否移动超过阈值
  let startX = 0; // 按下时的鼠标 X
  let startY = 0; // 按下时的鼠标 Y
  let startLeft = 0; // 按下时按钮的 left
  let startTop = 0; // 按下时按钮的 top
  const DRAG_THRESHOLD = 4; // 移动超过 4px 才算拖动

  // 把按钮的定位从 right/bottom 切换成 left/top，方便拖拽计算
  const lockToLeftTop = () => {
    const rect = btn.getBoundingClientRect();
    btn.style.left = `${rect.left}px`;
    btn.style.top = `${rect.top}px`;
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  };

  const onPointerDown = (e: PointerEvent) => {
    // 只处理主键（左键或触摸）
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    lockToLeftTop();
    startLeft = parseFloat(btn.style.left) || 0;
    startTop = parseFloat(btn.style.top) || 0;
    btn.style.cursor = "grabbing";
    btn.style.transform = "scale(1.06)";
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (_) {}
    // 阻止事件冒泡到 PDF，避免拖拽按钮时触发选词
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      moved = true;
    }
    if (!moved) return;

    // 限制在视口内，避免拖出阅读器
    const maxLeft = win.innerWidth - btn.offsetWidth - 4;
    const maxTop = win.innerHeight - btn.offsetHeight - 4;
    const left = Math.min(Math.max(4, startLeft + dx), maxLeft);
    const top = Math.min(Math.max(4, startTop + dy), maxTop);
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;

    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    btn.style.cursor = "grab";
    btn.style.transform = "scale(1)";
    try {
      btn.releasePointerCapture(e.pointerId);
    } catch (_) {}

    // 移动距离没超过阈值，视为点击
    if (!moved) {
      onToggle();
    }

    e.preventDefault();
    e.stopPropagation();
  };

  const onHoverEnter = () => {
    btn.style.opacity = "1";
    btn.style.boxShadow =
      "0 5px 16px rgba(225,29,72,0.6), 0 2px 5px rgba(0,0,0,0.3)";
  };
  const onHoverLeave = () => {
    btn.style.opacity = btn.dataset.off === "1" ? "0.6" : "0.92";
    btn.style.boxShadow =
      "0 3px 10px rgba(225,29,72,0.45), 0 1px 3px rgba(0,0,0,0.25)";
  };

  btn.addEventListener("pointerdown", onPointerDown);
  btn.addEventListener("pointermove", onPointerMove);
  btn.addEventListener("pointerup", onPointerUp);
  btn.addEventListener("pointercancel", onPointerUp);
  btn.addEventListener("mouseenter", onHoverEnter);
  btn.addEventListener("mouseleave", onHoverLeave);

  // 阻止按钮上的 click 冒泡到 PDF，避免选词/双击冲突
  const onBlockClick = (e: MouseEvent) => {
    e.stopPropagation();
  };
  btn.addEventListener("click", onBlockClick);

  const destroy = () => {
    btn.removeEventListener("pointerdown", onPointerDown);
    btn.removeEventListener("pointermove", onPointerMove);
    btn.removeEventListener("pointerup", onPointerUp);
    btn.removeEventListener("pointercancel", onPointerUp);
    btn.removeEventListener("mouseenter", onHoverEnter);
    btn.removeEventListener("mouseleave", onHoverLeave);
    btn.removeEventListener("click", onBlockClick);
    btn.remove();
  };

  return { el: btn, destroy };
}

/**
 * 更新按钮外观，反映横线开关状态。
 * 开启：玫红色背景、白色图标；关闭：灰色背景、半透明。
 */
function updateButtonState(btn: HTMLButtonElement, enabled: boolean) {
  if (enabled) {
    btn.dataset.off = "0";
    btn.style.background = "#e11d48";
    btn.style.color = "#ffffff";
    btn.style.opacity = "0.92";
    btn.style.boxShadow =
      "0 3px 10px rgba(225,29,72,0.45), 0 1px 3px rgba(0,0,0,0.25)";
    btn.title = "阅读参考线：已开启（点击关闭，可拖动）";
  } else {
    btn.dataset.off = "1";
    btn.style.background = "#9ca3af";
    btn.style.color = "#f3f4f6";
    btn.style.opacity = "0.6";
    btn.style.boxShadow =
      "0 3px 10px rgba(107,114,128,0.35), 0 1px 3px rgba(0,0,0,0.2)";
    btn.title = "阅读参考线：已关闭（点击开启，可拖动）";
  }
}

/**
 * 向指定阅读器注入横线和悬浮按钮，并绑定所有交互监听。
 * 返回清理函数，阅读器关闭或设置变更时调用。
 */
function injectReadingLine(reader: any): (() => void) | null {
  try {
    const win = getPdfWindow(reader);
    if (!win) return null;
    const doc = win.document;
    if (!doc?.body) return null;

    // 清理旧元素，防止重复注入
    const existing = doc.getElementById("zotero-reading-line");
    if (existing) existing.remove();
    const existingBtn = doc.getElementById("zotero-reading-line-toggle");
    if (existingBtn) existingBtn.remove();

    // ---------- 创建横线元素 ----------
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

    // 读取用户设置
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

    // ---------- 内部状态 ----------
    let showTimer: any = null; // 静止后延迟显示的定时器
    let lastMoveTime = 0; // 16ms 节流用
    let pointerDown = false; // 鼠标是否按下（拖选等）

    let lastX = -1; // 上一次鼠标 X，用于抖动容差
    let lastY = -1;
    const JITTER_TOLERANCE = 5; // 抖动容差，像素

    let isShown = false; // 横线是否完整显示
    let breathTimer: any = null; // 呼吸定时器
    let breathStart = 0; // 呼吸开始时间

    let enabled = true; // 横线开关，默认开启

    const hiddenTransform =
      anim === "fade-slide"
        ? "translateY(-50%) scaleY(0.4)"
        : "translateY(-50%) scaleY(1)";
    const shownTransform = "translateY(-50%) scaleY(1)";

    // ---------- 显示/隐藏 ----------

    /** 呼吸动画：显示超过 2 秒后，透明度在 0.85–1.0 之间缓慢往复，周期 3 秒。 */
    const startBreathing = () => {
      if (breathTimer !== null) return;
      breathStart = Date.now();
      breathTimer = win.setInterval(() => {
        if (!isShown) return;
        const elapsed = Date.now() - breathStart;
        if (elapsed < 2000) return;
        const phase = ((elapsed - 2000) % 3000) / 3000;
        const v = 0.925 + 0.075 * Math.cos(phase * 2 * Math.PI);
        line.style.opacity = String(v);
      }, 50);
    };

    const stopBreathing = () => {
      if (breathTimer !== null) {
        win.clearInterval(breathTimer);
        breathTimer = null;
      }
      breathStart = 0;
    };

    const hideLine = () => {
      isShown = false;
      stopBreathing();
      line.style.opacity = "0";
      if (anim === "fade-slide") {
        line.style.transform = hiddenTransform;
      }
    };

    const showLine = () => {
      isShown = true;
      line.style.opacity = "1";
      if (anim === "fade-slide") {
        line.style.transform = shownTransform;
      }
      startBreathing();
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

    /** 检查是否有非空文字选区。有选区时不应该显示横线。 */
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

    /** 根据鼠标所在页面的边界，更新横线 left 和 width，只覆盖该页宽度。 */
    const updatePageBounds = (page: HTMLElement) => {
      try {
        const rect = page.getBoundingClientRect();
        line.style.left = `${rect.left}px`;
        line.style.width = `${rect.width}px`;
      } catch (_) {}
    };

    // ---------- 事件处理 ----------

    /**
     * 鼠标移动：
     * 1. 关闭状态下不处理，只记录坐标。
     * 2. 16ms 节流。
     * 3. 页面外隐藏并清定时器。
     * 4. 抖动容差：横线已显示且移动极小，直接返回，不闪烁。
     * 5. 正常移动：更新位置、隐藏、重置定时器，静止后重新显示。
     */
    const onMove = (e: MouseEvent) => {
      if (!enabled) {
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }

      const now = Date.now();
      if (now - lastMoveTime < 16) return;
      lastMoveTime = now;

      const page = getPageAt(doc, e.clientX, e.clientY);
      if (!page) {
        hideLine();
        clearShowTimer();
        lastX = -1;
        lastY = -1;
        return;
      }

      const dx = lastX < 0 ? Infinity : Math.abs(e.clientX - lastX);
      const dy = lastY < 0 ? Infinity : Math.abs(e.clientY - lastY);
      if (dx < JITTER_TOLERANCE && dy < JITTER_TOLERANCE && isShown) {
        return;
      }

      lastX = e.clientX;
      lastY = e.clientY;

      updatePageBounds(page);
      line.style.top = `${e.clientY}px`;
      hideLine();
      clearShowTimer();

      if (pointerDown) return;

      const x = e.clientX;
      const y = e.clientY;
      showTimer = win.setTimeout(() => {
        showTimer = null;
        if (!enabled) return;
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

    // ---------- 悬浮按钮 ----------

    const onToggle = () => {
      enabled = !enabled;
      if (!enabled) {
        cancelAndHide();
      }
      updateButtonState(toggleBtn.el, enabled);
      Zotero.debug(`[ReadingLine] enabled=${enabled}`, 1);
    };

    const toggleBtn = createToggleButton(doc, win, onToggle);
    updateButtonState(toggleBtn.el, enabled);
    doc.body.appendChild(toggleBtn.el);

    // ---------- 绑定监听 ----------
    win.addEventListener("mousemove", onMove, true);
    win.addEventListener("mousedown", onMouseDown, true);
    win.addEventListener("mouseup", onMouseUp, true);
    win.addEventListener("mouseleave", onLeave, true);
    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("wheel", onWheel, true);
    doc.addEventListener("selectionchange", onSelectionChange, true);
    doc.addEventListener("scroll", onScroll, true);

    // ---------- 清理函数 ----------
    return () => {
      clearShowTimer();
      stopBreathing();
      win.removeEventListener("mousemove", onMove, true);
      win.removeEventListener("mousedown", onMouseDown, true);
      win.removeEventListener("mouseup", onMouseUp, true);
      win.removeEventListener("mouseleave", onLeave, true);
      win.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("wheel", onWheel, true);
      doc.removeEventListener("selectionchange", onSelectionChange, true);
      doc.removeEventListener("scroll", onScroll, true);
      line.style.opacity = "0";
      line.remove();
      toggleBtn.destroy();
    };
  } catch (e) {
    Zotero.debug("[ReadingLine] inject error: " + e, 1);
    return null;
  }
}

/** 给单个阅读器挂载横线。用标记避免重复注入。 */
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

/** 扫描所有已打开的阅读器，给尚未注入的挂上横线。 */
function scanAllTabs(addon: any): void {
  try {
    const readers: any[] = (Zotero.Reader as any)._readers || [];
    for (const r of readers) attachToReader(r, addon);
  } catch (e) {
    Zotero.debug("[ReadingLine] scan error: " + e, 1);
  }
}

/** 设置变更时重新应用：清理所有已注入的横线，再重新扫描注入。 */
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

/** 注册 Reading Line 的设置面板，出现在 Zotero 设置左侧列表底部。 */
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

/**
 * 启动横线功能：
 * 1. 监听 tab 事件，新开阅读器时延迟挂载。
 * 2. 监听 5 个设置项，变更时重新应用。
 * 3. 每 2 秒扫描一次所有阅读器，兜底确保新阅读器能挂上。
 */
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

/** 插件启动：初始化语言、注册设置面板，延迟 2 秒启动横线功能。 */
async function onStartup() {
  try {
    initLocale();
  } catch (_) {}

  await registerPreferencePane(addon);

  setTimeout(() => startReadingLine(addon), 2000);
  addon.data.initialized = true;
}

/** 主窗口加载：初始化 ztoolkit 和语言文件。 */
async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  try {
    addon.data.ztoolkit = createZToolkit();
    win.MozXULElement.insertFTLIfNeeded(
      `${addon.data.config.addonRef}-mainWindow.ftl`,
    );
  } catch (_) {}
}

/** 主窗口卸载：清理 ztoolkit。 */
async function onMainWindowUnload(_win: Window): Promise<void> {
  try {
    ztoolkit.unregisterAll();
  } catch (_) {}
}

/** 插件关闭：执行所有清理逻辑，删除全局 Addon 实例。 */
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

// 以下钩子当前未使用，保留签名以兼容模板其他位置的引用
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
