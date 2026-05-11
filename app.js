/*
  Skull Image Sorter Web
  Static, local-only browser image sorter using the File System Access API.
  Nothing is uploaded. All image reads/writes happen through browser-granted local folder handles.
*/

'use strict';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const OUTPUT_DEFAULTS = {
  good: '1_good',
  rejected: '2_rejected',
  bad: '3_bad',
  delete: 'DELETE'
};
const SETTINGS_KEY = 'skullImageSorter.settings.v1';
const KEY_LOG_KEY = 'skullImageSorter.keyLog.v1';
const DB_NAME = 'skullImageSorter.handles.v1';
const DB_STORE = 'handles';

const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  viewerPanel: $('viewerPanel'),
  dropZone: $('dropZone'),
  emptySelectSource: $('emptySelectSource'),
  singleViewer: $('singleViewer'),
  galleryViewer: $('galleryViewer'),
  mainImage: $('mainImage'),
  sidebar: $('sidebar'),
  hideUiBtn: $('hideUiBtn'),
  showUiBtn: $('showUiBtn'),
  compatWarning: $('compatWarning'),
  compatText: $('compatText'),
  selectSourceBtn: $('selectSourceBtn'),
  selectOutputRootBtn: $('selectOutputRootBtn'),
  selectGoodBtn: $('selectGoodBtn'),
  selectRejectedBtn: $('selectRejectedBtn'),
  selectBadBtn: $('selectBadBtn'),
  restoreHandlesBtn: $('restoreHandlesBtn'),
  searchInput: $('searchInput'),
  caseSensitive: $('caseSensitive'),
  labelGood: $('labelGood'),
  labelRejected: $('labelRejected'),
  labelBad: $('labelBad'),
  saveSettingsBtn: $('saveSettingsBtn'),
  currentFile: $('currentFile'),
  pictureCounter: $('pictureCounter'),
  remainingCounter: $('remainingCounter'),
  modeStatus: $('modeStatus'),
  folderStatus: $('folderStatus'),
  timerStatus: $('timerStatus'),
  stats1h: $('stats1h'),
  stats4h: $('stats4h'),
  stats24h: $('stats24h'),
  galleryBtn: $('galleryBtn'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  undoBtn: $('undoBtn'),
  rescanBtn: $('rescanBtn'),
  clearSessionBtn: $('clearSessionBtn'),
  toastRegion: $('toastRegion')
};

const state = {
  sourceHandle: null,
  outputRootHandle: null,
  outputHandles: {
    good: null,
    rejected: null,
    bad: null,
    delete: null
  },
  allImages: [],
  filteredImages: [],
  currentIndex: 0,
  selectedPaths: new Set(),
  objectUrl: null,
  showFilename: true,
  galleryMode: false,
  thumbSize: 150,
  imageZoom: 1,
  imageOffset: { x: 0, y: 0 },
  isPanning: false,
  panStart: { x: 0, y: 0 },
  lastActionAt: null,
  lastAction: null,
  settings: {
    sortMode: 'copy',
    labels: {
      good: 'Good',
      rejected: 'Rejected',
      bad: 'Bad'
    },
    caseSensitive: false
  },
  keyLog: []
};

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  el.toastRegion.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function getExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isImageName(name) {
  return IMAGE_EXTENSIONS.has(getExtension(name));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unnamed';
}

function now() {
  return Date.now();
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function idbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function verifyPermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function chooseDirectory(idbKey, mode = 'readwrite') {
  const handle = await window.showDirectoryPicker({ mode });
  const ok = await verifyPermission(handle, mode);
  if (!ok) throw new Error('Folder permission was not granted.');
  await idbSet(idbKey, handle);
  return handle;
}

async function getOrCreateSubdir(parentHandle, name) {
  return parentHandle.getDirectoryHandle(name, { create: true });
}

async function scanImagesFromFolder(directoryHandle) {
  const images = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file' || !isImageName(name)) continue;
    try {
      const file = await handle.getFile();
      images.push({
        name,
        path: name,
        handle,
        parentHandle: directoryHandle,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type || 'image/unknown'
      });
    } catch (err) {
      console.warn('Skipping unreadable image:', name, err);
    }
  }
  images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return images;
}

