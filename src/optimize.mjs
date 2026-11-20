// @ts-check
// GLB post-processing in Node: dedup + EXT_meshopt_compression (quantizes positions, so expect ~1e-4 drift).
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * @param {Uint8Array} glb
 * @returns {Promise<Buffer>}
 */
export async function meshoptGLB(glb) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(glb);
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  await doc.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return Buffer.from(await io.writeBinary(doc));
}
