package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"time"
)

const (
	ImageStorageRevision             = 3
	ImageReaderRevision              = 3
	ImageMaintenanceRevision         = 3
	ImageMaintenanceLeaseSeconds     = 90
	ImageReadLeaseSeconds            = 45
	ImageReadTimeoutMilliseconds     = 30000
	ImageMaintenanceDeleteSeconds    = 30
	ImageMaintenancePassSeconds      = 45
	ImageMaintenancePollMilliseconds = 1000
	ImageQuotaWaitMilliseconds       = 10000
)

// Startup verifies the compile-time bounds against the shipped shared artifact.
func LoadImageMaintenanceContract() error {
	data, err := readImageContractArtifact("maintenance.json", 16*1024)
	if err != nil {
		return err
	}
	if err := validateImageMaintenanceContract(data); err != nil {
		return err
	}
	return LoadImageHistoryContract()
}

func validateImageMaintenanceContract(data []byte) error {
	var actual map[string]any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if decoder.Decode(&actual) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid image maintenance contract")
	}
	expected := map[string]any{
		"contract": "narra.image.maintenance", "version": json.Number("1"), "storageRevision": json.Number("3"), "readerRevision": json.Number("3"), "executorRevision": json.Number("3"),
		"limits": map[string]any{"previewAssets": json.Number("1000"), "previewSeconds": json.Number("600"), "jobItems": json.Number("100"), "leaseSeconds": json.Number("90"), "readLeaseSeconds": json.Number("45"), "readTimeoutMilliseconds": json.Number("30000"), "deleteSeconds": json.Number("30"), "passSeconds": json.Number("45"), "pollMilliseconds": json.Number("1000"), "quotaWaitMilliseconds": json.Number("10000")},
	}
	if !reflect.DeepEqual(actual, expected) {
		return errors.New("unsupported image maintenance contract")
	}
	return nil
}

