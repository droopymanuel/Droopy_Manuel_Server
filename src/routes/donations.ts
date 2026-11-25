import { Router, type Request, type Response } from 'express';
import {
	InvalidWebhookSignatureError,
	Payment,
	Preference,
	WebhookSignatureValidator
} from 'mercadopago';
import {
	donationCurrency,
	donationNotificationUrl,
	mercadopagoClient,
	webhookSecret
} from '../payments/mercadopago.js';
import { findDonationStatus, findDonationTier, saveDonationPayment } from '../repositories/donations.js';
import { asyncHandler, badRequest, notFound, queryParam } from './helpers.js';

/**
 * Donaciones con Mercado Pago.
 *
 * El checkout crea la preferencia de Checkout Pro. El webhook recibe el aviso
 * del pago, lo vuelve a consultar en Mercado Pago y lo guarda en la base.
 *
 * El prefijo es `/api/donations`.
 */
const router = Router();

/** URL pública del frontend, sin barra final. */
function frontendUrl(req: Request): string {
	const configured = process.env.FRONTEND_URL?.trim().replace(/\/+$/, '');
	const origin = req.get('origin')?.trim().replace(/\/+$/, '');

	// Mercado Pago solo acepta back URLs https. Si hay una URL pública https
	// configurada (túnel o producción), esa manda.
	if (configured?.startsWith('https://')) {
		return configured;
	}

	// En local, Vite puede saltar de 5173 a 5174; volvemos al origen real.
	if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
		return origin;
	}

	return configured || 'http://localhost:5173';
}

/** Página única de resultado; renderiza según el estado guardado en la base. */
const RESULT_PATH = '/dona-estrellas/estado';

/**
 * URL de retorno por estado.
 *
 * Prioridad: `MERCADOPAGO_BACK_URL_<ESTADO>`, luego `MERCADOPAGO_BACK_URL`
 * (una sola URL para los tres) y al final la página única de resultado.
 * Mercado Pago solo acepta https; si la URL no lo es se omite para no enviar
 * un valor que el proveedor va a descartar.
 */
function returnUrl(req: Request, status: 'success' | 'pending' | 'failure'): string | undefined {
	const key = `MERCADOPAGO_BACK_URL_${status.toUpperCase()}`;
	const url =
		process.env[key]?.trim() ||
		process.env.MERCADOPAGO_BACK_URL?.trim() ||
		`${frontendUrl(req)}${RESULT_PATH}`;

	return url.startsWith('https://') ? url : undefined;
}

/** POST /api/donations/checkout */
router.post(
	'/checkout',
	asyncHandler(async (req: Request, res: Response) => {
		const stars = Number((req.body as { stars?: unknown } | null)?.stars);

		if (!Number.isInteger(stars) || stars <= 0) {
			badRequest(res, 'Elige un nivel de estrellas válido.');
			return;
		}

		const tier = await findDonationTier(stars);
		if (!tier) {
			notFound(res, 'Ese nivel de estrellas no existe.');
			return;
		}

		if (!Number.isInteger(tier.priceCents) || tier.priceCents <= 0) {
			res.status(500).json({
				error: 'internal_error',
				message: 'El nivel de donación no tiene un precio válido.'
			});
			return;
		}

		const backUrls = {
			success: returnUrl(req, 'success'),
			pending: returnUrl(req, 'pending'),
			failure: returnUrl(req, 'failure')
		};
		const acceptsBackUrl = Boolean(backUrls.success);
		const notificationUrl = donationNotificationUrl();

		if (!acceptsBackUrl) {
			console.warn(
				'[mercadopago] back_urls solo funciona con https; en local no habrá retorno automático.'
			);
		}

		if (!notificationUrl) {
			console.warn(
				'[mercadopago] sin notification_url: define SERVER_PUBLIC_URL (https) para que el webhook guarde la donación.'
			);
		}

		try {
			const preference = new Preference(mercadopagoClient());
			const result = await preference.create({
				body: {
					items: [
						{
							id: `estrellas-${tier.stars}`,
							title: `${tier.name} · ${tier.stars} ${tier.stars === 1 ? 'estrella' : 'estrellas'}`,
							description: tier.blurb,
							quantity: 1,
							currency_id: donationCurrency(),
							unit_price: tier.priceCents / 100
						}
					],
					external_reference: `donacion:${tier.stars}:-:${crypto.randomUUID()}`,
					statement_descriptor: 'DROOPY MANUEL',
					// Mercado Pago avisa cada cambio de estado; sin esta URL
					// el pago se completaría pero no quedaría guardado.
					notification_url: notificationUrl,
					// Cada estado vuelve a su propia página: gracias, pendiente o error.
					back_urls: acceptsBackUrl ? backUrls : undefined,
					// `auto_return` exige back URLs https; en local se omite.
					auto_return: acceptsBackUrl ? 'approved' : undefined
				}
			});

			const initPoint = result.init_point ?? result.sandbox_init_point;
			if (!result.id || !initPoint) {
				throw new Error('Mercado Pago no devolvió un enlace de pago.');
			}

			res.status(201).json({ preferenceId: result.id, initPoint });
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			console.error('[mercadopago] no se pudo crear la preferencia:', detail);
			res.status(502).json({
				error: 'payment_provider_error',
				message: 'No pudimos abrir el pago. Intenta de nuevo en un momento.'
			});
		}
	})
);

/**
 * GET /api/donations/status?external_reference=…
 *
 * Lo consulta la página de resultado al volver de Mercado Pago. Si todavía no
 * hay webhook guardado, responde 404 y el front muestra «pendiente».
 */
