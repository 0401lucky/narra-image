package worker

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// Unbound historical URLs need the same gate even with managed writes disabled.
// Call this before acquiring job, owner, Canvas, quota or image row locks.
func lockImageReferenceEpoch(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT image_lock_reference_epoch()`)
	return err
}
