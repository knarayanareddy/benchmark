#!/usr/bin/env node
/**
 * Generate the break-glass key pair.
 *
 *   node packages/service/bin/breakglass-keygen.mjs > breakglass.pem
 *
 * The PUBLIC key goes to the service (BENCHMARK_BREAKGLASS_PUBLIC_KEY): it only
 * seals. The PRIVATE key opens, so keep it OFFLINE with the people who may
 * approve an opening, not on the running service. A moderator supplies it when
 * they collect an approved request. Without it, nothing can be opened.
 */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.stdout.write(`${pub}\n${priv}`);
process.stderr.write('Public key: set BENCHMARK_BREAKGLASS_PUBLIC_KEY on the service.\nPrivate key: store OFFLINE; it is the only thing that can open a sealed note.\n');
