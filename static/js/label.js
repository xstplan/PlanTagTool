// TAB 3 - Labeling
// =====================================================================

let labelMode = "character";
let labelSelectedProject = "";
let labelSelectedFilename = "";

const modeInfo = {
  character: "人物打标：标注人数、发型发色、表情、服装、姿态、视角和背景等可见信息",
  object:    "物体打标：标注主体物体本身（类别、材质、颜色、结构细节）以及必要场景信息",
  style:     "风格打标：标注画风与表现方式（媒介、线条、渲染、色调、构图、氛围）",
  scenery:   "场景打标：标注环境类型、时间天气、季节、光线、视角与空间氛围",
  fashion:   "服装打标：仅标注服装与配饰本体（款式、版型、颜色、面料、细节），排除人物与背景",
  shoes:     "鞋类训练辅助：不标注任何鞋子描述词，只标注鞋子以外的可见信息（人物/服装/背景/光线/构图），建议在前缀标签填触发词",
  general:   "通用打标：对主体、风格、颜色、构图、动作和场景做综合描述",
  custom:    "自定义提示词：按你的规则生成标签",
};

function clearLabelDetailPanel(message = "点击上方图片查看和编辑标注", keepSelection = false) {
  if (!keepSelection) {
    labelSelectedProject = "";
    labelSelectedFilename = "";
  }
  const empty = document.getElementById("label-detail-empty");
  const main = document.getElementById("label-detail-main");
  const emptyText = empty.querySelector(".empty-state-sub");
  if (emptyText) emptyText.textContent = message;
  empty.classList.remove("hidden");
  main.classList.add("hidden");
  document.getElementById("label-detail-status").textContent = "";
  document.getElementById("label-detail-img").src = "";
  document.getElementById("label-detail-name").textContent = "";
  document.getElementById("label-detail-meta").textContent = "";
  document.getElementById("label-detail-text").value = "";
  document.querySelectorAll("#label-img-grid .img-card.selected").forEach(el => el.classList.remove("selected"));
}

function showLabelDetail(img, projName, card = null) {
  if (!img || !projName) return;
  labelSelectedProject = projName;
  labelSelectedFilename = img.filename;

  const grid = document.getElementById("label-img-grid");
  grid.querySelectorAll(".img-card.selected").forEach(el => el.classList.remove("selected"));
  if (card) {
    card.classList.add("selected");
  } else {
    const target = Array.from(grid.querySelectorAll(".img-card"))
      .find(el => el.dataset.filename === img.filename);
    if (target) target.classList.add("selected");
  }

  const empty = document.getElementById("label-detail-empty");
  const main = document.getElementById("label-detail-main");
  empty.classList.add("hidden");
  main.classList.remove("hidden");

  document.getElementById("label-detail-status").textContent = img.labeled ? "已标注" : "未标注";
  document.getElementById("label-detail-img").src = img.url;
  document.getElementById("label-detail-name").textContent = img.filename;
  const dims = `${img.width || 0}×${img.height || 0}`;
  const size = Number.isFinite(img.size) ? formatBytes(img.size) : "";
  document.getElementById("label-detail-meta").textContent = `${dims}${size ? ` · ${size}` : ""}`;
  document.getElementById("label-detail-text").value = img.label || "";
}

function initLabelTab() {
  syncProjectSelects();
  updateModeDesc();
  requestAnimationFrame(updateLabelPaneHeight);
  const sel = document.getElementById("label-proj-select");
  if (!sel.value && State.currentProject) {
    sel.value = State.currentProject;
    loadLabelImages(State.currentProject);
  }
}

document.getElementById("label-proj-select").addEventListener("change", e => {
  loadLabelImages(e.target.value);
});

