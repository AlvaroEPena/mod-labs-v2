/** Review persistence (D1 tables `reviews` and `review_limits`, migrations/0001_create_reviews.sql). */
import type { PublicReview } from "../../src/lib/reviews/contract";

export type ReviewStatus = "pending" | "approved";

/** A validated submission, ready to store (empty optional fields are null). */
export interface NewReview {
  name: string;
  rating: number;
  service: string | null;
  source: string | null;
  body: string;
}

/** A row as the moderation flow sees it (includes pending reviews). */
export interface StoredReview extends NewReview {
  id: number;
  status: ReviewStatus;
  /** epoch ms */
  createdAt: number;
  /** epoch ms; null while pending */
  approvedAt: number | null;
}

/** Safety cap on the published list so page size and Worker CPU stay bounded. */
export const MAX_PUBLISHED_REVIEWS = 500;

/** `status = 'approved'` literally, so SQLite can use the partial index idx_reviews_approved. */
export const LIST_APPROVED_SQL =
  "SELECT id, name, rating, service, source, body, approved_at FROM reviews WHERE status = 'approved' ORDER BY approved_at DESC, id DESC LIMIT ?";

export interface ReviewStore {
  /** Insert a pending review and return its id. */
  insertPending(review: NewReview, createdAt: number): Promise<number>;
  /** Reviews created at or after `since` (epoch ms), any status. */
  countCreatedSince(since: number): Promise<number>;
  findById(id: number): Promise<StoredReview | null>;
  /** pending → approved. False when the row is missing or already approved. */
  approve(id: number, approvedAt: number): Promise<boolean>;
  /** Delete in any status. False when the row is already gone. */
  remove(id: number): Promise<boolean>;
  /** Approved reviews, newest approval first, at most MAX_PUBLISHED_REVIEWS. */
  listApproved(): Promise<PublicReview[]>;
  /**
   * Count one submission in a visitor's daily bucket (atomic upsert) and return the bucket's new total.
   * `bucketKey` is already a keyed hash (visitor-limit.ts); `day` is its UTC day (yyyy-mm-dd).
   */
  recordVisitorSubmission(bucketKey: string, day: string): Promise<number>;
  /** Delete the daily buckets of every UTC day before `day` (yyyy-mm-dd). */
  purgeVisitorCountsBefore(day: string): Promise<void>;
}

interface ReviewRow {
  id: number;
  name: string;
  rating: number;
  service: string | null;
  source: string | null;
  body: string;
  status: ReviewStatus;
  created_at: number;
  approved_at: number | null;
}

type PublicRow = Pick<ReviewRow, "id" | "name" | "rating" | "service" | "source" | "body"> & {
  approved_at: number;
};

const toPublic = (r: PublicRow): PublicReview => ({
  id: r.id,
  name: r.name,
  rating: r.rating,
  service: r.service,
  source: r.source,
  body: r.body,
  approvedAt: r.approved_at,
});

const toStored = (r: ReviewRow): StoredReview => ({
  id: r.id,
  name: r.name,
  rating: r.rating,
  service: r.service,
  source: r.source,
  body: r.body,
  status: r.status,
  createdAt: r.created_at,
  approvedAt: r.approved_at,
});

/** D1 implementation. Prepared statements with bound parameters only. */
export class D1ReviewStore implements ReviewStore {
  constructor(private readonly db: D1Database) {}

  async insertPending(review: NewReview, createdAt: number): Promise<number> {
    const id = await this.db
      .prepare(
        "INSERT INTO reviews (name, rating, service, source, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) RETURNING id",
      )
      .bind(review.name, review.rating, review.service, review.source, review.body, createdAt)
      .first<number>("id");
    if (typeof id !== "number") throw new Error("review insert returned no id");
    return id;
  }

  async countCreatedSince(since: number): Promise<number> {
    const count = await this.db
      .prepare("SELECT COUNT(*) AS n FROM reviews WHERE created_at >= ?")
      .bind(since)
      .first<number>("n");
    return count ?? 0;
  }

  async findById(id: number): Promise<StoredReview | null> {
    const row = await this.db
      .prepare(
        "SELECT id, name, rating, service, source, body, status, created_at, approved_at FROM reviews WHERE id = ?",
      )
      .bind(id)
      .first<ReviewRow>();
    return row ? toStored(row) : null;
  }

  async approve(id: number, approvedAt: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE reviews SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'")
      .bind(approvedAt, id)
      .run();
    return result.meta.changes > 0;
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM reviews WHERE id = ?").bind(id).run();
    return result.meta.changes > 0;
  }

  async listApproved(): Promise<PublicReview[]> {
    const { results } = await this.db.prepare(LIST_APPROVED_SQL).bind(MAX_PUBLISHED_REVIEWS).all<PublicRow>();
    return results.map(toPublic);
  }

  async recordVisitorSubmission(bucketKey: string, day: string): Promise<number> {
    // A single statement, so two concurrent submissions can't both read the old count.
    const count = await this.db
      .prepare(
        "INSERT INTO review_limits (key, day, count) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count",
      )
      .bind(bucketKey, day)
      .first<number>("count");
    if (typeof count !== "number") throw new Error("visitor count upsert returned no count");
    return count;
  }

  async purgeVisitorCountsBefore(day: string): Promise<void> {
    await this.db.prepare("DELETE FROM review_limits WHERE day < ?").bind(day).run();
  }
}
