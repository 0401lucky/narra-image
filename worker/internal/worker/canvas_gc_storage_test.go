package worker

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func canvasTestS3Storage(t *testing.T, handler http.HandlerFunc) canvasGCStorage {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	storage, err := NewStorage(context.Background(), Config{
		S3Endpoint: server.URL, S3Region: "us-east-1", S3Bucket: "imports",
		S3AccessKeyID: "test-access", S3SecretAccessKey: "test-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := newCanvasGCStorage(storage)
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func TestCanvasS3VerifiesOnlyKnownUnversionedReceipts(t *testing.T) {
	for _, scenario := range []struct {
		name, xml string
		status    int
		ready     bool
	}{
		{"unversioned", `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`, 200, true},
		{"enabled", `<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>`, 200, false},
		{"suspended", `<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>`, 200, false},
		{"unknown", `<VersioningConfiguration><Status>Unknown</Status></VersioningConfiguration>`, 200, false},
		{"denied", `<Error><Code>AccessDenied</Code></Error>`, 403, false},
		{"server-error", `<Error><Code>InternalError</Code></Error>`, 503, false},
		{"unsupported-is-not-unversioned", `<Error><Code>NotImplemented</Code></Error>`, 501, false},
		{"wrong-status", `<VersioningConfiguration/>`, 202, false},
		{"invalid-xml", `<VersioningConfiguration`, 200, false},
		{"empty-body-is-unknown", ``, 200, false},
		{"wrong-root-is-unknown", `<html/>`, 200, false},
		{"error-body-is-unknown", `<Error><Code>NotImplemented</Code></Error>`, 200, false},
		{"invalid-comment-character", "<!--\x00--><VersioningConfiguration/>", 200, false},
		{"invalid-comment-noncharacter", "<VersioningConfiguration><!--\ufffe--></VersioningConfiguration>", 200, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var calls atomic.Int32
			storage := canvasTestS3Storage(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodGet || r.URL.Path != "/imports" || !r.URL.Query().Has("versioning") {
					t.Error("capability probe was destructive or used another bucket")
				}
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(scenario.status)
				_, _ = w.Write([]byte(scenario.xml))
			})
			err := storage.Verify(context.Background())
			if (err == nil) != scenario.ready {
				t.Fatalf("incorrect capability: %v", err)
			}
			if calls.Load() != 1 {
				t.Fatalf("capability probe retried unboundedly: %d", calls.Load())
			}
		})
	}
}

func TestCanvasS3DeleteUsesOnlyRegisteredExactKeyAndRejectsMarkers(t *testing.T) {
	for _, scenario := range []struct {
		name         string
		status       int
		xml, version string
		marker       bool
		outcome      string
		fail         bool
	}{
		{name: "deleted", status: 204, outcome: canvasDeleteDeleted},
		{name: "missing-key", status: 404, xml: `<Error><Code>NoSuchKey</Code></Error>`, outcome: canvasDeleteMissing},
		{name: "missing-bucket", status: 404, xml: `<Error><Code>NoSuchBucket</Code></Error>`, outcome: canvasDeleteFailed, fail: true},
		{name: "denied", status: 403, xml: `<Error><Code>AccessDenied</Code></Error>`, outcome: canvasDeleteFailed, fail: true},
		{name: "transient", status: 503, xml: `<Error><Code>InternalError</Code></Error>`, outcome: canvasDeleteFailed, fail: true},
		{name: "unexpected-status", status: 200, outcome: canvasDeleteUnknown, fail: true},
		{name: "delete-marker", status: 204, marker: true, outcome: canvasDeleteUnknown, fail: true},
		{name: "version-id", status: 204, version: "new-version", outcome: canvasDeleteUnknown, fail: true},
		{name: "null-version", status: 204, version: "null", outcome: canvasDeleteUnknown, fail: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var calls atomic.Int32
			storage := canvasTestS3Storage(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodDelete || r.URL.Path != "/imports/not-a-prefix-scan/one.png" || r.URL.Query().Get("versionId") != "" || r.URL.Query().Has("list-type") {
					t.Errorf("wrong exact delete request: %s %s", r.Method, r.URL)
				}
				if scenario.marker {
					w.Header().Set("x-amz-delete-marker", "true")
				}
				if scenario.version != "" {
					w.Header().Set("x-amz-version-id", scenario.version)
				}
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(scenario.status)
				_, _ = w.Write([]byte(scenario.xml))
			})
			asset := runtimeCanvasAsset(t)
			location := storage.Location()
			asset.StorageEndpoint, asset.StorageRegion, asset.StorageBucket, asset.StorageLocation = location.Endpoint, location.Region, location.Bucket, location.ID
			asset.StorageKey = "not-a-prefix-scan/one.png"
			outcome, err := storage.Delete(context.Background(), asset)
			if outcome != scenario.outcome || (err != nil) != scenario.fail {
				t.Fatalf("incorrect delete receipt: %q %v", outcome, err)
			}
			if calls.Load() != 1 {
				t.Fatalf("delete retried instead of DB backoff: %d", calls.Load())
			}
		})
	}
}

