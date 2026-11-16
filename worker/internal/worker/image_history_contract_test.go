package worker

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func historyObservedContractFixture() ImageObjectRecord {
	observation := "22334455-6677-4899-aabb-ccddeeff0011"
	return ImageObjectRecord{ID: "11223344-5566-4788-99aa-bbccddeeff00", AssetID: "33445566-7788-49aa-bbcc-ddeeff001122", Provenance: "OBSERVED",
		SourceObservationID: &observation, LocationID: "local-v1:11223344-5566-4788-99aa-bbccddeeff00", PhysicalNamespace: "local:11223344-5566-4788-99aa-bbccddeeff00",
		Key: "old/image.png", ByteLength: 10, MimeType: "image/png", SHA256: strings.Repeat("a", 64), State: "READY", PutOutcome: "NOT_APPLICABLE", Accounted: true}
}

func TestImageHistoryObjectObservedNullShape(t *testing.T) {
	if err := LoadImageHistoryContract(); err != nil {
		t.Fatal(err)
	}
	object := historyObservedContractFixture()
	data, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ImageObjectRecord
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.Provenance != "OBSERVED" || !ImageObjectVerified(decoded) {
		t.Fatalf("observed object rejected: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"reservationId", "slot", "writeToken", "writeExpiresAt"} {
		if string(fields[key]) != "null" {
			t.Fatalf("%s is not null", key)
		}
	}
	for key, value := range map[string]string{"reservationId": `"11223344-5566-4788-99aa-bbccddeeff00"`, "slot": "0", "sourceObservationId": "null", "putOutcome": `"CONFIRMED"`} {
		original := fields[key]
		fields[key] = json.RawMessage(value)
		invalid, _ := json.Marshal(fields)
		if json.Unmarshal(invalid, &decoded) == nil {
			t.Fatalf("mixed observed/write shape accepted: %s", key)
		}
		fields[key] = original
	}
	delete(fields, "writeToken")
	invalid, _ := json.Marshal(fields)
	if json.Unmarshal(invalid, &decoded) == nil {
		t.Fatal("omitted nullable identity accepted")
	}
}

func TestImageHistoryObjectUnknownReconciliationIsIndependent(t *testing.T) {
	object := historyObservedContractFixture()
	proof := *object.SourceObservationID
	object.Provenance = "WRITE"
	object.SourceObservationID = nil
	object.ReconciliationObservationID = &proof
	object.ReservationID = object.ID
	object.WriteToken = object.ID
	object.WriteExpiresAt = "2026-11-15T00:00:00.000Z"
	object.PutOutcome = "UNKNOWN"
	data, _ := json.Marshal(object)
	var decoded ImageObjectRecord
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.PutOutcome != "UNKNOWN" || decoded.WriteExpiresAt != object.WriteExpiresAt {
		t.Fatalf("original write facts lost: %v", err)
	}
	object.ReconciliationObservationID = nil
	data, _ = json.Marshal(object)
	if json.Unmarshal(data, &decoded) == nil {
		t.Fatal("UNKNOWN made ready without an immutable observation")
	}
}

func TestImageHistoryObjectKeepsOversizedAccountingWithoutUploadGrant(t *testing.T) {
	object := historyObservedContractFixture()
	object.ByteLength = 6_000_000_000
	object.State = "UNKNOWN"
	object.NeedsReconciliation = true
	data, _ := json.Marshal(object)
	var decoded ImageObjectRecord
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.ByteLength != object.ByteLength {
		t.Fatalf("historical physical bytes truncated: %v", err)
	}
	if ImageObjectVerified(decoded) {
		t.Fatal("unsupported original offered for COPY/deletion")
	}
	_, err := NewImageRepository(nil).ReserveInput(context.Background(), ImageReserveInput{OwnerID: "fixture", IntentKey: "fixture", ByteLength: object.ByteLength})
	if err == nil || err.Error() != "IMAGE_INVALID_INPUT" {
		t.Fatalf("observed size expanded upload rules: %v", err)
	}
}

func TestImageHistoryPreservesConfirmedLegacyVersionRead(t *testing.T) {
	object := historyObservedContractFixture()
	version := "legacy-version"
	object.Provenance = "WRITE"
	object.SourceObservationID = nil
	object.ReservationID = object.ID
	object.WriteToken = object.ID
	object.WriteExpiresAt = "2026-11-15T00:00:00.000Z"
	object.PutOutcome = "CONFIRMED"
	object.VersionID = &version
	data, _ := json.Marshal(object)
	var decoded ImageObjectRecord
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.VersionID == nil || *decoded.VersionID != version {
		t.Fatalf("legal legacy receipt rejected: %v", err)
	}
	if ImageObjectVerified(decoded) {
		t.Fatal("versioned original offered for unversioned copy/delete")
	}
}
