// TAB 1 - Dataset Management
// =====================================================================

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
      <button class="project-del" data-del="${escHtml(p.name)}" title="删除项目">✕</button>
    `;
    item.addEventListener("click", e => {
      if (e.target.dataset.del) return;
      selectProject(p.name);
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
  State.currentProject = name;
  renderProjectList();
  await loadImages();
  document.getElementById("dataset-empty").classList.add("hidden");
  document.getElementById("dataset-main").classList.remove("hidden");
}

async function loadImages() {
  if (!State.currentProject) return;
  const loadToken = ++datasetLoadToken;
  try {
    const images = await api("GET", `${projectApi(State.currentProject)}/images`);
    if (loadToken !== datasetLoadToken) return;
    State.images = images;
    renderImageGrid();
    const p = State.projects.find(x => x.name === State.currentProject);
    if (p) p.image_count = State.images.length;
    syncProjectSelects();
  } catch (e) {
    if (loadToken !== datasetLoadToken) return;
    toast("加载图片失败: " + e.message, "error");
  }
}

function renderImageGrid() {
  const renderToken = ++datasetRenderToken;
  const grid = document.getElementById("img-grid");
  const count = document.getElementById("img-count");
  count.textContent = `${State.images.length} 张图片`;
  grid.replaceChildren();
  if (!State.images.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">📲</div>
      <div class="empty-state-text">还没有图片</div>
      <div class="empty-state-sub">拖拽图片到上方区域上传</div>
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
        openLabelModal(img, State.currentProject);
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
document.getElementById("btn-new-project").addEventListener("click", () => {
  document.getElementById("new-proj-modal").classList.remove("hidden");
  document.getElementById("new-proj-name").value = "";
  document.getElementById("new-proj-name").focus();
});
document.getElementById("new-proj-close").addEventListener("click", () =>
  document.getElementById("new-proj-modal").classList.add("hidden"));
document.getElementById("new-proj-cancel").addEventListener("click", () =>
  document.getElementById("new-proj-modal").classList.add("hidden"));
document.getElementById("new-proj-confirm").addEventListener("click", createProject);
document.getElementById("new-proj-name").addEventListener("keydown", e => {
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

async function deleteProject(name) {
  if (!confirm(`确认删除项目 "${name}"？此操作不可撤销。`)) return;
  try {
    await api("DELETE", projectApi(name));
    if (State.currentProject === name) {
      State.currentProject = null;
      State.images = [];
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
    await api("DELETE", projectImageApi(State.currentProject, filename));
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
const uploadProgressWrap = document.getElementById("upload-progress-wrap");
const uploadPbar = document.getElementById("upload-pbar");
const uploadPtext = document.getElementById("upload-ptext");
let uploadInProgress = false;

function isImageFile(filename) {
  return /\.(jpe?g|png|webp|bmp|gif)$/i.test(filename || "");
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

pickFilesBtn.addEventListener("click", e => {
  e.stopPropagation();
  fileInput.click();
});
pickFolderBtn.addEventListener("click", e => {
  e.stopPropagation();
  folderInput.click();
});
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
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
folderInput.addEventListener("change", () => handleFiles(folderInput.files));

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

document.getElementById("btn-refresh-imgs").addEventListener("click", loadImages);

document.getElementById("btn-clear-labels").addEventListener("click", async () => {
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

// Label modal
let modalImg = null;
let modalProject = null;

function openLabelModal(img, projectName = State.currentProject) {
  modalImg = img;
  modalProject = projectName || State.currentProject || "";
  document.getElementById("modal-img-name").textContent = img.filename;
  document.getElementById("modal-img").src = img.url;
  document.getElementById("modal-label-text").value = img.label || "";
  document.getElementById("label-modal").classList.remove("hidden");
  document.getElementById("modal-label-text").focus();
}

document.getElementById("modal-close").addEventListener("click", closeLabelModal);
document.getElementById("modal-cancel").addEventListener("click", closeLabelModal);
document.getElementById("label-modal").addEventListener("click", e => {
  if (e.target === document.getElementById("label-modal")) closeLabelModal();
});

function closeLabelModal() {
  document.getElementById("label-modal").classList.add("hidden");
  modalImg = null;
  modalProject = null;
}

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

document.getElementById("modal-save").addEventListener("click", async () => {
  if (!modalImg) return;
  const targetProject = modalProject || State.currentProject;
  if (!targetProject) { toast("未找到项目上下文", "error"); return; }
  const label = document.getElementById("modal-label-text").value.trim();
  const fd = new FormData();
  fd.append("label", label);
  try {
    await api("PUT", projectLabelApi(targetProject, modalImg.filename), fd, true);
    closeLabelModal();
    await refreshLabelRelatedViews(targetProject);
    toast("标注已保存", "success");
  } catch (e) {
    toast("保存失败: " + e.message, "error");
  }
});

document.getElementById("modal-del-label").addEventListener("click", async () => {
  if (!modalImg) return;
  const targetProject = modalProject || State.currentProject;
  if (!targetProject) { toast("未找到项目上下文", "error"); return; }
  try {
    await api("DELETE", projectLabelApi(targetProject, modalImg.filename));
    closeLabelModal();
    await refreshLabelRelatedViews(targetProject);
    toast("标注已删除", "info");
  } catch (e) {
    toast("删除失败: " + e.message, "error");
  }
});

// =====================================================================

// Init dataset tab
loadProjects();
