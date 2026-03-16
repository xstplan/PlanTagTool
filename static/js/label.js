// TAB 3 - Labeling
// =====================================================================

let labelMode = "character";
let labelSelectedProject = "";
let labelSelectedFilename = "";
let labelLanguage = "en";
let labelContextTarget = null;
let labelPollToken = 0;

const labelDetail = createImageDetailPanelController({
  gridSelector: "#label-img-grid",
  emptySelector: "#label-detail-empty",
  mainSelector: "#label-detail-main",
  statusSelector: "#label-detail-status",
  imageSelector: "#label-detail-img",
  nameSelector: "#label-detail-name",
  metaSelector: "#label-detail-meta",
  textSelector: "#label-detail-text",
  defaultMessage: "点击上方图片查看和编辑标注",
  getSelection: () => ({ project: labelSelectedProject, filename: labelSelectedFilename }),
  setSelection: (project, filename) => {
    labelSelectedProject = project || "";
    labelSelectedFilename = filename || "";
  },
});

const modeInfo = {
  character: "人物打标：优先标注角色脸和身份稳定特征，如发型发色、眼睛、脸部细节、表情、视线与头部角度；弱化服装和背景",
  object:    "物体打标：标注主体物体本身（类别、材质、颜色、结构细节）以及必要场景信息",
  style:     "风格打标：标注画风与表现方式（媒介、线条、渲染、色调、构图、氛围）",
  scenery:   "场景打标：标注环境类型、时间天气、季节、光线、视角与空间氛围",
  fashion:   "服装打标：仅标注服装与配饰本体（款式、版型、颜色、面料、细节），排除人物与背景",
  shoes:     "鞋类训练辅助：不标注任何鞋子描述词，只标注鞋子以外的可见信息（人物/服装/背景/光线/构图），建议在前缀标签填触发词",
  general:   "通用打标：对主体、风格、颜色、构图、动作和场景做综合描述",
  custom:    "自定义提示词：按你的规则生成标签",
};

function clearLabelDetailPanel(message = "点击上方图片查看和编辑标注", keepSelection = false) {
  labelDetail.clear(message, keepSelection);
}

function showLabelDetail(img, projName, card = null) {
  labelDetail.show(img, projName, card);
}

