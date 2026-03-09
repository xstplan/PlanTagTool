// TAB 2 - Image Resize
// =====================================================================

let resizeMode = "crop";
let resizeFmt  = "jpg";
let lockResizeRatio = false;
let resizeRatio = 1;
let resizePreviewImages = [];
let resizeSelectedImage = null;
const cropFocusByFile = {};
const resizeWInput = document.getElementById("resize-w");
const resizeHInput = document.getElementById("resize-h");
const lockRatioBtn = document.getElementById("btn-lock-ratio");
const resizeSizeText = document.getElementById("resize-size-text");
const resizeLayout = document.getElementById("resize-layout");
const resizePreviewGrid = document.getElementById("resize-preview-grid");
const resizeExportBtn = document.getElementById("btn-export-resize");
const resizeCloseResultBtn = document.getElementById("btn-close-resize-result");
const labelCloseResultBtn = document.getElementById("btn-close-label-result");
let resizeActiveCardEl = null;
let resizeRelayoutRaf = 0;
let resizeRenderTimer = null;
let resizeLayoutRefreshTimer = null;
let resizePollToken = 0;
let resizeScrollMemoryTop = 0;
let resizeRestoreScrollRaf = 0;
let resizeIsDraggingCrop = false;

function getResizeScrollContainer() {
  const panel = document.getElementById("panel-resize");
  if (!panel) return null;
  // Desktop: right pane scrolls. Mobile: panel content scrolls.
  if (window.matchMedia("(max-width: 1100px)").matches) {
    return panel.querySelector(".content");
  }
  return panel.querySelector(".resize-right");
}

function getResizeScrollTop() {
  const scrollEl = getResizeScrollContainer();
  if (!scrollEl) return resizeScrollMemoryTop;
  resizeScrollMemoryTop = scrollEl.scrollTop;
  return resizeScrollMemoryTop;
}

function restoreResizeScrollTop(targetTop, frames = 16) {
  const desiredTop = Math.max(0, Number(targetTop) || 0);
  if (resizeRestoreScrollRaf) {
    cancelAnimationFrame(resizeRestoreScrollRaf);
    resizeRestoreScrollRaf = 0;
  }

  const tick = left => {
    if (resizeIsDraggingCrop) {
      resizeRestoreScrollRaf = 0;
      return;
    }
    const scrollEl = getResizeScrollContainer();
    if (!scrollEl) return;

    const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const nextTop = Math.min(desiredTop, maxTop);
    scrollEl.scrollTop = nextTop;
    resizeScrollMemoryTop = nextTop;

    if (left <= 0) return;
    if (maxTop < desiredTop - 1 || Math.abs(scrollEl.scrollTop - desiredTop) > 1) {
      resizeRestoreScrollRaf = requestAnimationFrame(() => tick(left - 1));
    }
  };

  resizeRestoreScrollRaf = requestAnimationFrame(() => tick(frames));
}

