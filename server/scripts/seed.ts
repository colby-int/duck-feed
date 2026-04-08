// Seed the initial admin user.
// Usage: npx tsx scripts/seed.ts [username] [password]
// If no args provided, prompts via stdin.

import bcrypt from 'bcrypt';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, exit } from 'node:process';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: !hidden });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const argUsername = process.argv[2];
  const argPassword = process.argv[3];

  const username = argUsername ?? (await prompt('Admin username: '));
  if (!username) {
    console.error('Username is required');
    exit(1);
  }

  const password = argPassword ?? (await prompt('Admin password: ', true));
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters');
    exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await db.select().from(users).where(eq(users.username, username));

  if (existing.length > 0) {
    await db.update(users).set({ passwordHash }).where(eq(users.username, username));
    console.log(`Updated password for existing user: ${username}`);
  } else {
    await db.insert(users).values({ username, passwordHash });
    console.log(`Created admin user: ${username}`);
  }

  exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  exit(1);
});
