import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, pending, clearQueue } from './queue.js';

describe('the offline queue and sign-out', () => {
  beforeEach(async () => { await clearQueue(); });

  it('clearQueue forgets every waiting answer, including the context the person added', async () => {
    await enqueue('C1', 0.4, { reason: 'private reasoning', confidence: 3 });
    await enqueue('C2', 0.6);
    expect((await pending()).length).toBe(2);
    await clearQueue();
    expect(await pending()).toEqual([]);
  });
});
