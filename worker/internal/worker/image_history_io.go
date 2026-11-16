package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

// Observation reads are bounded independently of the existing 50 MiB write
// limit. Larger historical objects are streamed, never buffered for a COPY.
const ImageHistoryObservationMaxBytes int64 = 512 * 1024 * 1024

type ImageHistoryIOError struct {
	Code      string
	VersionID string
}

func (err ImageHistoryIOError) Error() string { return err.Code }

type ImageHistoryExpectedContent struct {
	ByteLength int64
	SHA256     string
	MimeType   string
}

// ImageHistoryInspection is an actual IO result, not a database assertion. A
// non-FULL result may have a known size, but never fabricates a digest.
type ImageHistoryInspection struct {
	ReadResult          string
	ByteLength          *int64
	SHA256              string
	MimeType            string
	VersionEvidence     string
	VersionID           string
	ETag                string
	LastModified        string
	LocalFinalImmutable bool
	WriterProofSHA256   string
	Data                []byte
}

// The planner receives only this interface. It cannot PUT, delete, probe
// writability, initialize a volume, or register a database location.
type ImageHistoryReadOnlyIO interface {
	Verify(context.Context, ImageLocationInput) error
	Inspect(context.Context, ImageLocationInput, string, *ImageHistoryExpectedContent, bool) (ImageHistoryInspection, error)
}

type ImageHistoryApplyIO interface {
	ImageHistoryReadOnlyIO
	ProbeTarget(context.Context, ImageLocationInput) error
	Put(context.Context, ImageLocationInput, ImageObjectRecord, []byte) (string, error)
	VerifyPublishedReader(context.Context, string, ImageHistoryExpectedContent) error
}

type imageHistoryReadStore interface {
	Verify(context.Context) error
	Inspect(context.Context, string, *ImageHistoryExpectedContent, bool) (ImageHistoryInspection, error)
}

type ImageHistoryInspector struct {
	locations map[string]ImageLocationInput
	stores    map[string]imageHistoryReadStore
}

// NewImageHistoryInspector has no storage IO and does not use NewStorage or an
// AWS default config/credential chain. Only explicitly bound namespaces are
// reachable, using the existing storage loader's explicit credential pair.
func NewImageHistoryInspector(cfg Config, locations []ImageLocationInput) (*ImageHistoryInspector, error) {
	return newImageHistoryInspector(cfg, locations, nil)
}

