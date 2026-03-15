// TAB 1 - Dataset Management
// =====================================================================

let datasetSelectedProject = "";
let datasetSelectedFilename = "";
let renameTargetProject = "";
let datasetImageSource = "original";

const datasetDetail = createImageDetailPanelController({
  gridSelector: "#img-grid",
  emptySelector: "#dataset-detail-empty",
  mainSelector: "#dataset-detail-main",
  statusSelector: "#dataset-detail-status",
  imageSelector: "#dataset-detail-img",
  nameSelector: "#dataset-detail-name",
  metaSelector: "#dataset-detail-meta",
  textSelector: "#dataset-detail-text",
  defaultMessage: "点击图片查看和编辑详细信息",
  getSelection: () => ({ project: datasetSelectedProject, filename: datasetSelectedFilename }),
  setSelection: (project, filename) => {
    datasetSelectedProject = project || "";
    datasetSelectedFilename = filename || "";
  },
});

function clearDatasetDetailPanel(message = "点击图片查看和编辑详细信息", keepSelection = false) {
  datasetDetail.clear(message, keepSelection);
}

function showDatasetDetail(img, projectName = State.currentProject, card = null) {
  datasetDetail.show(img, projectName, card);
}

function getDatasetSourceLabel() {
  return datasetImageSource === "active" ? "处理图" : "原图";
}

function datasetImageApi(filename) {
  return `${projectImageApi(State.currentProject, filename)}?source=${encPath(datasetImageSource)}`;
}

function datasetLabelApi(projectName, filename) {
  return `${projectLabelApi(projectName, filename)}?source=${encPath(datasetImageSource)}`;
}

function updateDatasetSourceSwitch() {
  document.querySelectorAll("[data-dataset-source]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.datasetSource === datasetImageSource);
  });
}

async function loadProjects() {
  try {
    State.projects = await api("GET", "/api/projects");
    renderProjectList();
    syncProjectSelects();
  } catch (e) {
    toast("加载项目失败: " + e.message, "error");
  }
}

function renderProjectList() {
  const list = document.getElementById("project-list");
  list.innerHTML = "";
  if (!State.projects.length) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 10px;font-size:12px">暂无项目，点击「+ 新建」</div>`;
    return;
  }
  State.projects.forEach(p => {
    const item = document.createElement("div");
    item.className = "project-item" + (p.name === State.currentProject ? " active" : "");
    item.dataset.name = p.name;
    item.innerHTML = `
      <span class="project-name">${escHtml(p.name)}</span>
      <span class="project-count">${p.image_count}</span>
      <div class="project-actions">
        <button class="project-rename" data-rename="${escHtml(p.name)}" title="重命名项目">改名</button>
        <button class="project-del" data-del="${escHtml(p.name)}" title="删除项目">✕</button>
      </div>
    `;
    item.addEventListener("click", e => {
      if (e.target.dataset.del || e.target.dataset.rename) return;
      selectProject(p.name);
    });
    item.querySelector(".project-rename").addEventListener("click", e => {
      e.stopPropagation();
      openRenameProjectModal(p.name);
    });
    item.querySelector(".project-del").addEventListener("click", e => {
      e.stopPropagation();
      deleteProject(p.name);
    });
    list.appendChild(item);
  });
}

