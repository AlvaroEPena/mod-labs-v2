/** In-memory ReviewStore test double with the same semantics as D1ReviewStore. */
import type { PublicReview } from "../../src/lib/reviews/contract";
import { MAX_PUBLISHED_REVIEWS, type NewReview, type ReviewStore, type StoredReview } from "./store";

export class MemoryReviewStore implements ReviewStore {
  private rows = new Map<number, StoredReview>();
  /** Like SQLite AUTOINCREMENT: only ever grows, so a deleted row's id is never handed out again. */
  private lastId = 0;
  private visitorCounts = new Map<string, { day: string; count: number }>();
  /** Set to make every call reject, to exercise error paths. */
  failWith: Error | null = null;

  private guard(): void {
    if (this.failWith) throw this.failWith;
  }

  /** Test helper: insert a row in any state. */
  seed(review: NewReview & Partial<Pick<StoredReview, "status" | "createdAt" | "approvedAt">>): StoredReview {
    const status = review.status ?? "pending";
    this.lastId += 1;
    const row: StoredReview = {
      ...review,
      id: this.lastId,
      status,
      createdAt: review.createdAt ?? 0,
      approvedAt: status === "approved" ? (review.approvedAt ?? review.createdAt ?? 0) : null,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  /** Test helper: a copy of every row, by id. */
  all(): StoredReview[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  /** Test helper: every visitor bucket, as stored. */
  visitorBuckets(): { key: string; day: string; count: number }[] {
    return [...this.visitorCounts].map(([key, value]) => ({ key, ...value }));
  }

  async insertPending(review: NewReview, createdAt: number): Promise<number> {
    this.guard();
    return this.seed({ ...review, createdAt }).id;
  }

  async countCreatedSince(since: number): Promise<number> {
    this.guard();
    return [...this.rows.values()].filter((r) => r.createdAt >= since).length;
  }

  async findById(id: number): Promise<StoredReview | null> {
    this.guard();
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async approve(id: number, approvedAt: number): Promise<boolean> {
    this.guard();
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return false;
    this.rows.set(id, { ...row, status: "approved", approvedAt });
    return true;
  }

  async remove(id: number): Promise<boolean> {
    this.guard();
    return this.rows.delete(id);
  }

  async listApproved(): Promise<PublicReview[]> {
    this.guard();
    return [...this.rows.values()]
      .filter(
        (r): r is StoredReview & { approvedAt: number } => r.status === "approved" && r.approvedAt !== null,
      )
      .sort((a, b) => b.approvedAt - a.approvedAt || b.id - a.id)
      .slice(0, MAX_PUBLISHED_REVIEWS)
      .map(({ id, name, rating, service, source, body, approvedAt }) => ({
        id,
        name,
        rating,
        service,
        source,
        body,
        approvedAt,
      }));
  }

  async recordVisitorSubmission(bucketKey: string, day: string): Promise<number> {
    this.guard();
    // Same as the D1 upsert: an existing key keeps its day and only counts up.
    const existing = this.visitorCounts.get(bucketKey);
    const next = existing ? { ...existing, count: existing.count + 1 } : { day, count: 1 };
    this.visitorCounts.set(bucketKey, next);
    return next.count;
  }

  async purgeVisitorCountsBefore(day: string): Promise<void> {
    this.guard();
    for (const [key, value] of this.visitorCounts) if (value.day < day) this.visitorCounts.delete(key);
  }
}
