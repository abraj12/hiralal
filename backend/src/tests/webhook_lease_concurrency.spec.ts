import { prisma } from '../db';

describe('Finding 10 Regression Suite: Webhook Processing Lease & Stale Worker CAS Finalization', () => {
  const testEventId = 'evt_test_lease_concurrency_001';

  beforeAll(async () => {
    await prisma.webhookEvent.deleteMany({
      where: { eventId: testEventId },
    });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.$disconnect();
  });

  it('prevents stale worker from finalizing when lease has been taken over by another worker', async () => {
    // 1. Seed initial webhook event
    const initialEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'RAZORPAYX',
        eventId: testEventId,
        eventType: 'payout.processed',
        payload: { test: true },
        isProcessed: false,
        attempts: 1,
        // Lease was started 200 seconds ago (> 180s threshold)
        processingStartedAt: new Date(Date.now() - 200 * 1000),
      },
    });

    const staleWorkerClaimedAttempts = 1;

    // 2. A new worker B claims the expired lease using atomic database clock check
    const claimedRows = await prisma.$queryRaw<Array<{ id: string; attempts: number }>>`
      UPDATE "WebhookEvent"
      SET "processingStartedAt" = clock_timestamp() AT TIME ZONE 'UTC',
          "attempts" = "attempts" + 1
      WHERE "provider" = 'RAZORPAYX'
        AND "eventId" = ${testEventId}
        AND "isProcessed" = false
        AND (
          "processingStartedAt" IS NULL
          OR "processingStartedAt" < (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '180 seconds'
        )
      RETURNING "id", "attempts";
    `;

    expect(claimedRows).toHaveLength(1);
    const workerBClaimedAttempts = claimedRows[0].attempts;
    expect(workerBClaimedAttempts).toBe(2);

    // 3. Stale worker A (with attempts = 1) attempts CAS finalization
    const staleFinalized = await prisma.webhookEvent.updateMany({
      where: {
        provider: 'RAZORPAYX',
        eventId: testEventId,
        attempts: staleWorkerClaimedAttempts,
        isProcessed: false,
      },
      data: {
        isProcessed: true,
        processedAt: new Date(),
        processingStartedAt: null,
      },
    });

    // Stale worker finalization MUST be rejected (0 rows updated)
    expect(staleFinalized.count).toBe(0);

    const eventAfterStaleAttempt = await prisma.webhookEvent.findUnique({
      where: { provider_event_unique: { provider: 'RAZORPAYX', eventId: testEventId } },
    });
    expect(eventAfterStaleAttempt?.isProcessed).toBe(false);

    // 4. Active worker B (with attempts = 2) executes CAS finalization
    const validFinalized = await prisma.webhookEvent.updateMany({
      where: {
        provider: 'RAZORPAYX',
        eventId: testEventId,
        attempts: workerBClaimedAttempts,
        isProcessed: false,
      },
      data: {
        isProcessed: true,
        processedAt: new Date(),
        processingStartedAt: null,
      },
    });

    expect(validFinalized.count).toBe(1);

    const finalizedEvent = await prisma.webhookEvent.findUnique({
      where: { provider_event_unique: { provider: 'RAZORPAYX', eventId: testEventId } },
    });
    expect(finalizedEvent?.isProcessed).toBe(true);
  });
});
