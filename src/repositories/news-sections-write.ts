import { and, asc, desc, eq, gt, gte, lt, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { newsSections } from '../db/schema/index.js';
import type { NewsSection, NewsSectionKind } from '../types.js';
import { NEWS_SECTION_KINDS } from '../types.js';
import { toNewsSection } from './mappers.js';
import {
	ValidationError,
	requireEnum,
	requireInt,
	requireString,
	requireStringArray
} from './validation.js';

/**
 * Escritura de las secciones del cuerpo de una noticia (panel).
 *
 * Igual que `project-write.ts`, pero todo va filtrado por `newsSlug` porque
 * `position` es único **por noticia**. Al crear o mover una sección a una
 * posición ocupada, las demás de esa noticia se recorren; los corrimientos se
 * hacen fila por fila dentro de una transacción, de mayor a menor al subir y
 * de menor a mayor al bajar, para no chocar con la restricción de unicidad a
 * mitad de camino.
 */

/** Transacción de drizzle, para los corrimientos de posición. */
type NewsSectionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Campos que acepta el panel al crear o editar una sección. */
export interface NewsSectionInput {
	position?: number;
	kind?: NewsSectionKind;
	/** Título visible. `null` o vacío = sin encabezado. */
	title?: string | null;
	/** Párrafos en texto plano. `**negrita**` es el único formato. */
	body?: string[];
}

/** Título opcional: ausente o vacío se guarda como NULL (sin encabezado). */
function optionalTitle(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	const text = String(value).trim();
	if (text === '') return null;
	return requireString(text, 'title', 255);
}

/** Valida título y cuerpo según la clase efectiva de la sección. */
function buildValues(
	input: NewsSectionInput,
	partial: boolean,
	effectiveKind?: NewsSectionKind
) {
	const values: {
		kind?: NewsSectionKind;
		title?: string | null;
		body?: string[];
		position?: number;
	} = {};

	const kind =
		!partial || input.kind !== undefined
			? requireEnum(input.kind, [...NEWS_SECTION_KINDS], 'kind')
			: effectiveKind;
	if (kind !== undefined) values.kind = kind;

	if (!partial || input.title !== undefined) {
		values.title = optionalTitle(input.title);
	}

	if (!partial || input.body !== undefined) {
		// Al crear, el cuerpo ausente (portada sin texto) equivale a vacío: la
		// regla de mínimo un párrafo lo acepta solo para `hero`.
		const body = input.body === undefined ? [] : requireStringArray(input.body, 'body');
		// La portada es solo el titular: el resto necesita al menos un párrafo.
		if (kind !== 'hero' && body.length === 0) {
			throw new ValidationError('El campo "body" debe tener al menos un párrafo.');
		}
		if (kind === undefined) {
			throw new ValidationError('Falta la clase de la sección ("kind").');
		}
		values.body = body;
	}

	return values;
}

/** Sube una posición a las filas de la noticia con `position >= from`. */
async function shiftUp(tx: NewsSectionTx, newsSlug: string, from: number): Promise<void> {
	const rows = await tx
		.select({ id: newsSections.id, position: newsSections.position })
		.from(newsSections)
		.where(and(eq(newsSections.newsSlug, newsSlug), gte(newsSections.position, from)))
		.orderBy(desc(newsSections.position));
	for (const row of rows) {
		await tx
			.update(newsSections)
			.set({ position: row.position + 1, updatedAt: new Date() })
			.where(eq(newsSections.id, row.id));
	}
}

/**
 * Mueve el hueco de `oldPosition` a `newPosition` dentro de la noticia.
 *
 * Debe correrse antes de escribir la nueva posición de la sección movida.
 *
 * La sección movida se saca primero a una posición temporal (`-id`, siempre
 * libre porque las reales son >= 1): si no, al recorrer las demás chocan con
 * la restricción única `(news_slug, position)` a mitad de camino.
 */
async function moveGap(
	tx: NewsSectionTx,
	newsSlug: string,
	id: number,
	oldPosition: number,
	newPosition: number
): Promise<void> {
	await tx
		.update(newsSections)
		.set({ position: -id, updatedAt: new Date() })
		.where(and(eq(newsSections.newsSlug, newsSlug), eq(newsSections.id, id)));

	if (newPosition < oldPosition) {
		// Sube: las filas [newPosition, oldPosition) suben un puesto.
		const rows = await tx
			.select({ id: newsSections.id, position: newsSections.position })
			.from(newsSections)
			.where(
				and(
					eq(newsSections.newsSlug, newsSlug),
					gte(newsSections.position, newPosition),
					lt(newsSections.position, oldPosition)
				)
			)
			.orderBy(desc(newsSections.position));
		for (const row of rows) {
			await tx
				.update(newsSections)
				.set({ position: row.position + 1, updatedAt: new Date() })
				.where(eq(newsSections.id, row.id));
		}
	} else {
		// Baja: las filas (oldPosition, newPosition] bajan un puesto.
		const rows = await tx
			.select({ id: newsSections.id, position: newsSections.position })
			.from(newsSections)
			.where(
				and(
					eq(newsSections.newsSlug, newsSlug),
					gt(newsSections.position, oldPosition),
					lte(newsSections.position, newPosition)
				)
			)
			.orderBy(asc(newsSections.position));
		for (const row of rows) {
			await tx
				.update(newsSections)
				.set({ position: row.position - 1, updatedAt: new Date() })
				.where(eq(newsSections.id, row.id));
		}
	}
}

export async function createNewsSection(
	newsSlug: string,
	input: NewsSectionInput
): Promise<NewsSection> {
	const values = buildValues(input, false);
	// Sin `partial`, clase y cuerpo siempre vienen validados: esto es red de
	// seguridad para el tipado del `insert`.
	if (values.kind === undefined || values.body === undefined) {
		throw new ValidationError('El campo "kind" es obligatorio.');
	}
	const { kind, body } = values;

	return db.transaction(async (tx) => {
		let position: number;
		if (input.position === undefined) {
			// Sin posición: al final de esta noticia.
			const [top] = await tx
				.select({ position: newsSections.position })
				.from(newsSections)
				.where(eq(newsSections.newsSlug, newsSlug))
				.orderBy(desc(newsSections.position))
				.limit(1);
			position = (top?.position ?? 0) + 1;
		} else {
			// Con posición ocupada: se inserta ahí y el resto se recorre.
			position = requireInt(input.position, 'position', 1);
			await shiftUp(tx, newsSlug, position);
		}

		const [row] = await tx
			.insert(newsSections)
			.values({ newsSlug, kind, title: values.title ?? null, body, position })
			.returning();

		if (!row) throw new Error('No se pudo crear la sección.');
		return toNewsSection(row);
	});
}

export async function updateNewsSection(
	newsSlug: string,
	id: number,
	input: NewsSectionInput
): Promise<NewsSection | undefined> {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(newsSections)
			.where(and(eq(newsSections.newsSlug, newsSlug), eq(newsSections.id, id)))
			.limit(1);
		if (!current) return undefined;

		const values = buildValues(input, true, current.kind);
		// La clase o el cuerpo pueden venir de antes: el resultado efectivo
		// también debe cumplir (un capítulo sin párrafos quedaría vacío).
		const effectiveKind = values.kind ?? current.kind;
		const effectiveBody = values.body ?? current.body;
		if (effectiveKind !== 'hero' && effectiveBody.length === 0) {
			throw new ValidationError('El campo "body" debe tener al menos un párrafo.');
		}
		if (input.position !== undefined) {
			const next = requireInt(input.position, 'position', 1);
			if (next !== current.position) {
				await moveGap(tx, newsSlug, id, current.position, next);
				values.position = next;
			}
		}

		if (Object.keys(values).length === 0) {
			throw new ValidationError('No se envió ningún campo para actualizar.');
		}

		const [row] = await tx
			.update(newsSections)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(newsSections.id, id))
			.returning();

		return row ? toNewsSection(row) : undefined;
	});
}

export async function deleteNewsSection(newsSlug: string, id: number): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({ position: newsSections.position })
			.from(newsSections)
			.where(and(eq(newsSections.newsSlug, newsSlug), eq(newsSections.id, id)))
			.limit(1);
		if (!current) return false;

		await tx.delete(newsSections).where(eq(newsSections.id, id));

		// Se cierra el hueco: las que estaban encima bajan un puesto.
		const following = await tx
			.select({ id: newsSections.id, position: newsSections.position })
			.from(newsSections)
			.where(
				and(
					eq(newsSections.newsSlug, newsSlug),
					gt(newsSections.position, current.position)
				)
			)
			.orderBy(asc(newsSections.position));
		for (const row of following) {
			await tx
				.update(newsSections)
				.set({ position: row.position - 1, updatedAt: new Date() })
				.where(eq(newsSections.id, row.id));
		}

		return true;
	});
}