func newImageHistoryInspector(cfg Config, locations []ImageLocationInput, transport http.RoundTripper) (*ImageHistoryInspector, error) {
	result := &ImageHistoryInspector{locations: make(map[string]ImageLocationInput), stores: make(map[string]imageHistoryReadStore)}
	for _, location := range locations {
		if err := validateImageHistoryLocation(location); err != nil {
			return nil, err
		}
		if previous, exists := result.locations[location.ID]; exists {
			if previous != location {
				return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
			}
			continue
		}
		result.locations[location.ID] = location
		if location.Provider == "LOCAL" {
			if location.VolumeID != cfg.ImageStorageVolumeID {
				return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
			}
			local, err := NewLocalImageStore(LocalImageStoreConfig{RootDirectory: cfg.ImageStoragePath, VolumeID: location.VolumeID})
			if err != nil {
				return nil, imageHistoryIOError(err)
			}
			result.stores[location.ID] = &imageHistoryLocalStore{local: local, location: location}
			continue
		}
		if cfg.S3AccessKeyID == "" || cfg.S3SecretAccessKey == "" {
			return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		httpClient := &http.Client{
			Timeout: time.Duration(ImageReadTimeoutMilliseconds) * time.Millisecond, Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
		client := s3.New(s3.Options{
			BaseEndpoint: aws.String(location.Endpoint), Region: location.Region,
			UsePathStyle: true, RetryMaxAttempts: 1, HTTPClient: httpClient,
			Credentials: credentials.NewStaticCredentialsProvider(cfg.S3AccessKeyID, cfg.S3SecretAccessKey, ""),
		})
		canvasLocation, err := NewCanvasStorageLocation(location.Endpoint, location.Region, location.Bucket)
		if err != nil {
			return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		probe := &canvasS3GCStorage{client: client, location: canvasLocation}
		if canvasR2Endpoint.MatchString(canvasLocation.Endpoint) {
			probe.r2Client, err = newCanvasR2ProbeClient(client, canvasLocation)
			if err != nil {
				return nil, imageHistoryIOError(err)
			}
		}
		result.stores[location.ID] = &imageHistoryS3Store{client: client, probe: probe, location: location}
	}
	return result, nil
}

func validateImageHistoryLocation(location ImageLocationInput) error {
	var identity ImageLocationInput
	var err error
	switch location.Provider {
	case "LOCAL":
		identity, err = NewImageLocalLocation(location.VolumeID)
	case "S3":
		identity, err = NewImageS3Location(location.Endpoint, location.Region, location.Bucket, location.PublicBaseURL)
	default:
		return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	if err != nil || identity != location {
		return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	return nil
}

func (inspector *ImageHistoryInspector) store(location ImageLocationInput) (imageHistoryReadStore, error) {
	if inspector == nil || inspector.locations[location.ID] != location || inspector.stores[location.ID] == nil {
		return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	return inspector.stores[location.ID], nil
}

func (inspector *ImageHistoryInspector) Verify(ctx context.Context, location ImageLocationInput) error {
	store, err := inspector.store(location)
	if err != nil {
		return err
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageReadTimeoutMilliseconds)*time.Millisecond)
	defer cancel()
	return imageHistoryIOError(store.Verify(probeCtx))
}

func (inspector *ImageHistoryInspector) Inspect(ctx context.Context, location ImageLocationInput, key string, expected *ImageHistoryExpectedContent, keepData bool) (ImageHistoryInspection, error) {
	result := ImageHistoryInspection{ReadResult: "FAILED", VersionEvidence: "UNKNOWN"}
	if _, _, err := LocalImageObjectNames(key); err != nil {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if expected != nil && (expected.ByteLength < 1 || !imagePublicTokenPattern.MatchString(expected.SHA256) || expected.MimeType == "") {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	store, err := inspector.store(location)
	if err != nil {
		return result, err
	}
	readCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageReadTimeoutMilliseconds)*time.Millisecond)
	defer cancel()
	result, err = store.Inspect(readCtx, key, expected, keepData)
	if err != nil {
		// Data from any failed/mismatching read must never be reused for COPY.
		result.Data = nil
		result.LocalFinalImmutable = false
		result.WriterProofSHA256 = ""
		return result, imageHistoryIOError(err)
	}
	return result, nil
}

func imageHistoryIOError(err error) error {
	if err == nil {
		return nil
	}
	var historyErr ImageHistoryIOError
	if errors.As(err, &historyErr) {
		return historyErr
	}
	var imageErr ImageStorageError
	if errors.As(err, &imageErr) {
		return ImageStorageError{Code: imageErr.Code}
	}
	var localErr *LocalImageStoreError
	if errors.As(err, &localErr) {
		switch localErr.Code {
		case "LOCAL_IMAGE_NOT_FOUND":
			return ImageHistoryIOError{Code: "SOURCE_MISSING"}
		case "LOCAL_IMAGE_WRITE_PENDING":
			return ImageHistoryIOError{Code: "WRITE_PENDING"}
		case "LOCAL_IMAGE_CONTENT_MISMATCH":
			return ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
		case "LOCAL_IMAGE_OBJECT_EXISTS":
			return ImageHistoryIOError{Code: "OBJECT_EXISTS"}
		case "LOCAL_IMAGE_VOLUME_MISMATCH", "LOCAL_IMAGE_UNSAFE_PATH":
			return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
	}
	var responseErr *smithyhttp.ResponseError
	if errors.As(err, &responseErr) && responseErr.HTTPStatusCode() == http.StatusNotFound {
		return ImageHistoryIOError{Code: "SOURCE_MISSING"}
	}
	return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
}

func readImageHistoryContent(ctx context.Context, reader io.Reader, length int64, expected *ImageHistoryExpectedContent, keepData bool) (ImageHistoryInspection, error) {
	result := ImageHistoryInspection{ReadResult: "UNVERIFIED", ByteLength: &length, VersionEvidence: "UNKNOWN"}
	if length < 1 {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	if length > ImageHistoryObservationMaxBytes {
		return result, ImageHistoryIOError{Code: "OBSERVATION_TOO_LARGE"}
	}
	if expected != nil && expected.ByteLength != length {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	digest := sha256.New()
	var retained bytes.Buffer
	var prefix []byte
	buffer := make([]byte, localImageChunkBytes)
	bounded := io.LimitReader(reader, length+1)
	var count int64
	for {
		if ctx.Err() != nil {
			return result, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		n, err := bounded.Read(buffer)
		if n > 0 {
			count += int64(n)
			if count > length {
				return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
			}
			_, _ = digest.Write(buffer[:n])
			if len(prefix) < 512 {
				prefix = append(prefix, buffer[:min(n, 512-len(prefix))]...)
			}
			if keepData && length <= ImageMaxBytes {
				_, _ = retained.Write(buffer[:n])
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil || n == 0 {
			return result, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
	}
	if count != length || ctx.Err() != nil {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	result.SHA256 = hex.EncodeToString(digest.Sum(nil))
	mimeType, err := managedImageMime(prefix)
	if err != nil {
		return result, ImageHistoryIOError{Code: "NOT_AN_IMAGE"}
	}
	result.MimeType = mimeType
	if expected != nil && (expected.SHA256 != result.SHA256 || expected.MimeType != result.MimeType) {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	result.ReadResult = "FULL"
	if keepData && length <= ImageMaxBytes {
		result.Data = retained.Bytes()
	}
	return result, nil
}

type imageHistoryS3Store struct {
	client   *s3.Client
	probe    *canvasS3GCStorage
	location ImageLocationInput
}

func (store *imageHistoryS3Store) Verify(ctx context.Context) error { return store.probe.Verify(ctx) }

func imageHistoryObjectWire(location ImageLocationInput, key, method string) func(*s3.Options) {
	return func(options *s3.Options) {
		canvasSingleAttempt(options)
		options.APIOptions = append(options.APIOptions, func(stack *middleware.Stack) error {
			guard := middleware.DeserializeMiddlewareFunc("ImageHistoryObjectIdentity", func(ctx context.Context, input middleware.DeserializeInput, next middleware.DeserializeHandler) (middleware.DeserializeOutput, middleware.Metadata, error) {
				output, metadata, err := next.HandleDeserialize(ctx, input)
				response, ok := output.RawResponse.(*smithyhttp.Response)
				if !ok || response == nil || response.Response == nil {
					return output, metadata, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
				}
				request := response.Request
				expectedPath := "/" + location.Bucket + "/" + key
				if ctx.Err() != nil || request == nil || request.URL == nil || request.Method != method || request.Response != nil ||
					request.URL.Scheme+"://"+request.URL.Host != location.Endpoint || request.URL.Path != expectedPath ||
					!strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
					if response.Body != nil {
						_ = response.Body.Close()
					}
					return output, metadata, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
				}
				for name := range response.Header {
					if strings.EqualFold(name, "x-amz-version-id") || strings.EqualFold(name, "x-amz-delete-marker") {
						if response.Body != nil {
							_ = response.Body.Close()
						}
						versionID := response.Header.Get("x-amz-version-id")
						if len(versionID) > 1024 {
							versionID = ""
						}
						return output, metadata, ImageHistoryIOError{Code: "VERSIONED_OBJECT", VersionID: versionID}
					}
				}
				if response.StatusCode != http.StatusOK {
					if response.Body != nil {
						_ = response.Body.Close()
					}
					if response.StatusCode == http.StatusNotFound {
						return output, metadata, ImageHistoryIOError{Code: "SOURCE_MISSING"}
					}
					return output, metadata, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
				}
				return output, metadata, err
			})
			return stack.Deserialize.Insert(guard, "OperationDeserializer", middleware.After)
		})
	}
}

func (store *imageHistoryS3Store) Inspect(ctx context.Context, key string, expected *ImageHistoryExpectedContent, keepData bool) (ImageHistoryInspection, error) {
	result := ImageHistoryInspection{ReadResult: "UNVERIFIED", VersionEvidence: "UNKNOWN"}
	// The raw versioning/R2 proof is read-only and is repeated for each object.
	if err := store.Verify(ctx); err != nil {
		return result, err
	}
	head, err := store.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(store.location.Bucket), Key: aws.String(key)}, imageHistoryObjectWire(store.location, key, http.MethodHead))
	if err != nil || head == nil || head.ContentLength == nil {
		failure := imageHistoryInspectionFailure(&result, err)
		return result, failure
	}
	length := *head.ContentLength
	result.ByteLength, result.VersionEvidence = &length, "UNVERSIONED"
	result.ETag = aws.ToString(head.ETag)
	if head.LastModified != nil {
		result.LastModified = head.LastModified.UTC().Format(time.RFC3339Nano)
	}
	if length < 1 || length > ImageHistoryObservationMaxBytes {
		return result, ImageHistoryIOError{Code: "OBSERVATION_TOO_LARGE"}
	}
	if result.ETag == "" || head.LastModified == nil || head.VersionId != nil || head.DeleteMarker != nil {
		return result, ImageHistoryIOError{Code: "OBJECT_IDENTITY_UNVERIFIED"}
	}
	if expected != nil && expected.ByteLength != length {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	got, err := store.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(store.location.Bucket), Key: aws.String(key), IfMatch: head.ETag}, imageHistoryObjectWire(store.location, key, http.MethodGet))
	if err != nil || got == nil || got.Body == nil {
		failure := imageHistoryInspectionFailure(&result, err)
		return result, failure
	}
	defer got.Body.Close()
	stopAbort := context.AfterFunc(ctx, func() { _ = got.Body.Close() })
	defer stopAbort()
	if got.ContentLength == nil || *got.ContentLength != length || aws.ToString(got.ETag) != result.ETag || got.LastModified == nil || !got.LastModified.Equal(*head.LastModified) || got.VersionId != nil || got.DeleteMarker != nil {
		return result, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	content, err := readImageHistoryContent(ctx, got.Body, length, expected, keepData)
	content.ETag, content.LastModified, content.VersionEvidence = result.ETag, result.LastModified, result.VersionEvidence
	if err != nil {
		return content, err
	}
	// An object that changed while we hashed is not a stable observation.
	after, err := store.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(store.location.Bucket), Key: aws.String(key), IfMatch: head.ETag}, imageHistoryObjectWire(store.location, key, http.MethodHead))
	if err != nil || after == nil || after.ContentLength == nil || *after.ContentLength != length || aws.ToString(after.ETag) != result.ETag || after.LastModified == nil || !after.LastModified.Equal(*head.LastModified) || after.VersionId != nil || after.DeleteMarker != nil {
		content.ReadResult = "UNVERIFIED"
		if err != nil {
			failure := imageHistoryInspectionFailure(&content, err)
			return content, failure
		}
		return content, ImageHistoryIOError{Code: "OBJECT_CHANGED"}
	}
	if err := store.Verify(ctx); err != nil {
		content.ReadResult, content.VersionEvidence = "UNVERIFIED", "UNKNOWN"
		return content, err
	}
	return content, nil
}

func imageHistoryInspectionFailure(result *ImageHistoryInspection, err error) error {
	if err == nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	normalized := imageHistoryIOError(err)
	var known ImageHistoryIOError
	if errors.As(normalized, &known) {
		switch known.Code {
		case "SOURCE_MISSING":
			result.ReadResult = "MISSING"
		case "VERSIONED_OBJECT":
			result.VersionEvidence = "VERSIONED"
			result.VersionID = known.VersionID
		}
	}
	return normalized
}

// The explicit apply constructor is the only place that exposes target
// mutation capabilities. It still does not initialize volumes or start loops.
type ImageHistoryWriter struct{ *ImageHistoryInspector }

func NewImageHistoryWriter(cfg Config, locations []ImageLocationInput) (*ImageHistoryWriter, error) {
	inspector, err := NewImageHistoryInspector(cfg, locations)
	if err != nil {
		return nil, err
	}
	return &ImageHistoryWriter{ImageHistoryInspector: inspector}, nil
}

func (writer *ImageHistoryWriter) ProbeTarget(ctx context.Context, location ImageLocationInput) error {
	store, err := writer.store(location)
	if err != nil {
		return err
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageReadTimeoutMilliseconds)*time.Millisecond)
	defer cancel()
	if local, ok := store.(*imageHistoryLocalStore); ok {
		_, err := local.local.ProbeWritable(probeCtx)
		return imageHistoryIOError(err)
	}
	return imageHistoryIOError(store.Verify(probeCtx))
}

func (writer *ImageHistoryWriter) Put(ctx context.Context, location ImageLocationInput, object ImageObjectRecord, data []byte) (string, error) {
	store, err := writer.store(location)
	if err != nil {
		return "", err
	}
	if object.LocationID != location.ID || object.Provenance != "WRITE" || !imageUUIDPattern.MatchString(object.WriteToken) || !imageUUIDPattern.MatchString(object.ReservationID) || object.State != "WRITING" || object.PutOutcome != "NOT_STARTED" || object.ByteLength != int64(len(data)) || object.ByteLength > ImageMaxBytes || object.ByteLength < 1 {
		return "", ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != object.SHA256 {
		return "", ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	if _, _, err := LocalImageObjectNames(object.Key); err != nil {
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	putCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageReadTimeoutMilliseconds)*time.Millisecond)
	defer cancel()
	if local, ok := store.(*imageHistoryLocalStore); ok {
		_, err := local.local.Put(putCtx, LocalImagePutInput{LocalImageObject: LocalImageObject{Key: object.Key, ByteLength: object.ByteLength, SHA256: object.SHA256}, Bytes: data})
		return "", imageHistoryIOError(err)
	}
	s3Store, ok := store.(*imageHistoryS3Store)
	if !ok {
		return "", ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if err := s3Store.Verify(putCtx); err != nil {
		return "", imageHistoryIOError(err)
	}
	receipt, err := s3Store.client.PutObject(putCtx, &s3.PutObjectInput{
		Bucket: aws.String(location.Bucket), Key: aws.String(object.Key), Body: bytes.NewReader(data),
		ContentLength: aws.Int64(object.ByteLength), ContentType: aws.String(object.MimeType),
		ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(digest[:])), IfNoneMatch: aws.String("*"),
	}, imageHistoryObjectWire(location, object.Key, http.MethodPut))
	versionID := ""
	if receipt != nil {
		versionID = aws.ToString(receipt.VersionId)
	}
	var versioned ImageHistoryIOError
	if errors.As(err, &versioned) && versioned.Code == "VERSIONED_OBJECT" && versionID == "" {
		versionID = versioned.VersionID
	}
	return versionID, imageHistoryIOError(err)
}

func imageHistoryProof(parts ...string) string {
	var encoded strings.Builder
	for _, part := range parts {
		encoded.WriteString(strconv.Itoa(len(part)))
		encoded.WriteByte(':')
		encoded.WriteString(part)
	}
	digest := sha256.Sum256([]byte(encoded.String()))
	return hex.EncodeToString(digest[:])
}

// URL strings are only matched as exact aliases. This parser is deliberately
// never used to choose an endpoint, bucket, key, or remote download target.
func validImageHistoryAlias(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.User == nil && len(rawURL) <= 8192
}
