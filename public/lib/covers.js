const MAX_BYTES = 300_000;
const TYPE = 'image/jpeg';
let connection;

function open() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('xenotravel-covers', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('covers');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

async function access(mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', mode);
    const request = operation(tx.objectStore('covers'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}

export const get = (id) => access('readonly', (store) => store.get(id));
export const put = (id, blob) => access('readwrite', (store) => store.put(blob, id));
export const remove = (id) => access('readwrite', (store) => store.delete(id));
export const clear = () => access('readwrite', (store) => store.clear());

export function cropRect(width, height) {
  const w = Math.min(width, height * 16 / 9);
  const h = Math.min(height, width * 9 / 16);
  return [(width - w) / 2, (height - h) / 2, w, h];
}

export async function compress(file) {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const crop = cropRect(image.width, image.height);
    for (const width of [1280, 960, 640, 320]) {
      canvas.width = width;
      canvas.height = width * 9 / 16;
      ctx.drawImage(image, ...crop, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.72, 0.55]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, TYPE, quality));
        if (blob?.type === TYPE && blob.size <= MAX_BYTES) return blob;
      }
    }
    throw new Error('Cover compression failed');
  } finally {
    image.close();
  }
}

export function encode(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function decode(value) {
  const prefix = `data:${TYPE};base64,`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > prefix.length + 4 * Math.ceil(MAX_BYTES / 3)) {
    throw new Error('Invalid cover');
  }
  const bytes = Uint8Array.from(atob(value.slice(prefix.length)), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid cover');
  const blob = new Blob([bytes], { type: TYPE });
  const image = await createImageBitmap(blob);
  const valid = image.width <= 1280 && image.width * 9 === image.height * 16;
  image.close();
  if (!valid) throw new Error('Invalid cover dimensions');
  return blob;
}
