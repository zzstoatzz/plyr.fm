import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { RequireContext } from 'expo-router/build/types';
import type { getRoutes as buildRouteTree } from 'expo-router/build/getRoutes';
import type { getNavigationConfig as buildNavigationConfig } from 'expo-router/build/getLinkingConfig';
import type { getStateFromPath as parsePath } from 'expo-router/build/fork/getStateFromPath';

const require = createRequire(import.meta.url);
const { getRoutes } = require('expo-router/build/getRoutes') as { getRoutes: typeof buildRouteTree };
const { getNavigationConfig } = require('expo-router/build/getLinkingConfig') as { getNavigationConfig: typeof buildNavigationConfig };
const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath') as { getStateFromPath: typeof parsePath };

const keys = readdirSync(new URL('../app/', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter(file => /\.tsx?$/.test(file))
  .map(file => './' + file);
const context = Object.assign(() => ({ default: () => null }), { keys: () => keys, resolve: (id: string) => id, id: 'native-test-routes' }) as RequireContext;
const tree = getRoutes(context, { platform: 'ios' });
assert.ok(tree);
const config = getNavigationConfig(tree, true, { sitemap: false, notFound: false });

function focusedRoutes(path: string, from: string[] = []) {
  const names: string[] = [];
  let state = getStateFromPath(path, config, from);
  while (state) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    names.push(route.name);
    state = route.state;
  }
  return names.slice(1);
}

test('a shared detail keeps its source tab, and cold track links open in Home', () => {
  assert.deepEqual(focusedRoutes('/track/1667', ['(main)', '(search)', 'search']), ['(main)', '(search)', 'track/[id]']);
  assert.deepEqual(focusedRoutes('/track/1667'), ['(main)', '(home)', 'track/[id]']);
  assert.deepEqual(focusedRoutes('/queue', ['(main)', '(library)', 'library']), ['(main)', '(library)', 'queue']);
});

test('an upload link works while the Upload tab is hidden', () => {
  assert.deepEqual(focusedRoutes('/upload?visibility=only-you'), ['(main)', '(home)', 'upload']);
  assert.deepEqual(focusedRoutes('/(main)/(publish)/upload'), ['(main)', '(publish)', 'upload']);
});

test('the OAuth callback stays reachable above the tabs', () => {
  assert.deepEqual(focusedRoutes('/oauth/callback'), ['oauth/callback']);
});
