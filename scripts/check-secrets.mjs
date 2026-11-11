#!/usr/bin/env node
/**
 * Verifica se algum segredo (chave de API, token, senha) entraria no repositório.
 *
 * Uso:
 *   npm run check:secrets
 *
 * - Em um repositório Git, analisa exatamente os arquivos que seriam commitados
 *   (`git ls-files` + não rastreados, respeitando o .gitignore).
 * - Fora do Git, percorre o projeto com a mesma lista de exclusões.
 *
 * Os valores encontrados nunca são impressos por completo: apenas o tipo e um
 * trecho mascarado. Sai com código 1 se encontrar algo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const MAX_FILE_SIZE = 2 * 1024 * 1024;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'data',
  'coverage',
  '.cache',
  'playwright-report',
  'test-results',
  'minha-bolha-intro',
  'minha-bolha-intro-Global',
  'release'
]);

const IGNORED_FILES = [
  /^\.env(\.|$)/i, // exceto .env.example, tratado abaixo
  /^\.npmrc$/i,
  /^id_rsa$/i,
  /\.(pem|p12|pfx|key)$/i,
  /^tmp-.*/i,
  /\.zip$/i,
  /\.(db|db-shm|db-wal|sqlite)$/i
];

const ALLOWED_FILES = new Set(['.env.example']);

/** Arquivos que jamais deveriam ser versionados (mesmo fora das pastas ignoradas). */
const SENSITIVE_NAMES = [
  { re: /^\.env$/i, label: 'arquivo .env (contém chaves reais)' },
  { re: /^\.(env|npmrc)\.(?!example$)/i, label: 'arquivo de configuração sensível' },
  { re: /^(Cookies|Login Data|Web Data|Local State)$/i, label: 'dados de sessão do navegador' },
  { re: /\.(db|db-shm|db-wal|sqlite)$/i, label: 'banco de dados local' },
  { re: /^id_rsa$/i, label: 'chave SSH privada' },
  { re: /\.(pem|p12|pfx|key)$/i, label: 'chave/certificado privado' }
];

const RULES = [
  { name: 'chave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'token do GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'token do GitHub (fine-grained)', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'chave OpenAI/Anthropic', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'token do Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'chave do Stripe', re: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9._-]{12,}/ },
  { name: 'URL com usuário e senha', re: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i },
  {
    name: 'segredo em atribuição',
    re: /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key)[\"']?\s*[:=]\s*["'][^"'\s]{12,}["']/i
  }
];

const FALSE_POSITIVES =
  /\$\{|process\.env|import\.meta|example|placeholder|changeme|your[-_]|xxxx|••••|<[^>]+>|undefined|null/i;

function listFilesViaGit() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return {
      source: 'git',
      files: [...new Set(output.split('\u0000').filter(Boolean))].map((f) => path.join(root, f))
    };
  } catch {
    return null;
  }
}

function isIgnoredFile(name) {
  if (ALLOWED_FILES.has(name)) return false;
  return IGNORED_FILES.some((re) => re.test(name));
}

function listFilesByWalking(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      listFilesByWalking(path.join(dir, entry.name), acc);
      continue;
    }
    if (isIgnoredFile(entry.name)) continue;
    acc.push(path.join(dir, entry.name));
  }
  return acc;
}

function mask(value) {
  const candidate = value
    .split(/[:=]/)
    .pop()
    .replace(/^["'\s]+|["'\s]+$/g, '');
  const target = candidate.length >= 8 ? candidate : value;
  if (target.length <= 8) return '****';
  return `${target.slice(0, 3)}… (${target.length} caracteres)`;
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

function envSecrets() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return [];
  const values = [];
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.replace(/^["']|["']$/g, '');
    if (value.length < 12 || value.startsWith('${')) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIAL)/i.test(name)) continue;
    values.push({ name, value });
  }
  return values;
}

function checkEnvIgnored(findings, inRepo) {
  if (!inRepo) return;
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore']
    });
  } catch {
    findings.push({
      file: '.env',
      line: 0,
      type: 'o .env existe, mas NÃO está sendo ignorado pelo Git'
    });
  }
}

function main() {
  const git = listFilesViaGit();
  const source = git ?? { source: 'projeto', files: listFilesByWalking(root) };
  const files = source.files;

  const findings = [];
  checkEnvIgnored(findings, source.source === 'git');

  const envValues = envSecrets();

  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const name = path.basename(file);

    const sensitive = SENSITIVE_NAMES.find(({ re }) => re.test(name));
    if (sensitive) {
      findings.push({ file: relative, line: 0, type: sensitive.label });
      continue;
    }

    let buffer;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) continue;
      buffer = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (isBinary(buffer)) continue;

    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.length > 2000) return;

      for (const rule of RULES) {
        const match = line.match(rule.re);
        if (!match) continue;
        if (FALSE_POSITIVES.test(match[0])) continue;
        findings.push({
          file: relative,
          line: index + 1,
          type: rule.name,
          masked: mask(match[0])
        });
      }

      for (const { name: envName, value } of envValues) {
        if (line.includes(value)) {
          findings.push({
            file: relative,
            line: index + 1,
            type: `valor de ${envName} copiado do .env`
          });
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log(`✔ Nenhum segredo encontrado em ${files.length} arquivo(s) analisado(s).`);
    return;
  }

  const unique = [
    ...new Map(
      findings.map((f) => [`${f.file}:${f.line}:${f.masked ?? f.type}`, f])
    ).values()
  ];
  console.error(`✖ ${unique.length} possível(is) segredo(s) encontrado(s):\n`);
  for (const finding of unique) {
    const location = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
    const masked = finding.masked ? `  ${finding.masked}` : '';
    console.error(`  ${location}  [${finding.type}]${masked}`);
  }
  console.error('\nRemova o valor do arquivo ou adicione-o ao .gitignore antes de commitar.');
  process.exitCode = 1;
}

main();