function bindResizeScrollMemory() {
  const rightEl = document.querySelector("#panel-resize .resize-right");
  const contentEl = document.querySelector("#panel-resize .content");
  if (rightEl) {
    rightEl.addEventListener("scroll", () => {
      if (!window.matchMedia("(max-width: 1100px)").matches) {
        resizeScrollMemoryTop = rightEl.scrollTop;
      }
    }, { passive: true });
  }
  if (contentEl) {
    contentEl.addEventListener("scroll", () => {
      if (window.matchMedia("(max-width: 1100px)").matches) {
        resizeScrollMemoryTop = contentEl.scrollTop;
      }
    }, { passive: true });
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function setRect(el, x, y, w, h) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${Math.max(0, w)}px`;
  el.style.height = `${Math.max(0, h)}px`;
}

function getResizeTargetSize() {
  return {
    w: Math.max(1, parseInt(resizeWInput.value) || 1),
    h: Math.max(1, parseInt(resizeHInput.value) || 1),
  };
}

function updateResizeSizeText() {
  const { w, h } = getResizeTargetSize();
  resizeSizeText.textContent = `输出：${w} × ${h}`;
}

function updateResizePaneHeight() {
  if (!resizeLayout) return;
  const panel = document.getElementById("panel-resize");
  if (!panel || !panel.classList.contains("active")) return;
  const rect = resizeLayout.getBoundingClientRect();
  const h = Math.floor(window.innerHeight - rect.top - 18);
  if (h > 240) {
    resizeLayout.style.setProperty("--resize-pane-h", `${h}px`);
  }
}

function updateLabelPaneHeight() {
  const layout = document.getElementById("label-layout");
  if (!layout) return;
  const panel = document.getElementById("panel-label");
  if (!panel || !panel.classList.contains("active")) return;
  const rect = layout.getBoundingClientRect();
  const h = Math.floor(window.innerHeight - rect.top - 18);
  if (h > 240) {
    layout.style.setProperty("--label-pane-h", `${h}px`);
  }
}

function ensureCropFocusMap() {
  const keep = new Set(resizePreviewImages.map(i => i.filename));
  Object.keys(cropFocusByFile).forEach(filename => {
    if (!keep.has(filename)) delete cropFocusByFile[filename];
  });
  resizePreviewImages.forEach(img => {
    if (!cropFocusByFile[img.filename]) {
      cropFocusByFile[img.filename] = { x: 0.5, y: 0.5 };
    }
  });
}

function getCropFocus(filename) {
  const focus = cropFocusByFile[filename];
  return {
    x: focus ? clamp01(Number(focus.x)) : 0.5,
    y: focus ? clamp01(Number(focus.y)) : 0.5,
  };
}

function setCropFocus(filename, x, y) {
  cropFocusByFile[filename] = { x: clamp01(x), y: clamp01(y) };
}

function setResizeActiveCard(cardEl, img) {
  if (!cardEl || !img) return;
  if (resizeActiveCardEl && resizeActiveCardEl !== cardEl) {
    resizeActiveCardEl.classList.remove("active");
  }
  resizeActiveCardEl = cardEl;
  resizeActiveCardEl.classList.add("active");
  resizeSelectedImage = img;
}

function relayoutResizePreviewGrid() {
  // Resize preview now uses CSS columns masonry, so no JS relayout is needed.
}

function scheduleRelayoutResizePreviewGrid() {
  if (resizeRelayoutRaf) return;
  resizeRelayoutRaf = requestAnimationFrame(() => {
    resizeRelayoutRaf = 0;
    relayoutResizePreviewGrid();
  });
}

function scheduleRenderResizeThumbs(delay = 80) {
  if (resizeRenderTimer) clearTimeout(resizeRenderTimer);
  resizeRenderTimer = setTimeout(() => {
    resizeRenderTimer = null;
    renderResizeThumbs();
  }, delay);
}

function refreshResizeThumbLayouts() {
  if (!resizePreviewGrid) return;
  resizePreviewGrid.querySelectorAll(".resize-thumb-stage").forEach(stage => {
    if (typeof stage._applyResizeLayout === "function") {
      stage._applyResizeLayout();
    }
  });
}

function scheduleRefreshResizeThumbLayouts(delay = 40) {
  if (resizeLayoutRefreshTimer) clearTimeout(resizeLayoutRefreshTimer);
  resizeLayoutRefreshTimer = setTimeout(() => {
    resizeLayoutRefreshTimer = null;
    refreshResizeThumbLayouts();
  }, delay);
}

function calcCropLayout(stageW, stageH, imgW, imgH, outW, outH, focusX, focusY) {
  const targetRatio = outW / outH;

  let cropW = stageW;
  let cropH = stageW / targetRatio;
  if (cropH > stageH) {
    cropH = stageH;
    cropW = stageH * targetRatio;
  }

  const cropX = (stageW - cropW) / 2;
  const cropY = (stageH - cropH) / 2;

  const scale = Math.min(stageW / imgW, stageH / imgH);
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const baseX = (stageW - dispW) / 2;
  const baseY = (stageH - dispH) / 2;

  const extraX = Math.max(0, dispW - cropW);
  const extraY = Math.max(0, dispH - cropH);
  const minX = cropX + cropW - dispW;
  const maxX = cropX;
  const minY = cropY + cropH - dispH;
  const maxY = cropY;

  let imgX = baseX;
  let imgY = baseY;
  if (extraX > 0) {
    imgX = cropX - extraX * clamp01(focusX);
    imgX = Math.max(minX, Math.min(maxX, imgX));
  }
  if (extraY > 0) {
    imgY = cropY - extraY * clamp01(focusY);
    imgY = Math.max(minY, Math.min(maxY, imgY));
  }

  return { cropX, cropY, cropW, cropH, dispW, dispH, imgX, imgY, extraX, extraY };
}

function renderResizeThumbs() {
  const renderToken = ++resizeRenderToken;
  const grid = resizePreviewGrid;
  const prevTop = getResizeScrollTop();
  const prevGridHeight = grid ? grid.scrollHeight : 0;
  resizeActiveCardEl = null;
  if (grid && prevGridHeight > 0) {
    // Keep enough scrollable height during full re-render to avoid browser snapping to top.
    grid.style.minHeight = `${prevGridHeight}px`;
  }
  grid.replaceChildren();
  restoreResizeScrollTop(prevTop);

  const items = resizePreviewImages.slice();
  const scheduleGridRelayout = () => {
    scheduleRelayoutResizePreviewGrid();
  };

  if (!items.length) {
    grid.style.minHeight = "";
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:30px"><div class="empty-state-icon">📲</div><div class="empty-state-sub">项目中没有图片</div></div>`;
    return;
  }

  const outSize = getResizeTargetSize();

  renderNodesInChunks({
    container: grid,
    items,
    chunkSize: RESIZE_RENDER_CHUNK,
    isCanceled: () => renderToken !== resizeRenderToken,
    createNode: img => {
      const card = document.createElement("div");
      card.className = "resize-thumb-card" + (resizeSelectedImage && resizeSelectedImage.filename === img.filename ? " active" : "");
      if (resizeSelectedImage && resizeSelectedImage.filename === img.filename) {
        resizeActiveCardEl = card;
      }

      const stage = document.createElement("div");
      stage.className = "resize-thumb-stage";
      const srcW = Math.max(1, Number(img.width) || outSize.w);
      const srcH = Math.max(1, Number(img.height) || outSize.h);
      // Keep preview shape consistent with original image so long/tall images remain long/tall.
      stage.style.aspectRatio = `${srcW} / ${srcH}`;

      const name = document.createElement("div");
      name.className = "resize-thumb-name";
      const meta = img.width && img.height ? ` ${img.width}×${img.height}` : "";
      name.textContent = `${img.filename}${meta}`;

      if (resizeMode === "crop") {
        const image = document.createElement("img");
        image.className = "resize-thumb-image";
        image.alt = img.filename;
        image.draggable = false;

        const maskTop = document.createElement("div");
        const maskBottom = document.createElement("div");
        const maskLeft = document.createElement("div");
        const maskRight = document.createElement("div");
        [maskTop, maskBottom, maskLeft, maskRight].forEach(m => m.className = "resize-thumb-mask");

        const frame = document.createElement("div");
        frame.className = "resize-thumb-frame";
        const vline = document.createElement("div");
        vline.className = "resize-thumb-frame-line resize-thumb-frame-line-v";
        const hline = document.createElement("div");
        hline.className = "resize-thumb-frame-line resize-thumb-frame-line-h";
        frame.appendChild(vline);
        frame.appendChild(hline);

        const applyLayout = (withGridRelayout = true) => {
          const nW = image.naturalWidth || srcW;
          const nH = image.naturalHeight || srcH;
          stage.style.aspectRatio = `${nW} / ${nH}`;

          const stageRect = stage.getBoundingClientRect();
          const stageW = Math.max(1, stageRect.width);
          const stageH = Math.max(1, stageRect.height);
          const focus = getCropFocus(img.filename);
          const layout = calcCropLayout(stageW, stageH, nW, nH, outSize.w, outSize.h, focus.x, focus.y);
          stage._cropLayout = layout;

          setRect(image, layout.imgX, layout.imgY, layout.dispW, layout.dispH);
          setRect(maskTop, 0, 0, stageW, layout.cropY);
          setRect(maskBottom, 0, layout.cropY + layout.cropH, stageW, Math.max(0, stageH - layout.cropY - layout.cropH));
          setRect(maskLeft, 0, layout.cropY, layout.cropX, layout.cropH);
          setRect(maskRight, layout.cropX + layout.cropW, layout.cropY, Math.max(0, stageW - layout.cropX - layout.cropW), layout.cropH);
          setRect(frame, layout.cropX, layout.cropY, layout.cropW, layout.cropH);
          if (withGridRelayout) {
            scheduleGridRelayout();
          }
        };
        stage._applyResizeLayout = () => applyLayout(false);

        let drag = null;
        const finishDrag = e => {
          if (!drag || e.pointerId !== drag.pointerId) return;
          drag = null;
          resizeIsDraggingCrop = false;
          stage.classList.remove("dragging");
          if (stage.hasPointerCapture(e.pointerId)) {
            stage.releasePointerCapture(e.pointerId);
          }
        };

        stage.addEventListener("pointerdown", e => {
          if (resizeMode !== "crop") return;
          const layout = stage._cropLayout;
          if (!layout) return;
          const focus = getCropFocus(img.filename);
          drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startFocusX: focus.x,
            startFocusY: focus.y,
            extraX: layout.extraX,
            extraY: layout.extraY,
          };
          resizeIsDraggingCrop = true;
          stage.classList.add("dragging");
          stage.setPointerCapture(e.pointerId);
          e.preventDefault();
        });

        stage.addEventListener("pointermove", e => {
          if (!drag || e.pointerId !== drag.pointerId) return;
          let nextX = drag.startFocusX;
          let nextY = drag.startFocusY;
          const dx = e.clientX - drag.startX;
          const dy = e.clientY - drag.startY;
          if (drag.extraX > 0) nextX = clamp01(drag.startFocusX - dx / drag.extraX);
          if (drag.extraY > 0) nextY = clamp01(drag.startFocusY - dy / drag.extraY);
          setCropFocus(img.filename, nextX, nextY);
          // Dragging only changes current card crop position, no need to relayout whole grid.
          applyLayout(false);
        });

        stage.addEventListener("pointerup", finishDrag);
        stage.addEventListener("pointercancel", finishDrag);

        image.addEventListener("load", () => applyLayout(true));
        image.src = img.thumb_url || img.url;

        // Cached images may complete before a visible paint; ensure layout refreshes with real natural size.
        requestAnimationFrame(() => applyLayout(true));

        stage.appendChild(image);
        stage.appendChild(maskTop);
        stage.appendChild(maskBottom);
        stage.appendChild(maskLeft);
        stage.appendChild(maskRight);
        stage.appendChild(frame);
      } else {
        const image = document.createElement("img");
        image.className = "resize-thumb-image-plain";
        image.alt = img.filename;
        image.loading = "lazy";
        image.decoding = "async";

        const applyPlainLayout = () => {
          const nW = image.naturalWidth || srcW;
          const nH = image.naturalHeight || srcH;
          stage.style.aspectRatio = `${nW} / ${nH}`;
          scheduleGridRelayout();
        };
        stage._applyResizeLayout = applyPlainLayout;

        image.addEventListener("load", applyPlainLayout);
        image.src = img.thumb_url || img.url;
        requestAnimationFrame(applyPlainLayout);
        stage.appendChild(image);
      }

      card.appendChild(stage);
      card.appendChild(name);
      card.addEventListener("click", () => {
        if (resizeSelectedImage && resizeSelectedImage.filename === img.filename) return;
        setResizeActiveCard(card, img);
      });

      return card;
    },
    onChunk: scheduleGridRelayout,
    onDone: () => {
      scheduleGridRelayout();
      restoreResizeScrollTop(prevTop);
      requestAnimationFrame(() => {
        grid.style.minHeight = "";
      });
    },
  });
}

