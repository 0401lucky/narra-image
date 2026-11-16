package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestGatewayMigratedImageProjectsTokenForQueryImagesAndChat(t *testing.T) {
	original := gatewayImage{ID: "historical-output", URL: "https://retired.invalid/images/original.png", Availability: "available"}
	publicToken := strings.Repeat("a", 64)
	projected, err := projectGatewayImageURL(original, "https://app.invalid/", historyTestAssetID, publicToken)
	if err != nil || projected.URL != "https://app.invalid/media/images/"+publicToken || original.URL != "https://retired.invalid/images/original.png" {
		t.Fatalf("managed URL projection rewrote provenance or skipped token route: %+v %v", projected, err)
	}
	worker := New(nil, Config{AppURL: "https://app.invalid", ImageStorageManagedEnabled: false}, nil)
	result := gatewayJobResult{JobID: "old-job", Status: "SUCCEEDED", Images: []gatewayImage{projected}}
	for _, endpoint := range []string{"images.generations", "images.edits", "chat.completions"} {
		for _, stream := range []bool{false, true} {
			recorder := httptest.NewRecorder()
			envelope := &gatewayEnvelope{Endpoint: endpoint}
			envelope.Payload.Stream = stream
			worker.writeGatewayEndpointResponse(recorder, envelope, result)
			if recorder.Code != http.StatusOK || strings.Contains(recorder.Body.String(), "retired.invalid") || !strings.Contains(recorder.Body.String(), projected.URL) {
				t.Fatalf("%s stream=%v exposed retired source: %d %s", endpoint, stream, recorder.Code, recorder.Body.String())
			}
		}
	}
	query := formatGatewayQueryResponse(gatewayJob{ID: "old-job", Status: "SUCCEEDED"}, []gatewayImage{projected})
	encoded, _ := json.Marshal(query)
	if strings.Contains(string(encoded), "retired.invalid") || !strings.Contains(string(encoded), projected.URL) {
		t.Fatalf("query emitted original physical URL: %s", encoded)
	}
	legacy, err := projectGatewayImageURL(original, "", "", "")
	if err != nil || legacy.URL != original.URL || legacy.MediaAssetID != "" {
		t.Fatal("legacy URL compatibility changed")
	}
}

func historyManagedLocalReadFixture(t *testing.T) (LocalImageStoreConfig, ManagedImage, []byte) {
	t.Helper()
	local, cfg := localImageFixture(t)
	data := imageHistoryPNG(t)
	put := localImageInput(data)
	if _, err := local.Put(context.Background(), put); err != nil {
		t.Fatal(err)
	}
	location, _ := NewImageLocalLocation(cfg.VolumeID)
	proof := historyTestProofID
	object := ImageObjectRecord{ID: historyTestTargetID, AssetID: historyTestAssetID, Provenance: "OBSERVED", SourceObservationID: &proof,
		LocationID: location.ID, PhysicalNamespace: location.ID, Key: put.Key, ByteLength: put.ByteLength, SHA256: put.SHA256, MimeType: "image/png",
		State: "READY", PutOutcome: "NOT_APPLICABLE", Accounted: true}
	image := ManagedImage{Asset: ImageAssetRecord{ID: historyTestAssetID, OwnerID: "source-owner", Purpose: "GENERATED", PublicToken: strings.Repeat("a", 64),
		ByteLength: object.ByteLength, MimeType: object.MimeType, SHA256: object.SHA256, State: "AVAILABLE", ActiveObjectID: &object.ID}, Object: &object,
		Location: &ImageLocation{ImageLocationInput: location, PhysicalNamespace: location.ID}}
	return cfg, image, data
}

func TestGatewayMigratedImageB64ReadsCurrentLocalReplicaWithoutURLAliasOrHTTP(t *testing.T) {
	cfg, image, data := historyManagedLocalReadFixture(t)
	encoded, _ := json.Marshal(image)
	lease, _ := json.Marshal(ImageReadLease{Image: image, ReadExpiresAt: time.Now().Add(45 * time.Second)})
	queryer := &imageReaderTestQueryer{image: encoded, lease: lease}
	var publicReads atomic.Int32
	public := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { publicReads.Add(1) }))
	defer public.Close()
	for _, managedWrites := range []bool{false, true} {
		worker := New(nil, Config{AppURL: public.URL, ImageStorageManagedEnabled: managedWrites}, nil)
		worker.storage = &Storage{cfg: Config{ImageStorageManagedEnabled: managedWrites, ImageStorageBackend: "s3", ImageStoragePath: cfg.RootDirectory, ImageStorageVolumeID: cfg.VolumeID}, imageRepository: NewImageRepository(queryer)}
		projected, err := projectGatewayImageURL(gatewayImage{ID: "old-output", URL: "https://retired.invalid/old.png"}, public.URL, image.Asset.ID, image.Asset.PublicToken)
		if err != nil {
			t.Fatal(err)
		}
		got, err := worker.gatewayImageToBase64(projected)
		if err != nil || got != base64.StdEncoding.EncodeToString(data) || publicReads.Load() != 0 {
			t.Fatalf("managed b64 used stale/public URL: %v reads=%d", err, publicReads.Load())
		}
		if len(queryer.resolveArgs) != 2 || queryer.resolveArgs[0] != image.Asset.ID {
			t.Fatal("b64 used projected URL alias instead of the known managed ID")
		}
		for _, endpoint := range []string{"images.generations", "responses"} {
			envelope := &gatewayEnvelope{Endpoint: endpoint}
			envelope.Payload.ResponseFormat = "b64_json"
			recorder := httptest.NewRecorder()
			worker.writeGatewayEndpointResponse(recorder, envelope, gatewayJobResult{JobID: "old-job", Status: "SUCCEEDED", Images: []gatewayImage{projected}})
			if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), base64.StdEncoding.EncodeToString(data)) || publicReads.Load() != 0 {
				t.Fatalf("%s lost current replica b64: %d %s", endpoint, recorder.Code, recorder.Body.String())
			}
		}
	}
}

func TestGatewayManagedProjectionFailsClosedWithoutTokenAndHidesUnavailableURLs(t *testing.T) {
	original := gatewayImage{ID: "historical", URL: "https://retired.invalid/source.png", Availability: "available"}
	if _, err := projectGatewayImageURL(original, "https://app.invalid", historyTestAssetID, ""); err == nil {
		t.Fatal("malformed managed identity fell back to stale source URL")
	}
	for _, state := range []string{"cleaned", "unavailable"} {
		original.Availability = state
		projected, err := projectGatewayImageURL(original, "https://app.invalid", historyTestAssetID, strings.Repeat("a", 64))
		if err != nil || projected.URL != "" {
			t.Fatal("unavailable managed image kept an actionable old link")
		}
	}
}
