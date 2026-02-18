#!/usr/bin/env node
/**
 * Test source URL validation logic against real-world credible sources.
 * Replicates the isUrlReachable() logic from synthesize.ts exactly.
 *
 * Run: node scripts/test-source-validation.mjs
 */

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DEAD_STATUSES = new Set([404, 410, 451]);

async function isUrlReachable(url) {
  const fetchOpts = {
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': BROWSER_UA },
  };
  try {
    const headRes = await fetch(url, { ...fetchOpts, method: 'HEAD' });
    if (!DEAD_STATUSES.has(headRes.status)) return { reachable: true, method: 'HEAD', status: headRes.status };
    const getRes = await fetch(url, { ...fetchOpts, method: 'GET' });
    return { reachable: !DEAD_STATUSES.has(getRes.status), method: 'GET-fallback', status: getRes.status };
  } catch (headErr) {
    try {
      const getRes = await fetch(url, { ...fetchOpts, method: 'GET' });
      return { reachable: !DEAD_STATUSES.has(getRes.status), method: 'GET-retry', status: getRes.status };
    } catch (getErr) {
      return { reachable: false, method: 'FAILED', status: getErr.cause?.code || getErr.message };
    }
  }
}

// ── Test URLs ──
// ALL "should pass" URLs are REAL, currently live pages (verified Feb 2026)
// ALL "should fail" URLs are deliberately fabricated to test 404 detection
const TEST_URLS = [
  // ═══ MAJOR NEWS — REAL ARTICLES ═══
  ['https://www.nytimes.com/', true, 'NYT homepage'],
  ['https://www.theatlantic.com/magazine/', true, 'The Atlantic magazine'],
  ['https://www.washingtonpost.com/', true, 'Washington Post homepage'],
  ['https://www.theguardian.com/technology', true, 'Guardian Tech section'],
  ['https://www.theguardian.com/us', true, 'Guardian US'],
  ['https://www.bbc.com/news', true, 'BBC News homepage'],
  ['https://www.bbc.com/future', true, 'BBC Future'],
  ['https://www.reuters.com/technology/', true, 'Reuters Tech'],
  ['https://apnews.com/hub/technology', true, 'AP News Tech'],
  ['https://www.economist.com/', true, 'The Economist'],

  // ═══ TECH PUBLICATIONS — REAL PAGES ═══
  ['https://www.theverge.com/', true, 'The Verge homepage'],
  ['https://www.theverge.com/ai-artificial-intelligence', true, 'The Verge AI section'],
  ['https://techcrunch.com/', true, 'TechCrunch homepage'],
  ['https://techcrunch.com/category/artificial-intelligence/', true, 'TechCrunch AI'],
  ['https://arstechnica.com/', true, 'Ars Technica homepage'],
  ['https://www.wired.com/', true, 'Wired homepage'],
  ['https://www.wired.com/tag/artificial-intelligence/', true, 'Wired AI tag'],

  // ═══ ACADEMIC / SCIENTIFIC — REAL PAGES ═══
  ['https://www.nature.com/', true, 'Nature homepage'],
  ['https://www.nature.com/nature/articles', true, 'Nature articles index'],
  ['https://www.science.org/', true, 'Science (AAAS)'],
  ['https://pubmed.ncbi.nlm.nih.gov/', true, 'PubMed'],
  ['https://arxiv.org/abs/2301.07041', true, 'arXiv real paper'],
  ['https://scholar.google.com/', true, 'Google Scholar'],
  ['https://www.thelancet.com/', true, 'The Lancet'],

  // ═══ GOVERNMENT / INSTITUTIONAL — REAL PAGES ═══
  ['https://www.cdc.gov/', true, 'CDC homepage'],
  ['https://www.cdc.gov/mental-health/', true, 'CDC Mental Health'],
  ['https://www.who.int/news-room/fact-sheets', true, 'WHO Fact Sheets'],
  ['https://www.whitehouse.gov/', true, 'White House'],
  ['https://www.congress.gov/', true, 'Congress.gov'],
  ['https://www.nih.gov/', true, 'NIH'],
  ['https://nces.ed.gov/', true, 'NCES (Education stats)'],

  // ═══ REFERENCE / KNOWLEDGE ═══
  ['https://en.wikipedia.org/wiki/Artificial_intelligence', true, 'Wikipedia - AI'],
  ['https://en.wikipedia.org/wiki/1984_(novel)', true, 'Wikipedia - 1984'],
  ['https://en.wikipedia.org/wiki/George_Orwell', true, 'Wikipedia - Orwell'],
  ['https://plato.stanford.edu/entries/privacy/', true, 'Stanford Encyc.'],
  ['https://hai.stanford.edu/', true, 'Stanford HAI'],
  ['https://www.pewresearch.org/', true, 'Pew Research'],

  // ═══ BUSINESS / ANALYSIS ═══
  ['https://www.bloomberg.com/', true, 'Bloomberg'],
  ['https://www.ft.com/', true, 'Financial Times'],
  ['https://hbr.org/', true, 'Harvard Business Review'],
  ['https://www.mckinsey.com/', true, 'McKinsey homepage'],
  ['https://www.brookings.edu/', true, 'Brookings Institution'],

  // ═══ BOOK / CULTURE ═══
  ['https://www.goodreads.com/book/show/61439040-1984', true, 'Goodreads - 1984'],
  ['https://www.penguinrandomhouse.com/', true, 'Penguin Random House'],

  // ═══ HALLUCINATED URLs — SHOULD FAIL ═══
  ['https://www.theatlantic.com/technology/archive/2024/99/fake-article-hallucinated/999999/', false, 'FAKE: Atlantic article'],
  ['https://arxiv.org/abs/9999.99999', false, 'FAKE: arXiv paper'],
  ['https://en.wikipedia.org/wiki/Completely_Nonexistent_Article_XYZ_12345', false, 'FAKE: Wikipedia page'],
  ['https://www.totally-fake-domain-xyz123.com/article', false, 'FAKE: DNS failure'],
  ['https://www.cdc.gov/fake-nonexistent-page-hallucinated-xyz/index.html', false, 'FAKE: CDC page'],
  ['https://www.theguardian.com/technology/2024/jan/99/completely-fake-slug-xyz', false, 'FAKE: Guardian article'],
  ['https://www.bbc.com/news/technology-00000001', false, 'FAKE: BBC article'],
  ['https://techcrunch.com/9999/01/01/fake-article-slug/', false, 'FAKE: TechCrunch'],
  ['https://www.nature.com/articles/fake-doi-s99999-999-99999-x', false, 'FAKE: Nature DOI'],
  ['https://pubmed.ncbi.nlm.nih.gov/99999999999/', false, 'FAKE: PubMed ID'],
];