async function loadResizePreview(projName, forceRefresh = false) {
  const loadToken = ++resizeLoadToken;
  const stat = document.getElementById("resize-img-stat");

  if (!projName) {
    resizeRenderToken += 1;
    resizePreviewImages = [];
    resizeSelectedImage = null;
    resizePreviewGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:30px"><div class="empty-state-icon">🖼️</div><div class="empty-state-sub">请先选择项目</div></div>`;
    if (stat) stat.textContent = "";
    return;
  }

  try {
    const qs = new URLSearchParams();
    qs.set("source", "original");
    if (forceRefresh) {
      qs.set("t", String(Date.now()));
    }
    const imgs = await api("GET", `${projectApi(projName)}/images?${qs.toString()}`);
    if (loadToken !== resizeLoadToken) return;
    resizePreviewImages = imgs;
    ensureCropFocusMap();
    if (stat) stat.textContent = `${imgs.length} 张图片`;

    if (!imgs.length) {
      resizeSelectedImage = null;
      renderResizeThumbs();
      return;
    }

    if (!resizeSelectedImage || !imgs.some(x => x.filename === resizeSelectedImage.filename)) {
      resizeSelectedImage = imgs[0];
    }

    renderResizeThumbs();
  } catch (e) {
    if (loadToken !== resizeLoadToken) return;
    toast("加载失败: " + e.message, "error");
  }
}

