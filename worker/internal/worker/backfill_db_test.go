//go:build workercontractsdb

package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The fixture proves scan/CAS behavior against real guards. Object creation is
// ledger-only; this test does not claim that a physical migration was executed.
func testBackfillBoundImageDB(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, jobID string) {
	t.Helper()
	volumeID, err := newImageMaintenanceToken()
	if err != nil {
		t.Fatal(err)
	}
	imageID := "db_backfill_bound_" + volumeID
	originalURL := "https://retired.example.test/images/" + volumeID + ".png"
	if _, err := pool.Exec(ctx, `INSERT INTO "GenerationImage" (id,"jobId",url,"showcaseStatus","showPromptPublic","createdAt")
VALUES ($1,$2,$3,'PRIVATE',false,CURRENT_TIMESTAMP)`, imageID, jobID, originalURL); err != nil {
		t.Fatal(err)
	}
	rows, err := scanMediaRows(ctx, pool, "GenerationImage", 0)
	if err != nil || len(rows) != 1 || rows[0].ID != imageID {
		t.Fatalf("unassociated NULL-metadata image was not scanned: rows=%v error=%v", rows, err)
	}
	captured := rows[0]
	data := imageHistoryPNG(t)
	legacyStorage := s3TestStorage()
	if _, err := pool.Exec(ctx, `UPDATE "GenerationImage" SET url=$2 WHERE id=$1`, imageID, originalURL+"?changed"); err != nil {
		t.Fatal(err)
	}
	if updated, skip := persistAndUpdateImage(ctx, pool, legacyStorage, captured, data, "png", "image/png", BackfillOptions{}); updated || skip != skipNoData {
		t.Fatalf("changed provenance reached a new PUT: updated=%v skip=%v", updated, skip)
	}
	if _, err := pool.Exec(ctx, `UPDATE "GenerationImage" SET url=$2 WHERE id=$1`, imageID, originalURL); err != nil {
		t.Fatal(err)
	}
	repository := NewImageRepository(pool)
	location, err := NewImageLocalLocation(volumeID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.RegisterLocation(ctx, location); err != nil {
		t.Fatal(err)
	}
	reservation, err := repository.ReserveInput(ctx, ImageReserveInput{OwnerID: ownerID, IntentKey: "backfill-image:" + imageID, ByteLength: int64(len(data))})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	ticket, err := repository.BeginObject(ctx, ImageBeginObjectInput{ReservationID: reservation.ID, Token: reservation.Token,
		LocationID: location.ID, Key: "images/backfill-test-" + volumeID + ".png", ByteLength: int64(len(data)),
		MimeType: "image/png", SHA256: hex.EncodeToString(digest[:]), Purpose: "GENERATED", OriginID: imageID})
	if err != nil {
		t.Fatal(err)
	}
	if receipt, err := repository.FinishObject(ctx, ImageFinishObjectInput{ObjectID: ticket.Object.ID, WriteToken: ticket.Object.WriteToken, Outcome: "CONFIRMED"}); err != nil || !receipt.Accepted {
		t.Fatalf("cannot seed available image ledger: %v", err)
	}
	if _, err := repository.CloseReservation(ctx, ImageCloseReservationInput{ReservationID: reservation.ID, Token: reservation.Token}); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackSilently(ctx, tx)
	if err := lockImageReferenceEpoch(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "GenerationImage" SET "mediaAssetId"=$2 WHERE id=$1`, imageID, ticket.Asset.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for _, managedWrites := range []bool{false, true} {
		storage := s3TestStorage()
		storage.cfg.ImageStorageManagedEnabled = managedWrites
		for _, dryRun := range []bool{false, true} {
			opts := BackfillOptions{IncludeHTTP: true, DryRun: dryRun}
			if updated, skip := backfillImageRow(ctx, pool, storage, captured, opts); updated || skip != skipNoData {
				t.Fatalf("stale scan fetched a bound image: managed=%v dryRun=%v updated=%v skip=%v", managedWrites, dryRun, updated, skip)
			}
			if updated, skip := persistAndUpdateImage(ctx, pool, storage, captured, data, "png", "image/png", opts); updated || skip != skipNoData {
				t.Fatalf("binding during fetch permitted another PUT: managed=%v dryRun=%v updated=%v skip=%v", managedWrites, dryRun, updated, skip)
			}
			result, err := BackfillMedia(ctx, pool, storage, opts)
			if err != nil || result.ImagesScanned != 0 || result.ImagesUpdated != 0 || len(result.Errors) != 0 {
				t.Fatalf("bound NULL-metadata image reentered backfill: result=%+v error=%v", result, err)
			}
		}
		if len(storage.client.(*fakeObjectStorage).puts) != 0 {
			t.Fatal("backfill issued a PUT for an already bound image")
		}
	}
	if len(legacyStorage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatal("backfill issued a PUT after the original URL changed")
	}
	var originalPreserved bool
	if err := pool.QueryRow(ctx, `SELECT url=$2 AND "mediaStorage" IS NULL AND "storageKey" IS NULL AND "mediaAssetId"=$3
FROM "GenerationImage" WHERE id=$1`, imageID, originalURL, ticket.Asset.ID).Scan(&originalPreserved); err != nil || !originalPreserved {
		t.Fatalf("backfill changed original metadata after ledger binding: preserved=%v error=%v", originalPreserved, err)
	}
}
