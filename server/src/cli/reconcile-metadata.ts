import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { reconcileMetadata } from '../services/metadata-reconciler.js';
import { validateMixcloudMetadata } from '../services/mixcloud-validator.js';

async function run() {
  const allEpisodes = await db.select().from(episodes);
  for (const episode of allEpisodes) {
    console.log(`Reconciling ${episode.id}: ${episode.title}`);
    const reconciled = await reconcileMetadata(episode);
    const isValid = await validateMixcloudMetadata(reconciled.title);
    
    await db
      .update(episodes)
      .set({ title: reconciled.title })
      .where(eq(episodes.id, episode.id));
      
    console.log(`Updated title: ${reconciled.title}, Mixcloud validation: ${isValid}`);
  }
}

run().catch(console.error);
