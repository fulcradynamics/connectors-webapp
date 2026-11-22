import { it, expect } from 'vitest';
import { mergeDiscoveredSources } from './source-options.js';
it('updates names on pagination and replaces stale rows on a fresh discovery', () => {
  const old = [
    { id: 'one', name: 'Old title' },
    { id: 'gone', name: 'Removed' }
  ];
  const page = [
    { id: 'one', name: 'New title' },
    { id: 'two', name: 'Second' }
  ];
  expect(mergeDiscoveredSources(old, page, true)).toEqual([
    { id: 'one', name: 'New title' },
    { id: 'gone', name: 'Removed' },
    { id: 'two', name: 'Second' }
  ]);
  expect(mergeDiscoveredSources(old, page, false)).toEqual([
    { id: 'one', name: 'New title' },
    { id: 'two', name: 'Second' }
  ]);
  expect(old[0].name).toBe('Old title');
});
