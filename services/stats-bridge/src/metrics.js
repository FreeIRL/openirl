const METRIC_LINE =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)$/;

function decodeLabel(value) {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\" || index === value.length - 1) {
      decoded += value[index];
      continue;
    }

    index += 1;
    const escaped = value[index];
    decoded += escaped === "n" ? "\n" : escaped;
  }

  return decoded;
}

export function parsePrometheus(text) {
  const samples = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = METRIC_LINE.exec(line);
    if (!match) continue;

    const [, name, rawLabels = "", rawValue] = match;
    const labels = {};

    for (const labelMatch of rawLabels.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g)) {
      labels[labelMatch[1]] = decodeLabel(labelMatch[2]);
    }

    const value = Number(rawValue);
    samples.push({ name, labels, value });
  }

  return samples;
}

export function findSample(samples, name, labels) {
  return samples.find(
    (sample) =>
      sample.name === name &&
      Object.entries(labels).every(([key, value]) => sample.labels[key] === value),
  );
}

export class FeedTracker {
  #previous;

  sample({ bytes, connected, timestamp = Date.now() }) {
    let bitrate = 0;

    if (
      this.#previous &&
      timestamp > this.#previous.timestamp &&
      bytes >= this.#previous.bytes
    ) {
      bitrate = Math.round(
        ((bytes - this.#previous.bytes) * 8) /
          (timestamp - this.#previous.timestamp),
      );
    }

    this.#previous = { bytes, timestamp };
    return { bitrate, connected };
  }
}