function applySettingsToUi() {
  const settings = loadJson(SETTINGS_KEY, state.settings);
  state.settings = {
    ...state.settings,
    ...settings,
    labels: { ...state.settings.labels, ...(settings.labels || {}) }
  };
  el.labelGood.value = state.settings.labels.good;
  el.labelRejected.value = state.settings.labels.rejected;
  el.labelBad.value = state.settings.labels.bad;
  el.caseSensitive.checked = !!state.settings.caseSensitive;
  const modeInput = document.querySelector(`input[name="sortMode"][value="${state.settings.sortMode}"]`);
  if (modeInput) modeInput.checked = true;
}

function saveSettingsFromUi() {
  state.settings.labels.good = safeName(el.labelGood.value || 'Good');
  state.settings.labels.rejected = safeName(el.labelRejected.value || 'Rejected');
  state.settings.labels.bad = safeName(el.labelBad.value || 'Bad');
  state.settings.caseSensitive = el.caseSensitive.checked;
  state.settings.sortMode = document.querySelector('input[name="sortMode"]:checked')?.value || 'copy';
  saveJson(SETTINGS_KEY, state.settings);
  toast('UI settings saved.', 'good');
  updateStatus();
}

function loadKeyLog() {
  state.keyLog = loadJson(KEY_LOG_KEY, []);
  const cutoff = now() - 86400_000;
  state.keyLog = state.keyLog.filter((entry) => entry && entry.t >= cutoff);
}

function saveKeyLog() {
  saveJson(KEY_LOG_KEY, state.keyLog);
}

function logSortKey(key) {
  state.keyLog.push({ key, t: now() });
  const cutoff = now() - 86400_000;
  state.keyLog = state.keyLog.filter((entry) => entry.t >= cutoff);
  saveKeyLog();
  updateStats();
}

function updateStats() {
  const windows = [
    { ms: 3600_000, el: el.stats1h, label: '1h' },
    { ms: 14400_000, el: el.stats4h, label: '4h' },
    { ms: 86400_000, el: el.stats24h, label: '24h' }
  ];
  const t = now();
  for (const win of windows) {
    const counts = { '1': 0, '2': 0, '3': 0 };
    for (const entry of state.keyLog) {
      if (t - entry.t <= win.ms && counts[entry.key] !== undefined) counts[entry.key] += 1;
    }
    const all = counts['1'] + counts['2'] + counts['3'];
    win.el.textContent = `${win.label} Presses - 1: ${counts['1']} 2: ${counts['2']} 3: ${counts['3']} All: ${all}`;
  }
}

function filterImages() {
  const query = el.searchInput.value.trim();
  const caseSensitive = el.caseSensitive.checked;
  state.settings.caseSensitive = caseSensitive;

  if (!query) {
    state.filteredImages = [...state.allImages];
  } else {
    const terms = query.split('/').map((part) => part.trim()).filter(Boolean);
    state.filteredImages = state.allImages.filter((img) => {
      const hay = caseSensitive ? img.name : img.name.toLowerCase();
      return terms.every((term) => hay.includes(caseSensitive ? term : term.toLowerCase()));
    });
  }

  state.currentIndex = Math.min(state.currentIndex, Math.max(0, state.filteredImages.length - 1));
  state.selectedPaths.clear();
  if (state.galleryMode) renderGallery();
  renderCurrentImage();
  updateStatus();
}

function currentImage() {
  if (!state.filteredImages.length) return null;
  return state.filteredImages[state.currentIndex] || null;
}

function revokeObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

async function renderCurrentImage() {
  const image = currentImage();
  if (!image) {
    revokeObjectUrl();
    el.mainImage.removeAttribute('src');
    el.dropZone.classList.remove('hidden');
    updateStatus();
    return;
  }

  el.dropZone.classList.add('hidden');
  try {
    const file = await image.handle.getFile();
    revokeObjectUrl();
    state.objectUrl = URL.createObjectURL(file);
    el.mainImage.src = state.objectUrl;
    el.mainImage.alt = image.name;
    resetImageTransform();
  } catch (err) {
    toast(`Could not load ${image.name}: ${err.message}`, 'bad');
  }
  updateStatus();
}