func TestCanvasS3RejectsLocationMismatchAndHonorsCancellation(t *testing.T) {
	var calls atomic.Int32
	storage := canvasTestS3Storage(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		<-r.Context().Done()
	})
	asset := runtimeCanvasAsset(t)
	if _, err := storage.Delete(context.Background(), asset); !errors.Is(err, errCanvasStorageCapability) || calls.Load() != 0 {
		t.Fatal("mismatched recorded location reached network")
	}
	location := storage.Location()
	asset.StorageEndpoint, asset.StorageRegion, asset.StorageBucket, asset.StorageLocation = location.Endpoint, location.Region, location.Bucket, location.ID
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	outcome, err := storage.Delete(ctx, asset)
	if outcome != canvasDeleteUnknown || err == nil || time.Since(started) > time.Second {
		t.Fatalf("delete timeout did not preserve retry inventory: %s %v", outcome, err)
	}
	if strings.Contains(outcome, "DELETED") {
		t.Fatal("timeout reported reclaimed bytes")
	}
}

func TestCanvasVersioningWireEnvelope(t *testing.T) {
	for _, body := range []string{
		`<VersioningConfiguration/>`,
		"<VersioningConfiguration> \n\t </VersioningConfiguration>",
		`<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`,
		`<s3:VersioningConfiguration xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"></s3:VersioningConfiguration>`,
		"\ufeff<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!--verified--><VersioningConfiguration><!--empty--></VersioningConfiguration>\n",
		`<?xml version='1.0' encoding='utf-8' standalone='yes'?><VersioningConfiguration/>`,
		`<!--inert & <![CDATA[ text--><VersioningConfiguration/>`,
		"<!--\t\r\n\u4e2d\u6587 \U0001f30d--><VersioningConfiguration/>",
	} {
		if !canvasVerifiedUnversionedXML([]byte(body)) {
			t.Errorf("valid empty versioning envelope rejected: %q", body)
		}
	}
	for _, body := range []string{
		"", " ", "<html/>", "<VersioningConfiguration", "<versioningConfiguration/>",
		`<VersioningConfiguration xmlns="https://unknown.invalid/"/>`,
		`<VersioningConfiguration strange="attribute"/>`,
		`<VersioningConfiguration xmlns="" xmlns=""/>`,
		`<VersioningConfiguration xmlns:xml="http://s3.amazonaws.com/doc/2006-03-01/"/>`,
		`<VersioningConfiguration xmlns:s3=""/>`,
		`<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"/>`,
		`<VersioningConfiguration xmlns:a:b="http://s3.amazonaws.com/doc/2006-03-01/"/>`,
		`<a:VersioningConfiguration xmlns:a="http://s3.amazonaws.com/doc/2006-03-01/" xmlns:b="http://s3.amazonaws.com/doc/2006-03-01/"></b:VersioningConfiguration>`,
		`<other:VersioningConfiguration/>`,
		`<VersioningConfiguration><Status/></VersioningConfiguration>`,
		`<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>`,
		`<VersioningConfiguration>unknown</VersioningConfiguration>`,
		`<VersioningConfiguration/><VersioningConfiguration/>`,
		`<VersioningConfiguration/>trailing`,
		`<!DOCTYPE VersioningConfiguration><VersioningConfiguration/>`,
		`<?processing invalid?><VersioningConfiguration/>`,
		` <?xml version="1.0"?><VersioningConfiguration/>`,
		`<!--before--><?xml version="1.0"?><VersioningConfiguration/>`,
		`<?xml version="2.0"?><VersioningConfiguration/>`,
		`<VersioningConfiguration><![CDATA[ ]]></VersioningConfiguration>`,
		`<VersioningConfiguration>&#x20;</VersioningConfiguration>`,
		"<!--\x00--><VersioningConfiguration/>",
		"<VersioningConfiguration><!--\x1f--></VersioningConfiguration>",
		"<VersioningConfiguration/><!--\ufffe-->",
		"<!--\uffff--><VersioningConfiguration/>",
		strings.Repeat(" ", canvasVersioningBodyLimit) + `<VersioningConfiguration/>`,
	} {
		if canvasVerifiedUnversionedXML([]byte(body)) {
			t.Errorf("ambiguous versioning envelope accepted: %q", body)
		}
	}
	if canvasVerifiedUnversionedXML(append([]byte{0xff}, []byte(`<VersioningConfiguration/>`)...)) {
		t.Fatal("invalid UTF-8 accepted")
	}
}
