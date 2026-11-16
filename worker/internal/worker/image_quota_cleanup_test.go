package worker

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeImageQuotaQueue struct {
	requested []ImageQuotaCleanupInput
	job       *ImageMaintenanceJob
}

func (queue *fakeImageQuotaQueue) RequestQuotaCleanup(_ context.Context, input ImageQuotaCleanupInput) (*ImageMaintenanceJob, error) {
	queue.requested = append(queue.requested, input)
	return queue.job, nil
}
func (queue *fakeImageQuotaQueue) GetMaintenanceJob(context.Context, ImageMaintenanceJobInput) (*ImageMaintenanceJob, error) {
	return queue.job, nil
}

func TestImageQuotaRechecksAdmissionAfterDurableCleanup(t *testing.T) {
	for _, reclaimed := range []bool{true, false} {
		queue := &fakeImageQuotaQueue{job: &ImageMaintenanceJob{ID: "00112233-4455-4677-8899-aabbccddeeff", State: "SUCCEEDED"}}
		calls := 0
		result, err := reserveImageWithCleanup(context.Background(), queue, "owner", "output:stable", ImageMaxBytes, func(context.Context) (ImageReservation, error) {
			calls++
			if calls == 1 || !reclaimed {
				return ImageReservation{}, ImageStorageError{Code: "IMAGE_QUOTA_EXCEEDED"}
			}
			return ImageReservation{ID: "reservation"}, nil
		})
		if calls != 2 || (err == nil) != reclaimed || (reclaimed && result.ID != "reservation") {
			t.Fatalf("did not recheck actual capacity: %d %+v %v", calls, result, err)
		}
		if len(queue.requested) != 1 || queue.requested[0].IntentKey != "output:stable" || queue.requested[0].NeededBytes != ImageMaxBytes || !imageUUIDPattern.MatchString(queue.requested[0].RequestID) {
			t.Fatalf("lost stable admission identity: %+v", queue.requested)
		}
	}
}

func TestImageQuotaWaitIsBoundedAndCannotReachProviderAfterTimeout(t *testing.T) {
	queue := &fakeImageQuotaQueue{job: &ImageMaintenanceJob{ID: "00112233-4455-4677-8899-aabbccddeeff", State: "WAITING"}}
	calls := 0
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, err := reserveImageWithCleanup(ctx, queue, "owner", "output:pending", ImageMaxBytes, func(context.Context) (ImageReservation, error) {
		calls++
		return ImageReservation{}, ImageStorageError{Code: "IMAGE_QUOTA_EXCEEDED"}
	})
	var storageError ImageStorageError
	if !errors.As(err, &storageError) || storageError.Code != "IMAGE_QUOTA_EXCEEDED" || calls != 1 {
		t.Fatalf("timeout granted another reservation: %d %v", calls, err)
	}
}

func TestImageQuotaDoesNotScheduleDeletionForAnotherFailure(t *testing.T) {
	queue := &fakeImageQuotaQueue{}
	_, err := reserveImageWithCleanup(context.Background(), queue, "owner", "output:error", ImageMaxBytes, func(context.Context) (ImageReservation, error) {
		return ImageReservation{}, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	})
	if err == nil || len(queue.requested) != 0 {
		t.Fatal("non-quota failure scheduled destructive cleanup")
	}
}