function initLabelTab() {
  syncProjectSelects();
  updateModeDesc();
  initLabelContextMenu();
  const activeLangBtn = document.querySelector("#label-lang-switch .format-btn.active[data-label-lang]");
  if (activeLangBtn) {
    labelLanguage = activeLangBtn.dataset.labelLang || "en";
  }
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
  hideLabelContextMenu();

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
    labelDetail.sync(imgs, projName, { emptyMessage: "项目中没有图片" });

    if (!imgs.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📲</div><div class="empty-state-sub">项目中没有图片</div></div>`;
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
        card.addEventListener("contextmenu", event => showLabelContextMenu(event, img, projName, card));
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

document.querySelectorAll("#label-lang-switch .format-btn[data-label-lang]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#label-lang-switch .format-btn[data-label-lang]").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
    labelLanguage = btn.dataset.labelLang || "en";
  });
});

async function translateLabelDetailTo(targetLanguage) {
  const textEl = document.getElementById("label-detail-text");
  const source = textEl.value.trim();
  if (!source) {
    toast("没有可翻译的标签文本", "info");
    return;
  }
  try {
    const translated = await translateTagsText(source, targetLanguage, { maxTokens: 400, temperature: 0.1 });
    if (translated) {
      textEl.value = translated;
      toast(targetLanguage === "zh" ? "已翻译为中文" : "Translated to English", "success");
    } else {
      toast("翻译结果为空", "error");
    }
  } catch (e) {
    toast("翻译失败: " + e.message, "error");
  }
}

document.getElementById("label-translate-zh")?.addEventListener("click", () => translateLabelDetailTo("zh"));
document.getElementById("label-translate-en")?.addEventListener("click", () => translateLabelDetailTo("en"));

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

function getCurrentLabelSettings(includeJobId = false) {
  const url = document.getElementById("lm-url").value.trim();
  const model = document.getElementById("lm-model").value;
  if (!url) {
    throw new Error("请输入 LM Studio 地址");
  }
  if (labelMode === "custom" && !document.getElementById("custom-prompt").value.trim()) {
    throw new Error("自定义模式下请填写提示词");
  }

  const settings = {
    lm_studio_url: url,
    model,
    mode: labelMode,
    prompt_extra_info: document.getElementById("label-prompt-extra").value.trim(),
    custom_prompt: document.getElementById("custom-prompt").value.trim(),
    prepend_tags: document.getElementById("prepend-tags").value.trim(),
    append_tags: document.getElementById("append-tags").value.trim(),
    max_tokens: parseInt(document.getElementById("max-tokens").value, 10) || 500,
    temperature: parseFloat(document.getElementById("temperature").value) || 0.2,
    overwrite: document.getElementById("overwrite-labels").checked,
    skip_labeled: document.getElementById("skip-labeled").checked,
    label_language: labelLanguage,
  };

  if (includeJobId) {
    settings.job_id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return settings;
}

function updateLabelResultPanelStart(message, clearList = true) {
  const card = document.getElementById("label-result-card");
  const pbar = document.getElementById("label-pbar");
  const ptext = document.getElementById("label-ptext");
  const rlist = document.getElementById("label-result-list");

  card.style.display = "block";
  pbar.style.width = "8%";
  pbar.style.background = "";
  ptext.textContent = message;
  if (clearList) {
    rlist.innerHTML = "";
  }

  return { pbar, ptext, rlist };
}

function appendLabelResultItem(result) {
  const rlist = document.getElementById("label-result-list");
  const el = document.createElement("div");
  if (result.skipped) {
    el.className = "result-item skip";
    el.innerHTML = `<span class="result-icon">⏭️</span><div><div class="result-file">${escHtml(result.file)}</div><div class="result-detail text-dim">已跳过（已有标注）</div></div>`;
  } else if (result.ok) {
    el.className = "result-item ok";
    el.innerHTML = `<span class="result-icon">✓</span><div><div class="result-file">${escHtml(result.file)}</div><div class="result-detail">${escHtml(result.label)}</div></div>`;
  } else {
    el.className = "result-item err";
    el.innerHTML = `<span class="result-icon">✗</span><div><div class="result-file">${escHtml(result.file)}</div><div class="result-detail text-error">${escHtml(result.error)}</div></div>`;
  }
  rlist.appendChild(el);
}

function hideLabelContextMenu() {
  const menu = document.getElementById("label-context-menu");
  if (menu) {
    menu.classList.add("hidden");
  }
  labelContextTarget = null;
}

function showLabelContextMenu(event, img, projName, card) {
  event.preventDefault();
  showLabelDetail(img, projName, card);

  const menu = document.getElementById("label-context-menu");
  if (!menu) return;

  labelContextTarget = { img, projName };
  menu.classList.remove("hidden");

  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function initLabelContextMenu() {
  if (initLabelContextMenu._initialized) return;
  initLabelContextMenu._initialized = true;

  const menu = document.getElementById("label-context-menu");
  const singleBtn = document.getElementById("label-context-single");
  if (!menu || !singleBtn) return;

  singleBtn.addEventListener("click", async () => {
    const target = labelContextTarget;
    hideLabelContextMenu();
    if (!target) return;
    await runSingleLabel(target.projName, target.img.filename);
  });

  document.addEventListener("click", event => {
    if (!menu.classList.contains("hidden") && !menu.contains(event.target)) {
      hideLabelContextMenu();
    }
  });

  document.addEventListener("contextmenu", event => {
    if (!event.target.closest("#label-img-grid .img-card")) {
      hideLabelContextMenu();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideLabelContextMenu();
    }
  });

  window.addEventListener("resize", hideLabelContextMenu);
  document.addEventListener("scroll", hideLabelContextMenu, true);
}

async function runSingleLabel(projName, filename) {
  if (!projName || !filename) {
    toast("请先选择图片", "info");
    return;
  }
  if (labelJobId) {
    toast("当前有批量打标任务进行中，请先停止", "info");
    return;
  }

  labelSelectedProject = projName;
  labelSelectedFilename = filename;

  let settings;
  try {
    settings = getCurrentLabelSettings(false);
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  const { pbar, ptext } = updateLabelResultPanelStart(`正在单独打标：${filename}`);

  try {
    const result = await api("POST", `${projectApi(projName)}/label-single/${encPath(filename)}`, settings);
    pbar.style.width = "100%";
    ptext.textContent = result.skipped ? `已跳过：${filename}` : `单图打标完成：${filename}`;
    appendLabelResultItem(result);
    toast(result.skipped ? "该图片已按当前设置跳过" : "单图打标完成", "success");
    await loadLabelImages(projName);
  } catch (e) {
    pbar.style.width = "100%";
    pbar.style.background = "var(--error)";
    ptext.textContent = `单图打标失败：${filename}`;
    appendLabelResultItem({ file: filename, ok: false, error: e.message });
    toast("单图打标失败: " + e.message, "error");
  }
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
  let settings;
  try {
    settings = getCurrentLabelSettings(true);
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  const { pbar, ptext } = updateLabelResultPanelStart("准备任务...");
  labelJobId = settings.job_id;
  let renderedResultCount = 0;

  document.getElementById("btn-do-label").disabled = true;
  document.getElementById("btn-stop-label").style.display = "block";
  const pollToken = ++labelPollToken;

  try {
    const start = await api("POST", `${projectApi(proj)}/label/start`, settings);
    const jobId = start.job_id;
    if (!jobId) {
      throw new Error("任务启动失败：未返回 job_id");
    }

    let job = null;
    while (pollToken === labelPollToken) {
      job = await api("GET", `/api/label-jobs/${encPath(jobId)}`);
      const total = Number(job.total || 0);
      const done = Number(job.done || 0);
      const progress = Math.max(2, total > 0 ? Math.floor((done / total) * 100) : Number(job.progress || 0));
      pbar.style.width = `${Math.min(100, progress)}%`;
      if (job.message === "cancel_requested") {
        ptext.textContent = "正在停止，等待当前图片完成...";
      } else {
        ptext.textContent = total > 0
          ? `打标中：${done}/${total}${job.current_file ? `（${job.current_file}）` : ""}`
          : "打标中，正在准备...";
      }

      const results = Array.isArray(job.results) ? job.results : [];
      while (renderedResultCount < results.length) {
        appendLabelResultItem(results[renderedResultCount]);
        renderedResultCount += 1;
      }

      if (job.status === "completed" || job.status === "canceled") break;
      if (job.status === "failed") {
        throw new Error(job.error || job.message || "批量打标失败");
      }
      await sleep(250);
    }

    if (pollToken !== labelPollToken) return;

    const results = Array.isArray(job?.results) ? job.results : [];
    const ok = results.filter(r => r.ok && !r.skipped).length;
    const skipCount = results.filter(r => r.skipped).length;
    const fail = results.filter(r => !r.ok).length;
    const canceled = job?.status === "canceled" || Boolean(job?.canceled);

    pbar.style.width = "100%";
    ptext.textContent = `${canceled ? "已停止：" : "完成："}${ok} 已标注${skipCount ? ` / ${skipCount} 跳过` : ""}${fail ? ` / ${fail} 失败` : ""}`;

    toast(canceled ? "打标任务已停止" : `打标完成：${ok} 张`, canceled ? "info" : "success");
    await loadLabelImages(proj);
  } catch (e) {
    toast("打标失败: " + e.message, "error");
    ptext.textContent = "失败: " + e.message;
    pbar.style.width = "100%";
    pbar.style.background = "var(--error)";
  } finally {
    document.getElementById("btn-do-label").disabled = false;
    document.getElementById("btn-stop-label").style.display = "none";
    labelJobId = null;
  }
});

document.getElementById("btn-stop-label").addEventListener("click", async () => {
  if (!labelJobId) {
    toast("当前没有进行中的打标任务", "info");
    return;
  }

  try {
    await api("POST", `/api/label-jobs/${encPath(labelJobId)}/cancel`, {});
    const ptext = document.getElementById("label-ptext");
    if (ptext) {
      ptext.textContent = "正在停止，等待当前图片完成...";
    }
    toast("已发送停止信号，当前图片处理完成后停止", "info");
  } catch (e) {
    toast("发送停止信号失败: " + e.message, "error");
  }
});

