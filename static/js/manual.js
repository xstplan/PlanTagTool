// TAB 4 - Manual Tag Management
// =====================================================================

let manualSelectedProject = "";
let manualActiveFilename = "";
let manualDetailMode = "single";
let manualImages = [];
let manualLoadToken = 0;
let manualRenderToken = 0;
let manualDirty = false;
const manualSelectedFiles = new Set();

function updateManualPaneHeight() {
  const layout = document.getElementById("manual-layout");
  const panel = document.getElementById("panel-manual");
  if (!layout || !panel || !panel.classList.contains("active")) return;
  const rect = layout.getBoundingClientRect();
  const h = Math.floor(window.innerHeight - rect.top - 18);
  if (h > 240) {
    layout.style.setProperty("--manual-pane-h", `${h}px`);
  }
}

function splitManualTags(text) {
  if (!text) return [];
  const normalized = String(text)
    .replace(/\n/g, ",")
    .replace(/，/g, ",")
    .replace(/；/g, ",")
    .replace(/;/g, ",")
    .replace(/\|/g, ",");
  const seen = new Set();
  const result = [];
  normalized.split(",").forEach(part => {
    const tag = part.trim();
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag);
  });
  return result;
}

function joinManualTags(tags) {
  return splitManualTags((tags || []).join(", ")).join(", ");
}

function appendManualTags(existingText, addText) {
  const result = [];
  const seen = new Set();
  [splitManualTags(existingText), splitManualTags(addText)].forEach(group => {
    group.forEach(tag => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(tag);
    });
  });
  return joinManualTags(result);
}

function removeManualTag(existingText, tagToRemove) {
  const removeKey = String(tagToRemove || "").trim().toLowerCase();
  if (!removeKey) return joinManualTags(splitManualTags(existingText));
  const kept = splitManualTags(existingText).filter(tag => tag.toLowerCase() !== removeKey);
  return joinManualTags(kept);
}

function manualLabelApi(filename) {
  return `${projectLabelApi(manualSelectedProject, filename)}?source=active`;
}

function updateManualModeSwitch() {
  document.querySelectorAll("[data-manual-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.manualMode === manualDetailMode);
  });
  const isBatch = manualDetailMode === "batch";
  document.getElementById("manual-tag-add-group")?.classList.toggle("hidden", isBatch);
  document.getElementById("manual-raw-text-group")?.classList.toggle("hidden", isBatch);
  document.getElementById("manual-detail-actions")?.classList.toggle("hidden", isBatch);
}

