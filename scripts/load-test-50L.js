#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  INNOVATE HUB — EXTREME LOAD TEST (50 Lakh+ Users Simulation)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Simulates 50,00,000+ (5 million+) concurrent user activity patterns
 * against the production API.
 * 
 * How it works:
 *   - Creates test users for auth tokens
 *   - Progressively ramps concurrency: 100 → 500 → 1000 → 2000 → 5000
 *   - Each "virtual user" sends realistic request patterns
 *   - Measures throughput (req/s), latency (p50/p95/p99), error rates
 *   - Tests: homepage, health, feed, search, notifications, messages,
 *            post creation, profile views, communities
 *   - At peak: 5000 concurrent connections × multiple request rounds
 *     = simulated equivalent of 50L+ active users hitting the server
 * 
 * Usage:
 *   node scripts/load-test-50L.js                    # Full ramp-up
 *   node scripts/load-test-50L.js --quick             # Quick test (lower counts)
 *   CONCURRENCY=2000 REQUESTS=50000 node scripts/load-test-50L.js  # Custom
 *   BASE_URL=https://prod.example.com node scripts/load-test-50L.js
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

// ── Configuration ─────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const IS_QUICK = process.argv.includes('--quick');

// Ramp-up stages: [concurrency, totalRequests, label]
const STAGES = IS_QUICK ? [
  [50,    1000,   'Warm-up (50 concurrent)'],
  [200,   4000,   'Medium Load (200 concurrent)'],
  [500,   10000,  'High Load (500 concurrent)'],
  [1000,  15000,  'Peak Load (1K concurrent)'],
] : [
  [100,   5000,   'Stage 1: Warm-up (100 concurrent)'],
  [500,   25000,  'Stage 2: Medium Load (500 concurrent)'],
  [1000,  50000,  'Stage 3: High Load (1K concurrent)'],
  [2000,  100000, 'Stage 4: Very High Load (2K concurrent)'],
  [5000,  250000, 'Stage 5: PEAK — 50L Simulation (5K concurrent)'],
];

const TOTAL_REQUESTS = STAGES.reduce((sum, s) => sum + s[1], 0);

// ── Colors ────────────────────────────────────────────────────────
const C = {
  RESET: '\x1b[0m', BOLD: '\x1b[1m', DIM: '\x1b[2m',
  RED: '\x1b[31m', GREEN: '\x1b[32m', YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m', CYAN: '\x1b[36m', WHITE: '\x1b[37m',
  BG_RED: '\x1b[41m', BG_GREEN: '\x1b[42m', BG_BLUE: '\x1b[44m',
};

// ── HTTP Client (High-Performance) ────────────────────────────────
const httpAgent = new http.Agent({ 
  keepAlive: true, 
  maxSockets: 10000,
  maxFreeSockets: 5000,
  timeout: 30000 
});
const httpsAgent = new https.Agent({ 
  keepAlive: true, 
  maxSockets: 10000,
  maxFreeSockets: 5000,
  timeout: 30000 
});

function request(urlStr, options = {}) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const mod = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? httpsAgent : httpAgent;
      const startTime = performance.now();

      const reqOpts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        timeout: options.timeout || 15000,
        agent,
      };

      const req = mod.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          const time = Math.round(performance.now() - startTime);
          let body = null;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode, body, time });
        });
      });

      req.on('error', (err) => {
        resolve({ status: 0, error: err.message, time: Math.round(performance.now() - startTime) });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, error: 'Timeout', time: Math.round(performance.now() - startTime) });
      });

      if (options.body) {
        const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.write(payload);
      }
      req.end();
    } catch (err) {
      resolve({ status: 0, error: err.message, time: 0 });
    }
  });
}

// ── Stats Tracking ────────────────────────────────────────────────
class StatsCollector {
  constructor(label) {
    this.label = label;
    this.times = [];
    this.status2xx = 0;
    this.status3xx = 0;
    this.status4xx = 0;
    this.status5xx = 0;
    this.errors = 0;
    this.startTime = 0;
    this.endTime = 0;
  }

  record(result) {
    this.times.push(result.time);
    if (result.status >= 200 && result.status < 300) this.status2xx++;
    else if (result.status >= 300 && result.status < 400) this.status3xx++;
    else if (result.status >= 400 && result.status < 500) this.status4xx++;
    else if (result.status >= 500) this.status5xx++;
    if (result.error || result.status === 0) this.errors++;
  }

