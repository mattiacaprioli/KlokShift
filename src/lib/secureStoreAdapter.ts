const DEFAULT_CHUNK_SIZE_BYTES = 1800;
const MAX_CHUNKS = 128;
const MANIFEST_VERSION = 2;

export type SecureKeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

type Manifest = {
  version: typeof MANIFEST_VERSION;
  generation: string;
  count: number;
};

type AdapterOptions = {
  chunkSizeBytes?: number;
  createGeneration?: () => string;
};

function manifestKey(key: string) {
  return `${key}__v2_manifest`;
}

function partKey(key: string, generation: string, index: number) {
  return `${key}__v2_${generation}_${index}`;
}

function legacyCountKey(key: string) {
  return `${key}__chunks`;
}

function legacyPartKey(key: string, index: number) {
  return `${key}__chunk_${index}`;
}

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_CHUNKS;
}

function parseLegacyCount(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const count = Number(raw);
  return validCount(count) ? count : null;
}

function parseManifest(raw: string | null): Manifest | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== MANIFEST_VERSION ||
      !("generation" in value) ||
      typeof value.generation !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(value.generation) ||
      !("count" in value) ||
      !validCount(value.count)
    ) {
      return null;
    }
    return value as Manifest;
  } catch {
    return null;
  }
}

function codePointBytes(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;

  for (const character of value) {
    const size = codePointBytes(character);
    if (bytes + size > maxBytes && part !== "") {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += size;
  }
  parts.push(part);
  return parts;
}

async function readParts(
  store: SecureKeyValueStore,
  keys: string[]
): Promise<string | null> {
  const parts: string[] = [];
  for (const key of keys) {
    const part = await store.getItemAsync(key);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function bestEffortDelete(store: SecureKeyValueStore, keys: string[]) {
  for (const key of keys) {
    try {
      await store.deleteItemAsync(key);
    } catch {
      // La nuova generazione è già pubblicata: residui vecchi non devono
      // trasformare una scrittura riuscita in un errore di sessione.
    }
  }
}

function defaultGeneration() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Storage atomico sopra SecureStore.
 *
 * Ogni valore, anche piccolo, viene scritto in una generazione nuova. Il
 * manifest è pubblicato soltanto quando tutte le parti esistono; fino a quel
 * momento il lettore continua a vedere la generazione precedente. Le chiavi
 * senza manifest e il vecchio formato `__chunks` restano leggibili per non
 * invalidare sessioni installate prima di questa versione.
 */
export function createSecureStoreAdapter(
  store: SecureKeyValueStore,
  options: AdapterOptions = {}
) {
  const chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes < 4) {
    throw new Error("La dimensione dei chunk SecureStore deve essere almeno 4 byte");
  }
  const createGeneration = options.createGeneration ?? defaultGeneration;

  return {
    async getItem(key: string): Promise<string | null> {
      const manifest = parseManifest(await store.getItemAsync(manifestKey(key)));
      if (manifest) {
        const value = await readParts(
          store,
          Array.from({ length: manifest.count }, (_, index) =>
            partKey(key, manifest.generation, index)
          )
        );
        if (value !== null) return value;
      }

      const direct = await store.getItemAsync(key);
      if (direct !== null) return direct;

      const count = parseLegacyCount(await store.getItemAsync(legacyCountKey(key)));
      if (count === null) return null;
      return readParts(
        store,
        Array.from({ length: count }, (_, index) => legacyPartKey(key, index))
      );
    },

    async setItem(key: string, value: string): Promise<void> {
      const previousManifest = parseManifest(
        await store.getItemAsync(manifestKey(key))
      );
      const previousLegacyCount = parseLegacyCount(
        await store.getItemAsync(legacyCountKey(key))
      );
      const generation = createGeneration();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(generation)) {
        throw new Error("Generazione SecureStore non valida");
      }
      if (generation === previousManifest?.generation) {
        throw new Error("Generazione SecureStore già in uso");
      }
      const parts = splitUtf8(value, chunkSizeBytes);
      if (!validCount(parts.length)) {
        throw new Error("Valore SecureStore troppo grande");
      }
      const newPartKeys = parts.map((_, index) => partKey(key, generation, index));

      try {
        for (let index = 0; index < parts.length; index++) {
          await store.setItemAsync(newPartKeys[index], parts[index]);
        }
        await store.setItemAsync(
          manifestKey(key),
          JSON.stringify({ version: MANIFEST_VERSION, generation, count: parts.length })
        );
      } catch (error) {
        await bestEffortDelete(store, newPartKeys);
        throw error;
      }

      const obsoleteKeys = [key, legacyCountKey(key)];
      if (previousLegacyCount !== null) {
        obsoleteKeys.push(
          ...Array.from({ length: previousLegacyCount }, (_, index) =>
            legacyPartKey(key, index)
          )
        );
      }
      if (previousManifest && previousManifest.generation !== generation) {
        obsoleteKeys.push(
          ...Array.from({ length: previousManifest.count }, (_, index) =>
            partKey(key, previousManifest.generation, index)
          )
        );
      }
      await bestEffortDelete(store, obsoleteKeys);
    },

    async removeItem(key: string): Promise<void> {
      const manifest = parseManifest(await store.getItemAsync(manifestKey(key)));
      const legacyCount = parseLegacyCount(
        await store.getItemAsync(legacyCountKey(key))
      );
      const keys = [manifestKey(key), key, legacyCountKey(key)];
      if (manifest) {
        keys.push(
          ...Array.from({ length: manifest.count }, (_, index) =>
            partKey(key, manifest.generation, index)
          )
        );
      }
      if (legacyCount !== null) {
        keys.push(
          ...Array.from({ length: legacyCount }, (_, index) =>
            legacyPartKey(key, index)
          )
        );
      }

      let firstError: unknown;
      for (const itemKey of keys) {
        try {
          await store.deleteItemAsync(itemKey);
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    },
  };
}