type ImageMaintenanceItem struct {
	ID            string  `json:"id"`
	AssetID       string  `json:"assetId"`
	State         string  `json:"state"`
	ByteLength    int64   `json:"byteLength,string"`
	ReleasedBytes int64   `json:"releasedBytes,string"`
	Reason        *string `json:"reason"`
}
type ImageMaintenanceJob struct {
	ID             string                 `json:"id"`
	Mode           string                 `json:"mode"`
	State          string                 `json:"state"`
	PolicyVersion  int                    `json:"policyVersion"`
	CreatedAt      string                 `json:"createdAt"`
	ConfirmedAt    *string                `json:"confirmedAt"`
	ExpiresAt      *string                `json:"expiresAt"`
	CompletedAt    *string                `json:"completedAt"`
	NextAttemptAt  *string                `json:"nextAttemptAt"`
	EstimatedBytes int64                  `json:"estimatedBytes,string"`
	ReleasedBytes  int64                  `json:"releasedBytes,string"`
	TotalItems     int                    `json:"totalItems"`
	CompletedItems int                    `json:"completedItems"`
	SkippedItems   int                    `json:"skippedItems"`
	FailedItems    int                    `json:"failedItems"`
	PendingItems   int                    `json:"pendingItems"`
	Truncated      bool                   `json:"truncated"`
	Items          []ImageMaintenanceItem `json:"items"`
	NextCursor     *string                `json:"nextCursor"`
}
type ImageStorageOverview struct {
	ImageUsage
	CleanableBytes       int64 `json:"cleanableBytes,string"`
	CleanableAssetCount  int64 `json:"cleanableAssetCount,string"`
	CleanableObjectCount int64 `json:"cleanableObjectCount,string"`
	ProtectedBytes       int64 `json:"protectedBytes,string"`
	UnmanagedImageCount  int64 `json:"unmanagedImageCount,string"`
	Locations            []struct {
		ID          string `json:"id"`
		Provider    string `json:"provider"`
		ObjectCount int64  `json:"objectCount,string"`
		UsedBytes   int64  `json:"usedBytes,string"`
	} `json:"locations"`
	RecentJobs []ImageMaintenanceJob `json:"recentJobs"`
}
type ImageCleanupPreview struct {
	PreviewID      string `json:"previewId"`
	PolicyVersion  int    `json:"policyVersion"`
	ExpiresAt      string `json:"expiresAt"`
	AssetCount     int    `json:"assetCount"`
	ObjectCount    int    `json:"objectCount"`
	EstimatedBytes int64  `json:"estimatedBytes,string"`
	Truncated      bool   `json:"truncated"`
}
type ImageDeleteClaim struct {
	JobID           string            `json:"jobId"`
	ItemID          string            `json:"itemId"`
	Mode            string            `json:"mode"`
	Object          ImageObjectRecord `json:"object"`
	Location        ImageLocation     `json:"location"`
	DeleteToken     string            `json:"deleteToken"`
	DeleteExpiresAt time.Time         `json:"deleteExpiresAt"`
}
type ImageDeleteReceipt struct {
	Accepted      bool                `json:"accepted"`
	Replayed      bool                `json:"replayed"`
	ReleasedBytes int64               `json:"releasedBytes,string"`
	Job           ImageMaintenanceJob `json:"job"`
}
type ImageReadLease struct {
	Image         ManagedImage `json:"image"`
	ReadExpiresAt time.Time    `json:"readExpiresAt"`
}
type ImageReservationCleanupResult struct {
	Closed        int   `json:"closed"`
	ReleasedBytes int64 `json:"releasedBytes,string"`
}
type ImageReplicaProofResult struct {
	ID string `json:"id"`
}
type ImageMaintenanceLeaseInput struct {
	WorkerID string `json:"workerId"`
	Token    string `json:"token"`
}
type ImageClaimMaintenanceInput struct {
	ExecutorToken       string   `json:"executorToken"`
	VerifiedLocationIDs []string `json:"verifiedLocationIds"`
}
type ImageFinishMaintenanceInput struct {
	JobID       string `json:"jobId"`
	ItemID      string `json:"itemId"`
	ObjectID    string `json:"objectId"`
	DeleteToken string `json:"deleteToken"`
	Outcome     string `json:"outcome"`
	ErrorCode   string `json:"errorCode,omitempty"`
}
type ImageReadInput struct {
	AssetID     string `json:"assetId,omitempty"`
	PublicToken string `json:"publicToken,omitempty"`
	URL         string `json:"url,omitempty"`
	OwnerID     string `json:"ownerId,omitempty"`
}
type ImagePrepareCopyInput struct {
	AssetID      string `json:"assetId"`
	OwnerID      string `json:"ownerId"`
	IntentKey    string `json:"intentKey"`
	ByteLength   int64  `json:"byteLength,string"`
	LeaseSeconds int    `json:"leaseSeconds,omitempty"`
}
type ImageQuotaCleanupInput struct {
	RequestID   string `json:"requestId"`
	OwnerID     string `json:"ownerId"`
	IntentKey   string `json:"intentKey"`
	NeededBytes int64  `json:"neededBytes,string"`
}
type ImageMaintenanceJobInput struct {
	JobID  string `json:"jobId"`
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}
type ImageReplicaVerificationInput struct {
	AssetID                string   `json:"assetId"`
	SourceObjectID         string   `json:"sourceObjectId"`
	TargetObjectID         string   `json:"targetObjectId"`
	ByteLength             int64    `json:"byteLength,string"`
	SHA256                 string   `json:"sha256"`
	AliasURLs              []string `json:"aliasUrls"`
	ReaderProtocolRevision int      `json:"readerProtocolRevision"`
}
type ImageSourceRetirementInput struct {
	RequestID      string `json:"requestId"`
	AssetID        string `json:"assetId"`
	SourceObjectID string `json:"sourceObjectId"`
	TargetObjectID string `json:"targetObjectId"`
	VerificationID string `json:"verificationId"`
}

type ImageUpdatePolicyInput struct {
	ExpectedVersion     int   `json:"expectedVersion"`
	LimitBytes          int64 `json:"limitBytes,string"`
	Enabled             bool  `json:"enabled"`
	QuotaCleanupEnabled bool  `json:"quotaCleanupEnabled"`
	ScheduleEnabled     bool  `json:"scheduleEnabled"`
	RetentionDays       int   `json:"retentionDays"`
	IntervalSeconds     int   `json:"intervalSeconds"`
}
type ImagePreviewCleanupInput struct {
	ActorID               string `json:"actorId"`
	PreviewRequestID      string `json:"previewRequestId"`
	ExpectedPolicyVersion int    `json:"expectedPolicyVersion"`
	Mode                  string `json:"mode"`
	RetentionDays         int    `json:"retentionDays,omitempty"`
}
type ImageConfirmCleanupInput struct {
	ActorID               string `json:"actorId"`
	PreviewID             string `json:"previewId"`
	RequestID             string `json:"requestId"`
	ExpectedPolicyVersion int    `json:"expectedPolicyVersion"`
}
type ImageCancelMaintenanceInput struct {
	ActorID   string `json:"actorId"`
	JobID     string `json:"jobId"`
	RequestID string `json:"requestId"`
}

var imageMaintenanceActions = map[string]bool{
	"image_acquire_maintenance_lease": true, "image_release_maintenance_lease": true, "image_claim_maintenance": true, "image_finish_maintenance_object": true,
	"image_get_maintenance_job": true, "image_request_quota_cleanup": true, "image_close_expired_reservations": true, "image_begin_read": true,
	"image_prepare_copy": true, "image_record_replica_verification": true, "image_request_source_retirement": true,
	"image_update_storage_policy": true, "image_preview_cleanup": true, "image_confirm_cleanup": true, "image_cancel_maintenance": true,
}

