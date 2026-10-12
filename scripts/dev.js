/**
 * VehicleGPT + Halo Bonded Dev Runner
 * Starts both VehicleGPT Python backend (port 8765) and Halo Next.js frontend (port 3000)
 * in a single unified command (`npm run dev`).
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');
const VEHICLEGPT_DIR = path.join(ROOT_DIR, 'vehiclegpt');

// ANSI Colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function log(prefix, color, message) {
  const lines = message.toString().split('\n');
  for (const line of lines) {
    if (line.trim().length > 0) {
      console.log(`${color}${BOLD}[${prefix}]${RESET} ${line}`);
    }
  }
}

/** Free up any stale process occupying port 3000 or 8765 */
function freePort(port) {
  if (os.platform() === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const state = parts[3];
        const pid = parts[parts.length - 1];
        if (state === 'LISTENING' && pid && pid !== '0' && pid !== String(process.pid)) {
          console.log(`${YELLOW}Cleaning up stale process PID ${pid} on port ${port}...${RESET}`);
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    } catch {
      // Port already free
    }
  }
}

console.log(`\n${CYAN}${BOLD}============================================================${RESET}`);
console.log(`${CYAN}${BOLD}   🚗 VehicleGPT + Halo Car Experience — Bonded Dev Server${RESET}`);
console.log(`${CYAN}${BOLD}   Frontend: http://localhost:3000${RESET}`);
console.log(`${CYAN}${BOLD}   Backend:  http://localhost:8765${RESET}`);
console.log(`${CYAN}${BOLD}============================================================${RESET}\n`);

// Free up ports before launch to guarantee port 3000
freePort(3000);
freePort(8765);

let pythonProc = null;
let nextProc = null;

// ── 1. Start VehicleGPT Backend ──────────────────────────────
console.log(`${GREEN}Starting VehicleGPT Python Backend...${RESET}`);
pythonProc = spawn('python', ['vehiclegpt/main.py'], {
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
  shell: true,
});

pythonProc.stdout.on('data', (d) => log('VehicleGPT', GREEN, d));
pythonProc.stderr.on('data', (d) => log('VehicleGPT', YELLOW, d));
pythonProc.on('error', (err) => {
  log('VehicleGPT', RED, `Backend error: ${err.message}`);
});
pythonProc.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    log('VehicleGPT', RED, `Backend exited with code ${code}`);
  }
});

// ── 2. Start Next.js Frontend on port 3000 ───────────────────
console.log(`${MAGENTA}Starting Halo Next.js Frontend on http://localhost:3000...${RESET}`);
const nextBin = path.join(ROOT_DIR, 'node_modules', '.bin', os.platform() === 'win32' ? 'next.cmd' : 'next');

nextProc = spawn(nextBin, ['dev', '-p', '3000'], {
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    PORT: '3000',
    NEXT_TELEMETRY_DISABLED: '1',
  },
  shell: true,
});

nextProc.stdout.on('data', (d) => log('Halo Next.js', MAGENTA, d));
nextProc.stderr.on('data', (d) => log('Halo Next.js', RED, d));
nextProc.on('error', (err) => {
  log('Halo Next.js', RED, `Frontend error: ${err.message}`);
});

// ── Clean Shutdown ───────────────────────────────────────────
function cleanup() {
  console.log(`\n${YELLOW}Shutting down VehicleGPT and Halo servers...${RESET}`);
  if (pythonProc) {
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /F /T /PID ${pythonProc.pid}`, { stdio: 'ignore' });
      } else {
        pythonProc.kill('SIGINT');
      }
    } catch {}
  }
  if (nextProc) {
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /F /T /PID ${nextProc.pid}`, { stdio: 'ignore' });
      } else {
        nextProc.kill('SIGINT');
      }
    } catch {}
  }
  freePort(3000);
  freePort(8765);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
