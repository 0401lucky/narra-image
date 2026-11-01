package worker

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsmiddleware "github.com/aws/aws-sdk-go-v2/aws/middleware"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

var (
	errCanvasStorageCapability = errors.New("CANVAS_STORAGE_CAPABILITY_INVALID")
	errCanvasGCAssetInvalid    = errors.New("CANVAS_INVALID_INPUT")
	canvasXMLDeclaration       = regexp.MustCompile(`^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"(?i:UTF-8)"|'(?i:UTF-8)'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>`)
	canvasXMLOpening           = regexp.MustCompile(`^<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?VersioningConfiguration)(?:[ \t\r\n]+xmlns(?::[A-Za-z_][A-Za-z0-9_.-]*)?[ \t\r\n]*=[ \t\r\n]*(?:"[^"<&]*"|'[^'<&]*'))*[ \t\r\n]*(/?)>`)
	canvasR2Endpoint           = regexp.MustCompile(`^https://[0-9a-f]{32}(?:\.(?:eu|fedramp|us))?\.r2\.cloudflarestorage\.com$`)
)

const (
	canvasVersioningBodyLimit = 16 * 1024
	canvasS3Namespace         = "http://s3.amazonaws.com/doc/2006-03-01/"
	canvasDeleteDeleted       = "DELETED"
	canvasDeleteMissing       = "MISSING"
	canvasDeleteFailed        = "FAILED"
	canvasDeleteUnknown       = "UNKNOWN"
)

type canvasGCStorage interface {
	Location() CanvasStorageLocation
	Verify(context.Context) error
	Delete(context.Context, canvasGCAsset) (string, error)
}

