/*
  Skull Image Sorter Web
  Static, local-only browser image sorter using the File System Access API.
  Nothing is uploaded. All image reads/writes happen through browser-granted local folder handles.
*/

'use strict';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const OUTPUT_DEFAULTS = {
  good: '1_good',
  rejected: '2_flawed',
  bad: '3_bad',
  delete: 'DELETE'
};
const SETTINGS_KEY = 'skullImageSorter.settings.v1';
const KEY_LOG_KEY = 'skullImageSorter.keyLog.v1';
const LAST_ACTION_IDB_KEY = 'lastSortAction';
const DB_NAME = 'skullImageSorter.handles.v1';
const DB_STORE = 'handles';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const DIMENSION_SCAN_CONCURRENCY = Math.max(2, Math.min(8, navigator.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 4));
const APP_VERSION = 'v2.13';
const VERSION_LOG = [
  {
    version: 'v2.13',
    date: '2026-07-02',
    title: 'Fixed sort key advance delay from undo storage',
    notes: [
      'Sorting no longer tries to save a full copy of moved high-res images into browser storage before advancing.',
      'After pressing a sorting key, the next image should show right away again.',
      'Undo for moved files now restores from the sorted output file instead of relying on a huge stored image snapshot.'
    ]
  },
  {
    version: 'v2.12',
    date: '2026-07-02',
    title: 'Sorting now advances the displayed image reliably',
    notes: [
      'After pressing 1, 2, 3, or delete, the sorter should immediately show the next image again.',
      'Image loading now ignores stale load/error events from the previous picture so the display does not get stuck after a sort.',
      'The viewer clears the old picture before loading the next one, making the screen state easier to trust.'
    ]
  },
  {
    version: 'v2.11',
    date: '2026-07-02',
    title: 'Safer undo and duplicate-file protection',
    notes: [
      'Ctrl+Z now remembers the last sort action even if the browser crashes or the page reloads.',
      'Manual rescan tries to stay on the same filename instead of jumping back to the first image.',
      'If an image cannot be displayed, the app now shows a clearer failed-image message instead of leaving a silent black screen.',
      'Sorting already avoided overwriting duplicate filenames; this update keeps that safety path and uses numbered names like image_1.png when needed.'
    ]
  },
  {
    version: 'v2.1',
    date: '2026-06-27',
    title: 'Large folder loading and file reliability',
    notes: [
      'Big folders should open faster because the app no longer fully checks every high-res picture up front.',
      'Sorting by ratio still works, but ratio checks now run only when you choose ratio sorting.',
      'Gallery mode is lighter because thumbnails load as you scroll instead of loading the whole folder at once.',
      'If the browser says a picture vanished even though it is still there, the app now retries by finding that file again from the selected folder.'
    ]
  }
];

