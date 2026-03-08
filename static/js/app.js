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
