import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, 'output');
const baseInj = join(base, 'injection-eval/docs/baseline');

function loadDocs(dir) {
  if (!existsSync(dir)) return {};
  const out = {};
  readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    out[d.anchorId] = d;
  });
  return out;
}

const bl = loadDocs(baseInj);

console.log('== k40 vs baseline (渲染闸门) ==');
for (const k of [40, 80, 100]) {
  const armDocs = loadDocs(join(base, 'ksweep', 'k' + k, 'docs'));
  let same = 0, diffTok = 0, diffCov = 0;
  const anchorIds = Object.keys(bl);
  let candCounts = [];
  for (const id of anchorIds) {
    const b = bl[id];
    const d = armDocs[id];
    if (!d) { console.log(`  [k${k}] ${id}: MISSING in ksweep`); continue; }
    if (String(b.metrics.docTokens) !== String(d.metrics.docTokens)) diffTok++;
    if (String(b.metrics.gtCovered) !== String(d.metrics.gtCovered)) diffCov++;
    const tokEq = String(b.metrics.docTokens) === String(d.metrics.docTokens);
    const covEq = String(b.metrics.gtCovered) === String(d.metrics.gtCovered);
    const textEq = b.text === d.text;
    if (tokEq && covEq && textEq) same++;
    else {
      console.log(`  [k${k}] ${id} tok:${b.metrics.docTokens}->${d.metrics.docTokens} cov:${b.metrics.gtCovered}->${d.metrics.gtCovered} textEq=${textEq} bm25cand=${d.bm25CandidateCount}`);
    }
    candCounts.push(d.bm25CandidateCount || 0);
  }
  console.log(`  [k${k}] 全等=${same}/${anchorIds.length} tok不同=${diffTok} cov不同=${diffCov} 平均BM25候选=${(candCounts.reduce((a,b)=>a+b,0)/candCounts.length).toFixed(1)}`);
}

// bm25 候选数随 k 变化诊断
console.log('\n== BM25 候选数随 k 变化 ==');
const c40 = loadDocs(join(base, 'ksweep', 'k40', 'docs'));
const c80 = loadDocs(join(base, 'ksweep', 'k80', 'docs'));
const c100 = loadDocs(join(base, 'ksweep', 'k100', 'docs'));
for (const id of Object.keys(c40)) {
  const n40 = c40[id].bm25CandidateCount, n80 = c80[id].bm25CandidateCount, n100 = c100[id].bm25CandidateCount;
  if (n40 !== n80 || n40 !== n100) console.log(`  ${id}: k40=${n40} k80=${n80} k100=${n100}`);
}
console.log('  done');