const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  viewerPanel: $('viewerPanel'),
  dropZone: $('dropZone'),
  emptySelectSource: $('emptySelectSource'),
  singleViewer: $('singleViewer'),
  imageStage: $('imageStage'),
  imageError: $('imageError'),
  galleryViewer: $('galleryViewer'),
  galleryGrid: $('galleryGrid'),
  gallerySearchInput: $('gallerySearchInput'),
  gallerySearchMode: $('gallerySearchMode'),
  mainImage: $('mainImage'),
  pngInfoBox: $('pngInfoBox'),
  sidebar: $('sidebar'),
  appTitle: $('appTitle'),
  hideUiBtn: $('hideUiBtn'),
  showUiBtn: $('showUiBtn'),
  versionLogBtn: $('versionLogBtn'),
  versionLogOverlay: $('versionLogOverlay'),
  closeVersionLogBtn: $('closeVersionLogBtn'),
  versionLogContent: $('versionLogContent'),
  compatWarning: $('compatWarning'),
  compatText: $('compatText'),
  selectSourceBtn: $('selectSourceBtn'),
  selectOutputRootBtn: $('selectOutputRootBtn'),
  selectGoodBtn: $('selectGoodBtn'),
  selectRejectedBtn: $('selectRejectedBtn'),
  selectBadBtn: $('selectBadBtn'),
  restoreHandlesBtn: $('restoreHandlesBtn'),
  loadOrder: $('loadOrder'),
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
  pngInfoBtn: $('pngInfoBtn'),
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
  imageRenderToken: 0,
  showFilename: true,
  galleryMode: false,
  pngInfoEnabled: false,
  pngInfoCache: new Map(),
  pngRawInfoCache: new Map(),
  pngInfoLoading: new Set(),
  failedImagePath: null,
  gallerySearchQuery: '',
  gallerySearchMode: 'tag',
  galleryRenderToken: 0,
  galleryThumbObserver: null,
  thumbSize: 150,
  imageZoom: 1,
  imageOffset: { x: 0, y: 0 },
  isPanning: false,
  panStart: { x: 0, y: 0 },
  lastActionAt: null,
  lastAction: null,
  settings: {
    sortMode: 'copy',
    loadOrder: 'name',
    labels: {
      good: 'Good',
      rejected: 'Flawed',
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

function renderVersionLog() {
  const frag = document.createDocumentFragment();
  for (const entry of VERSION_LOG) {
    const section = document.createElement('section');
    section.className = 'version-log-entry';

    const heading = document.createElement('h3');
    heading.textContent = `${entry.version} - ${entry.title}`;
    section.appendChild(heading);

    const date = document.createElement('p');
    date.className = 'tiny muted';
    date.textContent = entry.date;
    section.appendChild(date);

    const list = document.createElement('ul');
    for (const note of entry.notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.appendChild(item);
    }
    section.appendChild(list);
    frag.appendChild(section);
  }
  el.versionLogContent.replaceChildren(frag);
}

function openVersionLog() {
  renderVersionLog();
  el.versionLogOverlay.classList.remove('hidden');
}

function closeVersionLog() {
  el.versionLogOverlay.classList.add('hidden');
}

function isVersionLogOpen() {
  return !el.versionLogOverlay.classList.contains('hidden');
}

function rememberLastAction(action) {
  state.lastAction = action;
  state.lastActionAt = now();
  idbSet(LAST_ACTION_IDB_KEY, action).catch((err) => {
    console.warn('Could not save undo action:', err);
  });
}

async function clearLastAction() {
  state.lastAction = null;
  try {
    await idbDelete(LAST_ACTION_IDB_KEY);
  } catch (err) {
    console.warn('Could not clear undo action:', err);
  }
}

async function restoreLastAction() {
  try {
    const action = await idbGet(LAST_ACTION_IDB_KEY);
    if (action?.type === 'sort' && Array.isArray(action.actions) && action.actions.length) {
      state.lastAction = action;
      state.lastActionAt = action.savedAt || now();
      toast('Undo data found. Ctrl+Z can undo the last sort if folder permissions are restored.', 'warn');
    }
  } catch (err) {
    console.warn('Could not restore undo action:', err);
  }
}

function getExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isImageName(name) {
  return IMAGE_EXTENSIONS.has(getExtension(name));
}

async function readImageDimensions(file) {
  if (!('createImageBitmap' in window)) return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return { width: 0, height: 0 };
  }
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

function decodeLatin1(bytes) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function bytesMatch(bytes, expected) {
  return expected.every((value, index) => bytes[index] === value);
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

async function inflateZlibBytes(bytes) {
  if (!('DecompressionStream' in window)) return '[compressed text: browser cannot decompress zlib data]';
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return decodeUtf8(new Uint8Array(buffer));
}

async function extractPngInfoFromFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.png')) {
    return 'PNG info is only available for PNG files.';
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < PNG_SIGNATURE.length || !bytesMatch(bytes, PNG_SIGNATURE)) {
    return 'This file has a .png name but does not contain a valid PNG signature.';
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = decodeLatin1(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    const data = bytes.slice(dataStart, dataEnd);
    if (type === 'tEXt') {
      const sep = data.indexOf(0);
      const key = sep >= 0 ? decodeLatin1(data.slice(0, sep)) : 'Text';
      const value = sep >= 0 ? decodeLatin1(data.slice(sep + 1)) : decodeLatin1(data);
      chunks.push(`${key}: ${value}`);
    } else if (type === 'zTXt') {
      const sep = data.indexOf(0);
      if (sep >= 0 && data[sep + 1] === 0) {
        const key = decodeLatin1(data.slice(0, sep));
        const value = await inflateZlibBytes(data.slice(sep + 2));
        chunks.push(`${key}: ${value}`);
      }
    } else if (type === 'iTXt') {
      const keyEnd = data.indexOf(0);
      if (keyEnd >= 0) {
        const key = decodeLatin1(data.slice(0, keyEnd));
        const compressionFlag = data[keyEnd + 1];
        let cursor = keyEnd + 3;
        const languageEnd = data.indexOf(0, cursor);
        cursor = languageEnd >= 0 ? languageEnd + 1 : cursor;
        const translatedEnd = data.indexOf(0, cursor);
        cursor = translatedEnd >= 0 ? translatedEnd + 1 : cursor;
        const textBytes = data.slice(cursor);
        const value = compressionFlag === 1 ? await inflateZlibBytes(textBytes) : decodeUtf8(textBytes);
        chunks.push(`${key}: ${value}`);
      }
    }

    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  return chunks.length ? chunks.join('\n\n') : 'No textual PNG metadata was found.';
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

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

async function refreshImageHandle(image, mode = 'read') {
  if (!image?.parentHandle || !image?.name) return image?.handle || null;
  const ok = await verifyPermission(image.parentHandle, mode);
  if (!ok) throw new Error(`Folder permission was not granted for ${image.name}.`);
  image.handle = await image.parentHandle.getFileHandle(image.name, { create: false });
  return image.handle;
}

async function getImageFile(image) {
  if (!image?.handle) throw new Error(`Missing file handle for ${image?.name || 'image'}.`);
  try {
    return await image.handle.getFile();
  } catch (err) {
    if (!['NotFoundError', 'NotReadableError'].includes(err.name)) throw err;
    const handle = await refreshImageHandle(image);
    return handle.getFile();
  }
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
        type: file.type || 'image/unknown',
        width: 0,
        height: 0,
        ratio: 0
      });
    } catch (err) {
      console.warn('Skipping unreadable image:', name, err);
    }
  }
  if (state.settings.loadOrder === 'ratio') await hydrateImageRatios(images);
  sortImages(images);
  return images;
}