function updateStatus() {
  const image = currentImage();
  const total = state.filteredImages.length;
  const sourceName = state.sourceHandle?.name || 'none';
  const rootName = state.outputRootHandle?.name || '';
  const good = state.outputHandles.good?.name || (rootName ? OUTPUT_DEFAULTS.good : 'unset');
  const rejected = state.outputHandles.rejected?.name || (rootName ? OUTPUT_DEFAULTS.rejected : 'unset');
  const bad = state.outputHandles.bad?.name || (rootName ? OUTPUT_DEFAULTS.bad : 'unset');

  el.currentFile.textContent = image && state.showFilename ? `Name: ${image.name} (${formatBytes(image.size)})` : 'Name: —';
  el.pictureCounter.textContent = `Picture: ${total ? state.currentIndex + 1 : 0}/${total}`;
  el.remainingCounter.textContent = `Images remaining: ${total}`;
  el.modeStatus.textContent = `Mode: ${state.galleryMode ? 'gallery' : 'single image'} / ${state.settings.sortMode}`;
  el.folderStatus.textContent = `Source: ${sourceName} | 1: ${good} | 2: ${rejected} | 3: ${bad}`;

  el.selectGoodBtn.textContent = `Set 1 / ${state.settings.labels.good} folder`;
  el.selectRejectedBtn.textContent = `Set 2 / ${state.settings.labels.rejected} folder`;
  el.selectBadBtn.textContent = `Set 3 / ${state.settings.labels.bad} folder`;
}

function updateTimer() {
  if (!state.lastActionAt) {
    el.timerStatus.textContent = 'No action yet';
  } else {
    const elapsed = Math.max(0, now() - state.lastActionAt);
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    el.timerStatus.textContent = `Time since last action: ${minutes} min ${seconds} sec`;
  }
}

function setCompatStatus() {
  const supported = 'showDirectoryPicker' in window && 'FileSystemDirectoryHandle' in window;
  if (supported) {
    el.compatWarning.classList.add('ok');
    el.compatText.textContent = 'Ready. Best supported in Chrome / Edge. Files stay on your device.';
  } else {
    el.compatWarning.classList.remove('ok');
    el.compatText.textContent = 'This browser does not support folder read/write access. Use current Chrome or Edge.';
    for (const btn of [el.selectSourceBtn, el.selectOutputRootBtn, el.selectGoodBtn, el.selectRejectedBtn, el.selectBadBtn, el.restoreHandlesBtn, el.emptySelectSource]) {
      btn.disabled = true;
    }
  }
}

async function selectSourceFolder() {
  try {
    state.sourceHandle = await chooseDirectory('sourceHandle', 'readwrite');
    await rescanSource();
    toast(`Loaded ${state.allImages.length} image(s) from ${state.sourceHandle.name}.`, 'good');
  } catch (err) {
    toast(`Source folder not selected: ${err.message}`, 'warn');
  }
}

async function selectOutputRoot() {
  try {
    state.outputRootHandle = await chooseDirectory('outputRootHandle', 'readwrite');
    state.outputHandles.good = await getOrCreateSubdir(state.outputRootHandle, OUTPUT_DEFAULTS.good);
    state.outputHandles.rejected = await getOrCreateSubdir(state.outputRootHandle, OUTPUT_DEFAULTS.rejected);
    state.outputHandles.bad = await getOrCreateSubdir(state.outputRootHandle, OUTPUT_DEFAULTS.bad);
    state.outputHandles.delete = await getOrCreateSubdir(state.outputRootHandle, OUTPUT_DEFAULTS.delete);
    await Promise.all([
      idbSet('goodHandle', state.outputHandles.good),
      idbSet('rejectedHandle', state.outputHandles.rejected),
      idbSet('badHandle', state.outputHandles.bad),
      idbSet('deleteHandle', state.outputHandles.delete)
    ]);
    toast(`Output root set: ${state.outputRootHandle.name}`, 'good');
    updateStatus();
  } catch (err) {
    toast(`Output root not selected: ${err.message}`, 'warn');
  }
}

