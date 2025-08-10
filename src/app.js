const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  query: '',
  results: [],
  selected: new Map(), // key: PackageIdentifier, value: pkg object
  usingSample: true,
  sample: [],
  browseAll: false,
  listOffset: 0,
  loadingResults: false,
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
      const res = await fetch('data/sample-packages.json');
      state.sample = await res.json();
    } catch (e) {
      console.error('Failed to load sample data', e);
      state.sample = [];
    }
  }
}

async function searchPackages(query) {
  state.query = query.trim();
  if (!state.query) {
    // Empty search switches back to browse-all mode without clearing
    state.browseAll = true;
    renderResults();
    return;
  } else {
    state.browseAll = false;
  }

  await ensureSampleLoaded();
  state.results = filterSample(state.sample, state.query);

  renderResults();
}

async function listAll(reset = false) {
  if (reset) {
    state.results = [];
    state.listOffset = 0;
  }
  state.browseAll = true;
  const limit = 50;
  const offset = state.listOffset;
  state.loadingResults = true;
  renderResults();
  try {
    // Use bundled sample data with simple pagination
    await ensureSampleLoaded();
    const slice = state.sample.slice(offset, offset + limit);
    state.results = state.results.concat(slice.map(normalizePackage));
    state.listOffset += slice.length;
  } catch (e) {
    console.warn('List all failed', e);
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

function filterSample(all, q) {
  const needle = q.toLowerCase();
  return all
    .filter((p) => {
      const hay = [
        p.PackageIdentifier,
        p.Name,
        p.Publisher,
        p.Description,
        (p.Tags || []).join(' '),
        p.Moniker,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 50)
    .map(normalizePackage);
}

function renderResults() {
  const c = elements.results;
  c.innerHTML = '';
  if (!state.query && !state.browseAll) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Loading packages…';
    c.appendChild(div);
    return;
  }
  if (state.loadingResults && !state.results.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Loading…';
    c.appendChild(div);
    return;
  }
  if (!state.results.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No results.';
    c.appendChild(div);
    return;
  }
  for (const pkg of state.results) {
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
    const already = state.selected.has(pkg.PackageIdentifier);
    const label = document.createElement('label');
    label.className = 'meta';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = already;
    cb.addEventListener('change', () => {
      if (cb.checked) addSelected(pkg);
      else removeSelected(pkg.PackageIdentifier);
    });
    const txt = document.createElement('span');
    txt.textContent = already ? 'Selected' : 'Select';
    label.appendChild(cb);
    label.appendChild(txt);
    right.appendChild(label);

    item.appendChild(left);
    item.appendChild(right);
    c.appendChild(item);
  }

  // Load more for browse-all mode
  if (state.browseAll) {
    const moreWrap = document.createElement('div');
    moreWrap.style.padding = '12px';
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = 'Load more';
    btn.addEventListener('click', () => listAll(false));
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

function exportJson() {
  if (state.selected.size === 0) {
    alert('No packages selected.');
    return;
  }
  const data = buildWingetImportJson();
  const ts = new Date()
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('T', '-')
    .slice(0, 15);
  const filename = `winget-web-${ts}.json`;
  download(filename, JSON.stringify(data, null, 2));
  elements.importCommand.textContent = `winget import --import-file "${filename}"`;
}

function updateCommand() {
  if (state.selected.size === 0) {
    elements.importCommand.textContent = 'winget import --import-file "winget-web-YYYYMMDD.json"';
  }
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
  // Try to hydrate from sample data; unknowns become shell items
  for (const id of set) {
    state.selected.set(id, { PackageIdentifier: id, Name: id });
  }
}

function bind() {
  elements.search.addEventListener('input', debounce((e) => searchPackages(e.target.value), 250));
  elements.clearSelected.addEventListener('click', clearSelected);
  elements.exportJson.addEventListener('click', exportJson);
  elements.browseAll.addEventListener('click', () => listAll(true));
}

async function main() {
  bind();
  restoreFromUrl();
  renderSelected();
  if (state.selected.size) updateCommand();
  // Show package list by default
  listAll(true);
}

main();
