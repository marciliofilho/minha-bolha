/**
 * Ponte para o binário nativo do WebRTC.
 *
 * O `webrtc-polyfill` importa `node-datachannel` estaticamente. No bundle ESM
 * isso vira um import que não respeita o NODE_PATH. Este shim usa `require`
 * dinâmico, com caminho absoluto definido pelo processo principal no app
 * empacotado e fallback para o node_modules no desenvolvimento.
 */
import { createRequire } from 'node:module';

const requireModule = createRequire(import.meta.url);
const target = process.env.HUB_NODE_DATACHANNEL?.trim() || 'node-datachannel';

interface NodeDataChannel {
  PeerConnection: unknown;
  RtcpReceivingSession: unknown;
  Video: unknown;
  Audio: unknown;
  cleanup: unknown;
}

const native = requireModule(target) as NodeDataChannel;

export const PeerConnection = native.PeerConnection;
export const RtcpReceivingSession = native.RtcpReceivingSession;
export const Video = native.Video;
export const Audio = native.Audio;
export const cleanup = native.cleanup;

export default native;
