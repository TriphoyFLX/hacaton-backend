/**
 * Frees the configured PORT (default 5002) so `npm run dev` can bind reliably on Windows.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function loadEnvPort() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    const match = raw.match(/^\s*PORT\s*=\s*["']?(\d+)/m);
    if (match) return Number(match[1]);
  } catch {
    // ignore missing .env
  }
  return Number(process.env.PORT || 5002);
}

const port = loadEnvPort();

function pidsOnPort(p) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      if (!line.includes(`:${p}`)) continue;
      // Match local address ending with :port (avoid :50020 etc via word boundary after port)
      const m = line.match(new RegExp(`:\\s*${p}\\s+.*LISTENING\\s+(\\d+)\\s*$`, 'i'))
        || line.match(new RegExp(`:${p}\\s+.+LISTENING\\s+(\\d+)`, 'i'));
      if (m) pids.add(m[1]);
    }
    return [...pids].filter((id) => id && id !== '0');
  } catch {
    return [];
  }
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`[free-port] Port ${port} is free`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    console.log(`[free-port] Killed PID ${pid} on port ${port}`);
  } catch (err) {
    console.warn(`[free-port] Could not kill PID ${pid}:`, err.message || err);
  }
}

// Brief pause so Windows releases the socket
try {
  execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 400"', { stdio: 'ignore' });
} catch {
  // ignore
}

process.exit(0);
