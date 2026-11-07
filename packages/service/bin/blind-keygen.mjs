#!/usr/bin/env node
/**
 * Generate the key that blind-signs device-held ballots.
 *
 *   node packages/service/bin/blind-keygen.mjs > blind-key.pem
 *
 * Set BENCHMARK_BLIND_KEY (or BENCHMARK_BLIND_KEY_FILE) on the service. Keep it out of the
 * database and its backups. The PUBLIC half is served to browsers at /api/blind/key, so
 * the file is only needed on the service. Rotating it invalidates tokens already issued
 * for open cards, so rotate between rounds.
 */
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
process.stdout.write(privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.stderr.write('Set BENCHMARK_BLIND_KEY to this value. It blind-signs ballots; it is not the break-glass key.\n');
