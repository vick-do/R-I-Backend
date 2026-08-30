/**
 * A short-lived in-memory cache that also collapses concurrent duplicates.
 *
 * The second property is the important one. The dashboard's pages are read far
 * more often than the figures behind them change, and several readers arriving
 * together ask for exactly the same thing. Without this, twenty people opening
 * MEST X at once ran the same three aggregations twenty times over and queued
 * behind one connection pool — measured at seven to thirteen seconds each,
 * against two hundred milliseconds for a single reader.
 *
 * The promise is stored, not the result, so those twenty requests share one
 * query and all twenty are answered when it lands.
 *
 * Entries are short-lived by design. A stale figure is a wrong figure, so the
 * window is measured in seconds and every write path calls `invalidate`. The
 * TTL is a backstop for a path that forgets, not the mechanism.
 */
const store = new Map();

/** Runs `load` unless a fresh answer is already in hand or in flight. */
function memo(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const pending = Promise.resolve()
    .then(load)
    .then(
      (value) => {
        // Only keep it if this entry is still the current one — an invalidate
        // that landed mid-flight must not be undone by the result arriving.
        const current = store.get(key);
        if (current && current.value === pending) {
          store.set(key, { value, expires: Date.now() + ttlMs });
        }
        return value;
      },
      (err) => {
        if (store.get(key)?.value === pending) store.delete(key);
        throw err;
      }
    );

  store.set(key, { value: pending, expires: Date.now() + ttlMs });
  return pending;
}

/** Drops everything whose key starts with any of these prefixes. */
function invalidate(...prefixes) {
  if (prefixes.length === 0) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) store.delete(key);
  }
}

function size() {
  return store.size;
}

module.exports = { memo, invalidate, size };
