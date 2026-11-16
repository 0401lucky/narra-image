package worker

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type imageMaintenanceStorage interface {
	Verify(context.Context) error
	Delete(context.Context, ImageDeleteClaim) (string, error)
}

type imageLocalMaintenanceStorage struct {
	location ImageLocation
	local    *LocalImageStore
}

type imageS3MaintenanceStorage struct {
	location ImageLocation
	probe    *canvasS3GCStorage
}

func (storage *Storage) maintenanceStorage(ctx context.Context, location ImageLocation) (imageMaintenanceStorage, error) {
	if storage == nil || !storage.cfg.ImageStorageManagedEnabled {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if location.Provider == "LOCAL" {
		identity, err := NewImageLocalLocation(location.VolumeID)
		if err != nil || identity != location.ImageLocationInput || location.VolumeID != storage.cfg.ImageStorageVolumeID {
			return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		local, err := NewLocalImageStore(LocalImageStoreConfig{RootDirectory: storage.cfg.ImageStoragePath, VolumeID: location.VolumeID})
		if err != nil {
			return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
		}
		return &imageLocalMaintenanceStorage{location: location, local: local}, nil
	}
	identity, err := NewImageS3Location(location.Endpoint, location.Region, location.Bucket, location.PublicBaseURL)
	if err != nil || location.Provider != "S3" || identity != location.ImageLocationInput ||
		storage.cfg.S3AccessKeyID == "" || storage.cfg.S3SecretAccessKey == "" {
		return nil, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	awsConfig, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(location.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(storage.cfg.S3AccessKeyID, storage.cfg.S3SecretAccessKey, "")),
		config.WithHTTPClient(&http.Client{Timeout: time.Duration(ImageMaintenanceDeleteSeconds) * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}),
	)
	if err != nil {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	client := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(location.Endpoint)
		options.UsePathStyle = true
		options.RetryMaxAttempts = 1
	})
	canvasLocation, err := NewCanvasStorageLocation(location.Endpoint, location.Region, location.Bucket)
	if err != nil {
		return nil, err
	}
	probe := &canvasS3GCStorage{client: client, location: canvasLocation}
	if canvasR2Endpoint.MatchString(canvasLocation.Endpoint) {
		probe.r2Client, err = newCanvasR2ProbeClient(client, canvasLocation)
		if err != nil {
			return nil, err
		}
	}
	return &imageS3MaintenanceStorage{location: location, probe: probe}, nil
}

func validateImageDeleteClaim(claim ImageDeleteClaim, location ImageLocation) error {
	object := claim.Object
	if !imageUUIDPattern.MatchString(claim.JobID) || !imageUUIDPattern.MatchString(claim.ItemID) ||
		!imageUUIDPattern.MatchString(claim.DeleteToken) || object.DeleteToken == nil || *object.DeleteToken != claim.DeleteToken ||
		object.State != "DELETING" || !ImageObjectVerified(object) || !object.Accounted || object.NeedsReconciliation ||
		object.VersionID != nil || object.LocationID != location.ID || object.PhysicalNamespace == "" ||
		object.PhysicalNamespace != location.PhysicalNamespace || claim.Location != location {
		return ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	if _, _, err := validateLocalImageObject(LocalImageObject{Key: object.Key, ByteLength: object.ByteLength, SHA256: object.SHA256}); err != nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT", Cause: err}
	}
	return nil
}

func (storage *imageLocalMaintenanceStorage) Verify(ctx context.Context) error {
	_, err := storage.local.ProbeWritable(ctx)
	return err
}

func (storage *imageLocalMaintenanceStorage) Delete(ctx context.Context, claim ImageDeleteClaim) (string, error) {
	if err := validateImageDeleteClaim(claim, storage.location); err != nil {
		return canvasDeleteUnknown, err
	}
	result, err := storage.local.Delete(ctx, LocalImageObject{Key: claim.Object.Key, ByteLength: claim.Object.ByteLength, SHA256: claim.Object.SHA256})
	if err != nil {
		if ctx.Err() != nil {
			return canvasDeleteUnknown, err
		}
		return canvasDeleteFailed, err
	}
	switch result {
	case LocalImageDeleted:
		return canvasDeleteDeleted, nil
	case LocalImageMissing:
		return canvasDeleteMissing, nil
	default:
		return canvasDeleteUnknown, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
}

func (storage *imageS3MaintenanceStorage) Verify(ctx context.Context) error {
	return storage.probe.Verify(ctx)
}

func (storage *imageS3MaintenanceStorage) Delete(ctx context.Context, claim ImageDeleteClaim) (string, error) {
	if err := validateImageDeleteClaim(claim, storage.location); err != nil {
		return canvasDeleteUnknown, err
	}
	// Recheck immediately before each delete as well as before SQL claims. A
	// capability change invalidates the rest of this pass; no missing proof is
	// synthesized from an unsupported/denied versioning request.
	if err := storage.Verify(ctx); err != nil {
		return canvasDeleteUnknown, err
	}
	return deleteUnversionedS3Object(ctx, storage.probe.client, storage.location.Bucket, claim.Object.Key)
}

func imageMaintenanceErrorCode(err error) string {
	var known ImageStorageError
	if errors.As(err, &known) {
		return known.Code
	}
	if errors.Is(err, errCanvasStorageCapability) {
		return "IMAGE_STORAGE_UNAVAILABLE"
	}
	return "IMAGE_STORAGE_UNAVAILABLE"
}
