// @ts-check
// Variant C — pure code: models, textures, layout and effects are all generated at runtime.
// The page downloads no asset files at all.
import * as THREE from 'three';
import { start } from '../game.js';
import { generateLayout } from '../layout.js';
import arena from '../models/arena.js';
import barrel from '../models/barrel.js';
import bolt from '../models/bolt.js';
import crate from '../models/crate.js';
import drone from '../models/drone.js';

/** Run a generator and record how long it took (__bench.generate, ms). @template T @param {string} name @param {() => T} fn */
const timed = (name, fn) => {
  const t = performance.now(), out = fn();
  /** @type {any} */ (globalThis).__bench.generate = { .../** @type {any} */ (globalThis).__bench.generate, [name]: performance.now() - t };
  return out;
};

start({
  name: 'code',
  load: async () => ({
    arena: timed('arena', () => arena(THREE)), crate: timed('crate', () => crate(THREE)), barrel: timed('barrel', () => barrel(THREE)),
    drone: timed('drone', () => drone(THREE)), bolt: timed('bolt', () => bolt(THREE)), layout: timed('layout', () => generateLayout()),
    flipbook: null, sprite: null, // null: effects drawn by shaders
  }),
});
