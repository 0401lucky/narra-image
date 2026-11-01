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

type canvasS3GCStorage struct {
	client   canvasObjectStorageClient
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
	return &canvasS3GCStorage{client: client, location: location}, nil
}

func (storage *canvasS3GCStorage) Location() CanvasStorageLocation { return storage.location }

func canvasSingleAttempt(options *s3.Options) { options.RetryMaxAttempts = 1 }

type canvasVerifiedVersioningBodyKey struct{}

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
	if err != nil || location != storage.location {
		return errCanvasStorageCapability
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
