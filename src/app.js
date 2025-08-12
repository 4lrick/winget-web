import { searchPackages, listAll, restoreSearchFromUrl, init as initResults } from './results.js';
import * as selected from './selected.js';

const $ = (sel) => document.querySelector(sel);

export const PAGE_SIZE = 5;

export const state = {
  query: '',
  results: [],
  selected: new Map(),
  listOffset: 0,
  hasMore: false,
  searchVisibleCount: PAGE_SIZE,
  packageList: null,
  packageListLoading: false,
};

export const elements = {
  search: $('#searchInput'),
  results: $('#results'),
  selectedList: $('#selectedList'),
  selectedCount: $('#selectedCount'),
  clearSelected: $('#clearSelected'),
  exportJson: $('#exportJson'),
  exportPs1: $('#exportPs1'),
  copyPs1: $('#copyPs1'),
  importCommand: $('#importCommand'),
};

function bind() {
  elements.search.addEventListener('input', (e) => searchPackages(e.target.value));
  elements.clearSelected.addEventListener('click', selected.clearSelected);
  elements.exportJson.addEventListener('click', selected.exportJson);
  elements.exportPs1.addEventListener('click', selected.exportPs1);
  elements.copyPs1.addEventListener('click', selected.copyPs1);
}

async function main() {
  initResults(state, elements, selected);
  selected.init(state, elements);
  bind();
  
  const searchQuery = restoreSearchFromUrl();
  selected.restoreFromUrl();
  await selected.hydrateSelectedFromIndex();
  selected.renderSelected();
  if (state.selected.size) selected.updateCommand();
  
  if (searchQuery) {
    searchPackages(searchQuery);
  } else {
    listAll(true);
  }
}

main();