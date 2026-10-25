// 데모 음악 만들기:  node tools/make-test-music.js <폴더>
import path from 'node:path';
import { writeDemoLibrary } from './fixtures.js';

const dir = path.resolve(process.argv[2] || 'demo-music');
const files = writeDemoLibrary(dir);
console.log(`${files.length}곡을 만들었어요 → ${dir}`);