func (repository *ImageRepository) maintenanceAction(ctx context.Context, name string, input any, target any, nullable bool) error {
	if !imageMaintenanceActions[name] {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT", Cause: err}
	}
	return repository.query(ctx, "SELECT "+name+"($1::jsonb)", target, nullable, string(payload))
}
func (repository *ImageRepository) AcquireMaintenanceLease(ctx context.Context, input ImageMaintenanceLeaseInput) (bool, error) {
	var result bool
	err := repository.maintenanceAction(ctx, "image_acquire_maintenance_lease", input, &result, false)
	return result, err
}
func (repository *ImageRepository) ReleaseMaintenanceLease(ctx context.Context, input ImageMaintenanceLeaseInput) (bool, error) {
	var result bool
	err := repository.maintenanceAction(ctx, "image_release_maintenance_lease", input, &result, false)
	return result, err
}
func (repository *ImageRepository) ClaimMaintenance(ctx context.Context, input ImageClaimMaintenanceInput) ([]ImageDeleteClaim, error) {
	var result []ImageDeleteClaim
	if input.VerifiedLocationIDs == nil {
		input.VerifiedLocationIDs = []string{}
	}
	err := repository.maintenanceAction(ctx, "image_claim_maintenance", input, &result, false)
	return result, err
}
func (repository *ImageRepository) FinishMaintenanceObject(ctx context.Context, input ImageFinishMaintenanceInput) (ImageDeleteReceipt, error) {
	var result ImageDeleteReceipt
	err := repository.maintenanceAction(ctx, "image_finish_maintenance_object", input, &result, false)
	return result, err
}
func (repository *ImageRepository) GetMaintenanceJob(ctx context.Context, input ImageMaintenanceJobInput) (*ImageMaintenanceJob, error) {
	var result *ImageMaintenanceJob
	err := repository.maintenanceAction(ctx, "image_get_maintenance_job", input, &result, true)
	return result, err
}
func (repository *ImageRepository) RequestQuotaCleanup(ctx context.Context, input ImageQuotaCleanupInput) (*ImageMaintenanceJob, error) {
	var result *ImageMaintenanceJob
	err := repository.maintenanceAction(ctx, "image_request_quota_cleanup", input, &result, true)
	return result, err
}
func (repository *ImageRepository) CloseExpiredReservations(ctx context.Context, limit int) (ImageReservationCleanupResult, error) {
	var result ImageReservationCleanupResult
	if limit == 0 {
		limit = 100
	}
	err := repository.maintenanceAction(ctx, "image_close_expired_reservations", map[string]int{"limit": limit}, &result, false)
	return result, err
}
func (repository *ImageRepository) EnqueueDueCleanup(ctx context.Context) (*ImageMaintenanceJob, error) {
	var result *ImageMaintenanceJob
	err := repository.query(ctx, "SELECT image_enqueue_due_cleanup()", &result, true)
	return result, err
}
func (repository *ImageRepository) ListMaintenanceLocations(ctx context.Context) ([]ImageLocation, error) {
	var result []ImageLocation
	err := repository.query(ctx, "SELECT image_list_maintenance_locations()", &result, false)
	return result, err
}
func (repository *ImageRepository) BeginRead(ctx context.Context, input ImageReadInput) (*ImageReadLease, error) {
	var result *ImageReadLease
	err := repository.maintenanceAction(ctx, "image_begin_read", input, &result, true)
	return result, err
}
func (repository *ImageRepository) PrepareCopy(ctx context.Context, input ImagePrepareCopyInput) (ImageReservation, error) {
	var result ImageReservation
	err := repository.maintenanceAction(ctx, "image_prepare_copy", input, &result, false)
	return result, err
}
func (repository *ImageRepository) RecordReplicaVerification(ctx context.Context, input ImageReplicaVerificationInput) (ImageReplicaProofResult, error) {
	var result ImageReplicaProofResult
	err := repository.maintenanceAction(ctx, "image_record_replica_verification", input, &result, false)
	return result, err
}
func (repository *ImageRepository) RequestSourceRetirement(ctx context.Context, input ImageSourceRetirementInput) (ImageMaintenanceJob, error) {
	var result ImageMaintenanceJob
	err := repository.maintenanceAction(ctx, "image_request_source_retirement", input, &result, false)
	return result, err
}
func (repository *ImageRepository) GetStorageOverview(ctx context.Context) (ImageStorageOverview, error) {
	var result ImageStorageOverview
	err := repository.query(ctx, "SELECT image_get_storage_overview()", &result, false)
	return result, err
}
func (repository *ImageRepository) UpdateStoragePolicy(ctx context.Context, input ImageUpdatePolicyInput) (ImagePolicy, error) {
	var result ImagePolicy
	err := repository.maintenanceAction(ctx, "image_update_storage_policy", input, &result, false)
	return result, err
}
func (repository *ImageRepository) PreviewCleanup(ctx context.Context, input ImagePreviewCleanupInput) (ImageCleanupPreview, error) {
	var result ImageCleanupPreview
	err := repository.maintenanceAction(ctx, "image_preview_cleanup", input, &result, false)
	return result, err
}
func (repository *ImageRepository) ConfirmCleanup(ctx context.Context, input ImageConfirmCleanupInput) (ImageMaintenanceJob, error) {
	var result ImageMaintenanceJob
	err := repository.maintenanceAction(ctx, "image_confirm_cleanup", input, &result, false)
	return result, err
}
func (repository *ImageRepository) CancelMaintenance(ctx context.Context, input ImageCancelMaintenanceInput) (ImageMaintenanceJob, error) {
	var result ImageMaintenanceJob
	err := repository.maintenanceAction(ctx, "image_cancel_maintenance", input, &result, false)
	return result, err
}

