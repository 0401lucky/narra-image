//go:build workercontractsdb

package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Invoked by TestGatewayDB so the disposable runner's fixed test selection
// executes this coverage. The fixture is ledger-only; it performs no object IO.
func testGatewayManagedInputAliasesDB(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, apiKeyID, sourceOwner string) {
	t.Helper()
	repository := NewImageRepository(pool)
	volumeID, err := newImageMaintenanceToken()
	if err != nil {
		t.Fatal(err)
	}
	location, err := NewImageLocalLocation(volumeID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.RegisterLocation(ctx, location); err != nil {
		t.Fatal(err)
	}
	data := imageHistoryPNG(t)
	digest := sha256.Sum256(data)
	reservation, err := repository.ReserveInput(ctx, ImageReserveInput{OwnerID: sourceOwner, IntentKey: "gateway-source:" + volumeID, ByteLength: int64(len(data))})
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := repository.BeginObject(ctx, ImageBeginObjectInput{ReservationID: reservation.ID, Token: reservation.Token, LocationID: location.ID,
		Key: "images/gateway-input-" + volumeID + ".png", ByteLength: int64(len(data)), SHA256: hex.EncodeToString(digest[:]), MimeType: "image/png", Purpose: "REFERENCE"})
	if err != nil {
		t.Fatal(err)
	}
	if receipt, err := repository.FinishObject(ctx, ImageFinishObjectInput{ObjectID: ticket.Object.ID, WriteToken: ticket.Object.WriteToken, Outcome: "CONFIRMED"}); err != nil || !receipt.Accepted {
		t.Fatalf("cannot seed ready ledger fixture: %v", err)
	}
	if _, err := repository.CloseReservation(ctx, ImageCloseReservationInput{ReservationID: reservation.ID, Token: reservation.Token}); err != nil {
		t.Fatal(err)
	}
	oldURL := "https://former.example.test/media/images/" + ticket.Asset.PublicToken
	if err := repository.RegisterAlias(ctx, ticket.Asset.ID, oldURL); err != nil {
		t.Fatal(err)
	}
	before, err := repository.GetUsage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	base := "https://APP.gateway.example.test:443/prefix"
	path := "/prefix/media/images/" + ticket.Asset.PublicToken
	canonical := "https://app.gateway.example.test" + path
	variant := "https://APP.gateway.example.test:443" + path
	foreign := "https://unrelated.example.test" + path
	sources := []string{canonical, variant, foreign, canonical}
	env := validGatewayEnvelope()
	env.JobID, env.Auth.UserID, env.Auth.APIKeyID = "gw_job_input_token", ownerID, apiKeyID
	env.SourceImageURLs = append([]string(nil), sources...)
	worker := New(pool, Config{AppURL: base, ContractsV1Enabled: true, ImageStorageManagedEnabled: false}, nil)
	if _, err := worker.ensureGatewayJob(ctx, env); err != nil {
		t.Fatal(err)
	}
	assertInputURLs := func(jobID string, want []string) {
		t.Helper()
		var actual []string
		if err := pool.QueryRow(ctx, `SELECT "sourceImageUrls" FROM "GenerationJob" WHERE id=$1`, jobID).Scan(&actual); err != nil || !reflect.DeepEqual(actual, want) {
			t.Fatalf("input provenance changed: got=%v want=%v error=%v", actual, want, err)
		}
	}
	assertInputURLs(env.JobID, sources)
	for _, accepted := range []string{canonical, variant} {
		resolved, err := repository.ResolveURL(ctx, accepted, "")
		if err != nil || resolved == nil || resolved.Asset.ID != ticket.Asset.ID {
			t.Fatalf("accepted token URL has no exact alias: %v", err)
		}
	}
	if image, err := repository.ResolveURL(ctx, foreign, ""); err != nil || image != nil {
		t.Fatalf("cross-origin token inferred an owned image: %v", err)
	}
	assertRoot := func(jobID string) {
		t.Helper()
		var roots int
		if err := pool.QueryRow(ctx, `SELECT count(*)::integer FROM "ImageReference" WHERE "assetId"=$1 AND "ownerId"=$2 AND kind='JOB_INPUT' AND "referenceKey"=$3 AND permanent`, ticket.Asset.ID, ownerID, "job:"+jobID).Scan(&roots); err != nil || roots != 1 {
			t.Fatalf("exact aliases did not create a permanent cross-owner root: count=%d error=%v", roots, err)
		}
	}
	assertRoot(env.JobID)
	after, err := repository.GetUsage(ctx)
	if err != nil || after.UsedBytes != before.UsedBytes || after.ReservedBytes != before.ReservedBytes || after.AssetCount != before.AssetCount || after.ObjectCount != before.ObjectCount {
		t.Fatalf("write-disabled input binding reserved/wrote image output: before=%+v after=%+v error=%v", before, after, err)
	}

	// A failing job INSERT must roll back aliases made earlier in the same tx.
	rollbackURL := "https://app.GATEWAY.example.test:0443" + path
	bad := env
	bad.JobID, bad.Auth.UserID, bad.SourceImageURLs = "gw_job_input_rollback", "missing_gateway_input_owner", []string{rollbackURL}
	if _, err := worker.ensureGatewayJob(ctx, bad); err == nil {
		t.Fatal("invalid business owner unexpectedly created a job")
	}
	if image, err := repository.ResolveURL(ctx, rollbackURL, ""); err != nil || image != nil {
		t.Fatalf("failed business transaction retained a new alias: %v", err)
	}
	missingURL := "https://app.gateway.example.test/prefix/media/images/" + strings.Repeat("0", 64)
	bad.JobID, bad.Auth.UserID, bad.SourceImageURLs = "gw_job_input_missing", ownerID, []string{missingURL}
	if _, err := worker.ensureGatewayJob(ctx, bad); err == nil {
		t.Fatal("missing current-origin token unexpectedly created a job")
	} else {
		var failure ImageStorageError
		if !errors.As(err, &failure) || failure.Code != "IMAGE_UNAVAILABLE" {
			t.Fatalf("missing owned input was not rejected safely: %v", err)
		}
	}
	var rejectedJobs int
	if err := pool.QueryRow(ctx, `SELECT count(*)::integer FROM "GenerationJob" WHERE id = ANY($1::text[])`, []string{"gw_job_input_rollback", "gw_job_input_missing"}).Scan(&rejectedJobs); err != nil || rejectedJobs != 0 {
		t.Fatalf("failed input binding left a business job: count=%d error=%v", rejectedJobs, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE "GenerationJob" SET status='SUCCEEDED',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1`, env.JobID); err != nil {
		t.Fatal(err)
	}
	replay := env
	replay.SourceImageURLs = []string{missingURL}
	if job, err := worker.ensureGatewayJob(ctx, replay); err != nil || job.Status != "SUCCEEDED" {
		t.Fatalf("completed replay revalidated replacement input: %v", err)
	}
	assertInputURLs(env.JobID, sources)
	testGatewayManagedInputConcurrentReplayDB(t, ctx, pool, base, ownerID, apiKeyID, canonical, missingURL)
	assertRoot("gw_job_input_concurrent")
	if _, err := pool.Exec(ctx, `DELETE FROM "User" WHERE id=$1`, ownerID); err != nil {
		t.Fatal(err)
	}
	assertRoot(env.JobID)
	assertRoot("gw_job_input_concurrent")
}

func testGatewayManagedInputConcurrentReplayDB(t *testing.T, ctx context.Context, pool *pgxpool.Pool, appURL, ownerID, apiKeyID, originalURL, replacementURL string) {
	t.Helper()
	winner, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackSilently(ctx, winner)
	if err := lockImageReferenceEpoch(ctx, winner); err != nil {
		t.Fatal(err)
	}
	if _, err := winner.Exec(ctx, `INSERT INTO "GenerationJob" (id,"userId","apiKeyId","workerManaged","clientSource","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
VALUES ('gw_job_input_concurrent',$1,$2,true,'API','BUILT_IN','gpt-image-2','original input','1024x1024',1,$3,CURRENT_TIMESTAMP)`, ownerID, apiKeyID, []string{originalURL}); err != nil {
		t.Fatal(err)
	}
	config := pool.Config()
	applicationName := "gateway-input-replay-" + randomHex(8)
	config.ConnConfig.RuntimeParams["application_name"] = applicationName
	config.MaxConns = 2
	replayPool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer replayPool.Close()
	attemptCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	worker := New(replayPool, Config{AppURL: appURL, ContractsV1Enabled: true}, nil)
	env := validGatewayEnvelope()
	env.JobID, env.Auth.UserID, env.Auth.APIKeyID = "gw_job_input_concurrent", ownerID, apiKeyID
	env.SourceImageURLs = []string{replacementURL}
	type result struct {
		job gatewayJob
		err error
	}
	finished := make(chan result, 1)
	go func() { job, err := worker.ensureGatewayJob(attemptCtx, env); finished <- result{job, err} }()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND wait_event='advisory' AND query LIKE '%image_lock_reference_epoch%')`, applicationName).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case early := <-finished:
			t.Fatalf("replay did not wait for reference epoch: %+v", early)
		case <-deadline.C:
			t.Fatal("replay never reached the reference epoch")
		case <-ticker.C:
		}
	}
	if err := winner.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case completed := <-finished:
		if completed.err != nil || completed.job.ID != env.JobID {
			t.Fatalf("concurrent replay validated new input after the winning commit: %+v", completed)
		}
	case <-attemptCtx.Done():
		t.Fatal("concurrent replay did not return its existing job")
	}
	var actual []string
	if err := pool.QueryRow(ctx, `SELECT "sourceImageUrls" FROM "GenerationJob" WHERE id=$1`, env.JobID).Scan(&actual); err != nil || !reflect.DeepEqual(actual, []string{originalURL}) {
		t.Fatalf("concurrent replay changed frozen input: %v error=%v", actual, err)
	}
}