function initResizeTab() {
  syncProjectSelects();
  updateResizeSizeText();
  requestAnimationFrame(updateResizePaneHeight);

  const sel = document.getElementById("resize-proj-select");
  if (!sel.value && State.currentProject) {
    sel.value = State.currentProject;
  }
  if (sel.value) {
    loadResizePreview(sel.value);
  }
}

document.getElementById("resize-proj-select").addEventListener("change", e => {
  loadResizePreview(e.target.value);
});

document.getElementById("btn-refresh-resize-preview").addEventListener("click", () => {
  const proj = document.getElementById("resize-proj-select").value;
  if (!proj) {
    toast("请先选择项目", "error");
    return;
  }
  loadResizePreview(proj, true);
});

resizeExportBtn.addEventListener("click", () => {
  const proj = document.getElementById("resize-proj-select").value;
  if (!proj) {
    toast("请先选择项目", "error");
    return;
  }
  const url = `${projectApi(proj)}/resize/export?t=${Date.now()}`;
  window.location.href = url;
});

resizeCloseResultBtn.addEventListener("click", () => {
  const card = document.getElementById("resize-result-card");
  card.style.display = "none";
});

labelCloseResultBtn.addEventListener("click", () => {
  const card = document.getElementById("label-result-card");
  card.style.display = "none";
});

