import { ensureRepo, buildIndex } from './lib/indexer.js';

const offline = process.env.OFFLINE === '1';
ensureRepo({ verbose: true, offline });
buildIndex({ verbose: true });
