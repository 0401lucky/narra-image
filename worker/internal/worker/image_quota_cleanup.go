package worker

import (
	"context"
	"errors"
	"time"
)

type imageQuotaCleanupRepository interface {
	RequestQuotaCleanup(context.Context, ImageQuotaCleanupInput) (*ImageMaintenanceJob, error)
	GetMaintenanceJob(context.Context, ImageMaintenanceJobInput) (*ImageMaintenanceJob, error)
}

// Call only outside business transactions. The SQL reservation remains the
// authority on capacity; a maintenance result never grants a write by itself.
func reserveImageWithCleanup(ctx context.Context, repository imageQuotaCleanupRepository, ownerID, intentKey string, neededBytes int64,
	reserve func(context.Context) (ImageReservation, error)) (ImageReservation, error) {
	reservation, err := reserve(ctx)
	var quotaError ImageStorageError
	if err == nil || !errors.As(err, &quotaError) || quotaError.Code != "IMAGE_QUOTA_EXCEEDED" {
		return reservation, err
	}
	requestID, err := newImageMaintenanceToken()
	if err != nil {
		return ImageReservation{}, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageQuotaWaitMilliseconds)*time.Millisecond)
	defer cancel()
	job, err := repository.RequestQuotaCleanup(waitCtx, ImageQuotaCleanupInput{RequestID: requestID, OwnerID: ownerID, IntentKey: intentKey, NeededBytes: neededBytes})
	if err != nil {
		if waitCtx.Err() != nil {
			return ImageReservation{}, quotaError
		}
		return ImageReservation{}, err
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for job != nil && (job.State == "QUEUED" || job.State == "RUNNING" || job.State == "WAITING") {
		select {
		case <-waitCtx.Done():
			return ImageReservation{}, quotaError
		case <-ticker.C:
		}
		job, err = repository.GetMaintenanceJob(waitCtx, ImageMaintenanceJobInput{JobID: job.ID})
		if err != nil {
			if waitCtx.Err() != nil {
				return ImageReservation{}, quotaError
			}
			return ImageReservation{}, err
		}
	}
	if waitCtx.Err() != nil {
		return ImageReservation{}, quotaError
	}
	return reserve(ctx)
}
