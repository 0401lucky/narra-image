package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsmiddleware "github.com/aws/aws-sdk-go-v2/aws/middleware"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

const canvasTestR2Endpoint = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"

type canvasTestRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip canvasTestRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func canvasTestStorageWithTransport(endpoint string, transport http.RoundTripper) (canvasGCStorage, *s3.Client, error) {
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(endpoint), Region: "auto", UsePathStyle: true,
		Credentials: credentials.NewStaticCredentialsProvider("canvas-test-access", "canvas-test-secret", ""),
		HTTPClient:  &http.Client{Transport: transport},
	})
	storage, err := newCanvasGCStorage(&Storage{client: client, cfg: Config{
		S3Endpoint: endpoint, S3Region: "auto", S3Bucket: "imports",
		S3AccessKeyID: "canvas-test-access", S3SecretAccessKey: "canvas-test-secret",
	}})
	return storage, client, err
}

func canvasTestStorageResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status, Header: make(http.Header), Request: request,
		Body: io.NopCloser(strings.NewReader(body)),
	}
}

func TestCanvasStorageProbeSharedScenarios(t *testing.T) {
	var fixture struct {
		ProbeVectors []struct {
			ID       string  `json:"id"`
			Endpoint string  `json:"endpoint"`
			Probe    *string `json:"probe"`
		} `json:"probeVectors"`
	}
	if err := json.Unmarshal(loadTestCanvasContract(t).Scenarios["storage-location"], &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.ProbeVectors) == 0 {
		t.Fatal("missing shared storage probe scenarios")
	}
	for _, vector := range fixture.ProbeVectors {
		t.Run(vector.ID, func(t *testing.T) {
			var calls atomic.Int32
			storage, _, err := canvasTestStorageWithTransport(vector.Endpoint, canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
				calls.Add(1)
				if vector.Probe == nil {
					t.Fatal("invalid location reached transport")
				}
				if request.URL.Path != "/imports" || !strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=canvas-test-access/") {
					t.Errorf("probe did not authenticate the exact bucket: %s %s", request.Method, request.URL)
				}
				if *vector.Probe == "HeadBucket" {
					if request.Method != http.MethodHead || request.URL.RawQuery != "" {
						t.Errorf("R2 probe used unsupported/destructive operation: %s %s", request.Method, request.URL)
					}
					return canvasTestStorageResponse(request, http.StatusOK, ""), nil
				}
				if request.Method != http.MethodGet || !request.URL.Query().Has("versioning") {
					t.Errorf("non-R2 endpoint bypassed versioning: %s %s", request.Method, request.URL)
				}
				return canvasTestStorageResponse(request, http.StatusOK, `<VersioningConfiguration/>`), nil
			}))
			if vector.Probe == nil {
				if err == nil || storage != nil || calls.Load() != 0 {
					t.Fatal("invalid location produced an adapter or reached network")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := storage.Verify(context.Background()); err != nil {
				t.Fatalf("valid probe did not verify: %v", err)
			}
			if calls.Load() != 1 {
				t.Fatalf("probe sent %d requests, want one read-only request", calls.Load())
			}
		})
	}
}

func TestCanvasR2RejectsNonSuccessAndNeverFollowsRedirects(t *testing.T) {
	for _, status := range []int{201, 204, 301, 302, 303, 307, 308, 400, 401, 403, 404, 429, 500, 501, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls, redirectCalls atomic.Int32
			storage, original, err := canvasTestStorageWithTransport(canvasTestR2Endpoint, canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
				calls.Add(1)
				if request.URL.Host != strings.TrimPrefix(canvasTestR2Endpoint, "https://") {
					redirectCalls.Add(1)
					return canvasTestStorageResponse(request, http.StatusOK, ""), nil
				}
				response := canvasTestStorageResponse(request, status, "")
				response.Header.Set("Location", "https://other.invalid/imports")
				return response, nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if !errors.Is(storage.Verify(context.Background()), errCanvasStorageCapability) {
				t.Fatal("non-200 or redirected response established R2 readiness")
			}
			if calls.Load() != 1 || redirectCalls.Load() != 0 {
				t.Fatalf("probe retried or visited redirect target: calls=%d target=%d", calls.Load(), redirectCalls.Load())
			}
			if original.Options().HTTPClient.(*http.Client).CheckRedirect != nil {
				t.Fatal("probe changed the media client's redirect behavior")
			}
		})
	}
}

