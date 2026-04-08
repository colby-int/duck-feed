process.env.DATABASE_URL ??= 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
process.env.SESSION_SECRET ??= 'x'.repeat(64);
process.env.LOG_LEVEL ??= 'silent';
