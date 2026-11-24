import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { donationTiers, donations } from '../db/schema/index.js';
import type { DonationStatus, DonationTier } from '../types.js';
import { toDonationTier } from './mappers.js';

/** Nivel de donación por cantidad de estrellas, o `null` si no existe. */
export async function findDonationTier(stars: number): Promise<DonationTier | null> {
	const [row] = await db
		.select()
		.from(donationTiers)
		.where(eq(donationTiers.stars, stars))
		.limit(1);

	return row ? toDonationTier(row) : null;
}

/**
 * Estado público de una donación por su `external_reference`.
 *
 * Devuelve solo lo que puede ver la persona que vuelve del checkout: estado,
 * estrellas y monto. Nunca expone correo ni nombre del donante.
 *
 * Si hubo varios intentos de pago con la misma referencia, manda el aprobado;
 * si ninguno lo está, el más reciente.
 */
export async function findDonationStatus(
	externalReference: string
): Promise<DonationStatus | null> {
	const rows = await db
		.select({
			status: donations.status,
			statusDetail: donations.statusDetail,
			stars: donations.stars,
			amountCents: donations.amountCents,
			currency: donations.currency,
			paidAt: donations.paidAt
		})
		.from(donations)
		.where(eq(donations.externalReference, externalReference))
		.orderBy(desc(donations.createdAt));

	if (rows.length === 0) return null;

	const row = rows.find((item) => item.status === 'approved') ?? rows[0];
	if (!row) return null;

	return {
		status: row.status,
		statusDetail: row.statusDetail,
		stars: row.stars,
		amountCents: row.amountCents,
		currency: row.currency,
		paidAt: row.paidAt ? row.paidAt.toISOString() : null
	};
}

/**
 * Datos de un pago ya consultado en Mercado Pago.
 *
 * La ruta los arma a partir de la respuesta de la API, no del cuerpo del
 * webhook: así una notificación falsa no puede inventar montos ni correos.
 */
export interface DonationPaymentData {
	externalReference: string;
	paymentId: string;
	status: string;
	statusDetail: string | null;
	stars: number | null;
	amountCents: number;
	currency: string;
	donorName: string | null;
	donorEmail: string | null;
	paymentMethod: string | null;
	liveMode: boolean;
	paidAt: Date | null;
}

/**
 * Guarda o actualiza una donación a partir de un pago.
 *
 * Mercado Pago puede notificar el mismo pago varias veces (pendiente y luego
 * aprobado, por ejemplo). El `payment_id` único convierte esos avisos en
 * actualizaciones de la misma fila, sin duplicar el ingreso.
 */
export async function saveDonationPayment(data: DonationPaymentData): Promise<void> {
	await db
		.insert(donations)
		.values({
			externalReference: data.externalReference,
			paymentId: data.paymentId,
			status: data.status,
			statusDetail: data.statusDetail,
			stars: data.stars,
			amountCents: data.amountCents,
			currency: data.currency,
			donorName: data.donorName,
			donorEmail: data.donorEmail,
			paymentMethod: data.paymentMethod,
			liveMode: data.liveMode,
			paidAt: data.paidAt
		})
		.onConflictDoUpdate({
			target: donations.paymentId,
			set: {
				status: data.status,
				statusDetail: data.statusDetail,
				stars: data.stars,
				amountCents: data.amountCents,
				currency: data.currency,
				donorName: data.donorName,
				donorEmail: data.donorEmail,
				paymentMethod: data.paymentMethod,
				liveMode: data.liveMode,
				paidAt: data.paidAt,
				updatedAt: new Date()
			}
		});
}