router.get(
	'/status',
	asyncHandler(async (req: Request, res: Response) => {
		const externalReference = queryParam(req, 'external_reference');
		if (!externalReference) {
			badRequest(res, 'Falta external_reference.');
			return;
		}

		const donation = await findDonationStatus(externalReference);
		if (!donation) {
			notFound(res, 'No encontramos esa donación.');
			return;
		}

		res.set('Cache-Control', 'no-store');
		res.json(donation);
	})
);

/** Nivel de estrellas guardado en `external_reference` (`donacion:<stars>:...`). */
function starsFromReference(reference: string): number | null {
	const [prefix, rawStars] = reference.split(':');
	if (prefix !== 'donacion') return null;

	const stars = Number(rawStars);
	return Number.isInteger(stars) && stars > 0 ? stars : null;
}

/** Identificador del pago: viene en la query (`data.id`) o en el cuerpo. */
function webhookDataId(req: Request, body: unknown): string | undefined {
	const fromQuery = queryParam(req, 'data.id');
	if (fromQuery) return fromQuery;

	const data = (body as { data?: { id?: unknown } } | null)?.data;
	if (typeof data?.id === 'string' && data.id.trim() !== '') return data.id;
	if (typeof data?.id === 'number') return String(data.id);

	return undefined;
}

/** Tipo de aviso: `payment`, `merchant_order`… */
function webhookType(req: Request, body: unknown): string | undefined {
	const payload = (body ?? {}) as { type?: unknown; topic?: unknown };
	const fromBody = payload.type ?? payload.topic;
	const value = queryParam(req, 'type') ?? queryParam(req, 'topic') ?? fromBody;

	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Fecha ISO de Mercado Pago, o `null` si viene vacía o inválida. */
function parsePaymentDate(value: string | undefined): Date | null {
	if (!value) return null;

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * POST /api/donations/webhook — aviso de Mercado Pago.
 *
 * Nunca se confía en el cuerpo: se toma el `data.id` y se consulta el pago
 * con el access token. Así el monto, el estado y el correo salen del
 * proveedor y una notificación falsa no puede inventarlos.
 *
 * Si `MERCADOPAGO_WEBHOOK_SECRET` está definido también se exige la firma
 * `x-signature`. Responder 2xx confirma el aviso; un error 5xx hace que
 * Mercado Pago lo reintente.
 */
router.post(
	'/webhook',
	asyncHandler(async (req: Request, res: Response) => {
		const body: unknown = req.body;
		const type = webhookType(req, body);

		// Mercado Pago también avisa de órdenes; el pago llega por su propio
		// aviso. Se confirma para que no reintente algo que no usamos.
		if (type && type !== 'payment') {
			res.status(200).json({ ok: true, ignored: type });
			return;
		}

		const dataId = webhookDataId(req, body);
		if (!dataId) {
			console.warn('[mercadopago] webhook sin data.id; se ignora.');
			res.status(200).json({ ok: true, ignored: 'sin data.id' });
			return;
		}

		const secret = webhookSecret();
		if (secret) {
			try {
				WebhookSignatureValidator.validate({
					xSignature: req.get('x-signature'),
					xRequestId: req.get('x-request-id'),
					dataId,
					secret,
					toleranceSeconds: 300
				});
			} catch (error) {
				const reason =
					error instanceof InvalidWebhookSignatureError ? error.reason : 'desconocido';
				console.warn(`[mercadopago] firma de webhook inválida (${reason}).`);
				res.status(401).json({ error: 'invalid_signature' });
				return;
			}
		} else if (process.env.NODE_ENV === 'production') {
			console.warn(
				'[mercadopago] webhook sin MERCADOPAGO_WEBHOOK_SECRET; se acepta solo porque los datos se releen de la API.'
			);
		}

		try {
			const payment = await new Payment(mercadopagoClient()).get({ id: dataId });

			const paymentId = String(payment.id ?? dataId);
			const externalReference = (
				payment.external_reference?.trim() || `mp:${paymentId}`
			).slice(0, 255);
			const amount =
				typeof payment.transaction_amount === 'number' ? payment.transaction_amount : 0;
			const donorName = [payment.payer?.first_name, payment.payer?.last_name]
				.filter((part): part is string => Boolean(part?.trim()))
				.join(' ')
				.trim();

			await saveDonationPayment({
				externalReference,
				paymentId,
				status: payment.status?.trim() || 'unknown',
				statusDetail: payment.status_detail?.trim().slice(0, 120) || null,
				stars: starsFromReference(externalReference),
				amountCents: Math.max(0, Math.round(amount * 100)),
				currency: payment.currency_id?.trim().toUpperCase() || donationCurrency(),
				donorName: donorName.slice(0, 255) || null,
				donorEmail: payment.payer?.email?.trim().slice(0, 255) || null,
				paymentMethod: payment.payment_method_id?.trim().slice(0, 60) || null,
				liveMode: payment.live_mode === true,
				paidAt: parsePaymentDate(payment.date_approved)
			});

			console.log(
				`[mercadopago] pago ${paymentId} guardado (${payment.status ?? 'sin estado'}).`
			);
			res.status(200).json({ ok: true });
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			console.error(`[mercadopago] no se pudo guardar el pago ${dataId}:`, detail);
			// 5xx para que Mercado Pago reintente el aviso.
			res.status(502).json({
				error: 'payment_provider_error',
				message: 'No pudimos guardar la donación. Se reintentará.'
			});
		}
	})
);

export default router;