async function selectOutputFolder(kind) {
  try {
    const handle = await chooseDirectory(`${kind}Handle`, 'readwrite');
    state.outputHandles[kind] = handle;
    toast(`${kind} folder set: ${handle.name}`, 'good');
    updateStatus();
  } catch (err) {
    toast(`Folder not selected: ${err.message}`, 'warn');
  }
}

async function restoreSavedHandles() {
  try {
    state.sourceHandle = await idbGet('sourceHandle');
    state.outputRootHandle = await idbGet('outputRootHandle');
    state.outputHandles.good = await idbGet('goodHandle');
    state.outputHandles.rejected = await idbGet('rejectedHandle');
    state.outputHandles.bad = await idbGet('badHandle');
    state.outputHandles.delete = await idbGet('deleteHandle');

    const handles = [
      state.sourceHandle,
      state.outputRootHandle,
      state.outputHandles.good,
      state.outputHandles.rejected,
      state.outputHandles.bad,
      state.outputHandles.delete
    ].filter(Boolean);

    for (const handle of handles) {
      await verifyPermission(handle, 'readwrite');
    }

    if (state.sourceHandle) await rescanSource(false);
    toast('Saved folder handles restored where the browser allowed it.', 'good');
    updateStatus();
  } catch (err) {
    toast(`Could not restore saved handles: ${err.message}`, 'warn');
  }
}

async function rescanSource(showToast = true) {
  if (!state.sourceHandle) {
    toast('No source folder selected.', 'warn');
    return;
  }
  const ok = await verifyPermission(state.sourceHandle, 'readwrite');
  if (!ok) throw new Error('Source folder permission denied.');
  state.allImages = await scanImagesFromFolder(state.sourceHandle);
  state.currentIndex = 0;
  state.selectedPaths.clear();
  filterImages();
  if (showToast) toast(`Rescanned ${state.allImages.length} image(s).`, 'good');
}

async function getTargetHandle(kind) {
  if (state.outputHandles[kind]) {
    await verifyPermission(state.outputHandles[kind], 'readwrite');
    return state.outputHandles[kind];
  }

  if (!state.outputRootHandle) {
    throw new Error(`No output folder is set for ${kind}.`);
  }

  await verifyPermission(state.outputRootHandle, 'readwrite');
  const subdirName = OUTPUT_DEFAULTS[kind] || kind;
  const handle = await getOrCreateSubdir(state.outputRootHandle, subdirName);
  state.outputHandles[kind] = handle;
  await idbSet(`${kind}Handle`, handle);
  return handle;
}

async function uniqueFileHandle(directoryHandle, filename) {
  const clean = safeName(filename);
  const dot = clean.lastIndexOf('.');
  const base = dot >= 0 ? clean.slice(0, dot) : clean;
  const ext = dot >= 0 ? clean.slice(dot) : '';

  let candidate = clean;
  let counter = 1;
  while (true) {
    try {
      await directoryHandle.getFileHandle(candidate, { create: false });
      candidate = `${base}_${counter}${ext}`;
      counter += 1;
    } catch (err) {
      if (err.name === 'NotFoundError') {
        return {
          name: candidate,
          handle: await directoryHandle.getFileHandle(candidate, { create: true })
        };
      }
      throw err;
    }
  }
}

async function writeFileToDirectory(sourceFile, targetDirectory, targetName) {
  const { name, handle } = await uniqueFileHandle(targetDirectory, targetName || sourceFile.name);
  const writable = await handle.createWritable();
  await writable.write(sourceFile);
  await writable.close();
  return { name, handle };
}

