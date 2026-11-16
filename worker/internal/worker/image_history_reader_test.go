package worker

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

type historyPublishedFixture struct {
	hits    atomic.Int32
	corrupt atomic.Bool
	status  atomic.Int32
}

func historyRuntimePublishedReader(t *testing.T, runner *imageHistoryRunner, repo *historyRuntimeRepository, cfg LocalImageStoreConfig) *historyPublishedFixture {
	t.Helper()
	local, err := NewLocalImageStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &historyPublishedFixture{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		fixture.hits.Add(1)
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" {
			t.Error("published reader proof sent credentials")
		}
		if request.Method != http.MethodGet || request.URL.Path != "/media/images/"+repo.item.Source.Asset.PublicToken || request.URL.RawQuery != "" {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		if status := fixture.status.Load(); status != 0 {
			response.WriteHeader(int(status))
			return
		}
		target := repo.item.Target
		if target == nil || repo.item.ReplicaVerificationID == nil || repo.item.Source.Asset.ActiveObjectID == nil || *repo.item.Source.Asset.ActiveObjectID != target.Object.ID {
			t.Error("publication probe preceded actual target readback/switch")
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		data, err := local.Read(request.Context(), LocalImageObject{Key: target.Object.Key, ByteLength: target.Object.ByteLength, SHA256: target.Object.SHA256})
		if err != nil {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fixture.corrupt.Load() {
			data[len(data)-1] ^= 1
		}
		response.Header().Set("Content-Type", target.Object.MimeType)
		response.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = response.Write(data)
	}))
	t.Cleanup(server.Close)
	runner.job.PublicURLBase, repo.job.PublicURLBase = server.URL, server.URL
	return fixture
}

func TestImageHistoryPublishedReaderProofIsBoundedAndNeverRedirects(t *testing.T) {
	data := imageHistoryPNG(t)
	expected := *imageHistoryExpected(data)
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer destination.Close()
	for _, scenario := range []string{"success", "wrong-content", "too-long", "short", "missing", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				requests.Add(1)
				if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" {
					t.Error("reader proof sent credentials")
				}
				if scenario == "redirect" {
					response.Header().Set("Location", destination.URL+"/private")
					response.WriteHeader(http.StatusTemporaryRedirect)
					return
				}
				if scenario == "missing" {
					response.WriteHeader(http.StatusNotFound)
					return
				}
				body := bytes.Clone(data)
				switch scenario {
				case "wrong-content":
					body[len(body)-1] ^= 1
				case "too-long":
					body = append(body, 0)
				case "short":
					body = body[:len(body)-1]
				}
				response.Header().Set("Content-Type", "image/png")
				_, _ = response.Write(body)
			}))
			defer server.Close()
			canonical, _ := ImagePublicURL(server.URL, strings.Repeat("a", 64))
			err := (&ImageHistoryWriter{}).VerifyPublishedReader(context.Background(), canonical, expected)
			if scenario == "success" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				requireImageHistoryCode(t, err, "IMAGE_READER_INCOMPATIBLE")
			}
			if requests.Load() != 1 || redirected.Load() != 0 {
				t.Fatal("reader proof retried or followed a redirect")
			}
		})
	}
}

func TestImageHistoryPublishedReaderRejectsCredentialsAndCancelledReadBeforeNetwork(t *testing.T) {
	expected := *imageHistoryExpected(imageHistoryPNG(t))
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = io.WriteString(response, "never")
	}))
	defer server.Close()
	canonical, _ := ImagePublicURL(server.URL, strings.Repeat("a", 64))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := (&ImageHistoryWriter{}).VerifyPublishedReader(ctx, canonical, expected)
	requireImageHistoryCode(t, err, "IMAGE_READER_INCOMPATIBLE")
	for _, invalid := range []string{strings.Replace(canonical, "http://", "http://operator:fixture@", 1), canonical + "?secret=never", server.URL + "/arbitrary"} {
		err := (&ImageHistoryWriter{}).VerifyPublishedReader(context.Background(), invalid, expected)
		requireImageHistoryCode(t, err, "IMAGE_READER_INCOMPATIBLE")
	}
	if requests.Load() != 0 {
		t.Fatal("invalid/cancelled public proof reached network")
	}
}

func TestImageHistoryReaderMismatchRetainsSourceAndRetryDoesNotCopyAgain(t *testing.T) {
	runner, repo, storage, cfg, source := historyRuntimeFixture(t)
	reader := historyRuntimePublishedReader(t, runner, repo, cfg)
	reader.corrupt.Store(true)
	runner.job.RetireSource, repo.job.RetireSource = true, true
	first := runner.process(context.Background(), repo.item)
	if first.State != "BLOCKED" || first.Code != "IMAGE_READER_INCOMPATIBLE" || first.ReaderVerified || !first.StateAcknowledged || repo.lastBlockCode != "IMAGE_READER_INCOMPATIBLE" || repo.retirements != 0 || storage.puts != 1 {
		t.Fatalf("failed live publication proof retired source: %+v", first)
	}
	assertHistorySourcePreserved(t, repo, source)
	reader.corrupt.Store(false)
	second := runner.process(context.Background(), repo.item)
	if second.State != "RETIREMENT_REQUESTED" || second.Code != "" || !second.ReaderVerified || repo.retirements != 1 || storage.puts != 1 || repo.usedBytes != 2*int64(len(source.data)) || reader.hits.Load() != 2 {
		t.Fatalf("reader recovery repeated copy/accounting or skipped public proof: %+v", second)
	}
	assertHistorySourcePreserved(t, repo, source)
}
