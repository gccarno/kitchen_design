import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Project } from '../plan/schemas';

/**
 * One row per project. `doc` is the whole Project document (validated with
 * ProjectSchema on every read and write); the other columns copy the fields
 * the list and option-group queries filter and sort on.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    /** The owning user. Null until accounts arrive (Phase 2). */
    ownerId: uuid('owner_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    optionOf: uuid('option_of'),
    revision: integer('revision').notNull(),
    doc: jsonb('doc').$type<Project>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [index('projects_owner_updated_idx').on(t.ownerId, t.updatedAt), index('projects_option_of_idx').on(t.optionOf)]
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** Session tokens; only the SHA-256 digest of the token is stored. */
export const authTokens = pgTable('auth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
});