function setManualDirty(nextDirty) {
  manualDirty = Boolean(nextDirty);
  const statusEl = document.getElementById("manual-detail-status");
  if (!statusEl) return;
  if (manualDetailMode === "batch") {
    statusEl.textContent = manualSelectedFiles.size ? `批量模式 · 已选 ${manualSelectedFiles.size} 张` : "批量模式";
    return;
  }
  const current = manualImages.find(img => img.filename === manualActiveFilename);
  if (!current) {
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = manualDirty ? "未保存" : (current.labeled ? "已标注" : "未标注");
}

function updateManualSelectionStat() {
  const statEl = document.getElementById("manual-selection-stat");
  if (statEl) {
    statEl.textContent = `已选 ${manualSelectedFiles.size} 张图片`;
  }
}

function toggleManualSelection(filename, forceChecked = null) {
  const nextChecked = forceChecked === null ? !manualSelectedFiles.has(filename) : Boolean(forceChecked);
  if (nextChecked) {
    manualSelectedFiles.add(filename);
  } else {
    manualSelectedFiles.delete(filename);
  }
  updateManualSelectionStat();
  updateManualCardStates();
  if (manualDetailMode === "batch") {
    renderManualBatchDetail();
  }
}

function updateManualCardStates() {
  const grid = document.getElementById("manual-img-grid");
  if (!grid) return;
  grid.querySelectorAll(".img-card").forEach(card => {
    const filename = card.dataset.filename || "";
    card.classList.toggle("checked", manualSelectedFiles.has(filename));
    card.classList.toggle("focused", manualDetailMode === "single" && filename === manualActiveFilename);
    const checkbox = card.querySelector(".manual-card-check");
    if (checkbox) checkbox.checked = manualSelectedFiles.has(filename);
  });
}

function clearManualDetail(message = "点击中间图片查看并编辑标签") {
  manualActiveFilename = "";
  manualDirty = false;
  const empty = document.getElementById("manual-detail-empty");
  const main = document.getElementById("manual-detail-main");
  if (empty && main) {
    const text = empty.querySelector(".empty-state-sub");
    if (text) text.textContent = message;
    empty.classList.remove("hidden");
    main.classList.add("hidden");
  }
  const imgEl = document.getElementById("manual-detail-img");
  const nameEl = document.getElementById("manual-detail-name");
  const metaEl = document.getElementById("manual-detail-meta");
  const textEl = document.getElementById("manual-detail-text");
  const inputEl = document.getElementById("manual-tag-input");
  if (imgEl) imgEl.src = "";
  if (nameEl) nameEl.textContent = "";
  if (metaEl) metaEl.textContent = "";
  if (textEl) textEl.value = "";
  if (inputEl) inputEl.value = "";
  renderManualTagChips("", { mode: "single" });
  updateManualModeSwitch();
  setManualDirty(false);
  updateManualCardStates();
}

function getSelectedManualImages() {
  return manualImages.filter(img => manualSelectedFiles.has(img.filename));
}

async function removeManualTagFromBatch(tag) {
  const filenames = collectSelectedManualFilenames();
  if (!filenames.length) {
    toast("请先勾选图片", "info");
    return;
  }
  await api("POST", `${projectApi(manualSelectedProject)}/manual/batch-remove-tags`, {
    filenames,
    tags: tag,
  });
  toast(`已从选中图片中删除标签：${tag}`, "success");
  if (typeof refreshLabelRelatedViews === "function") {
    await refreshLabelRelatedViews(manualSelectedProject);
  } else {
    await loadManualImages(manualSelectedProject);
  }
}

function renderManualTagChips(source, options = {}) {
  const wrap = document.getElementById("manual-tag-chip-list");
  if (!wrap) return;
  const mode = options.mode || "single";
  wrap.innerHTML = "";
  if (mode === "batch") {
    const counts = new Map();
    (Array.isArray(source) ? source : []).forEach(img => {
      splitManualTags(img.label || "").forEach(tag => {
        const key = tag.toLowerCase();
        const current = counts.get(key) || { tag, count: 0 };
        current.count += 1;
        counts.set(key, current);
      });
    });
    const items = Array.from(counts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "zh-CN");
    });
    if (!items.length) {
      wrap.innerHTML = `<div class="text-dim text-sm">当前选中图片没有标签</div>`;
      return;
    }
    items.forEach(item => {
      const chip = document.createElement("span");
      chip.className = `manual-tag-chip ${item.count > 1 ? "shared" : "unique"}`;
      chip.innerHTML = `<span>${escHtml(item.tag)}</span>${item.count > 1 ? `<span class="manual-tag-chip-count">+${item.count}</span>` : ""}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "manual-tag-chip-del";
      btn.textContent = "×";
      btn.title = `从所有选中图片中删除标签 ${item.tag}`;
      btn.addEventListener("click", async () => {
        try {
          await removeManualTagFromBatch(item.tag);
        } catch (e) {
          toast("批量删除标签失败: " + e.message, "error");
        }
      });
      chip.appendChild(btn);
      wrap.appendChild(chip);
    });
    return;
  }

  const tags = splitManualTags(source);
  if (!tags.length) {
    wrap.innerHTML = `<div class="text-dim text-sm">当前没有标签</div>`;
    return;
  }
  tags.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "manual-tag-chip";
    chip.innerHTML = `<span>${escHtml(tag)}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "manual-tag-chip-del";
    btn.textContent = "×";
    btn.title = `删除标签 ${tag}`;
    btn.addEventListener("click", () => {
      const textEl = document.getElementById("manual-detail-text");
      textEl.value = removeManualTag(textEl.value, tag);
      renderManualTagChips(textEl.value);
      setManualDirty(true);
    });
    chip.appendChild(btn);
    wrap.appendChild(chip);
  });
}

