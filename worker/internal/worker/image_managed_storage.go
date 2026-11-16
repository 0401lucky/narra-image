package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type imageOutputReservationContextKey struct{}
type imageOutputObjectContextKey struct{}
type imageHistoricalGenerationKey struct{}
type imageOutputObjectContext struct {
	Reservation ImageReservation
	Slot        int
	OriginID    string
}

type ImageReadyCapability struct {
	Version          int    `json:"version"`
	Schema           string `json:"schema"`
	Provider         string `json:"provider"`
	LocationID       string `json:"locationId"`
	StorageRevision  int    `json:"storageRevision"`
	ReaderRevision   int    `json:"readerRevision"`
	ExecutorRevision int    `json:"executorRevision"`
	Maintenance      string `json:"maintenance"`
}

func withImageOutputReservation(ctx context.Context, reservation ImageReservation) context.Context {
	return context.WithValue(ctx, imageOutputReservationContextKey{}, reservation)
}

func imageOutputContext(ctx context.Context, slot int, originID string) context.Context {
	reservation, ok := ctx.Value(imageOutputReservationContextKey{}).(ImageReservation)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, imageOutputObjectContextKey{}, imageOutputObjectContext{Reservation: reservation, Slot: slot, OriginID: originID})
}

func imageAdmissionFailure(err error) ContractFailure {
	var storageErr ImageStorageError
	if errors.As(err, &storageErr) && storageErr.Code == "IMAGE_QUOTA_EXCEEDED" {
		return ContractFailure{Code: errorImageQuotaExceeded, Message: "图片存储空间不足，请清理后重试"}
	}
	return ContractFailure{Code: errorImageStorageUnavailable, Message: "图片存储暂不可用，请稍后重试"}
}

