// The upload tests attach this small file. It lives in results/ (not kept in git), so make it when it is missing.
import fs from 'node:fs';
fs.mkdirSync('results', { recursive: true });
if (!fs.existsSync('results/upload-sample.txt')) fs.writeFileSync('results/upload-sample.txt', 'sample file for the upload test\n');
