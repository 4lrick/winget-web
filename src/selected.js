import { setPackageFields } from './ranking.js';
import { loadPackageList } from './results.js';

let state, elements;

export function init(appState, appElements) {
  state = appState;
  elements = appElements;
}

export function addSelected(pkg) {
  if (!pkg?.PackageIdentifier) return;
  if (!state.selected.has(pkg.PackageIdentifier)) {
    state.selected.set(pkg.PackageIdentifier, pkg);
    renderSelected();
    updateCommand();
    syncUrl();
  }
}

export function removeSelected(id) {
  state.selected.delete(id);
  renderSelected();
  updateCommand();
  syncUrl();
}

export function clearSelected() {
  state.selected.clear();
  renderSelected();
  updateCommand();
  syncUrl();
}

let draggedElement = null;
let draggedIndex = -1;

function handleDragStart(e) {
  draggedElement = this;
  draggedIndex = parseInt(this.dataset.index);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.outerHTML);
}

function handleDragOver(e, elements) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const targetIndex = parseInt(this.dataset.index);
  if (draggedIndex === targetIndex) return;
  
  elements.selectedList.querySelectorAll('.selected-item').forEach(item => {
    item.classList.remove('drop-above', 'drop-below');
  });
  
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
  
  const selectedArray = Array.from(state.selected.entries());
  const [draggedId] = selectedArray[draggedIndex];
  
  selectedArray.splice(draggedIndex, 1);
  selectedArray.splice(targetIndex, 0, [draggedId, state.selected.get(draggedId)]);
  
  state.selected.clear();
  for (const [id, pkg] of selectedArray) {
    state.selected.set(id, pkg);
  }
  
  renderSelected();
  syncUrl();
  updateCommand();
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  
  elements.selectedList.querySelectorAll('.selected-item').forEach(item => {
    item.classList.remove('drop-above', 'drop-below');
  });
  
  draggedElement = null;
  draggedIndex = -1;
}

export function renderSelected() {
  elements.selectedList.innerHTML = '';
  const selectedArray = Array.from(state.selected.entries());
  
  for (let i = 0; i < selectedArray.length; i++) {
    const [id, pkg] = selectedArray[i];
    const li = document.createElement('li');
    li.className = 'selected-item';
    li.draggable = true;
    li.dataset.id = id;
    li.dataset.index = i;
    
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
    
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', (e) => handleDragOver.call(li, e, elements));
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);
    
    elements.selectedList.appendChild(li);
  }
  elements.selectedCount.textContent = String(state.selected.size);
}

export function buildWingetImportJson() {
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

export function buildInstallPs1() {
  const ids = Array.from(state.selected.keys());
  const parts = ids.map((id) => `winget install -e --id ${id}`);
  return parts.join(';');
}

export function buildTimestampedFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const ts = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  return `winget-export-${ts}.json`;
}

export function download(filename, dataStr, mime = 'application/json') {
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

export function exportJson() {
  if (state.selected.size === 0) {
    alert('No packages selected.');
    return;
  }
  const data = buildWingetImportJson();
  const filename = buildTimestampedFilename();
  download(filename, JSON.stringify(data, null, 2));
  elements.importCommand.textContent = `winget import --import-file "${filename}"`;
}

export function exportPs1() {
  if (state.selected.size === 0) {
    alert('No packages selected.');
    return;
  }
  const ps1 = buildInstallPs1();
  const jsonName = buildTimestampedFilename();
  const ps1Name = jsonName.replace(/\.json$/i, '.ps1');
  download(ps1Name, ps1, 'application/x-powershell');
}

export async function copyPs1() {
  if (state.selected.size === 0) {
    alert('No packages selected.');
    return;
  }
  const ps1 = buildInstallPs1();
  try {
    await navigator.clipboard.writeText(ps1);
    const prevHtml = elements.copyPs1.innerHTML;
    elements.copyPs1.disabled = true;
    elements.copyPs1.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20.9 7.1l-1.4-1.4z"/></svg>';
    setTimeout(() => {
      elements.copyPs1.innerHTML = prevHtml;
      elements.copyPs1.disabled = false;
    }, 1000);
  } catch {
    alert('Copy failed. Your browser may not permit clipboard access.');
  }
}

export function updateCommand() {
  if (state.selected.size === 0) {
    elements.importCommand.textContent = 'winget import --import-file "winget-export-YYYYMMDD.json"';
    return;
  }
  const filename = buildTimestampedFilename();
  elements.importCommand.textContent = `winget import --import-file "${filename}"`;
}

export function syncUrl() {
  const ids = Array.from(state.selected.keys());
  const url = new URL(location.href);
  if (ids.length) url.searchParams.set('ids', ids.join(','));
  else url.searchParams.delete('ids');
  history.replaceState(null, '', url.toString());
}

export function restoreFromUrl() {
  const url = new URL(location.href);
  const ids = url.searchParams.get('ids');
  if (!ids) return;
  const set = ids.split(',').filter(Boolean);
  for (const id of set) {
    state.selected.set(id, { PackageIdentifier: id, Name: id });
  }
}

export async function hydrateSelectedFromIndex() {
  if (state.selected.size === 0) return;
  await loadPackageList();
  const map = new Map((state.packageList?.items || []).map((p) => [String(p.PackageIdentifier || '').toLowerCase(), setPackageFields(p)]));
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
