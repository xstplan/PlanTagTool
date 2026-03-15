/* app.js - shared core for all tabs */

// Shared state
const State = {
  projects: [],          // [{name, image_count}]
  currentProject: null,  // string
  images: [],            // [{filename, width, height, labeled, label, url}]
};
let labelJobId = null;
let datasetLoadToken = 0;
let labelLoadToken = 0;
let resizeLoadToken = 0;
let datasetRenderToken = 0;
let labelRenderToken = 0;
let resizeRenderToken = 0;
const DATASET_RENDER_CHUNK = 24;
const LABEL_RENDER_CHUNK = 24;
const RESIZE_RENDER_CHUNK = 10;

function encPath(value) {
  return encodeURIComponent(value);
}

function projectApi(name) {
  return `/api/projects/${encPath(name)}`;
}

function projectImageApi(name, filename) {
  return `${projectApi(name)}/images/${encPath(filename)}`;
}

function projectLabelApi(name, filename) {
  return `${projectApi(name)}/labels/${encPath(filename)}`;
}

// Toast
function toast(msg, type = "info", ms = 3000) {
  const tc = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  tc.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// API helpers
async function api(method, path, body = null, isForm = false) {
  const opts = { method };
  if (body) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
  }
  const r = await fetch(path, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || r.statusText);
  }
  return r.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateTagsText(text, targetLanguage, options = {}) {
  const sourceText = String(text || "").trim();
  if (!sourceText) return "";

  const urlInput = document.getElementById("lm-url");
  const modelInput = document.getElementById("lm-model");
  const lmStudioUrl = (options.lmStudioUrl || urlInput?.value || "http://127.0.0.1:1234").trim();
  const model = (options.model || modelInput?.value || "").trim();

  const payload = {
    text: sourceText,
    target_language: targetLanguage || "zh",
    lm_studio_url: lmStudioUrl || "http://127.0.0.1:1234",
    model,
    max_tokens: options.maxTokens || 300,
    temperature: Number.isFinite(options.temperature) ? options.temperature : 0.1,
  };

  const res = await api("POST", "/api/translate-tags", payload);
  return String(res.translated_text || "").trim();
}

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById(`panel-${tab}`).classList.add("active");

    if (tab === "dataset") { loadProjects(); if (State.currentProject) loadImages(); }
    if (tab === "resize") initResizeTab();
    if (tab === "label")  initLabelTab();
    if (tab === "manual") initManualTab();
  });
});

function renderNodesInChunks({
  container,
  items,
  chunkSize = 24,
  isCanceled = () => false,
  createNode,
  onChunk = null,
  onDone = null,
}) {
  let index = 0;
  const total = items.length;

  const runChunk = () => {
    if (isCanceled()) return;

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + chunkSize, total);
    for (; index < end; index += 1) {
      const node = createNode(items[index], index);
      if (node) fragment.appendChild(node);
    }
    if (fragment.childNodes.length) {
      container.appendChild(fragment);
    }

    if (onChunk) onChunk(index, total);
    if (index < total) {
      requestAnimationFrame(runChunk);
    } else if (onDone) {
      onDone();
    }
  };

  requestAnimationFrame(runChunk);
}

// Utility
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMetaSize(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return "";
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function createImageDetailPanelController({
  gridSelector,
  emptySelector,
  mainSelector,
  statusSelector,
  imageSelector,
  nameSelector,
  metaSelector,
  textSelector,
  defaultMessage = "点击图片查看详情",
  getSelection,
  setSelection,
}) {
  const getEl = selector => document.querySelector(selector);

  function clear(message = defaultMessage, keepSelection = false) {
    if (!keepSelection) {
      setSelection("", "");
    }

    const empty = getEl(emptySelector);
    const main = getEl(mainSelector);
    if (empty && main) {
      const emptyText = empty.querySelector(".empty-state-sub");
      if (emptyText) emptyText.textContent = message;
      empty.classList.remove("hidden");
      main.classList.add("hidden");
    }

    const statusEl = getEl(statusSelector);
    if (statusEl) statusEl.textContent = "";

    const imgEl = getEl(imageSelector);
    if (imgEl) imgEl.src = "";

    const nameEl = getEl(nameSelector);
    if (nameEl) nameEl.textContent = "";

    const metaEl = getEl(metaSelector);
    if (metaEl) metaEl.textContent = "";

    const textEl = getEl(textSelector);
    if (textEl) textEl.value = "";

    const grid = getEl(gridSelector);
    if (grid) {
      grid.querySelectorAll(".img-card.selected").forEach(el => el.classList.remove("selected"));
    }
  }

  function show(img, projectName, card = null) {
    if (!img || !projectName) return;
    setSelection(projectName, img.filename);

    const grid = getEl(gridSelector);
    if (grid) {
      grid.querySelectorAll(".img-card.selected").forEach(el => el.classList.remove("selected"));
      if (card) {
        card.classList.add("selected");
      } else {
        const target = Array.from(grid.querySelectorAll(".img-card"))
          .find(el => el.dataset.filename === img.filename);
        if (target) target.classList.add("selected");
      }
    }

    const empty = getEl(emptySelector);
    const main = getEl(mainSelector);
    if (empty && main) {
      empty.classList.add("hidden");
      main.classList.remove("hidden");
    }

    const statusEl = getEl(statusSelector);
    if (statusEl) statusEl.textContent = img.labeled ? "已标注" : "未标注";

    const imgEl = getEl(imageSelector);
    if (imgEl) imgEl.src = img.url || "";

    const nameEl = getEl(nameSelector);
    if (nameEl) nameEl.textContent = img.filename || "";

    const dims = `${img.width || 0}×${img.height || 0}`;
    const size = formatMetaSize(img.size);
    const metaEl = getEl(metaSelector);
    if (metaEl) metaEl.textContent = `${dims}${size ? ` · ${size}` : ""}`;

    const textEl = getEl(textSelector);
    if (textEl) textEl.value = img.label || "";
  }

  function sync(images, projectName, { emptyMessage = "项目中没有图片" } = {}) {
    const items = Array.isArray(images) ? images : [];
    if (!projectName) {
      clear(defaultMessage);
      return;
    }

    if (!items.length) {
      clear(emptyMessage);
      return;
    }

    const { project, filename } = getSelection();
    if (project === projectName && filename) {
      const selected = items.find(i => i.filename === filename);
      if (selected) {
        show(selected, projectName, null);
      } else {
        clear("当前选中图片不存在");
      }
      return;
    }

    if (project !== projectName) {
      clear(defaultMessage);
    }
  }

  return { clear, show, sync };
}