type canvasObjectStorageClient interface {
	GetBucketVersioning(context.Context, *s3.GetBucketVersioningInput, ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

type canvasR2HeadClient interface {
	HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
}

type canvasS3GCStorage struct {
	client   canvasObjectStorageClient
	r2Client canvasR2HeadClient
	location CanvasStorageLocation
}

func newCanvasGCStorage(storage *Storage) (canvasGCStorage, error) {
	if storage == nil || storage.cfg.S3AccessKeyID == "" || storage.cfg.S3SecretAccessKey == "" {
		return nil, errCanvasStorageCapability
	}
	location, err := NewCanvasStorageLocation(storage.cfg.S3Endpoint, storage.cfg.S3Region, storage.cfg.S3Bucket)
	if err != nil {
		return nil, errCanvasStorageCapability
	}
	client, ok := storage.client.(canvasObjectStorageClient)
	if !ok {
		return nil, errCanvasStorageCapability
	}
	adapter := &canvasS3GCStorage{client: client, location: location}
	if canvasR2Endpoint.MatchString(location.Endpoint) {
		adapter.r2Client, err = newCanvasR2ProbeClient(client, location)
		if err != nil {
			return nil, err
		}
	}
	return adapter, nil
}

func (storage *canvasS3GCStorage) Location() CanvasStorageLocation { return storage.location }

func canvasSingleAttempt(options *s3.Options) { options.RetryMaxAttempts = 1 }

func newCanvasR2ProbeClient(client canvasObjectStorageClient, location CanvasStorageLocation) (canvasR2HeadClient, error) {
	sdkClient, ok := client.(*s3.Client)
	if !ok {
		return nil, errCanvasStorageCapability
	}
	options := sdkClient.Options()
	probeHTTPClient := options.HTTPClient
	if buildable, ok := probeHTTPClient.(interface{ Freeze() aws.HTTPClient }); ok {
		probeHTTPClient = buildable.Freeze()
	}
	httpClient, ok := probeHTTPClient.(*http.Client)
	if !ok || httpClient == nil {
		return nil, errCanvasStorageCapability
	}
	// The SDK's default HTTP client follows 307/308. Clone only the R2 probe
	// client so no redirect can establish bucket identity or send credentials
	// elsewhere, while media writes and exact-key deletes keep their client.
	noRedirects := *httpClient
	noRedirects.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	options.HTTPClient = &noRedirects
	options.BaseEndpoint = aws.String(location.Endpoint)
	options.Region = location.Region
	options.UsePathStyle = true
	return s3.New(options), nil
}

type canvasVerifiedVersioningBodyKey struct{}
type canvasVerifiedR2BucketKey struct{}

func canvasR2ProbeOptions(location CanvasStorageLocation) func(*s3.Options) {
	return func(options *s3.Options) {
		canvasSingleAttempt(options)
		options.APIOptions = append(options.APIOptions, func(stack *middleware.Stack) error {
			guard := middleware.DeserializeMiddlewareFunc("CanvasR2Bucket", func(ctx context.Context, input middleware.DeserializeInput, next middleware.DeserializeHandler) (middleware.DeserializeOutput, middleware.Metadata, error) {
				output, metadata, err := next.HandleDeserialize(ctx, input)
				if err != nil {
					return output, metadata, err
				}
				response, ok := output.RawResponse.(*smithyhttp.Response)
				if !ok || response == nil || response.Response == nil {
					return output, metadata, errCanvasStorageCapability
				}
				if response.Body != nil {
					defer response.Body.Close()
				}
				request := response.Request
				if ctx.Err() != nil || response.StatusCode != http.StatusOK || request == nil || request.URL == nil ||
					request.Method != http.MethodHead || request.Response != nil || request.URL.Scheme+"://"+request.URL.Host != location.Endpoint ||
					request.URL.EscapedPath() != "/"+location.Bucket || request.URL.RawQuery != "" ||
					!strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
					return output, metadata, errCanvasStorageCapability
				}
				for name := range response.Header {
					if strings.EqualFold(name, "x-amz-version-id") || strings.EqualFold(name, "x-amz-delete-marker") {
						return output, metadata, errCanvasStorageCapability
					}
				}
				metadata.Set(canvasVerifiedR2BucketKey{}, true)
				return output, metadata, nil
			})
			return stack.Deserialize.Insert(guard, "OperationDeserializer", middleware.After)
		})
	}
}

func canvasVersioningProbeOptions(options *s3.Options) {
	canvasSingleAttempt(options)
	options.APIOptions = append(options.APIOptions, func(stack *middleware.Stack) error {
		// SDK XML decoders accept empty/wrong-root 200 bodies as zero-value
		// outputs. An absent Status alone is not proof of unversioned storage.
		guard := middleware.DeserializeMiddlewareFunc("CanvasVersioningBody", func(ctx context.Context, input middleware.DeserializeInput, next middleware.DeserializeHandler) (middleware.DeserializeOutput, middleware.Metadata, error) {
			output, metadata, err := next.HandleDeserialize(ctx, input)
			if err != nil {
				return output, metadata, err
			}
			response, ok := output.RawResponse.(*smithyhttp.Response)
			if !ok || response == nil || response.Response == nil || response.Body == nil {
				return output, metadata, errCanvasStorageCapability
			}
			body, err := io.ReadAll(io.LimitReader(response.Body, canvasVersioningBodyLimit+1))
			_ = response.Body.Close()
			if err != nil || len(body) > canvasVersioningBodyLimit {
				return output, metadata, errCanvasStorageCapability
			}
			response.Body = io.NopCloser(bytes.NewReader(body))
			if response.StatusCode == http.StatusOK {
				if !canvasVerifiedUnversionedXML(body) {
					return output, metadata, errCanvasStorageCapability
				}
				metadata.Set(canvasVerifiedVersioningBodyKey{}, true)
			}
			return output, metadata, nil
		})
		return stack.Deserialize.Insert(guard, "OperationDeserializer", middleware.After)
	})
}

func canvasVerifiedUnversionedXML(body []byte) bool {
	if len(body) == 0 || len(body) > canvasVersioningBodyLimit || !utf8.Valid(body) {
		return false
	}
	// encoding/xml does not validate character ranges inside comments. Check
	// the entire XML 1.0 envelope, matching the Node capability wire guard.
	for _, character := range string(body) {
		if (character < 0x20 && character != '\t' && character != '\r' && character != '\n') || character == 0xfffe || character == 0xffff {
			return false
		}
	}
	body = bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf})
	if declaration := canvasXMLDeclaration.Find(body); declaration != nil {
		body = body[len(declaration):]
	}
	// Check the exact empty wire grammar before namespace decoding. The SDK and
	// encoding/xml both tolerate some malformed attributes/zero-value bodies.
	if !canvasEmptyXMLEnvelope(body) {
		return false
	}
	decoder := xml.NewDecoder(bytes.NewReader(body))
	started, closed := false, false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return started && closed
		}
		if err != nil {
			return false
		}
		switch value := token.(type) {
		case xml.StartElement:
			if started || value.Name.Local != "VersioningConfiguration" || (value.Name.Space != "" && value.Name.Space != canvasS3Namespace) {
				return false
			}
			seenAttributes := make(map[xml.Name]bool, len(value.Attr))
			for _, attribute := range value.Attr {
				if seenAttributes[attribute.Name] {
					return false
				}
				seenAttributes[attribute.Name] = true
				isDefault := attribute.Name.Space == "" && attribute.Name.Local == "xmlns"
				isPrefix := attribute.Name.Space == "xmlns"
				if (!isDefault && !isPrefix) || (isPrefix && (attribute.Name.Local == "xml" || attribute.Name.Local == "xmlns")) || (attribute.Value != canvasS3Namespace && !(isDefault && attribute.Value == "")) {
					return false
				}
			}
			started = true
		case xml.EndElement:
			if !started || closed || value.Name.Local != "VersioningConfiguration" {
				return false
			}
			closed = true
		case xml.CharData:
			if len(bytes.Trim(value, " \t\r\n")) != 0 {
				return false
			}
		case xml.Comment:
		default:
			return false
		}
	}
}

func canvasXMLTrivia(body []byte) ([]byte, bool) {
	for {
		body = bytes.TrimLeft(body, " \t\r\n")
		if !bytes.HasPrefix(body, []byte("<!--")) {
			return body, true
		}
		end := bytes.Index(body[4:], []byte("-->"))
		if end < 0 {
			return nil, false
		}
		comment := body[4 : 4+end]
		if bytes.Contains(comment, []byte("--")) || bytes.HasSuffix(comment, []byte("-")) {
			return nil, false
		}
		body = body[4+end+3:]
	}
}

