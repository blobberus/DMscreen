// A tiny event bus. bus.on('event', fn) returns an unsubscribe function.
const handlers = new Map();

export const bus = {
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event)?.delete(fn);
  },
  emit(event, payload) {
    for (const fn of handlers.get(event) || []) {
      try { fn(payload); } catch (e) { console.error(`[bus] ${event}`, e); }
    }
  },
};