function renderManualBatchDetail() {
  const selected = getSelectedManualImages();
  if (!selected.length) {
    clearManualDetail("勾选图片后可查看批量标签");
    return;
  }

  const empty = document.getElementById("manual-detail-empty");
  const main = document.getElementById("manual-detail-main");
  const imgEl = document.getElementById("manual-detail-img");
  const nameEl = document.getElementById("manual-detail-name");
  const metaEl = document.getElementById("manual-detail-meta");
  const textEl = document.getElementById("manual-detail-text");
  const inputEl = document.getElementById("manual-tag-input");
  if (empty && main) {
    empty.classList.add("hidden");
    main.classList.remove("hidden");
  }
  if (imgEl) {
    imgEl.src = "";
    imgEl.classList.add("hidden");
  }
  if (nameEl) {
    nameEl.textContent = `已选 ${selected.length} 张图片`;
  }
  if (metaEl) {
    const labeled = selected.filter(img => img.labeled).length;
    metaEl.textContent = `已标注 ${labeled}/${selected.length} · 点击标签可从所有选中图片中删除`;
  }
  if (textEl) textEl.value = "";
  if (inputEl) inputEl.value = "";
  renderManualTagChips(selected, { mode: "batch" });
  setManualDirty(false);
  updateManualCardStates();
}

function refreshManualDetailPanel() {
  updateManualModeSwitch();
  if (manualDetailMode === "batch") {
    renderManualBatchDetail();
    return;
  }
  const imgEl = document.getElementById("manual-detail-img");
  if (imgEl) imgEl.classList.remove("hidden");
  const active = manualImages.find(img => img.filename === manualActiveFilename);
  if (active) {
    showManualDetail(active, manualSelectedProject, null);
  } else {
    clearManualDetail("点击中间图片查看并编辑标签");
  }
}

function showManualDetail(img, projName, card = null) {
  manualSelectedProject = projName || "";
  manualActiveFilename = img?.filename || "";
  manualDirty = false;
  updateManualModeSwitch();
  if (manualDetailMode === "batch") {
    if (card) gridFocusCard(card);
    renderManualBatchDetail();
    return;
  }

  const empty = document.getElementById("manual-detail-empty");
  const main = document.getElementById("manual-detail-main");
  if (empty && main) {
    empty.classList.add("hidden");
    main.classList.remove("hidden");
  }

  const imgEl = document.getElementById("manual-detail-img");
  const nameEl = document.getElementById("manual-detail-name");
  const metaEl = document.getElementById("manual-detail-meta");
  const textEl = document.getElementById("manual-detail-text");
  const inputEl = document.getElementById("manual-tag-input");
  if (imgEl) {
    imgEl.src = img.url || "";
    imgEl.classList.remove("hidden");
  }
  if (nameEl) nameEl.textContent = img.filename || "";
  if (metaEl) {
    const dims = `${img.width || 0}×${img.height || 0}`;
    const size = formatMetaSize(img.size);
    metaEl.textContent = `${dims}${size ? ` · ${size}` : ""}`;
  }
  if (textEl) textEl.value = img.label || "";
  if (inputEl) inputEl.value = "";
  renderManualTagChips(img.label || "", { mode: "single" });
  setManualDirty(false);
  updateManualCardStates();

  if (card) {
    gridFocusCard(card);
  }
}

function gridFocusCard(card) {
  const grid = document.getElementById("manual-img-grid");
  if (!grid || !card) return;
  grid.querySelectorAll(".img-card.focused").forEach(el => el.classList.remove("focused"));
  card.classList.add("focused");
}

function collectSelectedManualFilenames() {
  return manualImages
    .map(img => img.filename)
    .filter(filename => manualSelectedFiles.has(filename));
}

