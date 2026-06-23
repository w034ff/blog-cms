import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import matter from 'gray-matter';

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const DB_PATH = path.join(ROOT, 'data', 'blog.db');

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

  const db = new Database(DB_PATH);
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, date, description, category, tags, draft, body, created_at, updated_at)
     VALUES (@slug, @title, @date, @description, @category, @tags, @draft, @body, @now, @now)
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, date=excluded.date, description=excluded.description,
       category=excluded.category, tags=excluded.tags, draft=excluded.draft,
       body=excluded.body, updated_at=excluded.updated_at`,
  );

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
    insert.run({
      slug,
      title: fm.title,
      date: fm.date,
      description: fm.description ?? '',
      category: fm.category ?? 'uncategorized',
      tags: JSON.stringify(Array.isArray(fm.tags) ? fm.tags : []),
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