function syncProjectSelects() {
  ["resize-proj-select", "label-proj-select"].forEach(id => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">-- 请选择项目 --</option>`;
    State.projects.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = `${p.name} (${p.image_count})`;
      if (p.name === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

async function selectProject(name) {
  const projectChanged = State.currentProject !== name;
  State.currentProject = name;
  if (projectChanged) {
    clearDatasetDetailPanel();
  }
  renderProjectList();
  await loadImages();
  document.getElementById("dataset-empty").classList.add("hidden");
  document.getElementById("dataset-main").classList.remove("hidden");
}

async function loadImages() {
  if (!State.currentProject) return;
  const loadToken = ++datasetLoadToken;
  try {
    const images = await api("GET", `${projectApi(State.currentProject)}/images?source=${encPath(datasetImageSource)}`);
    if (loadToken !== datasetLoadToken) return;
    State.images = images;
    renderImageGrid();
    datasetDetail.sync(State.images, State.currentProject, { emptyMessage: `项目中没有${getDatasetSourceLabel()}` });
  } catch (e) {
    if (loadToken !== datasetLoadToken) return;
    toast("加载图片失败: " + e.message, "error");
  }
}

function renderImageGrid() {
  const renderToken = ++datasetRenderToken;
  const grid = document.getElementById("img-grid");
  const count = document.getElementById("img-count");
  count.textContent = `${State.images.length} 张${getDatasetSourceLabel()}`;
  grid.replaceChildren();
  if (!State.images.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">📲</div>
      <div class="empty-state-text">还没有${getDatasetSourceLabel()}</div>
      <div class="empty-state-sub">${datasetImageSource === "original" ? "拖拽图片到上方区域上传" : "先到图片处理页面生成处理后的图片"}</div>
    </div>`;
    return;
  }

  const items = State.images.slice();
  renderNodesInChunks({
    container: grid,
    items,
    chunkSize: DATASET_RENDER_CHUNK,
    isCanceled: () => renderToken !== datasetRenderToken,
    createNode: img => {
      const previewUrl = img.thumb_url || img.url;
      const card = document.createElement("div");
      card.className = "img-card" + (img.labeled ? " labeled" : "");
      card.dataset.filename = img.filename;
      if (datasetSelectedProject === State.currentProject && datasetSelectedFilename === img.filename) {
        card.classList.add("selected");
      }
      card.innerHTML = `
        <img class="img-thumb" src="${previewUrl}" loading="lazy" decoding="async" fetchpriority="low" alt="${escHtml(img.filename)}" />
        <div class="img-card-footer">
          <span class="img-card-name" title="${escHtml(img.filename)}">${escHtml(img.filename)}</span>
          ${img.labeled ? '<span class="img-labeled-badge">已标注</span>' : ''}
        </div>
        <button class="img-card-del" data-del="${escHtml(img.filename)}" title="删除图片">✕</button>
      `;
      card.addEventListener("click", e => {
        if (e.target.dataset.del) return;
        showDatasetDetail(img, State.currentProject, card);
      });
      card.querySelector(".img-card-del").addEventListener("click", e => {
        e.stopPropagation();
        deleteImage(img.filename);
      });
      return card;
    },
  });
}

// New project modal
document.getElementById("btn-new-project")?.addEventListener("click", () => {
  document.getElementById("new-proj-modal").classList.remove("hidden");
  document.getElementById("new-proj-name").value = "";
  document.getElementById("new-proj-name").focus();
});
document.getElementById("new-proj-close")?.addEventListener("click", () =>
  document.getElementById("new-proj-modal").classList.add("hidden"));
document.getElementById("new-proj-cancel")?.addEventListener("click", () =>
  document.getElementById("new-proj-modal").classList.add("hidden"));
document.getElementById("new-proj-confirm")?.addEventListener("click", createProject);
document.getElementById("new-proj-name")?.addEventListener("keydown", e => {
  if (e.key === "Enter") createProject();
});

async function createProject() {
  const name = document.getElementById("new-proj-name").value.trim();
  if (!name) {
    toast("请输入项目名称", "error");
    return;
  }
  try {
    const fd = new FormData();
    fd.append("name", name);
    await api("POST", "/api/projects", fd, true);
    document.getElementById("new-proj-modal").classList.add("hidden");
    await loadProjects();
    selectProject(name);
    toast(`项目 "${name}" 已创建`, "success");
  } catch (e) {
    toast("创建失败: " + e.message, "error");
  }
}

function openRenameProjectModal(projectName) {
  renameTargetProject = projectName || "";
  const modal = document.getElementById("rename-proj-modal");
  const input = document.getElementById("rename-proj-name");
  if (!modal || !input || !renameTargetProject) return;
  input.value = renameTargetProject;
  modal.classList.remove("hidden");
  input.focus();
  input.select();
}

function closeRenameProjectModal() {
  renameTargetProject = "";
  document.getElementById("rename-proj-modal")?.classList.add("hidden");
}

function syncRenamedProjectRefs(oldName, newName) {
  if (State.currentProject === oldName) {
    State.currentProject = newName;
  }
  if (datasetSelectedProject === oldName) {
    datasetSelectedProject = newName;
  }
  if (typeof labelSelectedProject !== "undefined" && labelSelectedProject === oldName) {
    labelSelectedProject = newName;
  }

  const resizeSel = document.getElementById("resize-proj-select");
  if (resizeSel && resizeSel.value === oldName) {
    resizeSel.value = newName;
  }
  const labelSel = document.getElementById("label-proj-select");
  if (labelSel && labelSel.value === oldName) {
    labelSel.value = newName;
  }
}

document.getElementById("rename-proj-close")?.addEventListener("click", closeRenameProjectModal);
document.getElementById("rename-proj-cancel")?.addEventListener("click", closeRenameProjectModal);
document.getElementById("rename-proj-confirm")?.addEventListener("click", renameProject);
document.getElementById("rename-proj-name")?.addEventListener("keydown", e => {
  if (e.key === "Enter") renameProject();
});

async function renameProject() {
  const oldName = renameTargetProject;
  const input = document.getElementById("rename-proj-name");
  const newName = input?.value.trim() || "";
  if (!oldName) {
    toast("没有可重命名的项目", "error");
    return;
  }
  if (!newName) {
    toast("请输入新的项目名称", "error");
    return;
  }

  try {
    const fd = new FormData();
    fd.append("new_name", newName);
    const res = await api("PUT", projectApi(oldName), fd, true);
    const finalName = String(res.name || newName).trim();
    syncRenamedProjectRefs(oldName, finalName);
    closeRenameProjectModal();
    await loadProjects();

    if (State.currentProject === finalName) {
      await loadImages();
    }
    if (typeof loadResizePreview === "function") {
      const resizeSel = document.getElementById("resize-proj-select");
      if (resizeSel && resizeSel.value === finalName) {
        await loadResizePreview(finalName, true);
      }
    }
    if (typeof loadLabelImages === "function") {
      const labelSel = document.getElementById("label-proj-select");
      if (labelSel && labelSel.value === finalName) {
        await loadLabelImages(finalName);
      }
    }

    toast(`项目已重命名为 "${finalName}"`, "success");
  } catch (e) {
    toast("重命名失败: " + e.message, "error");
  }
}

async function deleteProject(name) {
  if (!confirm(`确认删除项目 "${name}"？此操作不可撤销。`)) return;
  try {
    await api("DELETE", projectApi(name));
    if (State.currentProject === name) {
      State.currentProject = null;
      State.images = [];
      clearDatasetDetailPanel();
      document.getElementById("dataset-empty").classList.remove("hidden");
      document.getElementById("dataset-main").classList.add("hidden");
    }
    await loadProjects();
    toast(`项目 "${name}" 已删除`, "info");
  } catch (e) {
    toast("删除失败: " + e.message, "error");
  }
}

async function deleteImage(filename) {
  if (!confirm(`删除图片 "${filename}"？`)) return;
  try {
    await api("DELETE", datasetImageApi(filename));
    await loadImages();
    toast("图片已删除", "info");
  } catch (e) {
    toast("删除图片失败: " + e.message, "error");
  }
}

// Upload
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const folderInput = document.getElementById("folder-input");
const pickFilesBtn = document.getElementById("btn-pick-files");
const pickFolderBtn = document.getElementById("btn-pick-folder");
const pasteFilesBtn = document.getElementById("btn-paste-files");
const uploadProgressWrap = document.getElementById("upload-progress-wrap");
const uploadPbar = document.getElementById("upload-pbar");
const uploadPtext = document.getElementById("upload-ptext");
let uploadInProgress = false;

function isImageFile(filename) {
  return /\.(jpe?g|png|webp|bmp|gif)$/i.test(filename || "");
}

function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, [contenteditable='true'], [contenteditable=''], select"));
}

function extensionFromMime(type) {
  const mime = String(type || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/bmp") return "bmp";
  if (mime === "image/gif") return "gif";
  return "png";
}

function createClipboardImageFile(blob, index = 0) {
  if (!blob) return null;
  if (blob instanceof File && blob.name && isImageFile(blob.name)) {
    return blob;
  }
  const ext = extensionFromMime(blob.type);
  const timestamp = Date.now();
  const name = `pasted_${timestamp}_${index + 1}.${ext}`;
  return new File([blob], name, {
    type: blob.type || `image/${ext}`,
    lastModified: timestamp,
  });
}

async function readDirectoryEntries(reader) {
  const all = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

async function collectFilesFromEntry(entry, addFile) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    addFile(file);
    return;
  }
  if (!entry.isDirectory) return;
  const entries = await readDirectoryEntries(entry.createReader());
  for (const child of entries) {
    await collectFilesFromEntry(child, addFile);
  }
}

async function collectDroppedFiles(dataTransfer) {
  const files = [];
  const seen = new Set();

  const addFile = file => {
    if (!file || !isImageFile(file.name)) return;
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  // For multi-file drag from explorer/finder, DataTransfer.files is more reliable.
  Array.from(dataTransfer?.files || []).forEach(addFile);

  // For folder drag-drop, recursively read directory entries.
  if (dataTransfer?.items?.length) {
    for (const item of Array.from(dataTransfer.items)) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) {
        await collectFilesFromEntry(entry, addFile);
        continue;
      }
      const file = item.getAsFile?.();
      if (file) addFile(file);
    }
  }

  return files;
}

function collectClipboardFiles(clipboardData) {
  const files = [];
  const addFile = file => {
    if (!file || files.length >= 1) return;
    const normalized = createClipboardImageFile(file, files.length);
    if (!normalized || !isImageFile(normalized.name)) return;
    files.push(normalized);
  };

  Array.from(clipboardData?.files || []).forEach(addFile);
  Array.from(clipboardData?.items || []).forEach(item => {
    if (item.kind !== "file") return;
    const file = item.getAsFile?.();
    if (file && String(file.type || "").startsWith("image/")) {
      addFile(file);
    }
  });

  return files;
}

async function readClipboardFilesFromNavigator() {
  if (!navigator.clipboard?.read) {
    throw new Error("当前浏览器不支持系统剪贴板读取");
  }

  const items = await navigator.clipboard.read();

  for (const item of items) {
    for (const type of item.types || []) {
      if (!String(type || "").startsWith("image/")) continue;
      const blob = await item.getType(type);
      const file = createClipboardImageFile(blob, 0);
      if (!file || !isImageFile(file.name)) continue;
      return [file];
    }
  }

  return [];
}

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function setUploadUiState(isUploading) {
  uploadInProgress = isUploading;
  pickFilesBtn.disabled = isUploading;
  pickFolderBtn.disabled = isUploading;
  if (pasteFilesBtn) pasteFilesBtn.disabled = isUploading;
  dropZone.classList.toggle("uploading", isUploading);
}

function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path, true);
    xhr.responseType = "json";

    xhr.upload.onprogress = evt => {
      if (onProgress) onProgress(evt.loaded, evt.total, evt.lengthComputable);
    };

    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.onload = () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.detail || xhr.statusText || "上传失败"));
      }
    };

    xhr.send(formData);
  });
}

async function uploadClipboardImages(clipboardData = null) {
  if (uploadInProgress) {
    toast("正在上传中，请稍后...", "info");
    return;
  }
  if (!State.currentProject) {
    toast("请先选择项目，再粘贴图片", "error");
    return;
  }

  let files = collectClipboardFiles(clipboardData);
  if (!files.length) {
    files = await readClipboardFilesFromNavigator();
  }
  if (!files.length) {
    throw new Error("剪贴板中没有可上传的图片");
  }

  toast("检测到剪贴板图片，开始上传", "info");
  await handleFiles(files);
}

if (pickFilesBtn && fileInput) {
  pickFilesBtn.addEventListener("click", e => {
    e.stopPropagation();
    fileInput.click();
  });
}
if (pickFolderBtn && folderInput) {
  pickFolderBtn.addEventListener("click", e => {
    e.stopPropagation();
    folderInput.click();
  });
}
if (pasteFilesBtn) {
  pasteFilesBtn.addEventListener("click", async e => {
    e.stopPropagation();
    try {
      await uploadClipboardImages(null);
    } catch (err) {
      toast("粘贴失败: " + err.message, "error");
    }
  });
}
if (dropZone && fileInput) {
  dropZone.addEventListener("click", () => {
    if (uploadInProgress) return;
    fileInput.click();
  });
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", async e => {
    e.preventDefault();
    if (uploadInProgress) return;
    dropZone.classList.remove("dragover");
    const dropped = await collectDroppedFiles(e.dataTransfer);
    handleFiles(dropped);
  });
}
fileInput?.addEventListener("change", () => handleFiles(fileInput.files));
folderInput?.addEventListener("change", () => handleFiles(folderInput.files));

async function handleFiles(files) {
  if (uploadInProgress) {
    toast("正在上传中，请稍后...", "info");
    return;
  }
  if (!State.currentProject) { toast("请先选择项目", "error"); return; }
  if (!files.length) return;

  const imageFiles = Array.from(files).filter(f => isImageFile(f.name));
  if (!imageFiles.length) {
    toast("未检测到可上传的图片文件", "error");
    return;
  }

  const fd = new FormData();
  imageFiles.forEach(f => fd.append("files", f));
  const totalBytes = imageFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  uploadProgressWrap.classList.remove("hidden");
  uploadPbar.style.background = "var(--accent)";
  uploadPbar.style.width = "1%";
  uploadPtext.textContent = `准备上传 ${imageFiles.length} 张（${formatBytes(totalBytes)}）...`;
  setUploadUiState(true);
  try {
    const res = await uploadWithProgress(`${projectApi(State.currentProject)}/upload`, fd, (loaded, total, computable) => {
      if (computable && total > 0) {
        const pct = Math.max(1, Math.min(100, Math.round((loaded / total) * 100)));
        uploadPbar.style.width = `${pct}%`;
        uploadPtext.textContent = `上传中 ${pct}%（${formatBytes(loaded)} / ${formatBytes(total)}）`;
      } else {
        uploadPtext.textContent = `上传中（${formatBytes(loaded)}）`;
      }
    });
    uploadPbar.style.width = "100%";
    uploadPtext.textContent = `上传完成：${res.saved?.length ?? 0} 张`;
    await loadImages();
    toast(`上传成功 ${res.saved.length} 张${res.errors.length ? `（${res.errors.length} 个错误）` : ""}`, "success");
  } catch (e) {
    toast("上传失败: " + e.message, "error");
    uploadPbar.style.width = "100%";
    uploadPbar.style.background = "var(--error)";
    uploadPtext.textContent = "上传失败: " + e.message;
  } finally {
    setUploadUiState(false);
    fileInput.value = "";
    folderInput.value = "";
  }
}

window.addEventListener("paste", async event => {
  const datasetPanel = document.getElementById("panel-dataset");
  if (!datasetPanel?.classList.contains("active")) return;
  if (isEditableTarget(event.target)) return;

  event.preventDefault();
  try {
    await uploadClipboardImages(event.clipboardData);
  } catch (err) {
    toast("粘贴失败: " + err.message, "error");
  }
}, true);

document.getElementById("btn-refresh-imgs")?.addEventListener("click", loadImages);

document.querySelectorAll("[data-dataset-source]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const nextSource = btn.dataset.datasetSource || "original";
    if (nextSource === datasetImageSource) return;
    datasetImageSource = nextSource;
    updateDatasetSourceSwitch();
    clearDatasetDetailPanel(`点击${getDatasetSourceLabel()}查看和编辑详细信息`);
    await loadImages();
  });
});

document.getElementById("btn-clear-labels")?.addEventListener("click", async () => {
  if (!State.currentProject) return;
  if (!confirm("清除当前项目所有标注文件（.txt）？")) return;
  try {
    const res = await api("DELETE", `${projectApi(State.currentProject)}/labels`);
    await loadImages();
    toast(`已清除 ${res.deleted ?? 0} 个标注文件`, "info");
  } catch (e) {
    toast("清除失败: " + e.message, "error");
  }
});

document.getElementById("dataset-detail-save")?.addEventListener("click", async () => {
  if (!datasetSelectedProject || !datasetSelectedFilename) {
    toast("请先选择图片", "info");
    return;
  }

  const label = document.getElementById("dataset-detail-text").value.trim();
  const fd = new FormData();
  fd.append("label", label);

  try {
    await api("PUT", datasetLabelApi(datasetSelectedProject, datasetSelectedFilename), fd, true);
    toast("标注已保存", "success");
    await refreshLabelRelatedViews(datasetSelectedProject);
  } catch (e) {
    toast("保存失败: " + e.message, "error");
  }
});

document.getElementById("dataset-detail-del-label")?.addEventListener("click", async () => {
  if (!datasetSelectedProject || !datasetSelectedFilename) {
    toast("请先选择图片", "info");
    return;
  }

  try {
    await api("DELETE", datasetLabelApi(datasetSelectedProject, datasetSelectedFilename));
    toast("标注已删除", "info");
    await refreshLabelRelatedViews(datasetSelectedProject);
  } catch (e) {
    toast("删除失败: " + e.message, "error");
  }
});

document.getElementById("dataset-detail-del-image")?.addEventListener("click", async () => {
  if (!datasetSelectedFilename) {
    toast("请先选择图片", "info");
    return;
  }
  await deleteImage(datasetSelectedFilename);
});

async function translateDatasetDetailTo(targetLanguage) {
  const textEl = document.getElementById("dataset-detail-text");
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

document.getElementById("dataset-translate-zh")?.addEventListener("click", () => translateDatasetDetailTo("zh"));
document.getElementById("dataset-translate-en")?.addEventListener("click", () => translateDatasetDetailTo("en"));

async function refreshLabelRelatedViews(projectName) {
  const tasks = [];
  if (projectName && State.currentProject === projectName) {
    tasks.push(loadImages());
  }
  const labelProj = document.getElementById("label-proj-select").value;
  if (projectName && labelProj === projectName) {
    tasks.push(loadLabelImages(projectName));
  }
  if (!tasks.length && State.currentProject) {
    tasks.push(loadImages());
  }
  if (tasks.length) {
    await Promise.all(tasks);
  }
}

// =====================================================================

// Init dataset tab
updateDatasetSourceSwitch();
clearDatasetDetailPanel();
loadProjects();
