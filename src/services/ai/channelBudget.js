// Bounded per-channel hourly accounting. Active windows are never evicted to
// make space: at capacity, new channels wait until a window expires. In-flight
// work pins its bucket so a late completion cannot lose its accounting.
export function createChannelBudget({ now = Date.now, maxChannels = 2000, isBusy = () => false } = {}) {
 if (!Number.isSafeInteger(maxChannels) || maxChannels < 1) throw new RangeError('Invalid channel limit');
 const entries = new Map();
 let nextSweep = 0;
 const recent = (timestamps, time) => timestamps.filter(at => at > time - 3600000);
 function sweep() {
  const time = now(); nextSweep = time + 1000;
  for (const [id, timestamps] of entries) {
   const kept = recent(timestamps, time);
   if (!kept.length && !isBusy(id)) entries.delete(id);
   else entries.set(id, kept);
  }
 }
 function underLimit(id, limit) {
  const time = now(); let timestamps = entries.get(id);
  if (!timestamps) {
   if (entries.size >= maxChannels && time >= nextSweep) sweep();
   if (entries.size >= maxChannels) return false;
   timestamps = [];
  }
  timestamps = recent(timestamps, time); entries.set(id, timestamps);
  return timestamps.length < limit;
 }
 function record(id) {
  const timestamps = entries.get(id);
  if (!timestamps) throw new Error('Channel budget was not reserved');
  timestamps.push(now());
 }
 return { underLimit, record, sweep, get size() { return entries.size; } };
}
