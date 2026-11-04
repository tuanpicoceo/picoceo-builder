// Production server: serves dist/ and the /api routes. `npm run build && npm start`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './design.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 5180);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) return handleApi(req, res);
  const path = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
  const file = path.startsWith(root) && existsSync(path) && statSync(path).isFile() ? path : join(root, 'index.html');
  res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`PICOCEO Builder on http://localhost:${port}`));
