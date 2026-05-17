/**
 * node test-login.js
 * Teste le login directement sans passer par le navigateur
 */
require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 5001;

function post(email, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ email, password });
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: 'ERREUR: ' + e.message }));
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`\nTest login sur http://localhost:${PORT}/api/auth/login\n`);

  const tests = [
    { email: 'admin@rea.dz',  password: 'Admin@1234'  },
    { email: 'benali@rea.dz', password: 'Doctor@1234' },
    { email: 'hadj@rea.dz',   password: 'Nurse@1234'  },
  ];

  for (const t of tests) {
    const r = await post(t.email, t.password);
    const ok = r.status === 200;
    console.log(`${ok ? '✅' : '❌'} ${t.email} → HTTP ${r.status}`);
    if (!ok) console.log(`   Réponse: ${r.body}`);
    else {
      const parsed = JSON.parse(r.body);
      console.log(`   Token: ${parsed.token ? 'OUI' : 'NON'}, Rôle: ${parsed.user?.role}`);
    }
  }
}

main();