func validImageMaintenanceJob(value ImageMaintenanceJob) bool {
	validState := value.State == "PREVIEW" || value.State == "QUEUED" || value.State == "RUNNING" || value.State == "WAITING" || value.State == "SUCCEEDED" || value.State == "PARTIAL" || value.State == "CANCELLED" || value.State == "EXPIRED"
	validMode := value.Mode == "MANUAL_AGE" || value.Mode == "MANUAL_ALL" || value.Mode == "SCHEDULE" || value.Mode == "QUOTA" || value.Mode == "SOURCE_RETIREMENT"
	return imageUUIDPattern.MatchString(value.ID) && validState && validMode && value.PolicyVersion > 0 && value.EstimatedBytes >= 0 && value.ReleasedBytes >= 0 && value.ReleasedBytes <= value.EstimatedBytes && value.TotalItems >= 0 && value.CompletedItems >= 0 && value.SkippedItems >= 0 && value.PendingItems >= 0 && value.FailedItems >= 0 && value.FailedItems <= value.PendingItems && value.CompletedItems+value.SkippedItems+value.PendingItems == value.TotalItems && len(value.Items) <= 100
}
func validateImageMaintenanceResult(target any) bool {
	switch value := target.(type) {
	case *ImageMaintenanceJob:
		return validImageMaintenanceJob(*value)
	case **ImageMaintenanceJob:
		return *value == nil || validImageMaintenanceJob(**value)
	case *[]ImageDeleteClaim:
		for _, claim := range *value {
			if !imageUUIDPattern.MatchString(claim.JobID) || !imageUUIDPattern.MatchString(claim.ItemID) || !imageUUIDPattern.MatchString(claim.DeleteToken) || claim.DeleteExpiresAt.IsZero() || !validImageObject(claim.Object) || claim.Object.State != "DELETING" || claim.Object.LocationID != claim.Location.ID || claim.Object.DeleteToken == nil || *claim.Object.DeleteToken != claim.DeleteToken {
				return false
			}
		}
		return true
	case *[]ImageLocation:
		for _, location := range *value {
			if location.ID == "" || location.PhysicalNamespace == "" || (location.Provider != "S3" && location.Provider != "LOCAL") {
				return false
			}
		}
		return true
	case *ImageDeleteReceipt:
		return value.ReleasedBytes >= 0 && validImageMaintenanceJob(value.Job) && (!value.Replayed || value.ReleasedBytes == 0)
	case *ImageReservationCleanupResult:
		return value.Closed >= 0 && value.ReleasedBytes >= 0
	case **ImageReadLease:
		if *value == nil {
			return true
		}
		image := &(*value).Image
		return !(*value).ReadExpiresAt.IsZero() && image.Asset.State == "AVAILABLE" && validateImageRepositoryResult(&image) == nil
	case *ImageReplicaProofResult:
		return imageUUIDPattern.MatchString(value.ID)
	case *ImageStorageOverview:
		return value.Policy.Scope == "images" && value.UsedBytes >= 0 && value.ReservedBytes >= 0 && value.CleanableBytes >= 0 && value.CleanableBytes <= value.UsedBytes && len(value.RecentJobs) <= 10
	case *ImagePolicy:
		return value.Scope == "images" && value.Version > 0 && value.LimitBytes > 0 && value.RetentionDays > 0 && value.IntervalSeconds >= 60
	case *ImageCleanupPreview:
		return imageUUIDPattern.MatchString(value.PreviewID) && value.PolicyVersion > 0 && value.AssetCount >= 0 && value.ObjectCount >= 0 && value.EstimatedBytes >= 0
	default:
		return false
	}
}
