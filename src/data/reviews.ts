/**
 * Real customer reviews ONLY, with the customer's permission. Never invent reviews.
 * The reviews section is hidden while this array is empty.
 * Example: { name: "Jordan M.", text: "Dropped off my OLED...", service: "Switch OLED", source: "Facebook Marketplace", date: "2026-08" }
 */
export type Review = { name: string; text: string; service?: string; source?: string; date?: string };

export const reviews: Review[] = [];