// Preset sizes
document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [w, h] = btn.dataset.preset.split("x").map(Number);
    resizeWInput.value = w;
    resizeHInput.value = h;
    if (h > 0) resizeRatio = w / h;
    updateResizeSizeText();
    scheduleRefreshResizeThumbLayouts(0);
  });
});

lockRatioBtn.addEventListener("click", () => {
  lockResizeRatio = !lockResizeRatio;
  const w = parseInt(resizeWInput.value) || 1;
  const h = parseInt(resizeHInput.value) || 1;
  resizeRatio = w / h;
  lockRatioBtn.textContent = lockResizeRatio ? "🔒" : "🔓";
  lockRatioBtn.title = lockResizeRatio ? "已锁定宽高比" : "锁定宽高比";
  scheduleRefreshResizeThumbLayouts(0);
});

resizeWInput.addEventListener("input", () => {
  updateResizeSizeText();
  if (lockResizeRatio) {
    const w = parseInt(resizeWInput.value);
    if (w && resizeRatio > 0) {
      resizeHInput.value = Math.max(1, Math.round(w / resizeRatio));
    }
  }
  scheduleRefreshResizeThumbLayouts();
});

resizeHInput.addEventListener("input", () => {
  updateResizeSizeText();
  if (lockResizeRatio) {
    const h = parseInt(resizeHInput.value);
    if (h && resizeRatio > 0) {
      resizeWInput.value = Math.max(1, Math.round(h * resizeRatio));
    }
  }
  scheduleRefreshResizeThumbLayouts();
});

resizeWInput.addEventListener("change", () => scheduleRefreshResizeThumbLayouts(0));
resizeHInput.addEventListener("change", () => scheduleRefreshResizeThumbLayouts(0));
window.addEventListener("resize", () => {
  scheduleRefreshResizeThumbLayouts(120);
  updateResizePaneHeight();
  updateLabelPaneHeight();
});

bindResizeScrollMemory();

// Mode buttons
const modeBtns = document.querySelectorAll(".mode-btn[data-mode]");
const modeDescs = {
  crop: "居中裁剪，确保输出完全填充目标尺寸（可能裁掉边缘）",
  fit:  "缩放以适合框内，保留全部内容（可能有留边）",
  stretch: "强制拉伸到目标尺寸（可能变形）",
  pad: "缩放后用填充色补全到目标尺寸",
};
modeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    modeBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    resizeMode = btn.dataset.mode;
    document.getElementById("mode-desc").textContent = modeDescs[resizeMode];
    document.getElementById("pad-color-row").classList.toggle("hidden", resizeMode !== "pad");
    renderResizeThumbs();
  });
});

