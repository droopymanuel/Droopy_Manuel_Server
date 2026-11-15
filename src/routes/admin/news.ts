import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../../auth/middleware.js';
import { recordAudit } from '../../auth/users.js';
import { getNewsItem } from '../../repositories/news.js';
import { getNewsSection } from '../../repositories/news-sections.js';
import {
	createNewsSection,
	deleteNewsSection,
	updateNewsSection,
	type NewsSectionInput
} from '../../repositories/news-sections-write.js';
import {
	createNews,
	deleteNews,
	updateNews,
	type NewsInput
} from '../../repositories/news-write.js';
import { ValidationError } from '../../repositories/validation.js';
import { asyncHandler, badRequest, notFound, routeParam } from '../helpers.js';

/** Administración de noticias. */
const router = Router();

function handleValidation(error: unknown, res: Response): void {
	if (error instanceof ValidationError) {
		badRequest(res, error.message);
		return;
	}
	throw error;
}

/** Extrae el `id` numérico de la ruta. */
function routeSectionId(req: Request, res: Response): number | null {
	const raw = routeParam(req, res, 'id');
	if (raw === null) return null;
	const id = Number(raw);
	if (!Number.isInteger(id) || id < 1) {
		badRequest(res, 'El "id" debe ser un entero mayor que cero.');
		return null;
	}
	return id;
}

/** POST /api/admin/news */
router.post(
	'/',
	requireAdmin(),
	asyncHandler(async (req: Request, res: Response) => {
		try {
			const item = await createNews(req.body as NewsInput);
			await recordAudit({
				userId: req.adminUser?.id,
				entity: 'news',
				entityKey: item.slug,
				action: 'crear',
				after: item
			});
			res.status(201).json(item);
		} catch (error) {
			handleValidation(error, res);
		}
	})
);

/** PATCH /api/admin/news/:slug */
router.patch(
	'/:slug',
	requireAdmin(),
	asyncHandler(async (req: Request, res: Response) => {
		const slug = routeParam(req, res, 'slug');
		if (slug === null) return;

		const before = await getNewsItem(slug);
		if (!before) {
			notFound(res, `No existe la noticia "${slug}".`);
			return;
		}

		try {
			const item = await updateNews(slug, req.body as NewsInput);
			if (!item) {
				notFound(res, `No existe la noticia "${slug}".`);
				return;
			}
			await recordAudit({
				userId: req.adminUser?.id,
				entity: 'news',
				entityKey: slug,
				action: 'editar',
				before,
				after: item
			});
			res.json(item);
		} catch (error) {
			handleValidation(error, res);
		}
	})
);

/** DELETE /api/admin/news/:slug — solo `admin`. */
router.delete(
	'/:slug',
	requireAdmin('admin'),
	asyncHandler(async (req: Request, res: Response) => {
		const slug = routeParam(req, res, 'slug');
		if (slug === null) return;

		const before = await getNewsItem(slug);
		if (!before) {
			notFound(res, `No existe la noticia "${slug}".`);
			return;
		}

		await deleteNews(slug);
		await recordAudit({
			userId: req.adminUser?.id,
			entity: 'news',
			entityKey: slug,
			action: 'borrar',
			before
		});
		res.status(204).end();
	})
);

// ------------------------------------------------ Secciones del cuerpo

/** POST /api/admin/news/:slug/sections — agrega una sección a la noticia. */
router.post(
	'/:slug/sections',
	requireAdmin(),
	asyncHandler(async (req: Request, res: Response) => {
		const slug = routeParam(req, res, 'slug');
		if (slug === null) return;

		const news = await getNewsItem(slug);
		if (!news) {
			notFound(res, `No existe la noticia "${slug}".`);
			return;
		}

		try {
			const section = await createNewsSection(slug, req.body as NewsSectionInput);
			await recordAudit({
				userId: req.adminUser?.id,
				entity: 'news_sections',
				entityKey: `${slug}:${section.id}`,
				action: 'crear',
				after: section
			});
			res.status(201).json(section);
		} catch (error) {
			handleValidation(error, res);
		}
	})
);

/** PATCH /api/admin/news/:slug/sections/:id — edita campos sueltos. */
router.patch(
	'/:slug/sections/:id',
	requireAdmin(),
	asyncHandler(async (req: Request, res: Response) => {
		const slug = routeParam(req, res, 'slug');
		if (slug === null) return;
		const id = routeSectionId(req, res);
		if (id === null) return;

		const before = await getNewsSection(slug, id);
		if (!before) {
			notFound(res, `No existe la sección "${id}".`);
			return;
		}

		try {
			const section = await updateNewsSection(slug, id, req.body as NewsSectionInput);
			if (!section) {
				notFound(res, `No existe la sección "${id}".`);
				return;
			}

			await recordAudit({
				userId: req.adminUser?.id,
				entity: 'news_sections',
				entityKey: `${slug}:${id}`,
				action: 'editar',
				before,
				after: section
			});
			res.json(section);
		} catch (error) {
			handleValidation(error, res);
		}
	})
);

/** DELETE /api/admin/news/:slug/sections/:id — solo `admin`. */
router.delete(
	'/:slug/sections/:id',
	requireAdmin('admin'),
	asyncHandler(async (req: Request, res: Response) => {
		const slug = routeParam(req, res, 'slug');
		if (slug === null) return;
		const id = routeSectionId(req, res);
		if (id === null) return;

		const before = await getNewsSection(slug, id);
		if (!before) {
			notFound(res, `No existe la sección "${id}".`);
			return;
		}

		await deleteNewsSection(slug, id);
		await recordAudit({
			userId: req.adminUser?.id,
			entity: 'news_sections',
			entityKey: `${slug}:${id}`,
			action: 'borrar',
			before
		});
		res.status(204).end();
	})
);

export default router;
