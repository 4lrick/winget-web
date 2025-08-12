export function setPackageFields(pkg) {
  return {
    PackageIdentifier: pkg.PackageIdentifier || '',
    Name: pkg.Name || '',
    Publisher: pkg.Publisher || '',
    Description: pkg.Description || '',
    Version: pkg.Version || '',
    Tags: pkg.Tags || [],
    Moniker: pkg.Moniker || '',
  };
}

function getSingleWordMatchType(query, name, id, moniker, tags) {
  const nameLower = (name || '').toLowerCase();
  const idLower = (id || '').toLowerCase();
  const monikerLower = (moniker || '').toLowerCase();
  const nameWords = nameLower.split(/\s+/).filter(Boolean);
  
  if (nameLower === query) return 1;
  if (monikerLower === query) return 2;
  if (tags && tags.some(tag => tag.toLowerCase() === query)) return 3;
  if (nameLower.startsWith(query)) return 4;
  if (nameWords.some(word => word === query || word.startsWith(query))) return 5;
  if (idLower === query) return 6;
  if (idLower.startsWith(query)) return 7;
  if (nameLower.includes(query)) return 8;
  if (idLower.includes(query)) return 9;
  if (tags && tags.some(tag => tag.toLowerCase().includes(query))) return 10;
  if (monikerLower.includes(query)) return 11;
  
  return null;
}

function getMultiWordMatchType(queryWords, name, id, moniker) {
  const nameLower = (name || '').toLowerCase();
  const idLower = (id || '').toLowerCase();
  const monikerLower = (moniker || '').toLowerCase();
  
  const allWordsInName = queryWords.every(word => nameLower.includes(word));
  const allWordsInId = queryWords.every(word => idLower.includes(word));
  const allWordsInMoniker = monikerLower && queryWords.every(word => monikerLower.includes(word));
  
  if (allWordsInName) return 3;
  if (allWordsInId) return 9;
  if (allWordsInMoniker) return 11;
  
  return null;
}

function getMatchType(query, name, id, moniker, tags) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  
  if (queryWords.length === 1) {
    return getSingleWordMatchType(queryWords[0], name, id, moniker, tags);
  }
  
  return getMultiWordMatchType(queryWords, name, id, moniker);
}

function getIdPriority(packageId) {
  const id = packageId.toLowerCase();
  const segments = id.split('.');
  
  if (segments.length === 2) return 0;

  return 1;
}

export function rankResults(packages, query, limit) {
  const cleanQuery = query.toLowerCase().trim();
  const ranked = [];
  
  for (const pkg of packages) {
    const fields = setPackageFields(pkg);
    const matchType = getMatchType(cleanQuery, fields.Name, fields.PackageIdentifier, fields.Moniker, fields.Tags);
    if (matchType !== null) {
      const idPriority = getIdPriority(fields.PackageIdentifier);
      ranked.push([matchType, idPriority, fields]);
    }
  }
  
  ranked.sort((entryA, entryB) => {
    if (entryA[0] !== entryB[0]) return entryA[0] - entryB[0];
    
    if (entryA[1] !== entryB[1]) return entryA[1] - entryB[1];
    
    const entryAId = (entryA[2].PackageIdentifier || '').toLowerCase();
    const entryBId = (entryB[2].PackageIdentifier || '').toLowerCase();
    return entryAId < entryBId ? -1 : entryAId > entryBId ? 1 : 0;
  });
  
  return ranked.slice(0, limit).map((entry) => entry[2]);
}