async function loadManualImages(projName) {
  const loadToken = ++manualLoadToken;
  const renderToken = ++manualRenderToken;
  const grid = document.getElementById("manual-img-grid");
  const statEl = document.getElementById("manual-img-stat");
  const labeledEl = document.getElementById("manual-labeled-stat");

  if (!projName) {
    manualImages = [];
    manualSelectedProject = "";
    manualSelectedFiles.clear();
    updateManualSelectionStat();
    if (grid) grid.innerHTML = "";
    if (statEl) statEl.textContent = "";
    if (labeledEl) labeledEl.textContent = "";
    clearManualDetail();
    return;
  }

  try {
    const imgs = await api("GET", `${projectApi(projName)}/images`);
    if (loadToken !== manualLoadToken) return;

    manualImages = imgs;
    manualSelectedProject = projName;
    const validNames = new Set(imgs.map(img => img.filename));
    Array.from(manualSelectedFiles).forEach(filename => {
      if (!validNames.has(filename)) manualSelectedFiles.delete(filename);
    });

    const labeled = imgs.filter(img => img.labeled).length;
    if (statEl) statEl.textContent = `${imgs.length} 张`;
    if (labeledEl) labeledEl.textContent = `已标注 ${labeled}/${imgs.length}`;
    updateManualSelectionStat();

    grid.replaceChildren();
    if (!imgs.length) {
      clearManualDetail("项目中没有图片");
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📲</div><div class="empty-state-sub">项目中没有图片</div></div>`;
      return;
    }

    renderNodesInChunks({
      container: grid,
      items: imgs.slice(),
      chunkSize: LABEL_RENDER_CHUNK,
      isCanceled: () => renderToken !== manualRenderToken,
      createNode: img => {
        const card = document.createElement("div");
        card.className = "img-card" + (img.labeled ? " labeled" : "");
        card.dataset.filename = img.filename;
        if (manualSelectedFiles.has(img.filename)) card.classList.add("checked");
        if (manualActiveFilename === img.filename) card.classList.add("focused");
        card.innerHTML = `
          <label class="manual-card-check-wrap" title="选择图片">
            <input class="manual-card-check" type="checkbox" ${manualSelectedFiles.has(img.filename) ? "checked" : ""} />
          </label>
          <img class="img-thumb" src="${img.thumb_url || img.url}" loading="lazy" decoding="async" fetchpriority="low" />
          <div class="img-card-footer">
            <span class="img-card-name" title="${escHtml(img.filename)}">${escHtml(img.filename)}</span>
            ${img.labeled ? '<span class="img-labeled-badge">已标注</span>' : ""}
          </div>`;

        const checkbox = card.querySelector(".manual-card-check");
        checkbox.addEventListener("click", event => {
          event.stopPropagation();
        });
        checkbox.addEventListener("change", () => {
          toggleManualSelection(img.filename, checkbox.checked);
        });
        card.addEventListener("click", event => {
          if (event.ctrlKey || event.metaKey) {
            toggleManualSelection(img.filename);
            return;
          }
          showManualDetail(img, projName, card);
        });
        return card;
      },
    });

    if (manualDetailMode === "batch") {
      renderManualBatchDetail();
    } else if (manualActiveFilename) {
      const active = imgs.find(img => img.filename === manualActiveFilename);
      if (active) {
        showManualDetail(active, projName, null);
      } else {
        clearManualDetail("当前选中图片不存在");
      }
    } else {
      clearManualDetail();
    }
  } catch (e) {
    if (loadToken !== manualLoadToken) return;
    toast("加载失败: " + e.message, "error");
  }
}

function initManualTab() {
  syncProjectSelects();
  updateManualModeSwitch();
  requestAnimationFrame(updateManualPaneHeight);
  const sel = document.getElementById("manual-proj-select");
  if (sel && !sel.value && State.currentProject) {
    sel.value = State.currentProject;
  }
  if (sel?.value) {
    loadManualImages(sel.value);
  }
}

async function runManualBatchAction(path, payload, successMessage) {
  if (!manualSelectedProject) {
    toast("请先选择项目", "error");
    return;
  }
  const filenames = collectSelectedManualFilenames();
  if (!filenames.length) {
    toast("请先勾选图片", "info");
    return;
  }

  await api("POST", `${projectApi(manualSelectedProject)}${path}`, {
    filenames,
    tags: payload || "",
  });
  toast(successMessage, "success");
  if (typeof refreshLabelRelatedViews === "function") {
    await refreshLabelRelatedViews(manualSelectedProject);
  } else {
    await loadManualImages(manualSelectedProject);
  }
}

function addManualTagsToCurrent() {
  if (!manualActiveFilename) {
    toast("请先点击图片", "info");
    return;
  }
  const inputEl = document.getElementById("manual-tag-input");
  const textEl = document.getElementById("manual-detail-text");
  const tagsText = inputEl.value.trim();
  if (!tagsText) {
    toast("请输入标签", "info");
    return;
  }
  textEl.value = appendManualTags(textEl.value, tagsText);
  inputEl.value = "";
  renderManualTagChips(textEl.value);
  setManualDirty(true);
}

document.getElementById("manual-proj-select")?.addEventListener("change", event => {
  manualSelectedFiles.clear();
  updateManualSelectionStat();
  loadManualImages(event.target.value);
});

document.querySelectorAll("[data-manual-mode]").forEach(btn => {
  btn.addEventListener("click", () => {
    const nextMode = btn.dataset.manualMode || "single";
    if (nextMode === manualDetailMode) return;
    manualDetailMode = nextMode;
    refreshManualDetailPanel();
  });
});

document.getElementById("manual-refresh")?.addEventListener("click", () => {
  const proj = document.getElementById("manual-proj-select").value;
  loadManualImages(proj);
});

document.getElementById("manual-select-all")?.addEventListener("click", () => {
  manualImages.forEach(img => manualSelectedFiles.add(img.filename));
  updateManualSelectionStat();
  updateManualCardStates();
  if (manualDetailMode === "batch") {
    renderManualBatchDetail();
  }
});

document.getElementById("manual-clear-selection")?.addEventListener("click", () => {
  manualSelectedFiles.clear();
  updateManualSelectionStat();
  updateManualCardStates();
  if (manualDetailMode === "batch") {
    renderManualBatchDetail();
  }
});

document.getElementById("manual-apply-prepend")?.addEventListener("click", async () => {
  const tags = document.getElementById("manual-batch-prepend").value.trim();
  if (!tags) {
    toast("请输入要追加的前置标签", "info");
    return;
  }
  await runManualBatchAction("/manual/batch-prepend", tags, "已批量追加前置标签");
});

document.getElementById("manual-apply-remove")?.addEventListener("click", async () => {
  const tags = document.getElementById("manual-batch-remove").value.trim();
  if (!tags) {
    toast("请输入要删除的标签", "info");
    return;
  }
  await runManualBatchAction("/manual/batch-remove-tags", tags, "已批量删除指定标签");
});

document.getElementById("manual-clear-labels")?.addEventListener("click", async () => {
  if (!collectSelectedManualFilenames().length) {
    toast("请先勾选图片", "info");
    return;
  }
  if (!confirm("清空选中图片的所有标注？")) return;
  await runManualBatchAction("/manual/batch-clear-labels", "", "已清空选中图片标注");
});

document.getElementById("manual-add-tag")?.addEventListener("click", addManualTagsToCurrent);
document.getElementById("manual-tag-input")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addManualTagsToCurrent();
  }
});

document.getElementById("manual-detail-text")?.addEventListener("input", event => {
  renderManualTagChips(event.target.value, { mode: "single" });
  setManualDirty(true);
});

document.getElementById("manual-detail-save")?.addEventListener("click", async () => {
  if (!manualSelectedProject || !manualActiveFilename) {
    toast("请先点击图片", "info");
    return;
  }
  const fd = new FormData();
  fd.append("label", document.getElementById("manual-detail-text").value.trim());
  try {
    await api("PUT", manualLabelApi(manualActiveFilename), fd, true);
    toast("标注已保存", "success");
    if (typeof refreshLabelRelatedViews === "function") {
      await refreshLabelRelatedViews(manualSelectedProject);
    } else {
      await loadManualImages(manualSelectedProject);
    }
  } catch (e) {
    toast("保存失败: " + e.message, "error");
  }
});

document.getElementById("manual-detail-del")?.addEventListener("click", async () => {
  if (!manualSelectedProject || !manualActiveFilename) {
    toast("请先点击图片", "info");
    return;
  }
  try {
    await api("DELETE", manualLabelApi(manualActiveFilename));
    toast("标注已删除", "info");
    if (typeof refreshLabelRelatedViews === "function") {
      await refreshLabelRelatedViews(manualSelectedProject);
    } else {
      await loadManualImages(manualSelectedProject);
    }
  } catch (e) {
    toast("删除失败: " + e.message, "error");
  }
});

window.addEventListener("resize", () => {
  updateManualPaneHeight();
});

updateManualSelectionStat();