async function hydrateImageRatios(images) {
  let cursor = 0;

  async function worker() {
    while (cursor < images.length) {
      const image = images[cursor];
      cursor += 1;
      if (image.ratio) continue;
      try {
        const file = await getImageFile(image);
        const dimensions = await readImageDimensions(file);
        image.width = dimensions.width;
        image.height = dimensions.height;
        image.ratio = dimensions.width && dimensions.height ? dimensions.width / dimensions.height : 0;
      } catch (err) {
        console.warn('Could not read image dimensions:', image.name, err);
      }
    }
  }

  const workerCount = Math.min(DIMENSION_SCAN_CONCURRENCY, images.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}

function sortImages(images) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  switch (state.settings.loadOrder) {
    case 'date':
      images.sort((a, b) => a.lastModified - b.lastModified || byName(a, b));
      break;
    case 'size':
      images.sort((a, b) => a.size - b.size || byName(a, b));
      break;
    case 'ratio':
      images.sort((a, b) => a.ratio - b.ratio || byName(a, b));
      break;
    case 'name':
    default:
      images.sort(byName);
      break;
  }
}

function applySettingsToUi() {
  const settings = loadJson(SETTINGS_KEY, state.settings);
  state.settings = {
    ...state.settings,
    ...settings,
    labels: { ...state.settings.labels, ...(settings.labels || {}) }
  };
  if (state.settings.labels.rejected === 'Rejected') state.settings.labels.rejected = 'Flawed';
  state.settings.loadOrder = state.settings.loadOrder || 'name';
  el.labelGood.value = state.settings.labels.good;
  el.labelRejected.value = state.settings.labels.rejected;
  el.labelBad.value = state.settings.labels.bad;
  el.loadOrder.value = state.settings.loadOrder || 'name';
  el.caseSensitive.checked = !!state.settings.caseSensitive;
  const modeInput = document.querySelector(`input[name="sortMode"][value="${state.settings.sortMode}"]`);
  if (modeInput) modeInput.checked = true;
}

