// What an agent does after "finishing" a task: ask the witness, keep the receipt.
// Usage: node examples/agent-client.mjs http://localhost:8787 <api_key> <url> <text>
const [base, key, url, text] = process.argv.slice(2);
const res = await fetch(base + '/v1/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
  body: JSON.stringify({ check: 'http_contains', claim: 'I published the page', params: { url, text } }),
});
const { receipt } = await res.json();
console.log(receipt.passed ? 'VERIFIED' : 'NOT VERIFIED', receipt.id);
