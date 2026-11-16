package worker

import (
	"bytes"
	"context"
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

type historyTokenQueryer struct {
	image   []byte
	lease   []byte
	err     error
	queries []string
	args    [][]any
}

func (queryer *historyTokenQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.queries = append(queryer.queries, query)
	queryer.args = append(queryer.args, args)
	if queryer.err != nil {
		return imageTestRow{err: queryer.err}
	}
	if strings.Contains(query, "image_get_by_token") {
		return imageTestRow{payload: queryer.image}
	}
	if strings.Contains(query, "image_begin_read") {
		return imageTestRow{payload: queryer.lease}
	}
	// No URL alias exists: the canonical token is a separate read identity.
	return imageTestRow{payload: []byte("null")}
}

func TestImageHistoryCanonicalTokenReadsUseLedgerWhenManagedWritesAreDisabled(t *testing.T) {
	cfg, image, data := historyManagedLocalReadFixture(t)
	encoded, _ := json.Marshal(image)
	lease, _ := json.Marshal(ImageReadLease{Image: image, ReadExpiresAt: time.Now().Add(45 * time.Second)})
	var publicHits atomic.Int32
	public := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { publicHits.Add(1) }))
	defer public.Close()
	for _, enabled := range []bool{false, true} {
		queryer := &historyTokenQueryer{image: encoded, lease: lease}
		appURL := public.URL + "/prefix"
		canonical, err := ImagePublicURL(appURL, image.Asset.PublicToken)
		if err != nil {
			t.Fatal(err)
		}
		storage := &Storage{cfg: Config{AppURL: appURL, ImageStorageManagedEnabled: enabled, ImageStorageBackend: "s3", ImageStoragePath: cfg.RootDirectory, ImageStorageVolumeID: cfg.VolumeID}, imageRepository: NewImageRepository(queryer)}
		sources, err := storage.loadImageSources(context.Background(), []string{canonical})
		if err != nil || len(sources) != 1 || !bytes.Equal(sources[0].Data, data) || publicHits.Load() != 0 {
			t.Fatalf("canonical input fell back to HTTP: enabled=%v error=%v", enabled, err)
		}
		if len(queryer.queries) != 2 || !strings.Contains(queryer.queries[0], "image_get_by_token") || !strings.Contains(queryer.queries[1], "image_begin_read") || queryer.args[0][0] != image.Asset.PublicToken {
			t.Fatalf("canonical input skipped token identity/reader lease: %+v", queryer.queries)
		}
		for _, other := range []string{"https://another.invalid/media/images/" + image.Asset.PublicToken, canonical + "?not-canonical=1", canonical + "#fragment"} {
			before := len(queryer.queries)
			resolved, err := storage.resolveManagedImage(context.Background(), other)
			if err != nil || resolved != nil || len(queryer.queries) != before+1 || !strings.Contains(queryer.queries[before], "image_resolve_url") {
				t.Fatal("unbound URL was interpreted as an owned token")
			}
		}
	}
}

func TestImageHistoryCanonicalReadFailureNeverFallsBackOrHidesDatabaseErrors(t *testing.T) {
	token := strings.Repeat("a", 64)
	canonical, _ := ImagePublicURL("https://app.invalid", token)
	queryer := &historyTokenQueryer{image: []byte("null")}
	storage := &Storage{cfg: Config{AppURL: "https://app.invalid"}, imageRepository: NewImageRepository(queryer)}
	_, err := storage.resolveManagedImage(context.Background(), canonical)
	requireImageHistoryCode(t, err, "IMAGE_UNAVAILABLE")
	queryer.err = errors.New("untrusted database error details")
	resolved, err := storage.resolveManagedImage(context.Background(), canonical)
	if err == nil || resolved != nil || err.Error() != "IMAGE_INTERNAL_ERROR" {
		t.Fatal("failed managed query was converted into legacy fallback")
	}
	storage.imageRepository = nil
	resolved, err = storage.resolveManagedImage(context.Background(), "https://legacy.invalid/kept.png")
	if err != nil || resolved != nil {
		t.Fatal("isolated legacy storage without repository stopped supporting old URLs")
	}
	storage.cfg.ImageStorageManagedEnabled = true
	_, err = storage.resolveManagedImage(context.Background(), canonical)
	requireImageHistoryCode(t, err, "IMAGE_STORAGE_UNAVAILABLE")
}
