const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  apiBase: '',
  query: '',
  results: [],
  selected: new Map(), // key: PackageIdentifier, value: pkg object
  usingSample: true,
  sample: [],
  browseAll: false,
  listOffset: 0,
  loadingResults: false,
  hasMore: false,
  pageSize: 5,
  searchVisibleCount: 5,
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

async function ensureSampleLoaded() {
  if (!state.sample.length) {
    try {
      const res = await fetch('data/index.json', { cache: 'no-store' });
      const data = await res.json();
      state.sample = Array.isArray(data) ? data : (data.items || []);
    } catch (e) {
      console.error('Failed to load local index data', e);
      state.sample = [];
    }
  }
}

async function detectApiBase() {
  try {
    const saved = localStorage.getItem('apiBase');
    if (saved) {
      state.apiBase = saved;
      state.usingSample = !state.apiBase;
      return;
    }
  } catch {}

  try {
    const isHttp = typeof location !== 'undefined' && /^https?:/i.test(location.protocol);
    const url = typeof location !== 'undefined' ? new URL(location.href) : null;
    const fromParam = url?.searchParams.get('api') || '';
    const candidates = [];
    if (fromParam) candidates.push(fromParam);
    if (isHttp) candidates.push(location.origin);
    for (const base of candidates) {
      try {
        const healthUrl = new URL('/api/health', base).toString();
        const res = await fetch(healthUrl, { cache: 'no-store' });
        if (res.ok) {
          state.apiBase = base;
          state.usingSample = false;
          try { localStorage.setItem('apiBase', base); } catch {}
          return;
        }
      } catch {}
    }
  } catch {}
  state.apiBase = '';
  state.usingSample = true;
}

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
  }

  if (state.apiBase) {
    try {
      const url = new URL('/api/search', state.apiBase);
      url.searchParams.set('q', state.query);
      url.searchParams.set('limit', '50');
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.results = rankResults(normalizeApiResults(data), state.query, 50);
      state.usingSample = false;
    } catch (e) {
      console.warn('API search failed; falling back to local index data.', e);
      state.apiBase = '';
      try { localStorage.setItem('apiBase', ''); } catch {}
      state.usingSample = true;
      await ensureSampleLoaded();
      state.results = filterSample(state.sample, state.query);
    }
  } else {
    await ensureSampleLoaded();
    state.results = filterSample(state.sample, state.query);
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
  try {
    if (state.apiBase) {
      const url = new URL('/api/list', state.apiBase);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (Array.isArray(data) ? data : data.items) || [];
      state.results = state.results.concat(items.map(normalizePackage));
      state.listOffset += items.length;
      state.hasMore = items.length === limit;
      state.usingSample = false;
    } else {
      // Use local index data with simple pagination
      await ensureSampleLoaded();
      const slice = state.sample.slice(offset, offset + limit);
      state.results = state.results.concat(slice.map(normalizePackage));
      state.listOffset += slice.length;
      state.hasMore = state.listOffset < state.sample.length;
    }
  } catch (e) {
    console.warn('List all failed', e);
    if (state.apiBase) {
      // fall back to local index if API not ready
      state.apiBase = '';
      try { localStorage.setItem('apiBase', ''); } catch {}
      state.usingSample = true;
      await ensureSampleLoaded();
      const slice = state.sample.slice(offset, offset + limit);
      state.results = state.results.concat(slice.map(normalizePackage));
      state.listOffset += slice.length;
      state.hasMore = state.listOffset < state.sample.length;
    }
  }
  state.loadingResults = false;
  renderResults();
}

function normalizeApiResults(data) {
  // Expected shape: array of packages with at least PackageIdentifier and Name
  if (Array.isArray(data)) return data.map(normalizePackage);
  if (Array.isArray(data.items)) return data.items.map(normalizePackage);
  return [];
}

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

function scoreMatch(pkg, needle) {
  const name = (pkg.Name || '').toLowerCase();
  const id = (pkg.PackageIdentifier || '').toLowerCase();
  const desc = (pkg.Description || '').toLowerCase();
  // No match in any of the important fields
  if (!name.includes(needle) && !id.includes(needle) && !desc.includes(needle)) return null;
  let score = 0;
  // Prioritize Name, then ID, then Description
  if (name) {
    if (name.startsWith(needle)) score = Math.max(score, 100 - (name.indexOf(needle) || 0));
    else if (name.includes(needle)) score = Math.max(score, 90 - name.indexOf(needle));
  }
  if (id) {
    if (id.startsWith(needle)) score = Math.max(score, 80 - (id.indexOf(needle) || 0));
    else if (id.includes(needle)) score = Math.max(score, 70 - id.indexOf(needle));
  }
  if (desc && desc.includes(needle)) {
    score = Math.max(score, 60 - desc.indexOf(needle));
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

function filterSample(all, q, limit = 50) {
  return rankResults(all, q, limit);
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
  const visible = state.browseAll ? state.results : state.results.slice(0, state.searchVisibleCount);
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

  // Show more for search mode (client-side reveal)
  if (!state.browseAll && state.results.length > state.searchVisibleCount) {
    const moreWrap = document.createElement('div');
    moreWrap.style.padding = '12px';
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = 'Show more';
    btn.addEventListener('click', () => {
      state.searchVisibleCount += state.pageSize;
      renderResults();
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
  for (const [id, pkg] of state.selected) {
    const li = document.createElement('li');
    li.className = 'selected-item';
    const left = document.createElement('div');
    left.innerHTML = `<div>${pkg.Name || id}</div><div class="meta">${id}</div>`;
    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn danger';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeSelected(id));
    right.appendChild(btn);
    li.appendChild(left);
    li.appendChild(right);
    elements.selectedList.appendChild(li);
  }
  elements.selectedCount.textContent = String(state.selected.size);
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
  const ts = new Date()
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-')
    .slice(0, 15);
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

function bind() {
  elements.search.addEventListener('input', debounce((e) => searchPackages(e.target.value), 250));
  elements.clearSelected.addEventListener('click', clearSelected);
  elements.exportJson.addEventListener('click', exportJson);
  elements.browseAll.addEventListener('click', () => searchPackages(elements.search.value || ''));
}

async function main() {
  bind();
  await detectApiBase();
  restoreFromUrl();
  renderSelected();
  if (state.selected.size) updateCommand();
  // Show package list by default
  listAll(true);
}

main();
