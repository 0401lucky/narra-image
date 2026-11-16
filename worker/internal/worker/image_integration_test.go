package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type imageReaderTestQueryer struct {
	image       []byte
	lease       []byte
	resolveArgs []any
}

func (queryer *imageReaderTestQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "image_begin_read") {
		return imageTestRow{payload: queryer.lease}
	}
	queryer.resolveArgs = args
	return imageTestRow{payload: queryer.image}
}

func TestImageGenerationCountGuardPrecedesProvider(t *testing.T) {
	for _, count := range []int{0, -1, 5} {
		_, err := generateImages(context.Background(), nil, GenerationJob{Count: count}, ProviderConfig{BaseURL: "http://127.0.0.1:1"})
		var failure ContractFailure
		if !errors.As(err, &failure) || failure.Code != errorProviderRequestInvalid {
			t.Fatalf("count %d was not rejected before IO: %v", count, err)
		}
	}
}

func TestImageGenerationExcessResultsAreFinalWithoutStorageOrResend(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]any{{"b64_json": "Y2F0"}, {"b64_json": "Y2F0"}}})
	}))
	defer server.Close()
	storage := s3TestStorage()
	_, err := generateImages(context.Background(), storage, GenerationJob{ID: "bounded-output", Count: 1, Model: "gpt-image-2", GenerationType: "TEXT_TO_IMAGE"}, ProviderConfig{BaseURL: server.URL, APIKey: "fixture", AllowPrivateNetwork: true})
	var persist ResultPersistError
	if !errors.As(err, &persist) || requests.Load() != 1 || len(storage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatalf("excess result crossed IO/retry boundary: requests=%d err=%v", requests.Load(), err)
	}
}

func TestMalformedGeneratedBase64IsResultPersistenceFailure(t *testing.T) {
	storage := s3TestStorage()
	_, err := normalizeGeneratedImage(context.Background(), storage, GenerationJob{UserID: "owner"}, map[string]any{"b64_json": "%%%invalid"}, imagePayload{})
	var persist ResultPersistError
	if !errors.As(err, &persist) || len(storage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatalf("malformed output classification = %v", err)
	}
}

func TestGeneratedBase64EncodedLimitPrecedesDecoding(t *testing.T) {
	storage := s3TestStorage()
	// Invalid base64 deliberately proves the encoded-size check runs first:
	// a decoder-first path would report malformed encoding instead of size.
	encoded := strings.Repeat("!", base64.StdEncoding.EncodedLen(int(ImageMaxBytes))+1)
	_, err := normalizeGeneratedImage(context.Background(), storage, GenerationJob{UserID: "owner"}, map[string]any{"b64_json": encoded}, imagePayload{})
	var persist ResultPersistError
	if !errors.As(err, &persist) || !strings.Contains(err.Error(), "超过 50MiB") || len(storage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatalf("encoded limit did not precede decoding/PUT: %v", err)
	}
}

func TestGeneratedBase64DecodedLimitWithinEncodedBudget(t *testing.T) {
	storage := s3TestStorage()
	// 50MiB is 2 mod 3. One extra decoded byte fits the exact same encoded
	// character budget, so the independent decoded-size guard is required.
	encodedLength := base64.StdEncoding.EncodedLen(int(ImageMaxBytes))
	if base64.StdEncoding.DecodedLen(encodedLength) != int(ImageMaxBytes)+1 {
		t.Fatal("boundary fixture must decode one byte past the limit")
	}
	_, err := normalizeGeneratedImage(context.Background(), storage, GenerationJob{UserID: "owner"}, map[string]any{"b64_json": strings.Repeat("A", encodedLength)}, imagePayload{})
	var persist ResultPersistError
	if !errors.As(err, &persist) || !strings.Contains(err.Error(), "为空或超过 50MiB") || len(storage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatalf("decoded limit allowed physical PUT: %v", err)
	}
}

func TestResponsesExtraImageStopsFurtherProviderCallsAndPersistence(t *testing.T) {
	var requests atomic.Int32
	result := base64.StdEncoding.EncodeToString(minimalPNG(2, 2))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		if request.URL.Path != "/responses" {
			t.Errorf("unexpected endpoint %s", request.URL.Path)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"output": []any{map[string]any{"type": "image_generation_call", "result": result}, map[string]any{"type": "image_generation_call", "result": result}}})
	}))
	defer server.Close()
	storage := s3TestStorage()
	_, err := generateImages(context.Background(), storage, GenerationJob{ID: "responses-budget", UserID: "owner", Count: 4, Model: "gpt-5.4", GenerationType: "TEXT_TO_IMAGE"}, ProviderConfig{BaseURL: server.URL, APIKey: "fixture", AllowPrivateNetwork: true})
	var persist ResultPersistError
	if !errors.As(err, &persist) || requests.Load() != 1 || len(storage.client.(*fakeObjectStorage).puts) != 0 {
		t.Fatalf("Responses excess output resent/PUT: requests=%d err=%v", requests.Load(), err)
	}
}

