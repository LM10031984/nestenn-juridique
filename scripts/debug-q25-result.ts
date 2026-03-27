import * as fs from 'fs'

const data = JSON.parse(fs.readFileSync('scripts/benchmark-results/2026-03-26T17-05-54_30q_gpt-4o.json', 'utf-8'))
const q25 = data.results.find((r: any) => r.id === 25)
if (q25) {
  console.log('Question:', q25.question)
  console.log('Expected refs:', q25.expected_refs)
  console.log('Expected keywords:', q25.expected_keywords)
  console.log('Score:', q25.score)
  console.log('Eval:', JSON.stringify(q25.evaluation, null, 2))
  console.log('\n--- Response (first 1000 chars) ---')
  console.log(q25.response?.slice(0, 1000))
}