func TestCanvasR2RejectsVersionHeadersAndUnboundResponses(t *testing.T) {
	for name, mutate := range map[string]func(*http.Response){
		"version":       func(response *http.Response) { response.Header.Set("x-amz-version-id", "version") },
		"empty-version": func(response *http.Response) { response.Header.Set("x-amz-version-id", "") },
		"null-version":  func(response *http.Response) { response.Header.Set("x-amz-version-id", "null") },
		"marker":        func(response *http.Response) { response.Header.Set("x-amz-delete-marker", "true") },
		"false-marker":  func(response *http.Response) { response.Header.Set("x-amz-delete-marker", "false") },
		"header-case":   func(response *http.Response) { response.Header["X-aMz-vErSiOn-Id"] = nil },
		"unsigned":      func(response *http.Response) { response.Request.Header.Del("Authorization") },
		"other-host":    func(response *http.Response) { response.Request.URL.Host = "other.invalid" },
		"other-bucket":  func(response *http.Response) { response.Request.URL.Path = "/other-bucket" },
		"other-method":  func(response *http.Response) { response.Request.Method = http.MethodGet },
		"query":         func(response *http.Response) { response.Request.URL.RawQuery = "versioning" },
		"redirect-chain": func(response *http.Response) {
			response.Request.Response = &http.Response{StatusCode: http.StatusTemporaryRedirect}
		},
	} {
		t.Run(name, func(t *testing.T) {
			storage, _, err := canvasTestStorageWithTransport(canvasTestR2Endpoint, canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
				response := canvasTestStorageResponse(request, http.StatusOK, "")
				mutate(response)
				return response, nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if !errors.Is(storage.Verify(context.Background()), errCanvasStorageCapability) {
				t.Fatal("unverified/versioned response established R2 readiness")
			}
		})
	}
}

type canvasTestHeadReceipt struct{ receipt *s3.HeadBucketOutput }

func (client canvasTestHeadReceipt) HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	return client.receipt, nil
}

func TestCanvasR2RequiresWireProofBeyondSDKMetadata(t *testing.T) {
	_, metadata, err := (awsmiddleware.AddRawResponse{}).HandleDeserialize(context.Background(), middleware.DeserializeInput{}, middleware.DeserializeHandlerFunc(func(context.Context, middleware.DeserializeInput) (middleware.DeserializeOutput, middleware.Metadata, error) {
		return middleware.DeserializeOutput{RawResponse: &smithyhttp.Response{Response: &http.Response{StatusCode: http.StatusOK}}}, middleware.Metadata{}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	location, err := NewCanvasStorageLocation(canvasTestR2Endpoint, "auto", "imports")
	if err != nil {
		t.Fatal(err)
	}
	for _, receipt := range []*s3.HeadBucketOutput{nil, {}, {ResultMetadata: metadata}} {
		storage := &canvasS3GCStorage{location: location, r2Client: canvasTestHeadReceipt{receipt: receipt}}
		if !errors.Is(storage.Verify(context.Background()), errCanvasStorageCapability) {
			t.Fatal("SDK success without the authenticated wire guard established readiness")
		}
	}
}

func TestCanvasR2CancellationAndLocationMismatch(t *testing.T) {
	for _, cancelBefore := range []bool{true, false} {
		t.Run(fmt.Sprintf("cancel-before=%t", cancelBefore), func(t *testing.T) {
			var calls atomic.Int32
			storage, _, err := canvasTestStorageWithTransport(canvasTestR2Endpoint, canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
				calls.Add(1)
				<-request.Context().Done()
				// Even a broken transport returning late HTTP 200 must fail closed.
				return canvasTestStorageResponse(request, http.StatusOK, ""), nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
			defer cancel()
			if cancelBefore {
				cancel()
			}
			started := time.Now()
			if !errors.Is(storage.Verify(ctx), errCanvasStorageCapability) || time.Since(started) > time.Second {
				t.Fatal("canceled/timed-out probe established readiness or ignored its bound")
			}
			if (cancelBefore && calls.Load() != 0) || (!cancelBefore && calls.Load() != 1) {
				t.Fatalf("unexpected canceled probe requests: %d", calls.Load())
			}
		})
	}
	var calls atomic.Int32
	storage, _, err := canvasTestStorageWithTransport(canvasTestR2Endpoint, canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		return canvasTestStorageResponse(request, http.StatusOK, ""), nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	storage.(*canvasS3GCStorage).location.Bucket = "different"
	if !errors.Is(storage.Verify(context.Background()), errCanvasStorageCapability) || calls.Load() != 0 {
		t.Fatal("location mismatch reached R2")
	}
}

func TestCanvasR2ProbeClonesSDKDefaultHTTPClient(t *testing.T) {
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(canvasTestR2Endpoint), Region: "auto", UsePathStyle: true,
		Credentials: credentials.NewStaticCredentialsProvider("test-access", "test-secret", ""),
	})
	location, err := NewCanvasStorageLocation(canvasTestR2Endpoint, "auto", "imports")
	if err != nil {
		t.Fatal(err)
	}
	probe, err := newCanvasR2ProbeClient(client, location)
	if err != nil {
		t.Fatal(err)
	}
	probeHTTP := probe.(*s3.Client).Options().HTTPClient.(*http.Client)
	if probeHTTP == client.Options().HTTPClient {
		t.Fatal("probe reused the mutable media HTTP client")
	}
	defer probeHTTP.CloseIdleConnections()
	for _, status := range []int{http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		request := &http.Request{Response: &http.Response{StatusCode: status}}
		if !errors.Is(probeHTTP.CheckRedirect(request, nil), http.ErrUseLastResponse) {
			t.Fatal("SDK default redirect handling was not disabled")
		}
	}
}