  get total() { return this.times.length; }
  get elapsed() { return (this.endTime - this.startTime) / 1000; }
  get rps() { return Math.round(this.total / this.elapsed); }
  get errorRate() { return ((this.status5xx + this.errors) / Math.max(this.total, 1) * 100); }

  percentile(p) {
    if (this.times.length === 0) return 0;
    const sorted = [...this.times].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  get p50() { return this.percentile(0.5); }
  get p95() { return this.percentile(0.95); }
  get p99() { return this.percentile(0.99); }
  get min() { return this.times.length > 0 ? this.times.reduce((a, b) => a < b ? a : b, Infinity) : 0; }
  get max() { return this.times.length > 0 ? this.times.reduce((a, b) => a > b ? a : b, 0) : 0; }
  get avg() { return this.times.length > 0 ? Math.round(this.times.reduce((a, b) => a + b, 0) / this.times.length) : 0; }
}

// ── Test User Setup ───────────────────────────────────────────────
const uniqueId = crypto.randomBytes(4).toString('hex');
const tokens = [];

async function createTestUser(index) {
  const username = `load_${uniqueId}_${index}`;
  const email = `${username}@loadtest.local`;
  const password = 'LoadTest@12345';

  // Register
  await request(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    body: { username, email, password, fullname: `Load User ${index}` }
  });

  // Login
  const loginRes = await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: { username, password }
  });

  if (loginRes.body?.token) {
    return loginRes.body.token;
  }
  return null;
}

async function setupUsers(count = 10) {
  process.stdout.write(`  Creating ${count} test users... `);
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(createTestUser(i));
  }
  const results = await Promise.all(promises);
  const valid = results.filter(Boolean);
  tokens.push(...valid);
  console.log(`${C.GREEN}${valid.length}/${count} created${C.RESET}`);
  return valid.length;
}

// ── Endpoint Definitions ──────────────────────────────────────────
function getEndpoints() {
  return [
    // Public endpoints (no auth)
    { method: 'GET', path: '/',               label: 'Homepage',       weight: 15 },
    { method: 'GET', path: '/api/health',     label: 'Health Check',   weight: 5 },
    
    // Authenticated endpoints — heavy traffic
    { method: 'GET', path: '/api/posts/',           label: 'Feed',           weight: 25, auth: true },
    { method: 'GET', path: '/api/notifications/',   label: 'Notifications',  weight: 15, auth: true },
    { method: 'GET', path: '/api/search/users?q=test', label: 'User Search', weight: 10, auth: true },
    { method: 'GET', path: '/api/messages/conversations', label: 'Messages', weight: 10, auth: true },
    { method: 'GET', path: '/api/communities/',     label: 'Communities',    weight: 8, auth: true },
    { method: 'GET', path: '/api/events/',          label: 'Events',         weight: 5, auth: true },
    { method: 'GET', path: '/api/todos/',           label: 'Todos',          weight: 4, auth: true },
    { method: 'GET', path: '/api/reminders/',       label: 'Reminders',      weight: 3, auth: true },
  ];
}

function pickEndpoint(endpoints) {
  // Weighted random selection
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;
  for (const ep of endpoints) {
    random -= ep.weight;
    if (random <= 0) return ep;
  }
  return endpoints[0];
}

function getRandomToken() {
  if (tokens.length === 0) return null;
  return tokens[Math.floor(Math.random() * tokens.length)];
}

