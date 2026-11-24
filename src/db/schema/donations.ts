import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar
} from 'drizzle-orm/pg-core';
import { paymentMethodEnum } from './enums.js';
import { dogs } from './dogs.js';

/** Niveles de donación («estrellas»). */
export const donationTiers = pgTable('donation_tiers', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	stars: integer('stars').notNull().unique(),
	name: varchar('name', { length: 160 }).notNull(),
	/** Precio en centavos, coherente con el resto del dinero. */
	priceCents: integer('price_cents').notNull(),
	currency: varchar('currency', { length: 8 }).notNull().default('COP'),
	blurb: text('blurb').notNull(),
	perks: text('perks').array().notNull().default([]),
	sortOrder: integer('sort_order').notNull().default(0)
});

/** Testimonios de adoptantes y voluntarios. */
export const testimonials = pgTable('testimonials', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: varchar('name', { length: 160 }).notNull(),
	role: varchar('role', { length: 160 }).notNull(),
	quote: text('quote').notNull(),
	/** Perrito relacionado, opcional. */
	dogSlug: varchar('dog_slug', { length: 120 }).references(() => dogs.slug, {
		onUpdate: 'cascade',
		onDelete: 'set null'
	}),
	sortOrder: integer('sort_order').notNull().default(0)
});

/** Cuentas bancarias para transferencias y donaciones. */
export const bankAccounts = pgTable('bank_accounts', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	bank: varchar('bank', { length: 160 }).notNull(),
	emoji: varchar('emoji', { length: 16 }).notNull(),
	method: paymentMethodEnum('method').notNull(),
	holder: varchar('holder', { length: 255 }).notNull(),
	/** Campos de la cuenta, en orden: [{label, value, copyable}] */
	fields: jsonb('fields').notNull().default([]),
	sortOrder: integer('sort_order').notNull().default(0)
});

/**
 * Perritos a los que se puede dirigir una donación.
 *
 * Reusa los de la manada viva: es una tabla propia porque en el panel se
 * podrá elegir cuáles aparecen y con qué meta.
 */
export const donationTargets = pgTable('donation_targets', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	dogSlug: varchar('dog_slug', { length: 120 })
		.notNull()
		.unique()
		.references(() => dogs.slug, { onUpdate: 'cascade', onDelete: 'cascade' }),
	/** Meta de recaudación en centavos, si existe. */
	goalCents: integer('goal_cents'),
	active: boolean('active').notNull().default(true),
	sortOrder: integer('sort_order').notNull().default(0)
});

/**
 * Donaciones pagadas con Mercado Pago.
 *
 * Cada fila nace del webhook: el servidor vuelve a consultar el pago con la
 * API de Mercado Pago y guarda lo que el proveedor dice, nunca lo que llega
 * en el cuerpo de la notificación.
 *
 * `payment_id` es único para que un webhook repetido actualice la misma fila
 * en lugar de duplicarla. El estado se guarda tal cual lo devuelve Mercado
 * Pago (`approved`, `pending`, `rejected`, `refunded`…): su catálogo puede
 * crecer sin exigir una migración.
 */
export const donations = pgTable(
	'donations',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		/** `external_reference` que enviamos al crear la preferencia. */
		externalReference: varchar('external_reference', { length: 255 }).notNull(),
		/** Identificador del pago en Mercado Pago. */
		paymentId: varchar('payment_id', { length: 64 }).notNull().unique(),
		status: varchar('status', { length: 32 }).notNull(),
		statusDetail: varchar('status_detail', { length: 120 }),
		/** Nivel de estrellas leído de `external_reference`, si se pudo. */
		stars: integer('stars'),
		/** Monto realmente cobrado, en centavos. */
		amountCents: integer('amount_cents').notNull(),
		currency: varchar('currency', { length: 8 }).notNull(),
		donorName: varchar('donor_name', { length: 255 }),
		donorEmail: varchar('donor_email', { length: 255 }),
		paymentMethod: varchar('payment_method', { length: 60 }),
		/** `true` si el pago ocurrió en producción y no en modo prueba. */
		liveMode: boolean('live_mode').notNull().default(false),
		/** Fecha de aprobación según Mercado Pago; nula si aún no se aprobó. */
		paidAt: timestamp('paid_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('donations_reference_idx').on(table.externalReference),
		index('donations_status_idx').on(table.status),
		index('donations_email_idx').on(table.donorEmail),
		index('donations_created_idx').on(table.createdAt)
	]
);

export type DonationTierRow = typeof donationTiers.$inferSelect;
export type TestimonialRow = typeof testimonials.$inferSelect;
export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type DonationTargetRow = typeof donationTargets.$inferSelect;
export type DonationRow = typeof donations.$inferSelect;
export type NewDonationTierRow = typeof donationTiers.$inferInsert;
export type NewBankAccountRow = typeof bankAccounts.$inferInsert;
