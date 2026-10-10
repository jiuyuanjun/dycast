import { networkInterfaces } from 'os';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function getLanIp() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '10.0.2.2';
}

const ip = getLanIp();
const config = {
  build: {
    devUrl: `http://${ip}:5173`
  }
};

writeFileSync(resolve(root, 'src-tauri/tauri.android.conf.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Android devUrl: http://${ip}:5173`);
