const STORAGE_KEY = "milka_offline_write_queue_v1";

export function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeQueue(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items || []));
  } catch {}
}

export function enqueue(item) {
  const next = [...readQueue(), item];
  writeQueue(next);
  return next;
}

export function removeAt(index) {
  const items = readQueue();
  if (index < 0 || index >= items.length) return items;
  const next = items.filter((_, i) => i !== index);
  writeQueue(next);
  return next;
}
