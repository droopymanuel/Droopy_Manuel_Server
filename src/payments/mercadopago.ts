import { MercadoPagoConfig } from 'mercadopago';

/**
 * Cliente de Mercado Pago.
 *
 * Paso 1: solo credenciales y cliente. Sin preferencias, sin webhook y sin
 * eventos todavía.
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
