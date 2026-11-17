// debugLog.js — Opt-in diagnostics for the host. Off by default: nothing is written unless AI_DEBUG is set to 1/true/yes/on.
// Never logs message content, tokens or any personal data — only event names, IDs and reasons.
import { logger } from './logger.js';
const enabled = /^(1|true|yes|on)$/i.test(String(process.env.AI_DEBUG || '').trim());
export function isDebug() { return enabled; }
export function debugLog(...parts) {
  if (!enabled) return;
  logger.info(['[debug]', ...parts.map(part => { try { return typeof part === 'string' ? part : JSON.stringify(part); } catch { return String(part); } })].join(' '));
}
