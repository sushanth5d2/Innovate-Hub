#!/usr/bin/env node
/**
 * Production Readiness Audit & Load Test
 * ========================================
 * Checks: security, config, API health, error handling, load testing
 * All errors displayed in console.
 * 
 * Usage: node scripts/production-readiness-test.js
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const LOAD_TEST_CONCURRENCY = 50;
const LOAD_TEST_REQUESTS = 500;
const LOAD_TEST_DURATION_SEC = 15;

// ─── Colors ──────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const PASS = `${GREEN}✓ PASS${RESET}`;
const FAIL = `${RED}✗ FAIL${RESET}`;
const WARN = `${YELLOW}⚠ WARN${RESET}`;
const INFO = `${BLUE}ℹ INFO${RESET}`;

let totalPass = 0;
let totalFail = 0;
let totalWarn = 0;
const errors = [];

function pass(msg) { totalPass++; console.log(`  ${PASS}  ${msg}`); }
function fail(msg) { totalFail++; errors.push(msg); console.error(`  ${FAIL}  ${msg}`); }
function warn(msg) { totalWarn++; console.warn(`  ${WARN}  ${msg}`); }
function info(msg) { console.log(`  ${INFO}  ${msg}`); }
function section(title) { console.log(`\n${BOLD}${CYAN}━━━ ${title} ━━━${RESET}`); }

// ─── HTTP helper ─────────────────────────────────────────────────
function httpRequest(urlStr, options = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const startTime = Date.now();
    
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 10000,
    };

    const req = mod.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          time: Date.now() - startTime,
          ok: res.statusCode >= 200 && res.statusCode < 400,
        });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, headers: {}, body: '', time: Date.now() - startTime, ok: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: '', time: Date.now() - startTime, ok: false, error: 'timeout' });
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// ═════════════════════════════════════════════════════════════════
// 1. ENVIRONMENT & CONFIGURATION AUDIT
// ═════════════════════════════════════════════════════════════════
async function auditEnvironment() {
  section('1. ENVIRONMENT & CONFIGURATION');

  // Load .env
  const envPath = path.resolve(__dirname, '..', '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) envVars[match[1].trim()] = match[2].trim();
  });

  // NODE_ENV
  if (envVars.NODE_ENV === 'production') {
    pass('NODE_ENV=production');
  } else {
    fail(`NODE_ENV=${envVars.NODE_ENV || 'not set'} (should be "production")`);
  }

  // JWT_SECRET
  const jwtSecret = envVars.JWT_SECRET || '';
  if (!jwtSecret) {
    fail('JWT_SECRET is not set');
  } else if (jwtSecret.length < 64) {
    warn(`JWT_SECRET is short (${jwtSecret.length} chars, recommend 64+)`);
  } else if (jwtSecret === 'your-secret-key' || jwtSecret === 'changeme') {
    fail('JWT_SECRET is using default/insecure value');
  } else {
    pass(`JWT_SECRET set (${jwtSecret.length} chars)`);
  }

  // Database config
  if (envVars.DB_TYPE === 'postgresql') {
    pass('DB_TYPE=postgresql (production-grade)');
  } else {
    fail(`DB_TYPE=${envVars.DB_TYPE || 'sqlite'} — SQLite is NOT suitable for production`);
  }

  // PG password check
  const pgPass = envVars.PG_PASSWORD || '';
  if (pgPass && (pgPass.length < 12 || pgPass === 'changeme' || pgPass === 'password')) {
    warn(`PG_PASSWORD is weak (${pgPass.length} chars) — use a strong password`);
  } else if (pgPass) {
    pass('PG_PASSWORD is set');
  } else if (envVars.DB_TYPE === 'postgresql') {
    fail('PG_PASSWORD not set but DB_TYPE=postgresql');
  }

  // CORS
  const origins = envVars.ALLOWED_ORIGINS || '*';
  if (origins === '*') {
    fail('ALLOWED_ORIGINS=* — wide open CORS in production (set to your domain)');
  } else {
    pass(`ALLOWED_ORIGINS restricted to: ${origins}`);
  }

  // Redis
  if (envVars.REDIS_ENABLED === 'true') {
    pass('Redis caching enabled');
  } else {
    warn('Redis disabled — no caching layer for production');
  }

  // API Keys exposed
  const sensitiveKeys = ['GROQ_API_KEY', 'GOOGLE_AI_API_KEY', 'HUGGINGFACE_API_KEY', 'MISTRAL_API_KEY'];
  sensitiveKeys.forEach(key => {
    if (envVars[key]) {
      warn(`${key} is in .env — ensure .env is in .gitignore and not committed`);
    }
  });

  // Check .gitignore
  const gitignorePath = path.resolve(__dirname, '..', '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignore.includes('.env')) {
      pass('.env is in .gitignore');
    } else {
      fail('.env is NOT in .gitignore — secrets may be committed!');
    }
  } else {
    fail('No .gitignore file found');
  }

  // Rate limiting
  const rateWindow = envVars.RATE_LIMIT_WINDOW_MS;
  const rateMax = envVars.RATE_LIMIT_MAX;
  if (!rateWindow && !rateMax) {
    info('Rate limiting using default values (check server.js for actual values)');
  } else {
    info(`Rate limit: ${rateMax || 'default'} req / ${rateWindow || 'default'}ms`);
  }
}

// ═════════════════════════════════════════════════════════════════
// 2. SECURITY HEADERS AUDIT
// ═════════════════════════════════════════════════════════════════
async function auditSecurityHeaders() {
  section('2. SECURITY HEADERS');

  const res = await httpRequest(BASE_URL);
  if (!res.ok && res.error) {
    fail(`Cannot reach ${BASE_URL}: ${res.error}`);
    return;
  }

  const headers = res.headers;

  // Check essential security headers
  const checks = [
    { header: 'x-content-type-options', expected: 'nosniff', label: 'X-Content-Type-Options' },
    { header: 'x-frame-options', expected: null, label: 'X-Frame-Options' },
    { header: 'strict-transport-security', expected: null, label: 'Strict-Transport-Security (HSTS)' },
    { header: 'content-security-policy', expected: null, label: 'Content-Security-Policy' },
    { header: 'x-xss-protection', expected: null, label: 'X-XSS-Protection' },
    { header: 'referrer-policy', expected: null, label: 'Referrer-Policy' },
    { header: 'x-dns-prefetch-control', expected: null, label: 'X-DNS-Prefetch-Control' },
  ];

  checks.forEach(({ header, expected, label }) => {
    const value = headers[header];
    if (value) {
      if (expected && value !== expected) {
        warn(`${label}: ${value} (expected: ${expected})`);
      } else {
        pass(`${label}: ${value}`);
      }
    } else {
      if (header === 'strict-transport-security') {
        info(`${label} not set (normal for HTTP; required when using HTTPS)`);
      } else {
        warn(`${label} header missing`);
      }
    }
  });

  // Server header (should be hidden)
  if (headers['x-powered-by']) {
    fail(`X-Powered-By header exposed: "${headers['x-powered-by']}" (Helmet should remove this)`);
  } else {
    pass('X-Powered-By header hidden');
  }

  // Check for secure cookies
  if (headers['set-cookie']) {
    const cookies = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']];
    cookies.forEach(c => {
      if (!c.includes('HttpOnly')) warn(`Cookie missing HttpOnly flag: ${c.split(';')[0]}`);
      if (!c.includes('Secure')) warn(`Cookie missing Secure flag: ${c.split(';')[0]}`);
    });
  }
}

// ═════════════════════════════════════════════════════════════════
// 3. API ENDPOINT HEALTH CHECK
// ═════════════════════════════════════════════════════════════════
async function auditAPIEndpoints() {
  section('3. API ENDPOINT HEALTH');

  // Public endpoints (no auth needed)
  const publicEndpoints = [
    { path: '/', method: 'GET', expectStatus: 200, label: 'Homepage' },
    { path: '/login', method: 'GET', expectStatus: 200, label: 'Login page' },
    { path: '/register', method: 'GET', expectStatus: 200, label: 'Register page' },
  ];

  // Auth endpoints
  const authEndpoints = [
    { path: '/api/auth/register', method: 'POST', expectStatus: 400, label: 'Register (validation)', body: {} },
    { path: '/api/auth/login', method: 'POST', expectStatus: [400, 401], label: 'Login (validation)', body: {} },
  ];

  // Protected endpoints (should return 401)
  const protectedEndpoints = [
    { path: '/api/posts', method: 'GET', expectStatus: 401, label: 'Posts (auth required)' },
    { path: '/api/messages/conversations', method: 'GET', expectStatus: 401, label: 'Messages (auth required)' },
    { path: '/api/communities', method: 'GET', expectStatus: 401, label: 'Communities (auth required)' },
    { path: '/api/notifications', method: 'GET', expectStatus: 401, label: 'Notifications (auth required)' },
    { path: '/api/users/me', method: 'GET', expectStatus: 401, label: 'User profile (auth required)' },
    { path: '/api/events', method: 'GET', expectStatus: 401, label: 'Events (auth required)' },
    { path: '/api/search/users?q=test', method: 'GET', expectStatus: 401, label: 'Search (auth required)' },
    { path: '/api/todos', method: 'GET', expectStatus: 401, label: 'Todos (auth required)' },
  ];

  for (const ep of publicEndpoints) {
    const res = await httpRequest(`${BASE_URL}${ep.path}`, { method: ep.method });
    if (res.status === ep.expectStatus) {
      pass(`${ep.label} → ${res.status} (${res.time}ms)`);
    } else if (res.error) {
      fail(`${ep.label} → Error: ${res.error}`);
    } else {
      fail(`${ep.label} → ${res.status} (expected ${ep.expectStatus})`);
    }
  }

  for (const ep of authEndpoints) {
    const res = await httpRequest(`${BASE_URL}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.body),
    });
    const expected = Array.isArray(ep.expectStatus) ? ep.expectStatus : [ep.expectStatus];
    if (expected.includes(res.status)) {
      pass(`${ep.label} → ${res.status} (${res.time}ms)`);
    } else if (res.error) {
      fail(`${ep.label} → Error: ${res.error}`);
    } else {
      warn(`${ep.label} → ${res.status} (expected ${expected.join('|')})`);
    }
  }

  for (const ep of protectedEndpoints) {
    const res = await httpRequest(`${BASE_URL}${ep.path}`, { method: ep.method });
    if (res.status === ep.expectStatus) {
      pass(`${ep.label} → ${res.status} (${res.time}ms)`);
    } else if (res.error) {
      fail(`${ep.label} → Error: ${res.error}`);
    } else {
      fail(`${ep.label} → ${res.status} (expected ${ep.expectStatus}) — auth not enforced!`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════
// 4. ERROR HANDLING AUDIT
// ═════════════════════════════════════════════════════════════════
async function auditErrorHandling() {
  section('4. ERROR HANDLING');

  // Test 404 handling
  const res404 = await httpRequest(`${BASE_URL}/api/nonexistent-route-xyz-12345`);
  if (res404.status === 404) {
    pass('404 for unknown API routes');
  } else {
    warn(`Unknown route returned ${res404.status} instead of 404`);
  }

  // Test malformed JSON
  const resBadJSON = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json',
  });
  if (resBadJSON.status === 400) {
    pass('Malformed JSON returns 400');
  } else if (resBadJSON.status === 500) {
    fail(`Malformed JSON causes 500 error — unhandled parse error`);
  } else {
    info(`Malformed JSON returns ${resBadJSON.status}`);
  }

  // Test very long input
  const longString = 'A'.repeat(100000);
  const resLong = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: longString, password: longString }),
  });
  if (resLong.status === 413) {
    pass('Oversized payload rejected with 413');
  } else if (resLong.status >= 400 && resLong.status < 500) {
    pass(`Oversized payload handled (${resLong.status})`);
  } else if (resLong.status === 500) {
    fail(`Oversized payload causes 500 — server crash risk`);
  } else {
    info(`Oversized payload returns ${resLong.status}`);
  }

  // Test SQL injection attempt
  const resSQLi = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: "' OR 1=1 --", password: "anything" }),
  });
  if (resSQLi.status >= 400 && resSQLi.status < 500) {
    pass(`SQL injection attempt handled correctly (${resSQLi.status})`);
  } else if (resSQLi.status === 500) {
    fail('SQL injection attempt causes 500 — possible vulnerability!');
  } else {
    warn(`SQL injection attempt returned ${resSQLi.status}`);
  }

  // Test XSS in query params
  const resXSS = await httpRequest(`${BASE_URL}/api/search?q=<script>alert('xss')</script>`, {
    headers: { 'Authorization': 'Bearer invalid' },
  });
  if (resXSS.body && resXSS.body.includes('<script>alert')) {
    fail('XSS payload reflected in response — potential XSS vulnerability');
  } else {
    pass('XSS payload not reflected in response');
  }

  // Test with invalid JWT
  const resInvalidJWT = await httpRequest(`${BASE_URL}/api/posts`, {
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoiYSJ9.invalid' },
  });
  if (resInvalidJWT.status === 401) {
    pass('Invalid JWT rejected correctly (401)');
  } else {
    fail(`Invalid JWT returned ${resInvalidJWT.status} (expected 401)`);
  }

  // Test expired-style JWT (garbage)
  const resGarbageToken = await httpRequest(`${BASE_URL}/api/posts`, {
    headers: { 'Authorization': 'Bearer garbagetokenhere' },
  });
  if (resGarbageToken.status === 401) {
    pass('Garbage token rejected correctly (401)');
  } else {
    fail(`Garbage token returned ${resGarbageToken.status} (expected 401)`);
  }
}

// ═════════════════════════════════════════════════════════════════
// 5. FILE & DIRECTORY SECURITY
// ═════════════════════════════════════════════════════════════════
async function auditFileSecurity() {
  section('5. FILE & DIRECTORY SECURITY');

  // Check if .env is accessible publicly
  const resEnv = await httpRequest(`${BASE_URL}/.env`);
  if (resEnv.status === 404 || resEnv.status === 403) {
    pass('.env file not publicly accessible');
  } else if (resEnv.body && resEnv.body.includes('JWT_SECRET')) {
    fail('.env file is publicly accessible! Secrets exposed!');
  } else {
    pass('.env not exposing secrets');
  }

  // Check for common sensitive file exposure
  const sensitiveFiles = [
    '/.git/config', '/package.json', '/server.js', '/.gitignore',
    '/config/database.js', '/node_modules/.package-lock.json',
  ];

  for (const filePath of sensitiveFiles) {
    const res = await httpRequest(`${BASE_URL}${filePath}`);
    if (res.status === 200 && (res.body.includes('require(') || res.body.includes('JWT_SECRET') || res.body.includes('PG_PASSWORD'))) {
      fail(`Sensitive file accessible: ${filePath}`);
    } else if (res.status === 404 || res.status === 403) {
      pass(`${filePath} not accessible`);
    } else {
      info(`${filePath} returns ${res.status}`);
    }
  }

  // Check upload directory exists
  const uploadsDir = path.resolve(__dirname, '..', 'uploads');
  if (fs.existsSync(uploadsDir)) {
    pass('uploads/ directory exists');
  } else {
    warn('uploads/ directory missing — file uploads will fail');
  }

  // Check for directory listing
  const resUploads = await httpRequest(`${BASE_URL}/uploads/`);
  if (resUploads.status === 200 && resUploads.body.includes('<pre>') && resUploads.body.includes('<a href')) {
    fail('Directory listing enabled for /uploads/ — files enumerable');
  } else {
    pass('No directory listing on /uploads/');
  }
}

// ═════════════════════════════════════════════════════════════════
// 6. DATABASE AUDIT
// ═════════════════════════════════════════════════════════════════
async function auditDatabase() {
  section('6. DATABASE');

  const envPath = path.resolve(__dirname, '..', '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) envVars[match[1].trim()] = match[2].trim();
  });

  if (envVars.DB_TYPE === 'postgresql') {
    info('Using PostgreSQL — good for production');

    // Check if PG connection works by testing an API
    const testReg = await httpRequest(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'a', email: 'a', password: 'a' }),
    });
    if (testReg.status === 400) {
      pass('Database responding to queries');
    } else if (testReg.status === 500) {
      fail('Database query failed (500) — check PostgreSQL connection');
    } else {
      info(`Database check returned ${testReg.status}`);
    }
  } else {
    fail('Using SQLite — not production-ready (no concurrent writes, no replication)');
  }

  // Check database file permissions (SQLite)
  const sqlitePath = path.resolve(__dirname, '..', 'database', 'innovate.db');
  if (fs.existsSync(sqlitePath) && envVars.DB_TYPE !== 'postgresql') {
    try {
      const stat = fs.statSync(sqlitePath);
      const mode = (stat.mode & 0o777).toString(8);
      if (mode === '600' || mode === '640') {
        pass(`SQLite file permissions: ${mode}`);
      } else {
        warn(`SQLite file permissions: ${mode} (recommend 600 or 640)`);
      }
    } catch (e) {
      warn('Cannot check SQLite file permissions');
    }
  }
}

// ═════════════════════════════════════════════════════════════════
// 7. DEPENDENCY AUDIT
// ═════════════════════════════════════════════════════════════════
async function auditDependencies() {
  section('7. DEPENDENCY SECURITY');

  try {
    const output = execSync('npm audit --json 2>/dev/null', { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    const audit = JSON.parse(output);
    const vulns = audit.metadata?.vulnerabilities || {};
    const critical = vulns.critical || 0;
    const high = vulns.high || 0;
    const moderate = vulns.moderate || 0;
    const low = vulns.low || 0;

    if (critical > 0) fail(`${critical} CRITICAL vulnerabilities`);
    else pass('No critical vulnerabilities');

    if (high > 0) warn(`${high} high vulnerabilities`);
    else pass('No high vulnerabilities');

    if (moderate > 0) info(`${moderate} moderate vulnerabilities`);
    if (low > 0) info(`${low} low vulnerabilities`);
  } catch (e) {
    // npm audit exits with non-zero when vulns found
    try {
      const output = e.stdout || '';
      const audit = JSON.parse(output);
      const vulns = audit.metadata?.vulnerabilities || {};
      if (vulns.critical > 0) fail(`${vulns.critical} CRITICAL npm vulnerabilities`);
      if (vulns.high > 0) warn(`${vulns.high} high npm vulnerabilities (run: npm audit)`);
      if (vulns.moderate > 0) info(`${vulns.moderate} moderate npm vulnerabilities`);
      if (vulns.low > 0) info(`${vulns.low} low npm vulnerabilities`);
    } catch (_) {
      warn('Could not parse npm audit output');
    }
  }

  // Check for outdated major versions
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    const deps = pkgJson.dependencies || {};
    
    // Check for known problematic versions
    if (deps.express && deps.express.includes('^4')) {
      info('Express v4 — consider upgrading to v5 for production (when stable)');
    }
    if (deps['socket.io'] && deps['socket.io'].includes('^4')) {
      pass('Socket.IO v4 — current stable');
    }
    
    pass(`${Object.keys(deps).length} production dependencies declared`);
  } catch (e) {
    warn('Could not read package.json');
  }
}

// ═════════════════════════════════════════════════════════════════
// 8. CODE QUALITY CHECKS
// ═════════════════════════════════════════════════════════════════
async function auditCodeQuality() {
  section('8. CODE QUALITY');

  const rootDir = path.resolve(__dirname, '..');
  
  // Check for console.log in production code (routes)
  const routesDir = path.join(rootDir, 'routes');
  let consoleLogs = 0;
  if (fs.existsSync(routesDir)) {
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    files.forEach(file => {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      const matches = content.match(/console\.log\(/g);
      if (matches) consoleLogs += matches.length;
    });
  }
  if (consoleLogs > 20) {
    warn(`${consoleLogs} console.log() calls in routes/ — consider using a logger`);
  } else if (consoleLogs > 0) {
    info(`${consoleLogs} console.log() calls in routes/`);
  } else {
    pass('No console.log() in routes');
  }

  // Check upload middleware debug logging
  const uploadMiddleware = path.join(rootDir, 'middleware', 'upload.js');
  if (fs.existsSync(uploadMiddleware)) {
    const content = fs.readFileSync(uploadMiddleware, 'utf8');
    const debugLogs = (content.match(/console\.log\(/g) || []).length;
    if (debugLogs > 5) {
      warn(`Upload middleware has ${debugLogs} console.log() — verbose debug logging in production`);
    }
  }

  // Check for TODO/FIXME/HACK
  let todoCount = 0;
  const codeFiles = ['routes', 'middleware', 'config', 'services'].flatMap(dir => {
    const dirPath = path.join(rootDir, dir);
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).filter(f => f.endsWith('.js')).map(f => path.join(dirPath, f));
  });
  codeFiles.push(path.join(rootDir, 'server.js'));

  codeFiles.forEach(file => {
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    const todos = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
    if (todos) todoCount += todos.length;
  });
  if (todoCount > 0) {
    warn(`${todoCount} TODO/FIXME/HACK comments found in code`);
  } else {
    pass('No TODO/FIXME/HACK in code');
  }

  // Check if test script exists
  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (pkgJson.scripts?.test && !pkgJson.scripts.test.includes('no test specified')) {
    pass('Test script configured');
  } else {
    fail('No test script — "npm test" does nothing');
  }

  // Check for proper error handling in routes
  let unhandledAsyncCount = 0;
  codeFiles.forEach(file => {
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    // Count async handlers without try-catch
    const asyncHandlers = content.match(/async\s*\(req,\s*res/g) || [];
    const tryCatchBlocks = content.match(/try\s*\{/g) || [];
    if (asyncHandlers.length > tryCatchBlocks.length + 2) {
      unhandledAsyncCount += asyncHandlers.length - tryCatchBlocks.length;
    }
  });
  if (unhandledAsyncCount > 5) {
    warn(`~${unhandledAsyncCount} async route handlers may lack try-catch error handling`);
  } else {
    pass('Route handlers appear to have error handling');
  }

  // Check graceful shutdown
  const serverContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  if (serverContent.includes('SIGTERM')) {
    pass('Graceful shutdown handler (SIGTERM) present');
  } else {
    fail('No SIGTERM handler — ungraceful shutdown in production');
  }
  if (serverContent.includes('SIGINT') || serverContent.includes('SIGTERM')) {
    pass('Process signal handling present');
  }

  // Check for unhandledRejection handler
  if (serverContent.includes('unhandledRejection')) {
    pass('unhandledRejection handler present');
  } else {
    warn('No unhandledRejection handler — unhandled promise rejections may crash');
  }
  if (serverContent.includes('uncaughtException')) {
    pass('uncaughtException handler present');
  } else {
    warn('No uncaughtException handler — uncaught errors will crash the process');
  }
}

// ═════════════════════════════════════════════════════════════════
// 9. PERFORMANCE CHECKS
// ═════════════════════════════════════════════════════════════════
async function auditPerformance() {
  section('9. PERFORMANCE');

  // Check compression
  const resComp = await httpRequest(BASE_URL, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' },
  });
  if (resComp.headers['content-encoding']) {
    pass(`Compression enabled: ${resComp.headers['content-encoding']}`);
  } else {
    warn('No compression detected — enable gzip/brotli for production');
  }

  // Check static file caching
  const resCSS = await httpRequest(`${BASE_URL}/css/instagram.css`);
  const cacheControl = resCSS.headers['cache-control'] || '';
  if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
    info(`CSS cache-control: ${cacheControl} (revalidation forced)`);
  } else if (cacheControl.includes('max-age')) {
    pass(`CSS caching: ${cacheControl}`);
  } else {
    info(`CSS cache-control: ${cacheControl || 'not set'}`);
  }

  // Response time baseline
  const times = [];
  for (let i = 0; i < 10; i++) {
    const r = await httpRequest(BASE_URL);
    if (r.time) times.push(r.time);
  }
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const maxTime = Math.max(...times);
  
  if (avgTime < 100) {
    pass(`Avg response time: ${avgTime.toFixed(0)}ms (excellent)`);
  } else if (avgTime < 500) {
    pass(`Avg response time: ${avgTime.toFixed(0)}ms (good)`);
  } else {
    warn(`Avg response time: ${avgTime.toFixed(0)}ms (slow — investigate)`);
  }
  info(`Max response time: ${maxTime}ms (10 sequential requests)`);
}

// ═════════════════════════════════════════════════════════════════
// 10. LOAD TEST
// ═════════════════════════════════════════════════════════════════
async function loadTest() {
  section('10. LOAD TEST');
  
  console.log(`  Config: ${LOAD_TEST_REQUESTS} requests, ${LOAD_TEST_CONCURRENCY} concurrent, ${LOAD_TEST_DURATION_SEC}s max`);
  console.log(`  Target: ${BASE_URL}`);
  console.log('');

  const endpoints = [
    { path: '/', label: 'Homepage (static)', weight: 3 },
    { path: '/login', label: 'Login page', weight: 2 },
    { path: '/api/auth/login', label: 'Auth API (POST)', method: 'POST', weight: 1, 
      headers: { 'Content-Type': 'application/json' }, body: '{"email":"loadtest@test.com","password":"test123"}' },
    { path: '/api/posts', label: 'Posts API (unauthed)', weight: 3 },
    { path: '/css/instagram.css', label: 'Static CSS', weight: 1 },
  ];

  const totalWeight = endpoints.reduce((s, e) => s + e.weight, 0);

  const results = {
    total: 0,
    success: 0,
    errors: 0,
    timeouts: 0,
    statusCodes: {},
    times: [],
    startTime: Date.now(),
    endpointStats: {},
  };

  endpoints.forEach(ep => {
    results.endpointStats[ep.path] = { total: 0, success: 0, errors: 0, times: [], label: ep.label };
  });

  // Select random endpoint based on weight
  function selectEndpoint() {
    let r = Math.random() * totalWeight;
    for (const ep of endpoints) {
      r -= ep.weight;
      if (r <= 0) return ep;
    }
    return endpoints[0];
  }

  // Execute a single request
  async function executeRequest() {
    const ep = selectEndpoint();
    const start = Date.now();
    try {
      const res = await httpRequest(`${BASE_URL}${ep.path}`, {
        method: ep.method || 'GET',
        headers: ep.headers || {},
        body: ep.body || null,
        timeout: 10000,
      });
      const elapsed = Date.now() - start;
      
      results.total++;
      results.times.push(elapsed);
      results.statusCodes[res.status] = (results.statusCodes[res.status] || 0) + 1;
      results.endpointStats[ep.path].total++;
      results.endpointStats[ep.path].times.push(elapsed);

      if (res.ok || res.status === 401 || res.status === 400 || res.status === 429) {
        results.success++;
        results.endpointStats[ep.path].success++;
      } else if (res.error === 'timeout') {
        results.timeouts++;
      } else {
        results.errors++;
        results.endpointStats[ep.path].errors++;
      }
    } catch (e) {
      results.total++;
      results.errors++;
      results.endpointStats[ep.path].total++;
      results.endpointStats[ep.path].errors++;
    }
  }

  // Run load test in waves
  const deadline = Date.now() + LOAD_TEST_DURATION_SEC * 1000;
  let requestsSent = 0;

  while (requestsSent < LOAD_TEST_REQUESTS && Date.now() < deadline) {
    const batch = [];
    const batchSize = Math.min(LOAD_TEST_CONCURRENCY, LOAD_TEST_REQUESTS - requestsSent);
    
    for (let i = 0; i < batchSize; i++) {
      batch.push(executeRequest());
    }
    
    await Promise.all(batch);
    requestsSent += batchSize;
    
    // Show progress
    const pct = Math.round((requestsSent / LOAD_TEST_REQUESTS) * 100);
    process.stdout.write(`\r  Progress: ${requestsSent}/${LOAD_TEST_REQUESTS} (${pct}%)`);
  }
  console.log(''); // newline after progress

  const totalTime = (Date.now() - results.startTime) / 1000;
  const rps = results.total / totalTime;
  const sortedTimes = results.times.sort((a, b) => a - b);
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;
  const avgTime = sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length || 0;
  const maxTime = sortedTimes[sortedTimes.length - 1] || 0;

  console.log('');
  console.log(`  ${BOLD}═══ Load Test Results ═══${RESET}`);
  console.log(`  Total requests:    ${results.total}`);
  console.log(`  Duration:          ${totalTime.toFixed(2)}s`);
  console.log(`  Requests/sec:      ${BOLD}${rps.toFixed(1)}${RESET}`);
  console.log(`  Success:           ${GREEN}${results.success}${RESET} (${((results.success / results.total) * 100).toFixed(1)}%)`);
  console.log(`  Errors:            ${results.errors > 0 ? RED : GREEN}${results.errors}${RESET}`);
  console.log(`  Timeouts:          ${results.timeouts > 0 ? YELLOW : GREEN}${results.timeouts}${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Latency:${RESET}`);
  console.log(`    Avg:     ${avgTime.toFixed(0)}ms`);
  console.log(`    p50:     ${p50}ms`);
  console.log(`    p95:     ${p95}ms`);
  console.log(`    p99:     ${p99}ms`);
  console.log(`    Max:     ${maxTime}ms`);
  console.log('');
  console.log(`  ${BOLD}Status codes:${RESET}`);
  Object.entries(results.statusCodes).sort(([a], [b]) => a - b).forEach(([code, count]) => {
    const color = code < 400 ? GREEN : code < 500 ? YELLOW : RED;
    console.log(`    ${color}${code}${RESET}: ${count}`);
  });
  console.log('');
  console.log(`  ${BOLD}Per-endpoint:${RESET}`);
  Object.entries(results.endpointStats).forEach(([path, stats]) => {
    if (stats.total === 0) return;
    const avgT = stats.times.length ? (stats.times.reduce((a, b) => a + b, 0) / stats.times.length).toFixed(0) : 'N/A';
    const errPct = stats.total ? ((stats.errors / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`    ${stats.label}`);
    console.log(`      Requests: ${stats.total} | Avg: ${avgT}ms | Errors: ${errPct}%`);
  });

  // Verdicts
  console.log('');
  if (rps >= 200) pass(`Throughput: ${rps.toFixed(0)} req/s (excellent)`);
  else if (rps >= 50) pass(`Throughput: ${rps.toFixed(0)} req/s (good)`);
  else if (rps >= 10) warn(`Throughput: ${rps.toFixed(0)} req/s (low — optimize or scale)`);
  else fail(`Throughput: ${rps.toFixed(0)} req/s (critical — too slow)`);

  if (p95 < 200) pass(`p95 latency: ${p95}ms (excellent)`);
  else if (p95 < 1000) pass(`p95 latency: ${p95}ms (acceptable)`);
  else warn(`p95 latency: ${p95}ms (high — investigate slow routes)`);

  const errorRate = results.errors / results.total * 100;
  const serverErrors = results.statusCodes[500] || 0;
  const serverErrorRate = serverErrors / results.total * 100;
  if (serverErrorRate < 1) pass(`Server error rate (5xx): ${serverErrorRate.toFixed(2)}%`);
  else if (serverErrorRate < 5) warn(`Server error rate (5xx): ${serverErrorRate.toFixed(2)}% (${serverErrors} of ${results.total})`);
  else fail(`Server error rate (5xx): ${serverErrorRate.toFixed(2)}% (${serverErrors} of ${results.total})`);

  if (errorRate < 1) pass(`Total error rate: ${errorRate.toFixed(2)}% (excellent)`);
  else if (errorRate < 5) info(`Total error rate: ${errorRate.toFixed(2)}% (incl. rate-limited)`);
  else info(`Total error rate: ${errorRate.toFixed(2)}% (incl. rate-limited & DB-connection errors from concurrency)`);

  if (results.timeouts > 0) warn(`${results.timeouts} request(s) timed out`);
  else pass('No timeouts');
}

// ═════════════════════════════════════════════════════════════════
// 11. RATE LIMITING TEST
// ═════════════════════════════════════════════════════════════════
async function auditRateLimiting() {
  section('11. RATE LIMITING');

  // Burst auth endpoint
  let rateLimited = false;
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(httpRequest(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `test${i}@test.com`, password: 'test' }),
    }));
  }
  const responses = await Promise.all(promises);
  const rateLimitedCount = responses.filter(r => r.status === 429).length;
  
  if (rateLimitedCount > 0) {
    pass(`Auth rate limiting active — ${rateLimitedCount}/50 requests blocked (429)`);
  } else {
    warn('Auth rate limiting did NOT trigger on 50 rapid requests — check configuration');
  }

  // Check rate limit headers
  const sample = responses.find(r => r.headers['ratelimit-limit']);
  if (sample) {
    info(`Rate limit: ${sample.headers['ratelimit-limit']} per window, ${sample.headers['ratelimit-remaining']} remaining`);
  }
}

// ═════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   PRODUCTION READINESS AUDIT & LOAD TEST        ║${RESET}`);
  console.log(`${BOLD}${CYAN}║   Innovate Hub                                  ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Date:   ${new Date().toISOString()}`);

  await auditEnvironment();
  await auditSecurityHeaders();
  await auditAPIEndpoints();
  await auditErrorHandling();
  await auditFileSecurity();
  await auditDatabase();
  await auditDependencies();
  await auditCodeQuality();
  await auditPerformance();
  await loadTest();
  await auditRateLimiting();

  // ─── FINAL REPORT ──────────────────────────────────────────────
  section('FINAL REPORT');
  console.log(`  ${GREEN}Passed:   ${totalPass}${RESET}`);
  console.log(`  ${YELLOW}Warnings: ${totalWarn}${RESET}`);
  console.log(`  ${RED}Failed:   ${totalFail}${RESET}`);
  console.log('');

  if (totalFail === 0 && totalWarn <= 3) {
    console.log(`  ${GREEN}${BOLD}✓ APPLICATION IS PRODUCTION-READY${RESET}`);
  } else if (totalFail === 0) {
    console.log(`  ${YELLOW}${BOLD}⚠ MOSTLY READY — address warnings before production${RESET}`);
  } else if (totalFail <= 3) {
    console.log(`  ${YELLOW}${BOLD}⚠ NOT FULLY READY — ${totalFail} critical issue(s) must be fixed${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}✗ NOT PRODUCTION-READY — ${totalFail} critical issues found${RESET}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ${RED}${BOLD}Critical Issues:${RESET}`);
    errors.forEach((e, i) => console.log(`  ${RED}${i + 1}. ${e}${RESET}`));
  }

  console.log('');
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Audit script failed:', err);
  process.exit(2);
});
