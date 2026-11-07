import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetKv } from './lib/kv.js';

afterEach(async () => { cleanup(); await resetKv(); });