func managedImageMime(data []byte) (string, error) {
	if len(data) == 0 || int64(len(data)) > ImageMaxBytes {
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	switch {
	case len(data) >= 24 && bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) && string(data[12:16]) == "IHDR":
		return "image/png", nil
	case len(data) >= 4 && data[0] == 255 && data[1] == 216 && data[2] == 255:
		return "image/jpeg", nil
	case len(data) >= 16 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp", nil
	case len(data) >= 10 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif", nil
	case len(data) >= 16 && string(data[4:8]) == "ftyp" && (string(data[8:12]) == "avif" || string(data[8:12]) == "avis"):
		return "image/avif", nil
	default:
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
}

func (storage *Storage) imageLocation() (ImageLocationInput, error) {
	if storage.cfg.ImageStorageBackend == "local" {
		return NewImageLocalLocation(storage.cfg.ImageStorageVolumeID)
	}
	if !storage.hasObjectStorage() {
		return ImageLocationInput{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	return NewImageS3Location(storage.cfg.S3Endpoint, storage.cfg.S3Region, storage.cfg.S3Bucket, storage.cfg.S3PublicBaseURL)
}

func (storage *Storage) initializeManagedImages(ctx context.Context) error {
	if err := ValidateImageStorageConfig(storage.cfg); err != nil {
		return err
	}
	if !storage.cfg.ImageStorageManagedEnabled {
		return nil
	}
	if err := validateManagedImagePublicURL(storage.cfg); err != nil {
		return err
	}
	if err := LoadImageContract(); err != nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	if err := LoadImageMaintenanceContract(); err != nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	if storage.cfg.ImageStorageBackend == "local" {
		local, err := NewLocalImageStore(LocalImageStoreConfig{RootDirectory: storage.cfg.ImageStoragePath, VolumeID: storage.cfg.ImageStorageVolumeID})
		if err != nil {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
		}
		if _, err := local.ProbeWritable(ctx); err != nil {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
		}
		storage.localImages = local
	}
	return nil
}

func (storage *Storage) verifyManagedImages(ctx context.Context) error {
	if !storage.cfg.ImageStorageManagedEnabled {
		return nil
	}
	if storage.imageRepository == nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if err := storage.imageRepository.VerifySchema(ctx); err != nil {
		return err
	}
	location, err := storage.imageLocation()
	if err != nil {
		return err
	}
	if location.Provider == "LOCAL" {
		if storage.localImages == nil {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		_, err = storage.localImages.ProbeWritable(ctx)
	} else {
		client, ok := storage.client.(canvasR2HeadClient)
		if !ok {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		_, err = client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(location.Bucket)}, canvasSingleAttempt)
	}
	return err
}

func (storage *Storage) acquireImageOutputReservation(ctx context.Context, job GenerationJob) (ImageReservation, error) {
	if storage.imageRepository == nil {
		return ImageReservation{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if storage.cfg.JobTimeout > 3480*time.Second || storage.cfg.JobTimeout <= 0 {
		return ImageReservation{}, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if storage.cfg.ImageStorageBackend == "local" {
		if storage.localImages == nil {
			return ImageReservation{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		if _, err := storage.localImages.ProbeWritable(ctx); err != nil {
			return ImageReservation{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
		}
	}
	leaseSeconds := int(storage.cfg.JobTimeout/time.Second) + 120
	if leaseSeconds < ImageDefaultLeaseSeconds {
		leaseSeconds = ImageDefaultLeaseSeconds
	}
	budget, err := ImageOutputBudget(job.Count)
	if err != nil {
		return ImageReservation{}, err
	}
	return reserveImageWithCleanup(ctx, storage.imageRepository, job.UserID, "output:"+job.ID, budget,
		func(reserveCtx context.Context) (ImageReservation, error) {
			return storage.imageRepository.AcquireForJob(reserveCtx, ImageAcquireForJobInput{JobID: job.ID, WorkerID: storage.cfg.WorkerID, LeaseSeconds: leaseSeconds})
		})
}

func (storage *Storage) closeFinishedImageReservation(ctx context.Context, jobID string) error {
	if storage == nil || !storage.cfg.ImageStorageManagedEnabled || storage.imageRepository == nil {
		return nil
	}
	reservation, err := storage.imageRepository.GetReservationByJob(ctx, jobID)
	if err != nil || reservation == nil {
		return err
	}
	_, err = storage.imageRepository.CloseReservation(ctx, ImageCloseReservationInput{ReservationID: reservation.ID, Token: reservation.Token})
	return err
}

func (storage *Storage) persistManagedImage(ctx context.Context, ownerID string, data []byte) (PersistedMedia, error) {
	if storage.imageRepository == nil {
		return PersistedMedia{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	mimeType, err := managedImageMime(data)
	if err != nil {
		return PersistedMedia{}, err
	}
	locationInput, err := storage.imageLocation()
	if err != nil {
		return PersistedMedia{}, err
	}
	location, err := storage.imageRepository.RegisterLocation(ctx, locationInput)
	if err != nil {
		return PersistedMedia{}, err
	}
	write, output := ctx.Value(imageOutputObjectContextKey{}).(imageOutputObjectContext)
	historicalID, historical := ctx.Value(imageHistoricalGenerationKey{}).(string)
	if !output {
		intentKey := "input:" + randomHex(24)
		if historical {
			intentKey = "backfill-image:" + historicalID
			write.OriginID = historicalID
		}
		write.Reservation, err = reserveImageWithCleanup(ctx, storage.imageRepository, ownerID, intentKey, int64(len(data)),
			func(reserveCtx context.Context) (ImageReservation, error) {
				return storage.imageRepository.ReserveInput(reserveCtx, ImageReserveInput{OwnerID: ownerID, IntentKey: intentKey, ByteLength: int64(len(data))})
			})
		if err != nil {
			return PersistedMedia{}, err
		}
		defer func() {
			finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_, _ = storage.imageRepository.CloseReservation(finishCtx, ImageCloseReservationInput{ReservationID: write.Reservation.ID, Token: write.Reservation.Token})
		}()
	}
	purpose := "REFERENCE"
	if output || historical {
		purpose = "GENERATED"
	}
	digest := sha256.Sum256(data)
	key := fmt.Sprintf("images/%s.%s", randomHex(24), extensionFromMime(mimeType))
	if historical {
		identity := sha256.Sum256([]byte(historicalID))
		key = fmt.Sprintf("images/backfill-%x.%s", identity, extensionFromMime(mimeType))
	}
	ticket, err := storage.imageRepository.BeginObject(ctx, ImageBeginObjectInput{
		ReservationID: write.Reservation.ID, Token: write.Reservation.Token, Slot: write.Slot,
		LocationID: location.ID, Key: key, ByteLength: int64(len(data)), MimeType: mimeType,
		SHA256: hex.EncodeToString(digest[:]), Purpose: purpose, OriginID: write.OriginID,
	})
	if err != nil {
		return PersistedMedia{}, err
	}
	attempted := false
	if ticket.WriteGranted {
		defer func() {
			if attempted {
				return
			}
			finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_, _ = storage.imageRepository.FinishObject(finishCtx, ImageFinishObjectInput{ObjectID: ticket.Object.ID, WriteToken: ticket.Object.WriteToken, Outcome: "NOT_WRITTEN", ErrorCode: "IMAGE_STORAGE_UNAVAILABLE"})
		}()
	}
	publicURL, err := ImagePublicURL(storage.cfg.AppURL, ticket.Asset.PublicToken)
	if err != nil {
		return PersistedMedia{}, err
	}
	if err := storage.imageRepository.RegisterAlias(ctx, ticket.Asset.ID, publicURL); err != nil {
		return PersistedMedia{}, err
	}
	result := PersistedMedia{URL: publicURL, MediaStorage: MediaStorage(location.Provider), StorageKey: ticket.Object.Key, MediaAssetID: ticket.Asset.ID}
	if !ticket.WriteGranted {
		if ticket.Asset.State == "AVAILABLE" && ticket.Object.State == "READY" {
			return result, nil
		}
		return PersistedMedia{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	var versionID string
	attempted = true
	if location.Provider == "LOCAL" {
		if storage.localImages == nil {
			err = ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		} else {
			_, err = storage.localImages.Put(ctx, LocalImagePutInput{LocalImageObject: LocalImageObject{
				Key: ticket.Object.Key, ByteLength: ticket.Object.ByteLength, SHA256: ticket.Object.SHA256,
			}, Bytes: data})
		}
	} else {
		putCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		var receipt *s3.PutObjectOutput
		receipt, err = storage.client.PutObject(putCtx, &s3.PutObjectInput{
			Bucket: aws.String(location.Bucket), Key: aws.String(ticket.Object.Key), Body: bytes.NewReader(data),
			ContentLength: aws.Int64(int64(len(data))), ContentType: aws.String(mimeType),
			ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(digest[:])), IfNoneMatch: aws.String("*"),
		}, canvasSingleAttempt)
		cancel()
		if receipt != nil {
			versionID = aws.ToString(receipt.VersionId)
		}
	}
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	outcome := "CONFIRMED"
	if err != nil {
		outcome = "UNKNOWN"
	}
	receipt, finishErr := storage.imageRepository.FinishObject(finishCtx, ImageFinishObjectInput{
		ObjectID: ticket.Object.ID, WriteToken: ticket.Object.WriteToken, Outcome: outcome, VersionID: versionID,
	})
	if err != nil {
		return PersistedMedia{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	if finishErr != nil {
		return PersistedMedia{}, finishErr
	}
	if !receipt.Accepted || receipt.Asset.State != "AVAILABLE" || receipt.Object.State != "READY" {
		return PersistedMedia{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	return result, nil
}

// managedImagePublicToken recognizes only the literal canonical token path on
// this application's current origin. URL origin comparison normalizes host
// casing/default ports; the caller keeps the original accepted URL as its
// alias and immutable business input. It never recognizes another origin by
// its token alone or strips a query/fragment to manufacture an owned URL.
func managedImagePublicToken(rawURL, appURL string) string {
	if len(rawURL) > 2048 || (!strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://")) || strings.ContainsAny(rawURL, "?#\\\r\n\t") {
		return ""
	}
	marker := strings.LastIndex(rawURL, "/media/images/")
	if marker < 0 {
		return ""
	}
	token := rawURL[marker+len("/media/images/"):]
	canonical, err := ImagePublicURL(appURL, token)
	if err != nil {
		return ""
	}
	source, err := url.Parse(rawURL)
	if err != nil || source.User != nil || source.Hostname() == "" || source.Opaque != "" {
		return ""
	}
	expected, err := url.Parse(canonical)
	if err != nil || source.Scheme != expected.Scheme || source.EscapedPath() != expected.EscapedPath() {
		return ""
	}
	pathAt := strings.Index(rawURL[len(source.Scheme)+3:], "/")
	if pathAt < 0 || rawURL[len(source.Scheme)+3+pathAt:] != source.EscapedPath() {
		return ""
	}
	for _, segment := range strings.Split(source.EscapedPath(), "/") {
		decoded, err := url.PathUnescape(segment)
		if err != nil || decoded == "." || decoded == ".." {
			return ""
		}
	}
	sourceHost, expectedHost := source.Hostname(), expected.Hostname()
	if strings.ContainsAny(sourceHost+expectedHost, "%") {
		return ""
	}
	if !strings.EqualFold(sourceHost, expectedHost) {
		sourceIP, sourceIPErr := netip.ParseAddr(sourceHost)
		expectedIP, expectedIPErr := netip.ParseAddr(expectedHost)
		if sourceIPErr != nil || expectedIPErr != nil || sourceIP != expectedIP {
			return ""
		}
	}
	sourcePort, sourcePortOK := managedImageURLPort(source)
	expectedPort, expectedPortOK := managedImageURLPort(expected)
	if !sourcePortOK || !expectedPortOK || sourcePort != expectedPort {
		return ""
	}
	return token
}

func managedImageURLPort(parsed *url.URL) (uint64, bool) {
	if parsed.Port() == "" {
		if parsed.Scheme == "https" {
			return 443, true
		}
		return 80, parsed.Scheme == "http"
	}
	port, err := strconv.ParseUint(parsed.Port(), 10, 16)
	return port, err == nil
}

func (storage *Storage) resolveManagedImage(ctx context.Context, rawURL string) (*ManagedImage, error) {
	if storage == nil {
		return nil, nil
	}
	if storage.imageRepository == nil {
		if !storage.cfg.ImageStorageManagedEnabled {
			return nil, nil
		}
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if token := managedImagePublicToken(rawURL, storage.cfg.AppURL); token != "" {
		managed, err := storage.imageRepository.GetByToken(ctx, token)
		if err != nil {
			return nil, err
		}
		if managed == nil {
			return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
		}
		return managed, nil
	}
	// Ordinary public links may belong to another user. Business authorization
	// happens at the caller; the exact registered alias is the file identity.
	// Disabling new managed writes does not change already-adopted read paths.
	return storage.imageRepository.ResolveURL(ctx, rawURL, "")
}

func (storage *Storage) readManagedImage(ctx context.Context, image ManagedImage) ([]byte, error) {
	if storage.imageRepository == nil {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	lease, err := storage.imageRepository.BeginRead(ctx, ImageReadInput{AssetID: image.Asset.ID})
	if err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	deadline := time.Now().Add(time.Duration(ImageReadTimeoutMilliseconds) * time.Millisecond)
	if expiry := lease.ReadExpiresAt.Add(-5 * time.Second); expiry.Before(deadline) {
		deadline = expiry
	}
	readCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	if readCtx.Err() != nil {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	ctx, image = readCtx, lease.Image
	object, location := image.Object, image.Location
	if image.Asset.State != "AVAILABLE" || object == nil || location == nil || object.State != "READY" || object.ByteLength < 1 || object.ByteLength > ImageMaxBytes {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	if location.Provider == "LOCAL" {
		identity, identityErr := NewImageLocalLocation(location.VolumeID)
		if identityErr != nil || identity.ID != location.ID || location.VolumeID != storage.cfg.ImageStorageVolumeID {
			return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		local := storage.localImages
		if local == nil {
			// The current write backend can be S3 while older replicas are LOCAL.
			// Reads use the registered volume, without requiring a writable local
			// destination or making S3-only startup depend on a local mount.
			var err error
			local, err = NewLocalImageStore(LocalImageStoreConfig{RootDirectory: storage.cfg.ImageStoragePath, VolumeID: location.VolumeID})
			if err != nil {
				return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE", Cause: err}
			}
		}
		data, err := local.Read(ctx, LocalImageObject{Key: object.Key, ByteLength: object.ByteLength, SHA256: object.SHA256})
		if err != nil {
			return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE", Cause: err}
		}
		return data, nil
	}
	if location.Provider != "S3" || location.Endpoint == "" || location.Region == "" || location.Bucket == "" || storage.cfg.S3AccessKeyID == "" || storage.cfg.S3SecretAccessKey == "" {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	awsConfig, err := config.LoadDefaultConfig(ctx, config.WithRegion(location.Region), config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(storage.cfg.S3AccessKeyID, storage.cfg.S3SecretAccessKey, "")))
	if err != nil {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	client := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(location.Endpoint)
		options.UsePathStyle = true
		options.RetryMaxAttempts = 1
	})
	result, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(location.Bucket), Key: aws.String(object.Key), VersionId: object.VersionID})
	if err != nil {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE", Cause: err}
	}
	if result == nil || result.Body == nil {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	defer result.Body.Close()
	stopAbort := context.AfterFunc(ctx, func() { _ = result.Body.Close() })
	defer stopAbort()
	if result.ContentLength != nil && *result.ContentLength != object.ByteLength {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	data, err := io.ReadAll(io.LimitReader(result.Body, object.ByteLength+1))
	if err != nil {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE", Cause: err}
	}
	digest := sha256.Sum256(data)
	if int64(len(data)) != object.ByteLength || hex.EncodeToString(digest[:]) != object.SHA256 {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	return data, nil
}

func (storage *Storage) loadImageSources(ctx context.Context, urls []string) ([]SourceImage, error) {
	if storage == nil || (storage.imageRepository == nil && !storage.cfg.ImageStorageManagedEnabled) {
		return loadSourceImages(ctx, urls)
	}
	images := make([]SourceImage, 0, len(urls))
	totalBytes := 0
	for index, rawURL := range urls {
		managed, err := storage.resolveManagedImage(ctx, rawURL)
		if err != nil {
			return nil, ContractFailure{Code: errorSourceImageInvalid, Message: "参考图暂不可用"}
		}
		var image SourceImage
		if managed == nil {
			image, err = loadSourceImage(ctx, rawURL, index)
		} else {
			if managed.Asset.ByteLength > int64(sourceImagesTotalMaxBytes-totalBytes) {
				return nil, ContractFailure{Code: errorSourceImageInvalid, Message: "参考图总大小超过 32MB"}
			}
			var data []byte
			data, err = storage.readManagedImage(ctx, *managed)
			image = SourceImage{Data: data, FileName: fmt.Sprintf("source-%d.%s", index+1, extensionFromMime(managed.Asset.MimeType)), MimeType: managed.Asset.MimeType}
		}
		if err != nil {
			return nil, ContractFailure{Code: errorSourceImageInvalid, Message: "参考图无效或无法读取"}
		}
		images, totalBytes, err = appendSourceImage(images, totalBytes, image)
		if err != nil {
			return nil, err
		}
	}
	return images, nil
}

func isImageGeneration(job GenerationJob) bool {
	return strings.EqualFold(job.GenerationType, "TEXT_TO_IMAGE") || strings.EqualFold(job.GenerationType, "IMAGE_TO_IMAGE")
}