function saveSettingsFromUi() {
  state.settings.labels.good = safeName(el.labelGood.value || 'Good');
  state.settings.labels.rejected = safeName(el.labelRejected.value || 'Flawed');
  state.settings.labels.bad = safeName(el.labelBad.value || 'Bad');
  state.settings.caseSensitive = el.caseSensitive.checked;
  state.settings.loadOrder = el.loadOrder.value;
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

async function getPngInfo(image) {
  if (!image) return 'No image selected.';
  if (state.pngInfoCache.has(image.path)) return state.pngInfoCache.get(image.path);
  if (state.pngInfoLoading.has(image.path)) return 'Loading PNG info...';

  state.pngInfoLoading.add(image.path);
  try {
    const file = await getImageFile(image);
    const rawInfo = await extractPngInfoFromFile(file);
    state.pngRawInfoCache.set(image.path, rawInfo);
    const info = window.PngInfoFormatter
      ? window.PngInfoFormatter.formatPngInfo(rawInfo, window.RPE_PRESETS || {})
      : rawInfo;
    state.pngInfoCache.set(image.path, info);
    return info;
  } catch (err) {
    const message = `Could not read PNG info: ${err.message}`;
    state.pngInfoCache.set(image.path, message);
    return message;
  } finally {
    state.pngInfoLoading.delete(image.path);
  }
}

function shouldShowPngInfo() {
  return state.pngInfoEnabled && !state.galleryMode;
}

async function updatePngInfoBox() {
  el.pngInfoBtn.classList.toggle('active', state.pngInfoEnabled);
  el.pngInfoBox.classList.toggle('hidden', !shouldShowPngInfo());
  if (!shouldShowPngInfo()) return;

  const image = currentImage();
  el.pngInfoBox.value = 'Loading PNG info...';
  const info = await getPngInfo(image);
  if (image === currentImage() && shouldShowPngInfo()) {
    el.pngInfoBox.value = info;
    updatePngInfoLayout();
  }
}

function updatePngInfoLayout() {
  if (!shouldShowPngInfo()) {
    el.singleViewer.classList.remove('png-info-dominant');
    fitImageToStage();
    return;
  }
  const viewerHeight = Math.max(1, el.singleViewer.clientHeight);
  const boxHeight = el.pngInfoBox.offsetHeight;
  el.singleViewer.classList.toggle('png-info-dominant', boxHeight / viewerHeight >= 0.58);
  fitImageToStage();
}

async function togglePngInfo() {
  state.pngInfoEnabled = !state.pngInfoEnabled;
  await updatePngInfoBox();
}

function fitImageToStage() {
  if (!el.mainImage.naturalWidth || !el.mainImage.naturalHeight) return;

  const stageWidth = el.imageStage.clientWidth;
  const stageHeight = el.imageStage.clientHeight;
  if (!stageWidth || !stageHeight) return;

  const imageRatio = el.mainImage.naturalWidth / el.mainImage.naturalHeight;
  const stageRatio = stageWidth / stageHeight;

  if (imageRatio >= stageRatio) {
    el.mainImage.style.width = `${stageWidth}px`;
    el.mainImage.style.height = 'auto';
  } else {
    el.mainImage.style.width = 'auto';
    el.mainImage.style.height = `${stageHeight}px`;
  }

  applyImageTransform();
}

function revokeObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

function showImageError(image, message) {
  state.failedImagePath = image?.path || null;
  revokeObjectUrl();
  el.mainImage.removeAttribute('src');
  el.mainImage.alt = image?.name || 'Image failed to load';
  el.imageError.textContent = `${image?.name || 'This image'} could not be displayed.\n${message}`;
  el.imageError.classList.remove('hidden');
}

function hideImageError() {
  state.failedImagePath = null;
  el.imageError.textContent = '';
  el.imageError.classList.add('hidden');
}

function handleCurrentImageDecodeError() {
  const image = currentImage();
  if (!image || state.failedImagePath === image.path || el.mainImage.dataset.path !== image.path) return;
  showImageError(image, 'The browser could read the file, but could not decode it as a displayable image. Try opening it outside the sorter to confirm the file is valid.');
  toast(`Could not display ${image.name}.`, 'bad');
  updateStatus();
}

async function renderCurrentImage() {
  const renderToken = ++state.imageRenderToken;
  const image = currentImage();
  if (!image) {
    revokeObjectUrl();
    el.mainImage.removeAttribute('src');
    delete el.mainImage.dataset.path;
    hideImageError();
    el.dropZone.classList.remove('hidden');
    await updatePngInfoBox();
    updateStatus();
    return;
  }

  el.dropZone.classList.add('hidden');
  try {
    const file = await getImageFile(image);
    if (renderToken !== state.imageRenderToken || image !== currentImage()) return;
    revokeObjectUrl();
    hideImageError();
    el.mainImage.removeAttribute('src');
    el.mainImage.dataset.path = image.path;
    state.objectUrl = URL.createObjectURL(file);
    el.mainImage.src = state.objectUrl;
    el.mainImage.alt = image.name;
    if (el.mainImage.decode) {
      await el.mainImage.decode().catch(() => null);
    }
    if (renderToken === state.imageRenderToken && image === currentImage() && el.mainImage.complete) resetImageTransform();
  } catch (err) {
    if (renderToken !== state.imageRenderToken || image !== currentImage()) return;
    showImageError(image, err.message);
    toast(`Could not load ${image.name}: ${err.message}`, 'bad');
  }
  if (renderToken !== state.imageRenderToken || image !== currentImage()) return;
  await updatePngInfoBox();
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
  el.modeStatus.textContent = `Mode: ${state.galleryMode ? 'gallery' : 'single image'} / ${state.settings.sortMode} / ${state.settings.loadOrder}`;
  el.folderStatus.textContent = `Source: ${sourceName} | 1: ${good} | 2: ${rejected} | 3: ${bad}`;

  el.selectGoodBtn.textContent = `Set Folder #1 / ${state.settings.labels.good}`;
  el.selectRejectedBtn.textContent = `Set Folder #2 / ${state.settings.labels.rejected}`;
  el.selectBadBtn.textContent = `Set Folder #3 / ${state.settings.labels.bad}`;
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
    await rescanSource(true, false);
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

async function rescanSource(showToast = true, preserveCurrent = true) {
  if (!state.sourceHandle) {
    toast('No source folder selected.', 'warn');
    return;
  }
  const currentPath = preserveCurrent ? currentImage()?.path : null;
  const ok = await verifyPermission(state.sourceHandle, 'readwrite');
  if (!ok) throw new Error('Source folder permission denied.');
  state.allImages = await scanImagesFromFolder(state.sourceHandle);
  state.pngInfoCache.clear();
  state.pngRawInfoCache.clear();
  state.pngInfoLoading.clear();
  state.selectedPaths.clear();
  filterImages();
  let restoredIndex = -1;
  if (currentPath) {
    restoredIndex = state.filteredImages.findIndex((image) => image.path === currentPath);
  }
  if (restoredIndex >= 0) {
    state.currentIndex = restoredIndex;
    await renderCurrentImage();
    updateStatus();
  } else if (!currentPath) {
    state.currentIndex = 0;
    await renderCurrentImage();
    updateStatus();
  }
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

async function getActionTargetFile(item) {
  try {
    return await item.targetHandle.getFile();
  } catch (err) {
    if (!['NotFoundError', 'NotReadableError'].includes(err.name)) throw err;
    const handle = await item.targetDirectory.getFileHandle(item.targetName, { create: false });
    item.targetHandle = handle;
    return handle.getFile();
  }
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
      const file = await getImageFile(image);
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
        mode
      });

      if (mode === 'move') {
        await image.parentHandle.removeEntry(image.name);
      }
    }

    removeImagesFromLists(selected);
    rememberLastAction({ type: 'sort', savedAt: now(), actions });
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
  const action = state.lastAction || await idbGet(LAST_ACTION_IDB_KEY).catch(() => null);
  if (!action || action.type !== 'sort') {
    toast('Nothing to undo.', 'warn');
    return;
  }

  try {
    for (const item of [...action.actions].reverse()) {
      const targetOk = await verifyPermission(item.targetDirectory, 'readwrite');
      if (!targetOk) throw new Error(`Permission denied for output folder while undoing ${item.targetName}.`);

      if (item.mode === 'move') {
        const sourceOk = await verifyPermission(item.sourceParentHandle, 'readwrite');
        if (!sourceOk) throw new Error(`Permission denied for source folder while restoring ${item.sourceName}.`);
        const targetFile = await getActionTargetFile(item);
        const restored = await writeFileToDirectory(targetFile, item.sourceParentHandle, item.sourceName);
        item.sourceHandle = restored.handle;
      }

      await item.targetDirectory.removeEntry(item.targetName).catch((err) => {
        if (err.name !== 'NotFoundError') throw err;
      });
    }

    await clearLastAction();
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
  el.gallerySearchInput.value = state.gallerySearchQuery;
  el.gallerySearchMode.value = state.gallerySearchMode;
  if (state.galleryMode) renderGallery();
  updatePngInfoBox();
  updateStatus();
}

function galleryMatchesSearch(image) {
  const query = state.gallerySearchQuery.trim();
  if (!query) return true;

  const terms = query.split('/').map((part) => part.trim()).filter(Boolean);
  if (!terms.length) return true;

  if (state.gallerySearchMode === 'filename') {
    const hay = image.name.toLowerCase();
    return terms.every((term) => hay.includes(term.toLowerCase()));
  }

  const cached = state.pngInfoCache.get(image.path);
  if (!cached) return false;
  const hay = cached.toLowerCase();
  return terms.every((term) => hay.includes(term.toLowerCase()));
}

function galleryImages() {
  return state.filteredImages.filter(galleryMatchesSearch);
}

async function warmGalleryTagSearch(token) {
  if (state.gallerySearchMode !== 'tag' || !state.gallerySearchQuery.trim()) return;

  const pngImages = state.filteredImages.filter((image) => image.name.toLowerCase().endsWith('.png'));
  await Promise.all(pngImages.map((image) => getPngInfo(image)));
  if (state.galleryMode && token === state.galleryRenderToken) renderGallery(false, true);
}

function renderGallery(scrollCurrent = true, skipWarm = false) {
  const token = ++state.galleryRenderToken;
  if (state.galleryThumbObserver) state.galleryThumbObserver.disconnect();
  state.galleryThumbObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        state.galleryThumbObserver.unobserve(entry.target);
        loadGalleryThumb(entry.target);
      }
    }, { root: el.galleryViewer, rootMargin: '600px' })
    : null;
  el.galleryGrid.style.setProperty('--thumb-size', `${state.thumbSize}px`);
  const frag = document.createDocumentFragment();
  const current = currentImage();
  const images = galleryImages();

  images.forEach((image) => {
    const index = state.filteredImages.indexOf(image);
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb';
    if (state.selectedPaths.has(image.path)) wrapper.classList.add('selected');
    if (current && current.path === image.path) wrapper.classList.add('current');
    wrapper.dataset.path = image.path;
    wrapper.dataset.index = String(index);

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = image.name;
    img.dataset.index = String(index);
    img.dataset.path = image.path;

    const label = document.createElement('span');
    label.title = image.name;
    label.textContent = image.name;

    wrapper.appendChild(img);
    wrapper.appendChild(label);
    wrapper.addEventListener('click', (event) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (state.selectedPaths.has(image.path)) state.selectedPaths.delete(image.path);
        else state.selectedPaths.add(image.path);
        renderGallery(false);
      } else {
        state.currentIndex = index;
        state.selectedPaths.clear();
        if (state.galleryMode) toggleGallery();
        renderCurrentImage();
      }
    });
    frag.appendChild(wrapper);
  });

  if (!images.length) {
    const empty = document.createElement('div');
    empty.className = 'gallery-empty';
    empty.textContent = state.gallerySearchQuery.trim() ? 'No gallery results.' : 'No images to show.';
    frag.appendChild(empty);
  }

  el.galleryGrid.replaceChildren(frag);
  const thumbs = el.galleryGrid.querySelectorAll('img[data-index]');
  for (const thumb of thumbs) {
    if (state.galleryThumbObserver) state.galleryThumbObserver.observe(thumb);
    else loadGalleryThumb(thumb);
  }

  if (scrollCurrent && current) {
    const node = el.galleryGrid.querySelector(`[data-path="${CSS.escape(current.path)}"]`);
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  if (!skipWarm) warmGalleryTagSearch(token);
}

