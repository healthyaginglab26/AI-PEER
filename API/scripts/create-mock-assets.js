const fs = require('fs');
const path = require('path');

const mockDir = path.join(__dirname, '..', 'mock-assets');
if (!fs.existsSync(mockDir)) {
    fs.mkdirSync(mockDir, { recursive: true });
}

// 1. Create dummy-qwen.gguf with valid GGUF magic header
// Header format: Magic "GGUF" (0x47 0x47 0x55 0x46), version (uint32: 3), tensor_count (uint64: 0), metadata_kv_count (uint64: 0)
const ggufHeader = Buffer.alloc(32);
ggufHeader.write('GGUF', 0, 4, 'ascii'); // Magic
ggufHeader.writeUInt32LE(3, 4);          // GGUF Version 3
ggufHeader.writeBigUInt64LE(0n, 8);      // Tensor count = 0
ggufHeader.writeBigUInt64LE(0n, 16);     // Metadata KV count = 0

// Pad to 1 KB of structured mock data
const ggufBuffer = Buffer.concat([ggufHeader, Buffer.alloc(1024 - 32, 0)]);
fs.writeFileSync(path.join(mockDir, 'dummy-qwen.gguf'), ggufBuffer);
console.log('Created mock asset: dummy-qwen.gguf');

// 2. Create minimal valid MP4 container (sample-exercise.mp4)
// Minimal MP4 structure: ftyp atom + moov atom
const ftypAtom = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // size: 24
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // major_brand: 'isom'
    0x00, 0x00, 0x02, 0x00, // minor_version: 512
    0x69, 0x73, 0x6f, 0x6d, // compatible: 'isom'
    0x69, 0x73, 0x6f, 0x32  // compatible: 'iso2'
]);

const moovAtom = Buffer.from([
    0x00, 0x00, 0x00, 0x08, // size: 8
    0x6d, 0x6f, 0x6f, 0x76  // 'moov'
]);

const mp4Buffer = Buffer.concat([ftypAtom, moovAtom]);
fs.writeFileSync(path.join(mockDir, 'sample-exercise.mp4'), mp4Buffer);
console.log('Created mock asset: sample-exercise.mp4');
