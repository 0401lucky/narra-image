package worker

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type imageTestRow struct {
	payload []byte
	err     error
}

func (row imageTestRow) Scan(targets ...any) error {
	if row.err != nil {
		return row.err
	}
	*targets[0].(*[]byte) = row.payload
	return nil
}

type imageTestQueryer struct {
	payload []byte
	err     error
	query   string
	args    []any
	calls   int
}

func (queryer *imageTestQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query, queryer.args = query, args
	queryer.calls++
	return imageTestRow{payload: queryer.payload, err: queryer.err}
}
func imageTestReservationJSON(t *testing.T) []byte {
	t.Helper()
	encoded, err := json.Marshal(ImageReservation{ID: "00112233-4455-4677-8899-aabbccddeeff", Token: "11223344-5566-4788-99aa-bbccddeeff00", OwnerID: "owner", IntentKey: "test", Kind: "OUTPUT", SlotBytes: []string{"52428800"}, RemainingBytes: ImageMaxBytes, State: "ACTIVE"})
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestImageRepositoryBudgetAndValidation(t *testing.T) {
	queryer := &imageTestQueryer{payload: imageTestReservationJSON(t)}
	repository := NewImageRepository(queryer)
	result, err := repository.ReserveOutputs(context.Background(), ImageReserveOutputsInput{OwnerID: "owner", IntentKey: "test", Count: 1})
	if err != nil || result.RemainingBytes != ImageMaxBytes {
		t.Fatalf("result = %+v, %v", result, err)
	}
	var input map[string]json.RawMessage
	if err := json.Unmarshal([]byte(queryer.args[0].(string)), &input); err != nil {
		t.Fatal(err)
	}
	if string(input["slotBytes"]) != `["52428800"]` {
		t.Fatalf("wrong byte encoding: %s", input["slotBytes"])
	}
	if _, ok := input["enabled"]; ok {
		t.Fatal("quota must not depend on cleanup flag")
	}
	before := queryer.calls
	if _, err := repository.ReserveOutputs(context.Background(), ImageReserveOutputsInput{Count: 5}); err == nil || queryer.calls != before {
		t.Fatal("invalid count touched database")
	}
}

func TestImageRepositoryErrorBoundaryAndNull(t *testing.T) {
	queryer := &imageTestQueryer{err: &pgconn.PgError{Code: "23514", Message: "IMAGE_QUOTA_EXCEEDED"}}
	repository := NewImageRepository(queryer)
	_, err := repository.ReserveOutputs(context.Background(), ImageReserveOutputsInput{OwnerID: "owner", IntentKey: "test", Count: 1})
	var imageErr ImageStorageError
	if !errors.As(err, &imageErr) || imageErr.Code != "IMAGE_QUOTA_EXCEEDED" {
		t.Fatalf("wrong error: %v", err)
	}
	queryer.err = &pgconn.PgError{Code: "23514", Message: "SQL private internal constraint"}
	_, err = repository.GetUsage(context.Background())
	if !errors.As(err, &imageErr) || imageErr.Code != "IMAGE_INTERNAL_ERROR" || strings.Contains(err.Error(), "private") {
		t.Fatalf("raw error escaped: %v", err)
	}
	queryer.err, queryer.payload = nil, nil
	missing, err := repository.ResolveURL(context.Background(), "https://images.example.test/missing", "")
	if err != nil || missing != nil {
		t.Fatalf("null result = %+v, %v", missing, err)
	}
}

func TestImageRepositoryRejectsMalformedDBPayload(t *testing.T) {
	queryer := &imageTestQueryer{payload: []byte(`{"id":"not-a-reservation"}`)}
	_, err := NewImageRepository(queryer).GetReservationByJob(context.Background(), "job")
	var imageErr ImageStorageError
	if !errors.As(err, &imageErr) || imageErr.Code != "IMAGE_INTERNAL_ERROR" {
		t.Fatalf("malformed result accepted: %v", err)
	}
}