// ── Run tests ──
async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PODDIT SOURCE URL VALIDATION TEST                        ║');
  console.log('║   Testing isUrlReachable() against real-world sources      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const [url, expectedReachable, label] of TEST_URLS) {
    const start = Date.now();
    const result = await isUrlReachable(url);
    const elapsed = Date.now() - start;

    const match = result.reachable === expectedReachable;
    const icon = match ? '✅' : '❌';
    const timeStr = `${elapsed}ms`.padStart(7);
    const statusStr = `${result.method} ${result.status}`;

    if (match) {
      passed++;
    } else {
      failed++;
    }

    results.push({ url, label, expectedReachable, result, elapsed, match });
    console.log(`${icon} ${label.padEnd(30)} ${(result.reachable ? 'PASS' : 'BLOCKED').padEnd(8)} (${statusStr.padEnd(20)}) ${timeStr}`);
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(70));

  // Separate results by category
  const legitResults = results.filter(r => r.expectedReachable);
  const fakeResults = results.filter(r => !r.expectedReachable);
  const legitPassed = legitResults.filter(r => r.match).length;
  const fakePassed = fakeResults.filter(r => r.match).length;
  const legitFailed = legitResults.filter(r => !r.match);
  const fakeFailed = fakeResults.filter(r => !r.match);

  console.log(`\n📊 RESULTS SUMMARY`);
  console.log(`   Total: ${passed}/${TEST_URLS.length} passed\n`);
  console.log(`   ✅ Legitimate sources:  ${legitPassed}/${legitResults.length} allowed through`);
  console.log(`   ✅ Fake/hallucinated:   ${fakePassed}/${fakeResults.length} correctly blocked\n`);

  if (legitFailed.length > 0) {
    console.log(`   ⚠️  LEGITIMATE SOURCES BLOCKED (false negatives — bad for UX):`);
    for (const r of legitFailed) {
      console.log(`      ${r.label}: ${r.result.method} ${r.result.status} (${r.elapsed}ms)`);
      console.log(`      ${r.url}`);
    }
    console.log();
  }

  if (fakeFailed.length > 0) {
    console.log(`   ⚠️  FAKE URLs ALLOWED THROUGH (false positives — could show 404 to user):`);
    for (const r of fakeFailed) {
      console.log(`      ${r.label}: ${r.result.method} ${r.result.status} (${r.elapsed}ms)`);
      console.log(`      ${r.url}`);
    }
    console.log();
  }

  // Overall assessment
  const legitRate = ((legitPassed / legitResults.length) * 100).toFixed(0);
  const fakeRate = ((fakePassed / fakeResults.length) * 100).toFixed(0);

  console.log(`   Legitimate pass-through rate: ${legitRate}%`);
  console.log(`   Fake URL catch rate: ${fakeRate}%`);

  if (parseInt(legitRate) >= 90 && parseInt(fakeRate) >= 70) {
    console.log('\n🎉 Validation is working well — high legit pass-through, good fake detection.');
  } else if (parseInt(legitRate) < 80) {
    console.log('\n🚨 Too many legitimate sources are being blocked — validation is too strict.');
    process.exitCode = 1;
  } else {
    console.log('\n⚠️  Some edge cases to review, but overall acceptable.');
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exitCode = 1;
});