func TestKnownLocalSourceUsesLedgerAndBytesWithoutPublicHTTP(t *testing.T) {
	ctx := context.Background()
	volumeID := "00112233-4455-4677-8899-aabbccddeeff"
	config := LocalImageStoreConfig{RootDirectory: t.TempDir(), VolumeID: volumeID}
	if _, err := InitializeLocalImageVolume(ctx, config); err != nil {
		t.Fatal(err)
	}
	local, err := NewLocalImageStore(config)
	if err != nil {
		t.Fatal(err)
	}
	data := minimalPNG(2, 2)
	digest := sha256.Sum256(data)
	object := ImageObjectRecord{ID: "11223344-5566-4788-99aa-bbccddeeff00", AssetID: "22334455-6677-4899-aabb-ccddeeff0011", Provenance: "WRITE", ReservationID: "33445566-7788-49aa-bbcc-ddeeff001122", WriteToken: "44556677-8899-4abb-8cdd-eeff00112233", WriteExpiresAt: time.Now().Format(time.RFC3339Nano), Key: "images/shared.png", ByteLength: int64(len(data)), MimeType: "image/png", SHA256: hex.EncodeToString(digest[:]), State: "READY", PutOutcome: "CONFIRMED", Accounted: true}
	location, _ := NewImageLocalLocation(volumeID)
	object.LocationID = location.ID
	if _, err := local.Put(ctx, LocalImagePutInput{LocalImageObject: LocalImageObject{Key: object.Key, ByteLength: object.ByteLength, SHA256: object.SHA256}, Bytes: data}); err != nil {
		t.Fatal(err)
	}
	image := ManagedImage{Asset: ImageAssetRecord{ID: object.AssetID, OwnerID: "another-owner", Purpose: "REFERENCE", PublicToken: strings.Repeat("a", 64), ByteLength: object.ByteLength, MimeType: object.MimeType, SHA256: object.SHA256, State: "AVAILABLE", ActiveObjectID: &object.ID}, Object: &object, Location: &ImageLocation{ImageLocationInput: location}}
	encoded, _ := json.Marshal(image)
	protected, _ := json.Marshal(ImageReadLease{Image: image, ReadExpiresAt: time.Now().Add(45 * time.Second)})
	queryer := &imageReaderTestQueryer{image: encoded, lease: protected}
	var hits atomic.Int32
	public := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer public.Close()
	for _, backend := range []string{"local", "s3"} {
		t.Run("current-write-backend-"+backend, func(t *testing.T) {
			storage := &Storage{cfg: Config{ImageStorageManagedEnabled: true, ImageStorageBackend: backend, ImageStoragePath: config.RootDirectory, ImageStorageVolumeID: volumeID}, imageRepository: NewImageRepository(queryer)}
			if backend == "local" {
				storage.localImages = local
			}
			sources, err := storage.loadImageSources(ctx, []string{public.URL + "/media/images/" + image.Asset.PublicToken})
			if err != nil || len(sources) != 1 || !bytes.Equal(sources[0].Data, data) || hits.Load() != 0 {
				t.Fatalf("internal image read failed: sources=%d publicRequests=%d err=%v", len(sources), hits.Load(), err)
			}
			if len(queryer.resolveArgs) != 2 || queryer.resolveArgs[1] != nil {
				t.Fatal("ordinary public alias unexpectedly restricted to its current referencing owner")
			}
			expired, _ := json.Marshal(ImageReadLease{Image: image, ReadExpiresAt: time.Now().Add(-time.Second)})
			queryer.lease = expired
			if _, err := storage.readManagedImage(ctx, image); err == nil {
				t.Fatal("expired reader fence still opened physical bytes")
			}
			queryer.lease = protected
		})
	}
}

func TestManagedImageAdmissionErrorsStayBeforeHandoff(t *testing.T) {
	for _, code := range []string{"IMAGE_QUOTA_EXCEEDED", "IMAGE_STORAGE_UNAVAILABLE"} {
		failure := imageAdmissionFailure(ImageStorageError{Code: code})
		if failure.Code != code {
			t.Fatalf("admission code changed to %s", failure.Code)
		}
	}
}
