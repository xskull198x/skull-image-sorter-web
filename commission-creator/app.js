(() => {
  "use strict";

  const data = window.COMMISSION_DATA;
  if (!data || !Array.isArray(data.categories)) {
    document.body.innerHTML = "<main class='shell'><h1>Commission data failed to load.</h1></main>";
    return;
  }

  const state = {
    mode: "gallery",
    categoryIndex: 0,
    reviewCategory: null,
    search: "",
    focusedItem: null,
    selected: new Map(),
    sequence: 0,
  };

  const els = {
    galleryModeBtn: document.getElementById("galleryModeBtn"),
    textModeBtn: document.getElementById("textModeBtn"),
    searchInput: document.getElementById("searchInput"),
    selectAllBtn: document.getElementById("selectAllBtn"),
    deselectAllBtn: document.getElementById("deselectAllBtn"),
    reviewBtn: document.getElementById("reviewBtn"),
    categoryTabs: document.getElementById("categoryTabs"),
    presetGrid: document.getElementById("presetGrid"),
    emptyState: document.getElementById("emptyState"),
    currentName: document.getElementById("currentName"),
    tagBox: document.getElementById("tagBox"),
    selectedList: document.getElementById("selectedList"),
    reviewDialog: document.getElementById("reviewDialog"),
    closeReviewBtn: document.getElementById("closeReviewBtn"),
    reviewTabs: document.getElementById("reviewTabs"),
    reviewContent: document.getElementById("reviewContent"),
    emptyCategoryWarning: document.getElementById("emptyCategoryWarning"),
    exportBtn: document.getElementById("exportBtn"),
  };

  function currentCategory() {
    return data.categories[state.categoryIndex];
  }

  function itemId(categoryName, itemName) {
    return `${categoryName}\u0000${itemName}`;
  }

  function selectedForCategory(category) {
    return Array.from(state.selected.values())
      .filter((entry) => entry.category === category.name)
      .sort((a, b) => a.order - b.order);
  }

  function selectedCategories() {
    return data.categories.filter((category) => selectedForCategory(category).length > 0);
  }

  function isSelected(category, item) {
    return state.selected.has(itemId(category.name, item.name));
  }

  function getSelectionOrder(category, item) {
    return state.selected.get(itemId(category.name, item.name))?.order;
  }

  function setFocused(category, item) {
    state.focusedItem = { category: category.name, name: item.name, tags: item.tags };
    els.currentName.textContent = `${category.name}: ${item.name}`;
    els.tagBox.textContent = item.tags || "No tags saved for this preset.";
  }

  function toggleSelection(category, item, force) {
    const id = itemId(category.name, item.name);
    const shouldSelect = force ?? !state.selected.has(id);
    if (shouldSelect) {
      if (!state.selected.has(id)) {
        state.selected.set(id, {
          id,
          category: category.name,
          outputFile: category.outputFile,
          name: item.name,
          tags: item.tags,
          order: ++state.sequence,
        });
      }
    } else {
      state.selected.delete(id);
    }
  }

  function filteredItems(category = currentCategory()) {
    const query = state.search.trim().toLocaleLowerCase();
    if (!query) return category.items;
    return category.items.filter((item) => {
      return (
        item.name.toLocaleLowerCase().includes(query) ||
        String(item.tags).toLocaleLowerCase().includes(query)
      );
    });
  }

  function renderTabs() {
    els.categoryTabs.replaceChildren();
    data.categories.forEach((category, index) => {
      const count = selectedForCategory(category).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab${index === state.categoryIndex ? " active" : ""}`;
      button.textContent = count ? `${category.name} (${count})` : category.name;
      button.addEventListener("click", () => {
        state.categoryIndex = index;
        render();
      });
      els.categoryTabs.append(button);
    });
  }

  function renderGrid() {
    const category = currentCategory();
    const items = filteredItems(category);
    els.presetGrid.classList.toggle("text-mode", state.mode === "text");
    els.presetGrid.replaceChildren();
    els.emptyState.hidden = items.length > 0;

    items.forEach((item) => {
      const selected = isSelected(category, item);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `preset-card${selected ? " selected" : ""}`;
      card.title = item.tags;

      const title = document.createElement("div");
      title.className = "preset-title";
      const name = document.createElement("span");
      name.textContent = item.name;
      title.append(name);
      const order = getSelectionOrder(category, item);
      if (order) {
        const badge = document.createElement("span");
        badge.className = "order-badge";
        badge.textContent = String(order);
        title.append(badge);
      }

      if (state.mode === "gallery") {
        const preview = document.createElement("div");
        const ratio = item.ratio || category.placeholderRatio || 1;
        preview.className = "preview";
        preview.style.aspectRatio = `${ratio}`;
        if (item.preview) {
          const img = document.createElement("img");
          img.loading = "lazy";
          img.decoding = "async";
          img.alt = item.name;
          img.src = item.preview;
          preview.append(img);
        } else {
          preview.textContent = "No preview";
        }
        if (item.preview) {
          card.append(preview, title);
        } else {
          card.append(title, preview);
        }
      } else {
        card.append(title);
      }

      const snippet = document.createElement("div");
      snippet.className = "tag-snippet";
      snippet.textContent = item.tags;

      card.append(snippet);
      card.addEventListener("mouseenter", () => setFocused(category, item));
      card.addEventListener("focus", () => setFocused(category, item));
      card.addEventListener("click", () => {
        setFocused(category, item);
        toggleSelection(category, item);
        render();
      });
      els.presetGrid.append(card);
    });
  }

  function renderSelectedList() {
    const category = currentCategory();
    const selected = selectedForCategory(category);
    els.selectedList.replaceChildren();
    if (!selected.length) {
      const li = document.createElement("li");
      li.textContent = "No presets selected for this category.";
      els.selectedList.append(li);
      return;
    }
    selected.forEach((entry, index) => {
      const li = document.createElement("li");
      li.textContent = `${index + 1}. ${entry.name}`;
      els.selectedList.append(li);
    });
  }

  function renderReviewTabs() {
    const categories = selectedCategories();
    els.reviewTabs.replaceChildren();
    if (!categories.length) {
      state.reviewCategory = null;
      return;
    }
    if (!state.reviewCategory || !categories.some((category) => category.name === state.reviewCategory)) {
      state.reviewCategory = categories[0].name;
    }
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab${category.name === state.reviewCategory ? " active" : ""}`;
      button.textContent = `${category.name} (${selectedForCategory(category).length})`;
      button.addEventListener("click", () => {
        state.reviewCategory = category.name;
        renderReview();
      });
      els.reviewTabs.append(button);
    });
  }

  function renderReview() {
    renderReviewTabs();
    els.reviewContent.replaceChildren();
    const category = data.categories.find((entry) => entry.name === state.reviewCategory);
    if (!category) {
      els.reviewContent.textContent = "No presets selected yet.";
    } else {
      selectedForCategory(category).forEach((entry, index) => {
        const item = document.createElement("article");
        item.className = "review-item";
        const title = document.createElement("strong");
        title.textContent = `${index + 1}. ${entry.name}`;
        const tags = document.createElement("div");
        tags.className = "tag-snippet";
        tags.textContent = entry.tags;
        item.append(title, tags);
        els.reviewContent.append(item);
      });
    }

    const empty = data.categories
      .filter((entry) => selectedForCategory(entry).length === 0)
      .map((entry) => entry.name);
    els.emptyCategoryWarning.textContent = empty.length
      ? `Skull may or may not choose presets for you. If you're ok with this click export, otherwise select some presets for these categories: ${empty.join(", ")}.`
      : "Every category currently has at least one selected preset.";
  }

  function render() {
    els.galleryModeBtn.classList.toggle("active", state.mode === "gallery");
    els.textModeBtn.classList.toggle("active", state.mode === "text");
    renderTabs();
    renderGrid();
    renderSelectedList();
  }

  function selectShown(shouldSelect) {
    const category = currentCategory();
    filteredItems(category).forEach((item) => toggleSelection(category, item, shouldSelect));
    render();
  }

  function groupSelectedByOutputFile() {
    const grouped = new Map();
    Array.from(state.selected.values())
      .sort((a, b) => a.order - b.order)
      .forEach((entry) => {
        if (!grouped.has(entry.outputFile)) grouped.set(entry.outputFile, []);
        grouped.get(entry.outputFile).push(entry);
      });
    return grouped;
  }

  function exportZip() {
    const files = new Map();
    groupSelectedByOutputFile().forEach((entries, outputFile) => {
      const content = entries.map((entry) => entry.tags).join("\n") + "\n";
      files.set(outputFile, content);
    });
    files.set(
      "README.txt",
      "Please download this ZIP and send it to Skull.\nEach file matches the related RPE prompt category file.\n"
    );

    const blob = buildZip(files);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `skull-commission-presets-${stamp}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function writeUint16(array, value) {
    array.push(value & 0xff, (value >>> 8) & 0xff);
  }

  function writeUint32(array, value) {
    array.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function dosDateTime(date) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const local = [];
    const central = [];
    let offset = 0;
    const now = dosDateTime(new Date());

    files.forEach((content, filename) => {
      const nameBytes = encoder.encode(filename.replaceAll("\\", "/"));
      const dataBytes = encoder.encode(content);
      const crc = crc32(dataBytes);
      const localHeader = [];
      writeUint32(localHeader, 0x04034b50);
      writeUint16(localHeader, 20);
      writeUint16(localHeader, 0x0800);
      writeUint16(localHeader, 0);
      writeUint16(localHeader, now.dosTime);
      writeUint16(localHeader, now.dosDate);
      writeUint32(localHeader, crc);
      writeUint32(localHeader, dataBytes.length);
      writeUint32(localHeader, dataBytes.length);
      writeUint16(localHeader, nameBytes.length);
      writeUint16(localHeader, 0);
      local.push(Uint8Array.from(localHeader), nameBytes, dataBytes);

      const centralHeader = [];
      writeUint32(centralHeader, 0x02014b50);
      writeUint16(centralHeader, 20);
      writeUint16(centralHeader, 20);
      writeUint16(centralHeader, 0x0800);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, now.dosTime);
      writeUint16(centralHeader, now.dosDate);
      writeUint32(centralHeader, crc);
      writeUint32(centralHeader, dataBytes.length);
      writeUint32(centralHeader, dataBytes.length);
      writeUint16(centralHeader, nameBytes.length);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint32(centralHeader, 0);
      writeUint32(centralHeader, offset);
      central.push(Uint8Array.from(centralHeader), nameBytes);

      offset += localHeader.length + nameBytes.length + dataBytes.length;
    });

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const footer = [];
    writeUint32(footer, 0x06054b50);
    writeUint16(footer, 0);
    writeUint16(footer, 0);
    writeUint16(footer, files.size);
    writeUint16(footer, files.size);
    writeUint32(footer, centralSize);
    writeUint32(footer, offset);
    writeUint16(footer, 0);

    return new Blob([...local, ...central, Uint8Array.from(footer)], { type: "application/zip" });
  }

  els.galleryModeBtn.addEventListener("click", () => {
    state.mode = "gallery";
    render();
  });
  els.textModeBtn.addEventListener("click", () => {
    state.mode = "text";
    render();
  });
  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value;
    renderGrid();
  });
  els.selectAllBtn.addEventListener("click", () => selectShown(true));
  els.deselectAllBtn.addEventListener("click", () => selectShown(false));
  els.reviewBtn.addEventListener("click", () => {
    renderReview();
    els.reviewDialog.showModal();
  });
  els.closeReviewBtn.addEventListener("click", () => els.reviewDialog.close());
  els.exportBtn.addEventListener("click", exportZip);

  render();
})();