function loadGalleryThumb(img) {
  const index = Number(img.dataset.index);
  const image = state.filteredImages[index]?.path === img.dataset.path
    ? state.filteredImages[index]
    : state.filteredImages.find((candidate) => candidate.path === img.dataset.path);
  if (!image || img.dataset.loaded === 'true') return;
  img.dataset.loaded = 'true';
  getImageFile(image).then((file) => {
    const url = URL.createObjectURL(file);
    img.src = url;
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
  }).catch((err) => {
    img.alt = `Could not load ${image.name}`;
    console.warn('Could not load gallery thumbnail:', image.name, err);
  });
}

function zoomGallery(delta) {
  if (!state.galleryMode) return;
  state.thumbSize = Math.max(70, Math.min(360, state.thumbSize + delta));
  renderGallery(false);
}

function resetImageTransform() {
  state.imageZoom = 1;
  state.imageOffset = { x: 0, y: 0 };
  fitImageToStage();
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
  if (event.target === el.pngInfoBox || event.target.closest?.('#pngInfoBox')) return;
  if (!event.target.closest?.('#imageStage') && event.target !== el.mainImage) return;
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
  requestAnimationFrame(() => {
    resetImageTransform();
    updatePngInfoLayout();
  });
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
  el.loadOrder.addEventListener('change', async () => {
    state.settings.loadOrder = el.loadOrder.value;
    saveJson(SETTINGS_KEY, state.settings);
    if (state.settings.loadOrder === 'ratio' && state.allImages.length) {
      toast('Reading image ratios. Large folders may take a moment.', 'warn');
      await hydrateImageRatios(state.allImages);
    }
    if (state.allImages.length) {
      sortImages(state.allImages);
      filterImages();
      toast(`Sorted by ${state.settings.loadOrder}.`, 'good');
    } else {
      updateStatus();
    }
  });
  el.searchInput.addEventListener('input', filterImages);
  el.caseSensitive.addEventListener('change', () => { saveSettingsFromUi(); filterImages(); });
  for (const input of document.querySelectorAll('input[name="sortMode"]')) {
    input.addEventListener('change', () => { state.settings.sortMode = input.value; saveSettingsFromUi(); });
  }
  for (const input of [el.labelGood, el.labelRejected, el.labelBad]) {
    input.addEventListener('change', saveSettingsFromUi);
  }
  el.galleryBtn.addEventListener('click', toggleGallery);
  el.pngInfoBtn.addEventListener('click', togglePngInfo);
  el.pngInfoBox.addEventListener('input', updatePngInfoLayout);
  el.pngInfoBox.addEventListener('mouseup', updatePngInfoLayout);
  el.pngInfoBox.addEventListener('keyup', updatePngInfoLayout);
  el.pngInfoBox.addEventListener('pointerdown', (event) => event.stopPropagation());
  el.pngInfoBox.addEventListener('pointermove', (event) => event.stopPropagation());
  el.pngInfoBox.addEventListener('pointerup', (event) => event.stopPropagation());
  el.pngInfoBox.addEventListener('wheel', (event) => event.stopPropagation());
  window.addEventListener('resize', () => {
    resetImageTransform();
    updatePngInfoLayout();
  });
  el.gallerySearchInput.addEventListener('input', () => {
    state.gallerySearchQuery = el.gallerySearchInput.value;
    if (state.galleryMode) renderGallery(false);
  });
  el.gallerySearchMode.addEventListener('change', () => {
    state.gallerySearchMode = el.gallerySearchMode.value;
    if (state.galleryMode) renderGallery(false);
  });
  el.prevBtn.addEventListener('click', prevImage);
  el.nextBtn.addEventListener('click', nextImage);
  el.undoBtn.addEventListener('click', undoLastAction);
  el.rescanBtn.addEventListener('click', () => rescanSource(true));
  el.clearSessionBtn.addEventListener('click', clearSessionData);
  el.hideUiBtn.addEventListener('click', toggleUi);
  el.showUiBtn.addEventListener('click', toggleUi);
  el.versionLogBtn.addEventListener('click', openVersionLog);
  el.closeVersionLogBtn.addEventListener('click', closeVersionLog);
  el.versionLogOverlay.addEventListener('click', (event) => {
    if (event.target === el.versionLogOverlay) closeVersionLog();
  });

  el.singleViewer.addEventListener('wheel', zoomSingleImage, { passive: false });
  el.singleViewer.addEventListener('pointerdown', startPan);
  el.singleViewer.addEventListener('pointermove', movePan);
  el.singleViewer.addEventListener('pointerup', endPan);
  el.singleViewer.addEventListener('pointercancel', endPan);
  el.mainImage.addEventListener('load', resetImageTransform);
  el.mainImage.addEventListener('error', handleCurrentImageDecodeError);
  el.mainImage.addEventListener('dblclick', resetImageTransform);

  window.addEventListener('keydown', async (event) => {
    if (isVersionLogOpen()) {
      if (event.key === 'Escape') closeVersionLog();
      return;
    }
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
      case 'p':
      case 'P':
        event.preventDefault();
        await togglePngInfo();
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
  el.appTitle.textContent = `Image Sorter ${APP_VERSION}`;
  setCompatStatus();
  applySettingsToUi();
  loadKeyLog();
  updateStats();
  bindEvents();
  filterImages();
  updatePngInfoBox();
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
    await restoreLastAction();
    updateStatus();
    if (state.sourceHandle) toast('Saved folders found. Press “Restore saved folder permissions” to reuse them.', 'warn');
  }
}

init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, 'bad');
});
