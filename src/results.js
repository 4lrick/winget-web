import { rankResults, setPackageFields } from './ranking.js';
import { PAGE_SIZE } from './app.js';

let state, elements, selectedFunctions;

export function init(appState, appElements, selectedModule) {
  state = appState;
  elements = appElements;
  selectedFunctions = selectedModule;
}

export async function loadPackageList() {
  if (state.packageList || state.packageListLoading) return;
  try {
    state.packageListLoading = true;
    const res = await fetch('./data/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    state.packageList = { total: items.length, items };
  } catch (e) {
    console.warn('Failed to load package list (data/index.json).', e);
    state.packageList = { total: 0, items: [] };
  } finally {
    state.packageListLoading = false;
  }
}

export async function searchPackages(query) {
  state.query = query.trim();
  
  const url = new URL(location.href);
  if (state.query) {
    url.searchParams.set('q', state.query);
  } else {
    url.searchParams.delete('q');
  }
  history.replaceState(null, '', url.toString());
  
  if (!state.query) {
    state.results = [];
    state.listOffset = 0;
    state.hasMore = false;
    listAll(true);
    return;
  } else {
    state.searchVisibleCount = PAGE_SIZE;
  }

  await loadPackageList();
  const all = state.packageList?.items || [];
  state.results = rankResults(all, state.query, all.length);
  renderResults();
}

export async function listAll(reset = false) {
  if (reset) {
    state.results = [];
    state.listOffset = 0;
    state.hasMore = false;
  }
  const limit = PAGE_SIZE;
  const offset = state.listOffset;
  try {
    await loadPackageList();
    const all = (state.packageList?.items || []).map(setPackageFields);
    const slice = all.slice(offset, offset + limit);
    state.results = state.results.concat(slice);
    state.listOffset += slice.length;
    state.hasMore = offset + slice.length < all.length;
  } catch (e) {
    console.warn('Failed to load results: ', e);
    state.hasMore = false;
  }
  renderResults();
}

function renderLoadingState(container, text = 'Loading package list…') {
  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'empty';
  loading.textContent = text;
  container.appendChild(loading);
  container.classList.add('is-empty');
}

function renderEmptyState(container, text = 'No results.') {
  container.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  container.appendChild(empty);
  container.classList.add('is-empty');
}

function getVisibleResults() {
  if (!state.query) return state.results;
  return state.results.slice(0, state.searchVisibleCount);
}

function buildResultItem(pkg) {
  const resultItem = document.createElement('div');
  resultItem.className = 'result-item';

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
    for (const tag of pkg.Tags) {
      const tagElement = document.createElement('span');
      tagElement.className = 'tag';
      tagElement.textContent = tag;
      tags.appendChild(tagElement);
    }
    left.appendChild(tags);
  }

  const right = document.createElement('div');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'select-checkbox';
  checkbox.checked = state.selected.has(pkg.PackageIdentifier);
  checkbox.setAttribute('aria-label', checkbox.checked ? 'Deselect' : 'Select');
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedFunctions.addSelected(pkg);
    else selectedFunctions.removeSelected(pkg.PackageIdentifier);
    renderResults();
  });
  right.appendChild(checkbox);

  resultItem.appendChild(left);
  resultItem.appendChild(right);
  return resultItem;
}

function renderMoreResults(container) {
  const canRevealMoreSearch = state.query && state.results.length > state.searchVisibleCount;
  const canLoadMoreBrowse = !state.query && state.hasMore;
  if (!canRevealMoreSearch && !canLoadMoreBrowse) return;
  const moreWrapper = document.createElement('div');
  moreWrapper.style.padding = '12px';
  const moreButton = document.createElement('button');
  moreButton.className = 'btn secondary';
  moreButton.textContent = 'Show more';
  moreButton.addEventListener('click', () => {
    if (canLoadMoreBrowse) listAll(false);
    else revealMoreSearchResults();
  });
  moreWrapper.appendChild(moreButton);
  container.appendChild(moreWrapper);
}

export function revealMoreSearchResults() {
  state.searchVisibleCount += PAGE_SIZE;
  renderResults();
}

export function restoreSearchFromUrl() {
  const url = new URL(location.href);
  const query = url.searchParams.get('q');
  if (query) {
    elements.search.value = query;
    return query;
  }
  return '';
}

export function renderResults() {
  const resultsContainer = elements.results;
  resultsContainer.innerHTML = '';
  if (state.packageListLoading) { renderLoadingState(resultsContainer); return; }
  if (!state.results.length) { renderEmptyState(resultsContainer, 'No results.'); return; }
  resultsContainer.classList.remove('is-empty');
  const visible = getVisibleResults();
  
  for (const pkg of visible) resultsContainer.appendChild(buildResultItem(pkg));

  renderMoreResults(resultsContainer);
}