func canvasEmptyXMLEnvelope(body []byte) bool {
	body, ok := canvasXMLTrivia(body)
	if !ok {
		return false
	}
	opening := canvasXMLOpening.FindSubmatch(body)
	if opening == nil {
		return false
	}
	body, ok = canvasXMLTrivia(body[len(opening[0]):])
	if !ok {
		return false
	}
	if len(opening[2]) == 0 {
		closing := []byte("</" + string(opening[1]))
		if !bytes.HasPrefix(body, closing) {
			return false
		}
		body = bytes.TrimLeft(body[len(closing):], " \t\r\n")
		if len(body) == 0 || body[0] != '>' {
			return false
		}
		body, ok = canvasXMLTrivia(body[1:])
	}
	return ok && len(body) == 0
}

func canvasStorageResponseStatus(metadata middleware.Metadata) int {
	response, ok := awsmiddleware.GetRawResponse(metadata).(*smithyhttp.Response)
	if !ok || response == nil || response.Response == nil {
		return 0
	}
	return response.StatusCode
}

func (storage *canvasS3GCStorage) Verify(ctx context.Context) error {
	location, err := NewCanvasStorageLocation(storage.location.Endpoint, storage.location.Region, storage.location.Bucket)
	if err != nil || location != storage.location || ctx.Err() != nil {
		return errCanvasStorageCapability
	}
	if canvasR2Endpoint.MatchString(location.Endpoint) {
		if storage.r2Client == nil {
			return errCanvasStorageCapability
		}
		// R2 has no object versioning API. The official TLS endpoint plus an
		// authenticated HEAD for this exact bucket proves its supported storage
		// capability; an unsupported/denied response never acts as a fallback.
		receipt, err := storage.r2Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(location.Bucket)}, canvasR2ProbeOptions(location))
		if err != nil || ctx.Err() != nil || receipt == nil || receipt.ResultMetadata.Get(canvasVerifiedR2BucketKey{}) != true || canvasStorageResponseStatus(receipt.ResultMetadata) != http.StatusOK {
			return errCanvasStorageCapability
		}
		return nil
	}
	receipt, err := storage.client.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{
		Bucket: aws.String(location.Bucket),
	}, canvasVersioningProbeOptions)
	if err != nil || receipt == nil || receipt.ResultMetadata.Get(canvasVerifiedVersioningBodyKey{}) != true || canvasStorageResponseStatus(receipt.ResultMetadata) != http.StatusOK || receipt.Status != "" {
		return errCanvasStorageCapability
	}
	return nil
}

func validateCanvasGCAsset(asset canvasGCAsset, expected CanvasStorageLocation) error {
	if asset.ID == "" || asset.OwnerID == "" || asset.Kind != "IMPORT" ||
		(asset.State != "DELETING" && asset.State != "DELETED") ||
		asset.DeleteToken == "" || asset.StorageVersionID != nil {
		return errCanvasGCAssetInvalid
	}
	location, err := NewCanvasStorageLocation(asset.StorageEndpoint, asset.StorageRegion, asset.StorageBucket)
	if err != nil || location != expected || location.ID != asset.StorageLocation {
		return errCanvasStorageCapability
	}
	// Keys come only from the claimed inventory, never a URL or prefix scan.
	// Reject ambiguous paths rather than normalizing them to another object.
	if asset.StorageKey == "" || len(asset.StorageKey) > 512 || strings.ContainsAny(asset.StorageKey, "\\?#%:") {
		return errCanvasGCAssetInvalid
	}
	for _, character := range asset.StorageKey {
		if character < 0x21 || character > 0x7e {
			return errCanvasGCAssetInvalid
		}
	}
	for _, part := range strings.Split(asset.StorageKey, "/") {
		if part == "" || part == "." || part == ".." {
			return errCanvasGCAssetInvalid
		}
	}
	return nil
}

func (storage *canvasS3GCStorage) Delete(ctx context.Context, asset canvasGCAsset) (string, error) {
	if err := validateCanvasGCAsset(asset, storage.location); err != nil {
		return canvasDeleteUnknown, err
	}
	receipt, err := storage.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(storage.location.Bucket),
		Key:    aws.String(asset.StorageKey),
	}, canvasSingleAttempt)
	if err != nil {
		var apiError smithy.APIError
		var responseError *smithyhttp.ResponseError
		if errors.As(err, &apiError) && errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound && apiError.ErrorCode() == "NoSuchKey" {
			return canvasDeleteMissing, nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return canvasDeleteUnknown, err
		}
		return canvasDeleteFailed, err
	}
	if receipt == nil || canvasStorageResponseStatus(receipt.ResultMetadata) != http.StatusNoContent {
		return canvasDeleteUnknown, errCanvasStorageCapability
	}
	if receipt.VersionId != nil || aws.ToBool(receipt.DeleteMarker) {
		return canvasDeleteUnknown, errCanvasStorageCapability
	}
	return canvasDeleteDeleted, nil
}