async function loadLabelImages(projName) {
  const loadToken = ++labelLoadToken;
  const renderToken = ++labelRenderToken;
  const stat = document.getElementById("label-img-stat");
  const stat2 = document.getElementById("label-labeled-stat");
  const grid = document.getElementById("label-img-grid");

  if (!projName) {
    grid.innerHTML = "";
    stat.textContent = "";
    stat2.textContent = "";
    clearLabelDetailPanel();
    return;
  }

  try {
    const imgs = await api("GET", `${projectApi(projName)}/images`);
    if (loadToken !== labelLoadToken) return;

    const labeled = imgs.filter(i => i.labeled).length;
    stat.textContent = `${imgs.length} 张`;
    stat2.textContent = `已标注 ${labeled}/${imgs.length}`;
    grid.replaceChildren();

    if (labelSelectedProject === projName && labelSelectedFilename) {
      const selected = imgs.find(i => i.filename === labelSelectedFilename);
      if (selected) {
        showLabelDetail(selected, projName, null);
      } else {
        clearLabelDetailPanel("当前选中图片不存在");
      }
    } else if (labelSelectedProject !== projName) {
      clearLabelDetailPanel();
    }

    if (!imgs.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📲</div><div class="empty-state-sub">项目中没有图片</div></div>`;
      clearLabelDetailPanel("项目中没有图片");
      return;
    }

    const items = imgs.slice();
    renderNodesInChunks({
      container: grid,
      items,
      chunkSize: LABEL_RENDER_CHUNK,
      isCanceled: () => renderToken !== labelRenderToken,
      createNode: img => {
        const previewUrl = img.thumb_url || img.url;
        const card = document.createElement("div");
        card.dataset.filename = img.filename;
        card.className = "img-card" + (img.labeled ? " labeled" : "");
        if (labelSelectedProject === projName && labelSelectedFilename === img.filename) {
          card.classList.add("selected");
        }
        card.innerHTML = `
          <img class="img-thumb" src="${previewUrl}" loading="lazy" decoding="async" fetchpriority="low" />
          <div class="img-card-footer">
            <span class="img-card-name" title="${escHtml(img.filename)}">${escHtml(img.filename)}</span>
            ${img.labeled ? '<span class="img-labeled-badge">已标注</span>' : ''}
          </div>`;
        card.addEventListener("click", () => showLabelDetail(img, projName, card));
        return card;
      },
    });
  } catch (e) {
    if (loadToken !== labelLoadToken) return;
    toast("加载失败: " + e.message, "error");
  }
}

document.getElementById("btn-label-refresh").addEventListener("click", () => {
  loadLabelImages(document.getElementById("label-proj-select").value);
});

document.getElementById("label-detail-save").addEventListener("click", async () => {
  if (!labelSelectedProject || !labelSelectedFilename) {
    toast("请先选择图片", "info");
    return;
  }

  const label = document.getElementById("label-detail-text").value.trim();
  const fd = new FormData();
  fd.append("label", label);

  try {
    await api("PUT", projectLabelApi(labelSelectedProject, labelSelectedFilename), fd, true);
    toast("标注已保存", "success");
    await loadLabelImages(labelSelectedProject);
  } catch (e) {
    toast("保存失败: " + e.message, "error");
  }
});

document.getElementById("label-detail-del").addEventListener("click", async () => {
  if (!labelSelectedProject || !labelSelectedFilename) {
    toast("请先选择图片", "info");
    return;
  }

  try {
    await api("DELETE", projectLabelApi(labelSelectedProject, labelSelectedFilename));
    toast("标注已删除", "info");
    await loadLabelImages(labelSelectedProject);
  } catch (e) {
    toast("删除失败: " + e.message, "error");
  }
});

// Mode cards
document.querySelectorAll(".mode-card[data-lmode]").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".mode-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    labelMode = card.dataset.lmode;
    updateModeDesc();
  });
});

function updateModeDesc() {
  document.getElementById("mode-desc-box").textContent = modeInfo[labelMode] || "";
  document.getElementById("custom-prompt-box").classList.toggle("hidden", labelMode !== "custom");
}

// LM Studio test
document.getElementById("btn-test-lm").addEventListener("click", async () => {
  const url = document.getElementById("lm-url").value.trim();
  const dot = document.getElementById("lm-dot");
  const txt = document.getElementById("lm-status-text");
  txt.textContent = "连接中...";
  dot.className = "status-dot";

  try {
    const res = await api("POST", "/api/test-lmstudio", {
      lm_studio_url: url,
      model: "",
      mode: "general",
      custom_prompt: "",
      prepend_tags: "",
      append_tags: "",
      max_tokens: 100,
      temperature: 0.3,
      overwrite: true,
    });

    if (res.ok) {
      dot.className = "status-dot ok";
      txt.textContent = `已连接，${res.models.length} 个模型`;
      const sel = document.getElementById("lm-model");
      sel.innerHTML = `<option value="">-- 选择模型 --</option>`;
      res.models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        sel.appendChild(opt);
      });
      toast("LM Studio 连接成功", "success");
    } else {
      dot.className = "status-dot err";
      txt.textContent = "连接失败: " + res.error;
      toast("连接失败: " + res.error, "error");
    }
  } catch (e) {
    dot.className = "status-dot err";
    txt.textContent = "错误: " + e.message;
    toast("连接错误: " + e.message, "error");
  }
});

// Do label
document.getElementById("btn-do-label").addEventListener("click", async () => {
  const proj = document.getElementById("label-proj-select").value;
  if (!proj) {
    toast("请先选择项目", "error");
    return;
  }

  const url = document.getElementById("lm-url").value.trim();
  const model = document.getElementById("lm-model").value;
  if (!url) {
    toast("请输入 LM Studio 地址", "error");
    return;
  }

  const overwrite = document.getElementById("overwrite-labels").checked;
  const skip = document.getElementById("skip-labeled").checked;
  if (labelMode === "custom" && !document.getElementById("custom-prompt").value.trim()) {
    toast("自定义模式下请填写提示词", "error");
    return;
  }

  const card = document.getElementById("label-result-card");
  const pbar = document.getElementById("label-pbar");
  const ptext = document.getElementById("label-ptext");
  const rlist = document.getElementById("label-result-list");
  card.style.display = "block";
  pbar.style.width = "5%";
  ptext.textContent = "正在打标，请稍候...";
  rlist.innerHTML = "";

  labelJobId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  document.getElementById("btn-do-label").disabled = true;
  document.getElementById("btn-stop-label").style.display = "block";

  try {
    const settings = {
      lm_studio_url: url,
      model,
      mode: labelMode,
      custom_prompt: document.getElementById("custom-prompt").value.trim(),
      prepend_tags: document.getElementById("prepend-tags").value.trim(),
      append_tags: document.getElementById("append-tags").value.trim(),
      max_tokens: parseInt(document.getElementById("max-tokens").value) || 500,
      temperature: parseFloat(document.getElementById("temperature").value) || 0.2,
      overwrite,
      skip_labeled: skip,
      job_id: labelJobId,
    };

    const res = await api("POST", `${projectApi(proj)}/label`, settings);
    pbar.style.width = "100%";

    const ok = res.results.filter(r => r.ok && !r.skipped).length;
    const skipCount = res.results.filter(r => r.skipped).length;
    const fail = res.results.filter(r => !r.ok).length;

    ptext.textContent = `${res.canceled ? "已停止：" : "完成："}${ok} 已标注${skipCount ? ` / ${skipCount} 跳过` : ""}${fail ? ` / ${fail} 失败` : ""}`;

    res.results.forEach(r => {
      const el = document.createElement("div");
      if (r.skipped) {
        el.className = "result-item skip";
        el.innerHTML = `<span class="result-icon">⏭️</span><div><div class="result-file">${escHtml(r.file)}</div><div class="result-detail text-dim">已跳过（已有标注）</div></div>`;
      } else if (r.ok) {
        el.className = "result-item ok";
        el.innerHTML = `<span class="result-icon">✓</span><div><div class="result-file">${escHtml(r.file)}</div><div class="result-detail">${escHtml(r.label)}</div></div>`;
      } else {
        el.className = "result-item err";
        el.innerHTML = `<span class="result-icon">✗</span><div><div class="result-file">${escHtml(r.file)}</div><div class="result-detail text-error">${escHtml(r.error)}</div></div>`;
      }
      rlist.appendChild(el);
    });

    toast(res.canceled ? "打标任务已停止" : `打标完成：${ok} 张`, res.canceled ? "info" : "success");
    loadLabelImages(proj);
  } catch (e) {
    toast("打标失败: " + e.message, "error");
    ptext.textContent = "失败: " + e.message;
    pbar.style.background = "var(--error)";
  }

  document.getElementById("btn-do-label").disabled = false;
  document.getElementById("btn-stop-label").style.display = "none";
  labelJobId = null;
});

document.getElementById("btn-stop-label").addEventListener("click", async () => {
  if (!labelJobId) {
    toast("当前没有进行中的打标任务", "info");
    return;
  }

  try {
    await api("POST", `/api/label-jobs/${encPath(labelJobId)}/cancel`, {});
    toast("已发送停止信号，当前图片处理完成后停止", "info");
  } catch (e) {
    toast("发送停止信号失败: " + e.message, "error");
  }
});

