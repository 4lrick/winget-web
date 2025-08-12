const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  query: '',
  results: [],
  rawResults: [],
  selected: new Map(), // key: PackageIdentifier, value: pkg object
  browseAll: false,
  listOffset: 0,
  loadingResults: false,
  hasMore: false,
  pageSize: 5,
  searchVisibleCount: 5,
  searchOffset: 0,
  searchTotal: 0,
  searchingMore: false,
  searchExhausted: false,
  lastSearchPageSize: 0,
  searchVisibleIds: [],
  // Local index support for static hosting (e.g., GitHub Pages)
  localIndex: null, // { total, items }
  localIndexLoaded: false,
};

const elements = {
  search: $('#searchInput'),
  results: $('#results'),
  selectedList: $('#selectedList'),
  selectedCount: $('#selectedCount'),
  clearSelected: $('#clearSelected'),
  exportJson: $('#exportJson'),
  importCommand: $('#importCommand'),
  browseAll: $('#browseAll'),
};

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Local index loader for static hosting
async function loadLocalIndex() {
  if (state.localIndexLoaded || state.localIndex) return;
  try {
    const res = await fetch('./data/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Normalize items minimally to expected shape
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    state.localIndex = { total: items.length, items };
    state.localIndexLoaded = true;
  } catch (e) {
    console.warn('Failed to load local index (data/index.json).', e);
    state.localIndex = { total: 0, items: [] };
    state.localIndexLoaded = true;
  }
}

// No API: static hosting only

async function searchPackages(query) {
  state.query = query.trim();
  if (!state.query) {
    // Empty search shows browse-all list
    state.browseAll = true;
    state.results = [];
    state.listOffset = 0;
    state.hasMore = false;
    listAll(true);
    return;
  } else {
    state.browseAll = false;
    state.searchVisibleCount = state.pageSize;
    state.searchVisibleIds = [];
  }

  {
    // Static mode: search in local index
    await loadLocalIndex();
    const all = state.localIndex?.items || [];
    // Rank across entire index; reveal with Show more
    state.rawResults = all;
    state.results = rankResults(all, state.query, all.length);
    state.searchTotal = state.results.length;
    state.searchOffset = state.searchTotal; // no server paging
    state.lastSearchPageSize = state.results.length;
    state.searchExhausted = true;
  }

  renderResults();
}

async function listAll(reset = false) {
  if (reset) {
    state.results = [];
    state.listOffset = 0;
    state.hasMore = false;
  }
  state.browseAll = true;
  const limit = state.pageSize;
  const offset = state.listOffset;
  state.loadingResults = true;
  renderResults();
  // Static mode: list from local index
  try {
    await loadLocalIndex();
    const all = (state.localIndex?.items || []).map(normalizePackage);
    const slice = all.slice(offset, offset + limit);
    state.results = state.results.concat(slice);
    state.listOffset += slice.length;
    state.hasMore = offset + slice.length < all.length;
  } catch (e) {
    console.warn('List all failed', e);
    state.hasMore = false;
  }
  state.loadingResults = false;
  renderResults();
}

// No API results normalization needed in static mode

function normalizePackage(pkg) {
  return {
    PackageIdentifier: pkg.PackageIdentifier || pkg.Id || pkg.id || '',
    Name: pkg.Name || pkg.name || '',
    Publisher: pkg.Publisher || pkg.publisher || '',
    Description: pkg.Description || pkg.description || '',
    Version: pkg.Version || pkg.version || '',
    Homepage: pkg.Homepage || pkg.homepage || pkg.HomepageUrl || '',
    Tags: pkg.Tags || pkg.tags || [],
    Moniker: pkg.Moniker || pkg.moniker || '',
  };
}

function normalizeCondensed(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function scoreMatch(pkg, needle) {
  const name = (pkg.Name || '').toLowerCase();
  const id = (pkg.PackageIdentifier || '').toLowerCase();
  const desc = (pkg.Description || '').toLowerCase();
  const publisher = (pkg.Publisher || '').toLowerCase();
  const needleCond = normalizeCondensed(needle);
  const nameCond = normalizeCondensed(name);
  const idCond = normalizeCondensed(id);
  const descCond = normalizeCondensed(desc);
  
  // Check for direct matches (original behavior)
  const anyDirect = name.includes(needle) || id.includes(needle) || desc.includes(needle) || publisher.includes(needle);
  
  // Check for multi-word matches (new behavior)
  const queryWords = needle.split(/\s+/).filter(word => word.length > 0);
  let multiWordScore = 0;
  if (queryWords.length > 1) {
    // Check if each word appears in any field
    const allWordsMatch = queryWords.every(word => {
      return name.includes(word) || id.includes(word) || desc.includes(word) || publisher.includes(word);
    });
    if (allWordsMatch) {
      // Calculate score based on how well each word matches
      for (const word of queryWords) {
        if (name.includes(word)) multiWordScore += 85;
        if (id.includes(word)) multiWordScore += 75;
        if (publisher.includes(word)) multiWordScore += 80;
        if (desc.includes(word)) multiWordScore += 60;
      }
      // Bonus for exact field matches
      if (publisher.includes(queryWords[0]) && name.includes(queryWords[1])) multiWordScore += 20;
      if (name.includes(queryWords[0]) && publisher.includes(queryWords[1])) multiWordScore += 20;
    }
  }
  
  // Check condensed matching (original behavior)
  const anyCondensed = (!!needleCond && (nameCond.includes(needleCond) || idCond.includes(needleCond) || descCond.includes(needleCond)));
  
  if (!anyDirect && !anyCondensed && multiWordScore === 0) return null;
  
  let score = Math.max(0, multiWordScore);
  
  // Prioritize Name, then ID, then Description (original scoring)
  if (name) {
    // Exact match gets highest priority
    if (name === needle) score = Math.max(score, 300); // Increased from 200 to 300
    // Starts with gets high priority, but shorter names get bonus
    else if (name.startsWith(needle)) {
      const nameLength = name.length;
      const lengthBonus = Math.max(0, 40 - nameLength); // Reduced from 60 to 40
      score = Math.max(score, 140 - (name.indexOf(needle) || 0) + lengthBonus);
    }
    // Contains gets medium priority, but shorter names get bonus
    else if (name.includes(needle)) {
      const nameLength = name.length;
      const lengthBonus = Math.max(0, 30 - nameLength); // Reduced from 50 to 30
      score = Math.max(score, 90 - name.indexOf(needle) + lengthBonus);
    }
    // Condensed matching (e.g., "explorer patcher" -> "ExplorerPatcher")
    if (needleCond) {
      if (nameCond.startsWith(needleCond)) {
        const nameLength = nameCond.length;
        const lengthBonus = Math.max(0, 25 - nameLength); // Reduced from 40 to 25
        score = Math.max(score, 85 - (nameCond.indexOf(needleCond) || 0) + lengthBonus);
      }
      else if (nameCond.includes(needleCond)) {
        const nameLength = nameCond.length;
        const lengthBonus = Math.max(0, 20 - nameLength); // Reduced from 30 to 20
        score = Math.max(score, 80 - nameCond.indexOf(needleCond) + lengthBonus);
      }
    }
  }
  if (id) {
    // Exact match gets high priority
    if (id === needle) score = Math.max(score, 250); // Increased from 180 to 250
    // Starts with gets high priority, but shorter IDs get bonus
    else if (id.startsWith(needle)) {
      const idLength = id.length;
      const lengthBonus = Math.max(0, 30 - idLength); // Reduced from 50 to 30
      score = Math.max(score, 120 - (id.indexOf(needle) || 0) + lengthBonus);
    }
    // Contains gets medium priority, but shorter IDs get bonus
    else if (id.includes(needle)) {
      const idLength = id.length;
      const lengthBonus = Math.max(0, 25 - idLength); // Reduced from 40 to 25
      score = Math.max(score, 75 - id.indexOf(needle) + lengthBonus);
    }
    if (needleCond) {
      if (idCond.startsWith(needleCond)) {
        const idLength = idCond.length;
        const lengthBonus = Math.max(0, 20 - idLength); // Reduced from 35 to 20
        score = Math.max(score, 65 - (idCond.indexOf(needleCond) || 0) + lengthBonus);
      }
      else if (idCond.includes(needleCond)) {
        const idLength = idCond.length;
        const lengthBonus = Math.max(0, 15 - idLength); // Reduced from 25 to 15
        score = Math.max(score, 60 - idCond.indexOf(needleCond) + lengthBonus);
      }
    }
  }
  if (desc) {
    if (desc.includes(needle)) {
      const descLength = desc.length;
      const lengthBonus = Math.max(0, 15 - descLength); // Reduced from 20 to 15
      score = Math.max(score, 55 - desc.indexOf(needle) + lengthBonus);
    }
    if (needleCond && descCond.includes(needleCond)) {
      const descLength = descCond.length;
      const lengthBonus = Math.max(0, 10 - descLength); // Reduced from 15 to 10
      score = Math.max(score, 50 - descCond.indexOf(needleCond) + lengthBonus);
    }
  }
  
  // Bonus for packages from the same publisher as the main package
  // This helps prioritize related packages (e.g., Valve.Steam, Valve.SteamLink)
  if (publisher.includes('valve') && (name.includes('steam') || id.includes('steam'))) {
    score += 20; // Increased from 15 to 20
  }
  
  // Special bonus for the main Steam application
  if (id === 'valve.steam' && name === 'steam') {
    score += 50; // Extra bonus for the main Steam package
  }
  
  return score;
}

function rankResults(pkgs, q, limit = 50) {
  const needle = q.toLowerCase().trim();
  if (!needle) return pkgs.slice(0, limit).map(normalizePackage);
  const scored = [];
  for (const p of pkgs) {
    const n = normalizePackage(p);
    const s = scoreMatch(n, needle);
    if (s !== null) scored.push([s, n]);
  }
  scored.sort((a, b) => {
    if (b[0] !== a[0]) return b[0] - a[0];
    // Tie-breaker: alphabetical by Name then ID
    const an = (a[1].Name || '').toLowerCase();
    const bn = (b[1].Name || '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    const ai = (a[1].PackageIdentifier || '').toLowerCase();
    const bi = (b[1].PackageIdentifier || '').toLowerCase();
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  return scored.slice(0, limit).map((x) => x[1]);
}

// No local sample filtering anymore

// Top-level search pagination helper used by the UI button
async function fetchMoreSearch() {
  // Static mode: we already have ranked results in memory.
  // Just reveal more of them by increasing the visible count; nothing to fetch.
  state.searchVisibleCount += state.pageSize;
  renderResults();
}

function renderResults() {
  const c = elements.results;
  c.innerHTML = '';
  if (!state.query && !state.browseAll) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Start typing to search packages…';
    c.appendChild(div);
    c.classList.add('is-empty');
    return;
  }
  if (state.loadingResults && !state.results.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Loading…';
    c.appendChild(div);
    c.classList.add('is-empty');
    return;
  }
  if (!state.results.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No results.';
    c.appendChild(div);
    c.classList.add('is-empty');
    return;
  }
  c.classList.remove('is-empty');
  let visible;
  if (state.browseAll) {
    visible = state.results;
  } else {
    // Preserve previously revealed items, and append next best-ranked ones
    const idOf = (p) => (p.PackageIdentifier || '').toLowerCase();
    const byId = new Map(state.results.map((p) => [idOf(p), p]));
    // Ensure searchVisibleIds contains only ids present in results
    state.searchVisibleIds = state.searchVisibleIds.filter((id) => byId.has(id));
    const need = Math.max(0, state.searchVisibleCount - state.searchVisibleIds.length);
    if (need > 0) {
      for (const p of state.results) {
        const id = idOf(p);
        if (!state.searchVisibleIds.includes(id)) {
          state.searchVisibleIds.push(id);
          if (state.searchVisibleIds.length >= state.searchVisibleCount) break;
        }
      }
    }
    // Build visible list in the stable order they were revealed
    visible = state.searchVisibleIds.map((id) => byId.get(id)).filter(Boolean);
  }
  for (const pkg of visible) {
    const item = document.createElement('div');
    item.className = 'result-item';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = `${pkg.Name || pkg.PackageIdentifier}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [pkg.PackageIdentifier, pkg.Publisher, pkg.Version].filter(Boolean).join(' • ');
    left.appendChild(title);
    left.appendChild(meta);

    if (pkg.Description) {
      const desc = document.createElement('div');
      desc.className = 'meta';
      desc.textContent = pkg.Description;
      left.appendChild(desc);
    }

    if (pkg.Tags && pkg.Tags.length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const t of pkg.Tags.slice(0, 6)) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = t;
        tags.appendChild(tag);
      }
      left.appendChild(tags);
    }

    const right = document.createElement('div');
    const btn = document.createElement('button');
    const setBtnState = () => {
      const already = state.selected.has(pkg.PackageIdentifier);
      btn.className = already ? 'btn ok' : 'btn secondary';
      btn.textContent = already ? 'Selected ✓' : 'Select';
      btn.setAttribute('aria-pressed', already ? 'true' : 'false');
    };
    setBtnState();
    btn.addEventListener('click', () => {
      const exists = state.selected.has(pkg.PackageIdentifier);
      if (exists) removeSelected(pkg.PackageIdentifier);
      else addSelected(pkg);
      setBtnState();
    });
    right.appendChild(btn);

    item.appendChild(left);
    item.appendChild(right);
    c.appendChild(item);
  }

  // Load more for browse-all mode
  if (state.browseAll && state.hasMore) {
    const moreWrap = document.createElement('div');
    moreWrap.style.padding = '12px';
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = 'Load more';
    btn.addEventListener('click', () => listAll(false));
    moreWrap.appendChild(btn);
    c.appendChild(moreWrap);
  }

  // Show more for search mode (reveal or fetch next page)
  const canReveal = state.results.length > state.searchVisibleCount;
  const canFetchMore = (!state.searchExhausted && !state.searchingMore) && (state.searchOffset < state.searchTotal || state.lastSearchPageSize === 50);
  if (!state.browseAll && (canReveal || canFetchMore)) {
    const moreWrap = document.createElement('div');
    moreWrap.style.padding = '12px';
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = state.searchingMore ? 'Loading…' : 'Show more';
    btn.disabled = state.searchingMore;
    btn.addEventListener('click', () => {
      // If we've revealed all buffered results but the server has more, fetch next page first
      if (state.searchVisibleCount >= state.results.length && (state.searchOffset < state.searchTotal || state.lastSearchPageSize === 50)) {
        fetchMoreSearch().then(() => {
          state.searchVisibleCount += state.pageSize;
          renderResults();
        });
      } else {
        state.searchVisibleCount += state.pageSize;
        renderResults();
      }
    });
    moreWrap.appendChild(btn);
    c.appendChild(moreWrap);
  }
}

function addSelected(pkg) {
  if (!pkg?.PackageIdentifier) return;
  if (!state.selected.has(pkg.PackageIdentifier)) {
    state.selected.set(pkg.PackageIdentifier, pkg);
    renderSelected();
    renderResults();
    updateCommand();
    syncUrl();
  }
}

function removeSelected(id) {
  state.selected.delete(id);
  renderSelected();
  renderResults();
  updateCommand();
  syncUrl();
}

function clearSelected() {
  state.selected.clear();
  renderSelected();
  renderResults();
  updateCommand();
  syncUrl();
}

function renderSelected() {
  elements.selectedList.innerHTML = '';
  const selectedArray = Array.from(state.selected.entries());
  
  for (let i = 0; i < selectedArray.length; i++) {
    const [id, pkg] = selectedArray[i];
    const li = document.createElement('li');
    li.className = 'selected-item';
    li.draggable = true;
    li.dataset.id = id;
    li.dataset.index = i;
    
    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '⋮⋮';
    dragHandle.title = 'Drag to reorder';
    
    const left = document.createElement('div');
    left.innerHTML = `<div>${pkg.Name || id}</div><div class="meta">${id}</div>`;
    
    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn danger';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeSelected(id));
    right.appendChild(btn);
    
    li.appendChild(dragHandle);
    li.appendChild(left);
    li.appendChild(right);
    
    // Drag and drop event listeners
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);
    
    elements.selectedList.appendChild(li);
  }
  elements.selectedCount.textContent = String(state.selected.size);
}

// Drag and drop functionality for reordering selected packages
let draggedElement = null;
let draggedIndex = -1;

function handleDragStart(e) {
  draggedElement = this;
  draggedIndex = parseInt(this.dataset.index);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.outerHTML);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const targetIndex = parseInt(this.dataset.index);
  if (draggedIndex === targetIndex) return;
  
  // Remove existing drop indicators
  elements.selectedList.querySelectorAll('.selected-item').forEach(item => {
    item.classList.remove('drop-above', 'drop-below');
  });
  
  // Add drop indicator
  if (draggedIndex < targetIndex) {
    this.classList.add('drop-below');
  } else {
    this.classList.add('drop-above');
  }
}

function handleDrop(e) {
  e.preventDefault();
  
  const targetIndex = parseInt(this.dataset.index);
  if (draggedIndex === targetIndex) return;
  
  console.log(`Moving item from index ${draggedIndex} to ${targetIndex}`);
  
  // Reorder the selected packages
  const selectedArray = Array.from(state.selected.entries());
  const [draggedId] = selectedArray[draggedIndex];
  
  // Remove the dragged item
  selectedArray.splice(draggedIndex, 1);
  
  // Insert at new position
  selectedArray.splice(targetIndex, 0, [draggedId, state.selected.get(draggedId)]);
  
  // Rebuild the Map with new order
  state.selected.clear();
  for (const [id, pkg] of selectedArray) {
    state.selected.set(id, pkg);
  }
  
  console.log('New order:', Array.from(state.selected.keys()));
  
  // Re-render and update URL
  renderSelected();
  syncUrl();
  
  // Update the command timestamp since order changed
  updateCommand();
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  
  // Remove all drop indicators
  elements.selectedList.querySelectorAll('.selected-item').forEach(item => {
    item.classList.remove('drop-above', 'drop-below');
  });
  
  draggedElement = null;
  draggedIndex = -1;
}

function buildWingetImportJson() {
  const packages = Array.from(state.selected.keys()).map((id) => ({ PackageIdentifier: id }));
  return {
    $schema: 'https://aka.ms/winget-packages.schema.2.0.json',
    CreationDate: new Date().toISOString(),
    Sources: [
      {
        SourceDetails: {
          Name: 'winget',
          Argument: 'https://cdn.winget.microsoft.com/cache',
          Identifier: 'Microsoft.Winget.Source_8wekyb3d8bbwe',
          Type: 'Microsoft.PreIndexed.Package',
        },
        Packages: packages,
      },
    ],
  };
}

function download(filename, dataStr, mime = 'application/json') {
  const blob = new Blob([dataStr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildTimestampedFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const ts = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  return `winget-web-${ts}.json`;
}

function exportJson() {
  if (state.selected.size === 0) {
    alert('No packages selected.');
    return;
  }
  const data = buildWingetImportJson();
  const filename = buildTimestampedFilename();
  download(filename, JSON.stringify(data, null, 2));
  elements.importCommand.textContent = `winget import --import-file "${filename}"`;
}

function updateCommand() {
  if (state.selected.size === 0) {
    elements.importCommand.textContent = 'winget import --import-file "winget-web-YYYYMMDD.json"';
    return;
  }
  const filename = buildTimestampedFilename();
  elements.importCommand.textContent = `winget import --import-file "${filename}"`;
}

function syncUrl() {
  const ids = Array.from(state.selected.keys());
  const url = new URL(location.href);
  if (ids.length) url.searchParams.set('ids', ids.join(','));
  else url.searchParams.delete('ids');
  history.replaceState(null, '', url.toString());
}

function restoreFromUrl() {
  const url = new URL(location.href);
  const ids = url.searchParams.get('ids');
  if (!ids) return;
  const set = ids.split(',').filter(Boolean);
  // Try to hydrate from local data; unknowns become shell items
  for (const id of set) {
    state.selected.set(id, { PackageIdentifier: id, Name: id });
  }
}

async function hydrateSelectedFromApi() {
  if (state.selected.size === 0) return;
  // Static hydration only (no API)
  // Static hydration: use local index
  await loadLocalIndex();
  const map = new Map((state.localIndex?.items || []).map((p) => [String(p.PackageIdentifier || '').toLowerCase(), normalizePackage(p)]));
  let changed = false;
  for (const id of Array.from(state.selected.keys())) {
    const pkg = map.get(id.toLowerCase());
    if (pkg) {
      state.selected.set(id, pkg);
      changed = true;
    }
  }
  if (changed) renderSelected();
}

function bind() {
  elements.search.addEventListener('input', debounce((e) => searchPackages(e.target.value), 250));
  elements.clearSelected.addEventListener('click', clearSelected);
  elements.exportJson.addEventListener('click', exportJson);
  elements.browseAll.addEventListener('click', () => searchPackages(elements.search.value || ''));
}

async function main() {
  bind();
  // Static: proactively load the local index
  await loadLocalIndex();
  restoreFromUrl();
  await hydrateSelectedFromApi();
  renderSelected();
  if (state.selected.size) updateCommand();
  // Show package list by default
  listAll(true);
}

main();

