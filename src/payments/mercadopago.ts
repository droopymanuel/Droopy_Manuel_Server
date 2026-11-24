import { MercadoPagoConfig } from 'mercadopago';

/**
 * Cliente de Mercado Pago y configuración del checkout de donaciones.
 *
 * Es perezoso a propósito: el server arranca aunque falte el token; el error
 * aparece recién cuando algo intenta usar Mercado Pago.
 */
let client: MercadoPagoConfig | null = null;

export function mercadopagoClient(): MercadoPagoConfig {
	const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

	if (!accessToken) {
		throw new Error(
			'Falta MERCADOPAGO_ACCESS_TOKEN (Server/.env en local, dashboard en Render).'
		);
	}

	client ??= new MercadoPagoConfig({ accessToken });
	return client;
}

/** Moneda de la cuenta de Mercado Pago (ISO 4217). Colombia: COP. */
export function donationCurrency(): string {
	return process.env.MERCADOPAGO_CURRENCY?.trim().toUpperCase() || 'COP';
}

/**
 * URL pública a la que Mercado Pago avisa cada cambio de un pago.
 *
 * Mercado Pago exige https, así que en local se omite: sin túnel no hay forma
 * de que llegue el aviso. En producción define `SERVER_PUBLIC_URL` (por
 * ejemplo `https://api.droopymanuel.co`) o `MERCADOPAGO_NOTIFICATION_URL`
 * para apuntar a otro destino.
 */
export function donationNotificationUrl(): string | undefined {
	const explicit = process.env.MERCADOPAGO_NOTIFICATION_URL?.trim();
	const base = process.env.SERVER_PUBLIC_URL?.trim().replace(/\/+$/, '');
	const url = explicit || (base ? `${base}/api/donations/webhook` : undefined);

	return url?.startsWith('https://') ? url : undefined;
}

/**
 * Secreto de firma del webhook (Tus integraciones > Webhooks).
 *
 * Opcional en desarrollo. Si está definido, cada notificación debe traer una
 * firma válida; sin él se acepta la notificación y se confía en que los datos
 * se releen de la API de Mercado Pago.
 */
export function webhookSecret(): string | undefined {
	return process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || undefined;
}