function imagesToSort() {
  if (state.galleryMode && state.selectedPaths.size) {
    const selected = state.filteredImages.filter((img) => state.selectedPaths.has(img.path));
    if (selected.length) return selected;
  }
  const image = currentImage();
  return image ? [image] : [];
}

function removeImagesFromLists(images) {
  const paths = new Set(images.map((img) => img.path));
  state.allImages = state.allImages.filter((img) => !paths.has(img.path));
  state.filteredImages = state.filteredImages.filter((img) => !paths.has(img.path));
  for (const path of paths) state.selectedPaths.delete(path);
  state.currentIndex = Math.min(state.currentIndex, Math.max(0, state.filteredImages.length - 1));
}

async function sortTo(kind, options = {}) {
  const selected = imagesToSort();
  if (!selected.length) {
    toast('No image selected.', 'warn');
    return;
  }

  const targetDirectory = await getTargetHandle(kind);
  const mode = state.settings.sortMode;
  const actions = [];

  try {
    for (const image of selected) {
      const file = await image.handle.getFile();
      const targetName = options.prefix ? `${options.prefix}${image.name}` : image.name;
      const written = await writeFileToDirectory(file, targetDirectory, targetName);
      actions.push({
        sourceName: image.name,
        sourcePath: image.path,
        sourceParentHandle: image.parentHandle,
        sourceHandle: image.handle,
        targetName: written.name,
        targetHandle: written.handle,
        targetDirectory,
        kind,
        mode,
        fileSnapshot: mode === 'move' ? file : null
      });

      if (mode === 'move') {
        await image.parentHandle.removeEntry(image.name);
      }
    }

    removeImagesFromLists(selected);
    state.lastAction = { type: 'sort', actions };
    state.lastActionAt = now();
    logSortKey(kind === 'good' ? '1' : kind === 'rejected' ? '2' : '3');
    if (state.galleryMode) renderGallery();
    await renderCurrentImage();
    updateStatus();
    toast(`${mode === 'move' ? 'Moved' : 'Copied'} ${selected.length} image(s) to ${kind}.`, 'good');
  } catch (err) {
    toast(`Sort failed: ${err.message}`, 'bad');
    console.error(err);
  }
}

async function undoLastAction() {
  const action = state.lastAction;
  if (!action || action.type !== 'sort') {
    toast('Nothing to undo.', 'warn');
    return;
  }

  try {
    for (const item of [...action.actions].reverse()) {
      await verifyPermission(item.targetDirectory, 'readwrite');
      await item.targetDirectory.removeEntry(item.targetName).catch((err) => {
        if (err.name !== 'NotFoundError') throw err;
      });

      if (item.mode === 'move') {
        await verifyPermission(item.sourceParentHandle, 'readwrite');
        const restored = await writeFileToDirectory(item.fileSnapshot, item.sourceParentHandle, item.sourceName);
        item.sourceHandle = restored.handle;
      }
    }

    state.lastAction = null;
    await rescanSource(false);
    state.lastActionAt = now();
    toast('Last action undone.', 'good');
  } catch (err) {
    toast(`Undo failed: ${err.message}`, 'bad');
    console.error(err);
  }
}

function nextImage() {
  if (!state.filteredImages.length) return;
  state.currentIndex = (state.currentIndex + 1) % state.filteredImages.length;
  if (state.galleryMode) renderGallery(false);
  renderCurrentImage();
}

function prevImage() {
  if (!state.filteredImages.length) return;
  state.currentIndex = (state.currentIndex - 1 + state.filteredImages.length) % state.filteredImages.length;
  if (state.galleryMode) renderGallery(false);
  renderCurrentImage();
}

function skipImage() {
  nextImage();
}

function toggleFilename() {
  state.showFilename = !state.showFilename;
  updateStatus();
}

function toggleGallery() {
  state.galleryMode = !state.galleryMode;
  el.galleryViewer.classList.toggle('hidden', !state.galleryMode);
  el.singleViewer.classList.toggle('hidden', state.galleryMode);
  if (state.galleryMode) renderGallery();
  updateStatus();
}

