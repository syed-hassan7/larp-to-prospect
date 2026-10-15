// Live test of Gate 2 (Jev): one supported claim, one real-quote-but-contradicted claim, one overreach.
import { verifyQuote, jevSupport } from '../agents/claims.js';
const page = `Northwind Comply pricing. Hosting: all customer data is stored in our US region (Virginia). EU data residency is not available on any plan today; it is on our 2027 roadmap. Integrations: native AWS, GitHub and Okta connectors are included on every plan. Starter plan from $6,000 per year.`;
const cases = [
  { name: 'supported', field: 'integration_okta', value: 'Native Okta integration on every plan', quote: 'native AWS, GitHub and Okta connectors are included on every plan' },
  { name: 'contradicted (real quote, wrong meaning)', field: 'data_residency', value: 'EU data residency available', quote: 'EU data residency is not available on any plan today' },
  { name: 'overreach', field: 'soc2_type2', value: 'SOC 2 Type II certified', quote: 'Starter plan from $6,000 per year' },
];
console.log('TYPESAFE_API_KEY set:', !!process.env.TYPESAFE_API_KEY);
for (const c of cases) {
  const g1 = verifyQuote(page, c.quote);
  const g2 = await jevSupport(page, c);
  console.log(`${c.name.padEnd(42)} gate1(string)=${g1 ? 'PASS' : 'FAIL'}  gate2(jev)=${g2 ? `${g2.relation} p=${g2.p.toFixed(2)} conf=${g2.confidence.toFixed(2)} ${g2.ms}ms` : 'skipped (fail-open)'}`);
}
