import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';
import { CATEGORIES, normalizeCategory } from '../lib/content.ts';

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const DB_PATH = resolveDbPath();

type Frontmatter = {
  title?: string;
  date?: string;
  description?: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
};

function main(): void {
  if (!existsSync(POSTS_DIR)) {
    console.log(`No content dir at ${POSTS_DIR}; nothing to migrate.`);
    return;
  }

  const db = openDb(DB_PATH);
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, date, description, category, tags, draft, body, created_at, updated_at, edited_at)
     VALUES (@slug, @title, @date, @description, @category, @tags, @draft, @body, @now, @now, @now)
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, date=excluded.date, description=excluded.description,
       category=excluded.category, tags=excluded.tags, draft=excluded.draft,
       body=excluded.body, updated_at=excluded.updated_at, edited_at=excluded.edited_at`,
  );

  // Tags are dictionary slugs (docs/editor-requirements.md §12.33), and unknown ones are dropped on
  // read, so frontmatter tags are admitted as-is (drizzle/0010's rule).
  const admitTag = db.prepare(`INSERT OR IGNORE INTO tags (slug, name) VALUES (?, ?)`);

  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
  let count = 0;
  for (const file of files) {
    const slug = file.slice(0, -'.mdx'.length);
    const parsed = matter(readFileSync(path.join(POSTS_DIR, file), 'utf8'));
    const fm = parsed.data as Frontmatter;
    if (!fm.title || !fm.date) {
      console.warn(`Skipping ${file}: missing title/date`);
      continue;
    }
    const tags = Array.isArray(fm.tags)
      ? fm.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
      : [];
    for (const tag of tags) admitTag.run(tag, tag);
    insert.run({
      slug,
      title: fm.title,
      date: fm.date,
      description: fm.description ?? '',
      // A published post has a category (§12.32), so a missing one takes the list's first.
      category: normalizeCategory(fm.category) || CATEGORIES[0].id,
      tags: JSON.stringify(tags),
      draft: fm.draft ? 1 : 0,
      body: parsed.content.trim(),
      now: new Date().toISOString(),
    });
    count += 1;
    console.log(`migrated: ${slug}`);
  }

  db.close();
  console.log(`Done. ${count} post(s) migrated.`);
}

main();
