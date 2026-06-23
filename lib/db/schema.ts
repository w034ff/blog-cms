import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable("posts", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("uncategorized"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  draft: integer("draft", { mode: "boolean" }).notNull().default(false),
  body: text("body").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});