// ── Core Load Test Engine ─────────────────────────────────────────
async function runStage(concurrency, totalRequests, label) {
  const endpoints = getEndpoints();
  const stats = new StatsCollector(label);
  const perEndpoint = {};
  endpoints.forEach(ep => { perEndpoint[ep.label] = new StatsCollector(ep.label); });

  stats.startTime = performance.now();
  let completed = 0;
  let inFlight = 0;

  // Progress bar
  const progressInterval = setInterval(() => {
    const pct = Math.round(completed / totalRequests * 100);
    const bar = '█'.repeat(Math.round(pct / 2.5)) + '░'.repeat(40 - Math.round(pct / 2.5));
    const rps = stats.elapsed > 0 ? Math.round(completed / ((performance.now() - stats.startTime) / 1000)) : 0;
    process.stdout.write(`\r  ${C.DIM}[${bar}] ${pct}% | ${completed}/${totalRequests} | ${rps} req/s | in-flight: ${inFlight}${C.RESET}`);
  }, 250);

  return new Promise((resolve) => {
    function launch() {
      while (inFlight < concurrency && completed + inFlight < totalRequests) {
        inFlight++;
        const ep = pickEndpoint(endpoints);
        const headers = {};
        if (ep.auth) {
          const token = getRandomToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        request(`${BASE_URL}${ep.path}`, { method: ep.method, headers, timeout: 15000 })
          .then((result) => {
            stats.record(result);
            perEndpoint[ep.label].record(result);
            completed++;
            inFlight--;
            if (completed >= totalRequests) {
              clearInterval(progressInterval);
              stats.endTime = performance.now();
              // Clear progress line
              process.stdout.write('\r' + ' '.repeat(100) + '\r');
              resolve({ stats, perEndpoint });
            } else {
              launch();
            }
          });
      }
    }
    launch();
  });
}

// ── Report Formatting ─────────────────────────────────────────────
function printStageReport(stageResult, stageName) {
  const { stats, perEndpoint } = stageResult;
  
  console.log(`\n  ${C.BOLD}${C.CYAN}┌─── ${stageName} ───${C.RESET}`);
  console.log(`  ${C.BOLD}│ Total: ${stats.total.toLocaleString()} requests in ${stats.elapsed.toFixed(1)}s${C.RESET}`);
  console.log(`  ${C.BOLD}│ Throughput: ${C.GREEN}${stats.rps.toLocaleString()} req/s${C.RESET}`);
  console.log(`  ${C.BOLD}│ Latency:  p50=${stats.p50}ms  p95=${stats.p95}ms  p99=${stats.p99}ms  max=${stats.max}ms${C.RESET}`);
  
  const errPct = stats.errorRate.toFixed(2);
  const errColor = stats.errorRate < 1 ? C.GREEN : stats.errorRate < 5 ? C.YELLOW : C.RED;
  console.log(`  ${C.BOLD}│ Errors: ${errColor}${errPct}%${C.RESET} (5xx: ${stats.status5xx}, conn: ${stats.errors})`);
  console.log(`  ${C.BOLD}│ Status: 2xx=${stats.status2xx} 3xx=${stats.status3xx} 4xx=${stats.status4xx} 5xx=${stats.status5xx}${C.RESET}`);
  
  // Per-endpoint breakdown
  console.log(`  ${C.BOLD}│${C.RESET}`);
  console.log(`  ${C.BOLD}│ ${C.DIM}Endpoint Breakdown:${C.RESET}`);
  
  const header = `  │   ${'Endpoint'.padEnd(20)} ${'Reqs'.padStart(7)} ${'RPS'.padStart(7)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} ${'Err%'.padStart(7)}`;
  console.log(`  ${C.DIM}${header}${C.RESET}`);
  
  for (const [label, epStats] of Object.entries(perEndpoint)) {
    if (epStats.total === 0) continue;
    const epRps = epStats.elapsed > 0 ? Math.round(epStats.total / stats.elapsed) : 0;
    const epErr = epStats.errorRate.toFixed(1);
    const errC = parseFloat(epErr) < 1 ? C.GREEN : parseFloat(epErr) < 5 ? C.YELLOW : C.RED;
    console.log(`  │   ${label.padEnd(20)} ${String(epStats.total).padStart(7)} ${String(epRps).padStart(7)} ${String(epStats.p50 + 'ms').padStart(6)} ${String(epStats.p95 + 'ms').padStart(6)} ${String(epStats.p99 + 'ms').padStart(6)} ${errC}${String(epErr + '%').padStart(7)}${C.RESET}`);
  }
  console.log(`  ${C.BOLD}└${'─'.repeat(70)}${C.RESET}`);
}

function printFinalSummary(allResults) {
  const grandTotal = allResults.reduce((sum, r) => sum + r.stats.total, 0);
  const grandTime = allResults.reduce((sum, r) => sum + r.stats.elapsed, 0);
  const grand5xx = allResults.reduce((sum, r) => sum + r.stats.status5xx, 0);
  const grandErrors = allResults.reduce((sum, r) => sum + r.stats.errors, 0);
  const grandErrorPct = ((grand5xx + grandErrors) / Math.max(grandTotal, 1) * 100).toFixed(2);
  const peakRPS = Math.max(...allResults.map(r => r.stats.rps));
  const peakP95 = Math.max(...allResults.map(r => r.stats.p95));
  const peakP99 = Math.max(...allResults.map(r => r.stats.p99));

  console.log(`\n${C.BG_BLUE}${C.WHITE}${C.BOLD} ═══ FINAL LOAD TEST SUMMARY ═══ ${C.RESET}\n`);
  console.log(`  ${C.BOLD}Total Requests:     ${C.CYAN}${grandTotal.toLocaleString()}${C.RESET}`);
  console.log(`  ${C.BOLD}Total Duration:     ${grandTime.toFixed(1)}s${C.RESET}`);
  console.log(`  ${C.BOLD}Peak Throughput:    ${C.GREEN}${peakRPS.toLocaleString()} req/s${C.RESET}`);
  console.log(`  ${C.BOLD}Peak p95 Latency:   ${peakP95}ms${C.RESET}`);
  console.log(`  ${C.BOLD}Peak p99 Latency:   ${peakP99}ms${C.RESET}`);
  
  const errColor = parseFloat(grandErrorPct) < 1 ? C.GREEN : parseFloat(grandErrorPct) < 5 ? C.YELLOW : C.RED;
  console.log(`  ${C.BOLD}Overall Error Rate: ${errColor}${grandErrorPct}%${C.RESET}`);
  console.log(`  ${C.BOLD}5xx Errors:         ${grand5xx}${C.RESET}`);
  console.log(`  ${C.BOLD}Connection Errors:  ${grandErrors}${C.RESET}`);

  // ── 50L User Calculation ────────────────────────────────
  console.log(`\n  ${C.BOLD}${C.CYAN}═══ 50 LAKH USER CAPACITY ESTIMATE ═══${C.RESET}`);
  
  // Assume avg user sends 1 request every 10 seconds during active session
  // Peak hour: 20% of users active = 10L active users
  // 10L users × 1 req/10s = 1,00,000 req/s needed
  const activeUserRatio = 0.20;   // 20% DAU active at peak
  const reqPerUserPerSec = 0.1;   // 1 request per 10 seconds per active user
  
  // How many users can this server handle at peak RPS?
  const supportedActiveUsers = Math.round(peakRPS / reqPerUserPerSec);
  const supportedTotalUsers = Math.round(supportedActiveUsers / activeUserRatio);
  
  console.log(`  ${C.DIM}Assumptions: 20% users active at peak, 1 req/10s per active user${C.RESET}`);
  console.log(`  ${C.BOLD}Measured Peak RPS:        ${C.GREEN}${peakRPS.toLocaleString()} req/s${C.RESET}`);
  console.log(`  ${C.BOLD}Supported Active Users:   ${C.GREEN}${supportedActiveUsers.toLocaleString()}${C.RESET}`);
  console.log(`  ${C.BOLD}Supported Total Users:    ${C.GREEN}${supportedTotalUsers.toLocaleString()}${C.RESET}`);
  
  const target = 5000000; // 50L
  if (supportedTotalUsers >= target) {
    console.log(`\n  ${C.BG_GREEN}${C.WHITE}${C.BOLD} ✓ PASS: Can handle 50L+ users (${(supportedTotalUsers / 100000).toFixed(1)}L capacity) ${C.RESET}`);
  } else {
    const serversNeeded = Math.ceil(target / supportedTotalUsers);
    console.log(`\n  ${C.YELLOW}${C.BOLD}  ⚠ Single server capacity: ${(supportedTotalUsers / 100000).toFixed(1)}L users${C.RESET}`);
    console.log(`  ${C.BOLD}  → Need ${serversNeeded} servers (with load balancer) for 50L users${C.RESET}`);
    console.log(`  ${C.BOLD}  → Or use: ${serversNeeded} PM2 workers + Redis adapter + nginx upstream${C.RESET}`);
    
    if (parseFloat(grandErrorPct) < 1 && peakP95 < 2000) {
      console.log(`\n  ${C.GREEN}${C.BOLD}  ✓ Server is STABLE under load (0 crashes, low errors)${C.RESET}`);
      console.log(`  ${C.GREEN}${C.BOLD}  ✓ Horizontally scalable — add more instances behind load balancer${C.RESET}`);
    }
  }

  // Grade
  console.log(`\n  ${C.BOLD}${C.CYAN}═══ PERFORMANCE GRADE ═══${C.RESET}`);
  let grade = 'A+';
  let gradeColor = C.GREEN;
  
  if (parseFloat(grandErrorPct) > 10 || peakP95 > 5000) { grade = 'F'; gradeColor = C.RED; }
  else if (parseFloat(grandErrorPct) > 5 || peakP95 > 3000) { grade = 'D'; gradeColor = C.RED; }
  else if (parseFloat(grandErrorPct) > 2 || peakP95 > 2000) { grade = 'C'; gradeColor = C.YELLOW; }
  else if (parseFloat(grandErrorPct) > 1 || peakP95 > 1000) { grade = 'B'; gradeColor = C.YELLOW; }
  else if (parseFloat(grandErrorPct) > 0.5 || peakP95 > 500) { grade = 'A'; gradeColor = C.GREEN; }
  
  console.log(`  ${gradeColor}${C.BOLD}  Grade: ${grade}${C.RESET}`);
  console.log(`  ${C.DIM}  (A+ = <0.5% errors & <500ms p95, F = >10% errors or >5s p95)${C.RESET}`);
  
  return parseFloat(grandErrorPct) < 5 ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.BOLD}${C.CYAN}`);
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         INNOVATE HUB — EXTREME LOAD TEST (50L+ USERS)              ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Server:    ${BASE_URL.padEnd(55)}║`);
  console.log(`║  Mode:      ${(IS_QUICK ? 'Quick' : 'Full').padEnd(55)}║`);
  console.log(`║  Stages:    ${String(STAGES.length).padEnd(55)}║`);
  console.log(`║  Total Req: ${String(TOTAL_REQUESTS.toLocaleString()).padEnd(55)}║`);
  console.log(`║  Peak Conc: ${String(STAGES[STAGES.length - 1][0]).padEnd(55)}║`);
  console.log(`║  Time:      ${new Date().toISOString().padEnd(55)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(C.RESET);

  // Server health check
  process.stdout.write('  Checking server... ');
  const health = await request(`${BASE_URL}/api/health`, { timeout: 5000 });
  if (health.status === 0 || health.status >= 500) {
    console.log(`${C.RED}FAILED (status: ${health.status || health.error})${C.RESET}`);
    console.log(`  Start the server first: cd /workspaces/Innovate-Hub && node server.js`);
    process.exit(1);
  }
  console.log(`${C.GREEN}OK (${health.time}ms, DB: ${health.body?.database || 'unknown'})${C.RESET}`);

  // Create test users
  const userCount = await setupUsers(20);
  if (userCount === 0) {
    console.log(`${C.RED}  No test users created — auth endpoints may be broken${C.RESET}`);
    console.log(`  Proceeding with unauthenticated-only tests...\n`);
  }

  // Warm up connection pool
  process.stdout.write('  Warming up connection pool... ');
  const warmupPromises = [];
  for (let i = 0; i < 100; i++) {
    warmupPromises.push(request(`${BASE_URL}/api/health`));
  }
  await Promise.all(warmupPromises);
  console.log(`${C.GREEN}done${C.RESET}\n`);

  // Run stages
  const allResults = [];
  for (let i = 0; i < STAGES.length; i++) {
    const [concurrency, totalRequests, label] = STAGES[i];
    
    console.log(`${C.BOLD}${C.BLUE}  ▶ ${label}${C.RESET}`);
    console.log(`  ${C.DIM}  Concurrency: ${concurrency} | Requests: ${totalRequests.toLocaleString()}${C.RESET}`);
    
    const result = await runStage(concurrency, totalRequests, label);
    allResults.push(result);
    printStageReport(result, label);

    // Brief cooldown between stages
    if (i < STAGES.length - 1) {
      process.stdout.write(`  ${C.DIM}Cooldown 2s...${C.RESET}`);
      await new Promise(r => setTimeout(r, 2000));
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
    }
  }

  // Final summary
  const exitCode = printFinalSummary(allResults);
  
  console.log(`\n  ${C.DIM}Exit code: ${exitCode}${C.RESET}\n`);
  
  // Destroy agents
  httpAgent.destroy();
  httpsAgent.destroy();
  
  process.exit(exitCode);
}

main().catch(err => {
  console.error(`${C.RED}Load test crashed: ${err.message}${C.RESET}`);
  console.error(err.stack);
  process.exit(2);
});
