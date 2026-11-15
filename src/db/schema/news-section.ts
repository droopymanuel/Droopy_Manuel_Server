import { index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { newsSectionKindEnum } from './enums.js';
import { news } from './news.js';

/**
 * Secciones editables del cuerpo de una noticia.
 *
 * Mismo patrón que `project_sections`, pero cada fila pertenece a una noticia:
 * `position` es único **por noticia** y el frontend las ordena por ese campo.
 * `title` nulo = sin encabezado visible. `body` son párrafos en texto plano;
 * `**negrita**` es el único formato.
 */
export const newsSections = pgTable(
	'news_sections',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		newsSlug: varchar('news_slug', { length: 160 })
			.notNull()
			.references(() => news.slug, { onUpdate: 'cascade', onDelete: 'cascade' }),
		position: integer('position').notNull(),
		kind: newsSectionKindEnum('kind').notNull(),
		title: varchar('title', { length: 255 }),
		body: text('body').array().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('news_sections_news_position_unique').on(table.newsSlug, table.position),
		index('news_sections_news_idx').on(table.newsSlug)
	]
);

export type NewsSectionRow = typeof newsSections.$inferSelect;
export type NewNewsSectionRow = typeof newsSections.$inferInsert;