// Format buttons
document.querySelectorAll(".format-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".format-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    resizeFmt = btn.dataset.fmt;
  });
});

// Quality slider
const qualSlider = document.getElementById("quality-slider");
const qualVal = document.getElementById("quality-val");
qualSlider.addEventListener("input", () => { qualVal.textContent = qualSlider.value; });

// Do resize
document.getElementById("btn-do-resize").addEventListener("click", async () => {
  const proj = document.getElementById("resize-proj-select").value;
  if (!proj) {
    toast("请先选择项目", "error");
    return;
  }

  const w = parseInt(resizeWInput.value);
  const h = parseInt(resizeHInput.value);
  if (!w || !h || w < 1 || h < 1) {
    toast("请输入有效的宽高", "error");
    return;
  }

  const card = document.getElementById("resize-result-card");
  const pbar = document.getElementById("resize-pbar");
  const ptext = document.getElementById("resize-ptext");
  const rlist = document.getElementById("resize-result-list");

  card.style.display = "block";
  resizeExportBtn.style.display = "none";
  resizeExportBtn.disabled = true;
  pbar.style.background = "var(--accent)";
  pbar.style.width = "2%";
  ptext.textContent = "准备任务...";
  rlist.innerHTML = "";
  document.getElementById("btn-do-resize").disabled = true;
  const pollToken = ++resizePollToken;

  try {
    const payload = {
      width: w,
      height: h,
      mode: resizeMode,
      output_format: resizeFmt,
      quality: parseInt(qualSlider.value),
      pad_color: document.getElementById("pad-color").value,
      overwrite: document.getElementById("resize-overwrite").checked,
      crop_focus_map: cropFocusByFile,
    };

    const start = await api("POST", `${projectApi(proj)}/resize/start`, payload);
    const jobId = start.job_id;
    if (!jobId) {
      throw new Error("任务启动失败：未返回 job_id");
    }

    let job = null;
    while (pollToken === resizePollToken) {
      job = await api("GET", `/api/resize-jobs/${encPath(jobId)}`);
      const total = Number(job.total || 0);
      const done = Number(job.done || 0);
      const progress = Math.max(2, total > 0 ? Math.floor((done / total) * 100) : Number(job.progress || 0));
      pbar.style.width = `${Math.min(100, progress)}%`;
      ptext.textContent = total > 0
        ? `处理中：${done}/${total}${job.current_file ? `（${job.current_file}）` : ""}`
        : "处理中，正在准备...";

      if (job.status === "completed") break;
      if (job.status === "failed") {
        throw new Error(job.error || job.message || "批量处理失败");
      }
      await sleep(250);
    }

    if (pollToken !== resizePollToken) return;

    const results = Array.isArray(job?.results) ? job.results : [];
    pbar.style.width = "100%";
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    ptext.textContent = `完成：${ok} 成功${fail ? ` / ${fail} 失败` : ""}`;

    if (ok > 0) {
      resizeExportBtn.style.display = "inline-flex";
      resizeExportBtn.disabled = false;
    }

    results.forEach(r => {
      const el = document.createElement("div");
      el.className = `result-item ${r.ok ? "ok" : "err"}`;
      el.innerHTML = `<span class="result-icon">${r.ok ? "✓" : "✗"}</span>
        <div><div class="result-file">${escHtml(r.file)}</div>
        <div class="result-detail">${r.ok ? `→ ${escHtml(r.output)} (${r.size})` : escHtml(r.error)}</div></div>`;
      rlist.appendChild(el);
    });

    toast(`处理完成：${ok} 张`, "success");
    loadResizePreview(proj, true);
  } catch (e) {
    toast("处理失败: " + e.message, "error");
    ptext.textContent = "失败: " + e.message;
    pbar.style.width = "100%";
    pbar.style.background = "var(--error)";
    resizeExportBtn.style.display = "none";
    resizeExportBtn.disabled = true;
  }

  document.getElementById("btn-do-resize").disabled = false;
});

