import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { newsSections } from '../db/schema/index.js';
import type { NewsSection } from '../types.js';
import { toNewsSection } from './mappers.js';

/**
 * Lectura de las secciones del cuerpo de una noticia.
 *
 * El orden lo da `position`: el frontend las muestra en ese orden sin
 * reordenar nada por su cuenta.
 */
export async function getNewsSections(newsSlug: string): Promise<NewsSection[]> {
	const rows = await db
		.select()
		.from(newsSections)
		.where(eq(newsSections.newsSlug, newsSlug))
		.orderBy(asc(newsSections.position), asc(newsSections.id));
	return rows.map(toNewsSection);
}

export async function getNewsSection(
	newsSlug: string,
	id: number
): Promise<NewsSection | undefined> {
	const [row] = await db
		.select()
		.from(newsSections)
		.where(and(eq(newsSections.newsSlug, newsSlug), eq(newsSections.id, id)))
		.limit(1);
	return row ? toNewsSection(row) : undefined;
}

/** Todas las secciones, agrupables por `newsSlug` (lo usa el panel). */
export async function getAllNewsSections(): Promise<NewsSection[]> {
	const rows = await db
		.select()
		.from(newsSections)
		.orderBy(asc(newsSections.newsSlug), asc(newsSections.position), asc(newsSections.id));
	return rows.map(toNewsSection);
}
