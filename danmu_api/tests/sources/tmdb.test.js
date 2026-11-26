import test from 'node:test';
import assert from 'node:assert/strict';
import TmdbSource from '../../sources/tmdb.js';
import { Globals } from '../../configs/globals.js';
import { withMockFetch } from '../helpers/context.js';

test('TMDB source skips network search when API key is missing', async () => {
  const previousApiKey = process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEY;
  Globals.init({ TMDB_API_KEY: '' });

  let requestCount = 0;
  try {
    const result = await withMockFetch(async () => {
      requestCount++;
      throw new Error('TMDB request should not be made without an API key');
    }, () => new TmdbSource({}).search('Resident Evil'));

    assert.deepEqual(result, []);
    assert.equal(requestCount, 0, 'missing API key must not trigger unauthenticated TMDB requests');
  } finally {
    if (previousApiKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousApiKey;
    Globals.init({});
  }
});

test('TMDB source ignores an empty search keyword without network requests', async () => {
  const previousApiKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'test-key';
  Globals.init({ TMDB_API_KEY: 'test-key' });

  let requestCount = 0;
  try {
    const result = await withMockFetch(async () => {
      requestCount++;
      throw new Error('empty query should not trigger TMDB requests');
    }, () => new TmdbSource({}).search('   '));

    assert.deepEqual(result, []);
    assert.equal(requestCount, 0);
  } finally {
    if (previousApiKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousApiKey;
    Globals.init({});
  }
});