function renderGallery(scrollCurrent = true) {
  el.galleryViewer.style.setProperty('--thumb-size', `${state.thumbSize}px`);
  const frag = document.createDocumentFragment();
  const current = currentImage();

  state.filteredImages.forEach((image, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb';
    if (state.selectedPaths.has(image.path)) wrapper.classList.add('selected');
    if (current && current.path === image.path) wrapper.classList.add('current');
    wrapper.dataset.path = image.path;
    wrapper.dataset.index = String(index);

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = image.name;
    image.handle.getFile().then((file) => {
      const url = URL.createObjectURL(file);
      img.src = url;
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    }).catch(() => {
      img.alt = `Could not load ${image.name}`;
    });

    const label = document.createElement('span');
    label.title = image.name;
    label.textContent = image.name;

    wrapper.appendChild(img);
    wrapper.appendChild(label);
    wrapper.addEventListener('click', (event) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (state.selectedPaths.has(image.path)) state.selectedPaths.delete(image.path);
        else state.selectedPaths.add(image.path);
      } else {
        state.currentIndex = index;
        state.selectedPaths.clear();
      }
      renderGallery(false);
      renderCurrentImage();
    });
    frag.appendChild(wrapper);
  });

  el.galleryViewer.replaceChildren(frag);

  if (scrollCurrent && current) {
    const node = el.galleryViewer.querySelector(`[data-path="${CSS.escape(current.path)}"]`);
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function zoomGallery(delta) {
  if (!state.galleryMode) return;
  state.thumbSize = Math.max(70, Math.min(360, state.thumbSize + delta));
  renderGallery(false);
}

function resetImageTransform() {
  state.imageZoom = 1;
  state.imageOffset = { x: 0, y: 0 };
  applyImageTransform();
}

function applyImageTransform() {
  el.mainImage.style.transform = `translate(${state.imageOffset.x}px, ${state.imageOffset.y}px) scale(${state.imageZoom})`;
}

function zoomSingleImage(event) {
  if (state.galleryMode) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const factor = direction > 0 ? 1.12 : 0.89;
  state.imageZoom = Math.max(0.2, Math.min(12, state.imageZoom * factor));
  applyImageTransform();
}

function startPan(event) {
  if (state.galleryMode || event.button !== 0) return;
  state.isPanning = true;
  state.panStart = {
    x: event.clientX - state.imageOffset.x,
    y: event.clientY - state.imageOffset.y
  };
  el.singleViewer.setPointerCapture(event.pointerId);
}

function movePan(event) {
  if (!state.isPanning) return;
  state.imageOffset = {
    x: event.clientX - state.panStart.x,
    y: event.clientY - state.panStart.y
  };
  applyImageTransform();
}

function endPan() {
  state.isPanning = false;
}

function toggleUi() {
  document.body.classList.toggle('ui-hidden');
  el.showUiBtn.classList.toggle('hidden', !document.body.classList.contains('ui-hidden'));
}

async function clearSessionData() {
  const ok = confirm('Clear saved folder handles, labels, counters, and local settings? This does not delete image files.');
  if (!ok) return;
  revokeObjectUrl();
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(KEY_LOG_KEY);
  await idbClear().catch(console.warn);
  state.sourceHandle = null;
  state.outputRootHandle = null;
  state.outputHandles = { good: null, rejected: null, bad: null, delete: null };
  state.allImages = [];
  state.filteredImages = [];
  state.currentIndex = 0;
  state.selectedPaths.clear();
  state.lastAction = null;
  state.lastActionAt = null;
  state.keyLog = [];
  applySettingsToUi();
  filterImages();
  updateStats();
  toast('Local app data cleared.', 'good');
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function bindEvents() {
  el.selectSourceBtn.addEventListener('click', selectSourceFolder);
  el.emptySelectSource.addEventListener('click', selectSourceFolder);
  el.selectOutputRootBtn.addEventListener('click', selectOutputRoot);
  el.selectGoodBtn.addEventListener('click', () => selectOutputFolder('good'));
  el.selectRejectedBtn.addEventListener('click', () => selectOutputFolder('rejected'));
  el.selectBadBtn.addEventListener('click', () => selectOutputFolder('bad'));
  el.restoreHandlesBtn.addEventListener('click', restoreSavedHandles);
  el.saveSettingsBtn.addEventListener('click', saveSettingsFromUi);
  el.searchInput.addEventListener('input', filterImages);
  el.caseSensitive.addEventListener('change', () => { saveSettingsFromUi(); filterImages(); });
  for (const input of document.querySelectorAll('input[name="sortMode"]')) {
    input.addEventListener('change', () => { state.settings.sortMode = input.value; saveSettingsFromUi(); });
  }
  for (const input of [el.labelGood, el.labelRejected, el.labelBad]) {
    input.addEventListener('change', saveSettingsFromUi);
  }
  el.galleryBtn.addEventListener('click', toggleGallery);
  el.prevBtn.addEventListener('click', prevImage);
  el.nextBtn.addEventListener('click', nextImage);
  el.undoBtn.addEventListener('click', undoLastAction);
  el.rescanBtn.addEventListener('click', () => rescanSource(true));
  el.clearSessionBtn.addEventListener('click', clearSessionData);
  el.hideUiBtn.addEventListener('click', toggleUi);
  el.showUiBtn.addEventListener('click', toggleUi);

  el.singleViewer.addEventListener('wheel', zoomSingleImage, { passive: false });
  el.singleViewer.addEventListener('pointerdown', startPan);
  el.singleViewer.addEventListener('pointermove', movePan);
  el.singleViewer.addEventListener('pointerup', endPan);
  el.singleViewer.addEventListener('pointercancel', endPan);
  el.mainImage.addEventListener('dblclick', resetImageTransform);

  window.addEventListener('keydown', async (event) => {
    if (isTypingTarget(event.target)) return;

    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      await undoLastAction();
      return;
    }

    switch (event.key) {
      case '1':
        event.preventDefault();
        await sortTo('good');
        break;
      case '2':
        event.preventDefault();
        await sortTo('rejected');
        break;
      case '3':
        event.preventDefault();
        await sortTo('bad');
        break;
      case '`':
        event.preventDefault();
        await sortTo('delete', { prefix: 'DELETE_' });
        break;
      case 'a':
      case 'A':
      case 'ArrowLeft':
        event.preventDefault();
        prevImage();
        break;
      case 'd':
      case 'D':
      case 'ArrowRight':
        event.preventDefault();
        nextImage();
        break;
      case ' ':
        event.preventDefault();
        skipImage();
        break;
      case 'g':
      case 'G':
        event.preventDefault();
        toggleGallery();
        break;
      case 'n':
      case 'N':
        event.preventDefault();
        toggleFilename();
        break;
      case 'h':
      case 'H':
        event.preventDefault();
        toggleUi();
        break;
      case '+':
      case '=':
        zoomGallery(20);
        break;
      case '-':
      case '_':
        zoomGallery(-20);
        break;
      default:
        break;
    }
  });
}

async function init() {
  setCompatStatus();
  applySettingsToUi();
  loadKeyLog();
  updateStats();
  bindEvents();
  filterImages();
  updateStatus();
  window.setInterval(() => {
    updateTimer();
    updateStats();
  }, 1000);

  if ('showDirectoryPicker' in window) {
    // Quietly try to load prior handles without prompting. User can press Restore to request permissions.
    state.sourceHandle = await idbGet('sourceHandle').catch(() => null);
    state.outputRootHandle = await idbGet('outputRootHandle').catch(() => null);
    state.outputHandles.good = await idbGet('goodHandle').catch(() => null);
    state.outputHandles.rejected = await idbGet('rejectedHandle').catch(() => null);
    state.outputHandles.bad = await idbGet('badHandle').catch(() => null);
    state.outputHandles.delete = await idbGet('deleteHandle').catch(() => null);
    updateStatus();
    if (state.sourceHandle) toast('Saved folders found. Press “Restore saved folder permissions” to reuse them.', 'warn');
  }
}

init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, 'bad');
});
