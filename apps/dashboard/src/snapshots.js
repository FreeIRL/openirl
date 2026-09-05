import { spawn } from 'node:child_process';

export function capture(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-rw_timeout', '5000000',
      '-i', url,
      '-an',
      '-frames:v', '1',
      '-vf', 'scale=640:-2',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let size = 0;
    const chunks = [];

    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);

    child.stdout.on('data', chunk => {
      size += chunk.length;

      if (size > 2 * 1024 * 1024) {
        child.kill('SIGKILL');
      } else {
        chunks.push(chunk);
      }
    });

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(timer);

      const image = Buffer.concat(chunks);

      if (code === 0 && image[0] === 0xff && image[1] === 0xd8) {
        resolve(image);
      } else {
        reject(new Error('Snapshot unavailable'));
      }
    });
  });
}

export class Snapshots {
  constructor({
    intervalMs = 10000,
    reader = capture,
    baseUrl = 'srt://127.0.0.1:8890?streamid=read:'
  } = {}) {
    Object.assign(this, { intervalMs, reader, baseUrl });

    this.frames = new Map();
    this.attempts = new Map();
    this.running = new Set();
  }

  status(id, now = Date.now()) {
    const frame = this.frames.get(id);

    return {
      available: Boolean(frame),
      stale: Boolean(frame && now - frame.at > 30000),
      format: 'jpeg',
      capturedAt: frame?.at || null,
      url: frame ? `/api/v1/snapshots/${id}?v=${frame.at}` : null,
      note: frame
        ? 'Last successfully received frame'
        : 'Waiting for an ingest snapshot'
    };
  }

  async refresh(feed, health, now = Date.now()) {
    if (
      !feed.enabled ||
      !['ONLINE', 'DEGRADED', 'CONNECTING'].includes(health?.state)
    ) {
      return false;
    }

    if (
      this.running.size >= 2 ||
      this.running.has(feed.id) ||
      now - (this.attempts.get(feed.id) ?? -Infinity) < this.intervalMs
    ) {
      return false;
    }

    this.attempts.set(feed.id, now);
    this.running.add(feed.id);

    try {
      const image = await this.reader(`${this.baseUrl}${feed.path}`);

      this.frames.set(feed.id, {
        image,
        at: Date.now()
      });

      return true;
    } catch {
      return false;
    } finally {
      this.running.delete(feed.id);
    }
  }

  prune(feeds) {
    const ids = new Set(feeds.map(feed => feed.id));

    for (const id of this.frames.keys()) {
      if (!ids.has(id)) {
        this.frames.delete(id);
      }
    }

    for (const id of this.attempts.keys()) {
      if (!ids.has(id)) {
        this.attempts.delete(id);
      }
    }
  }
}
