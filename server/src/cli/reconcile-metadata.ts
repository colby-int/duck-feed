import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { reconcileMetadata } from '../services/metadata-reconciler.js';
import { validateMixcloudMetadata } from '../services/mixcloud-validator.js';

async function run() {
  const allEpisodes = await db.select().from(episodes);
  for (const episode of allEpisodes) {
    console.log(`Reconciling ${episode.id}: ${episode.title}`);
    const reconciled = reconcileMetadata(episode);
    const isValid = await validateMixcloudMetadata(reconciled.mixcloudTitle);

    await db
      .update(episodes)
      .set({
        title: reconciled.title,
        presenter: reconciled.presenter,
        ...(reconciled.broadcastDate ? { broadcastDate: reconciled.broadcastDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episode.id));

    console.log(
      `  → title: ${reconciled.title}` +
        `${reconciled.presenter ? ` | presenter: ${reconciled.presenter}` : ''}` +
        `${reconciled.broadcastDate ? ` | date: ${reconciled.broadcastDate}` : ''}` +
        ` | mixcloud: ${reconciled.mixcloudTitle}` +
        ` | valid: ${isValid}`,
    );
  }
}

run().catch(console.error);
