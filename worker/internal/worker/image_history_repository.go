package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
)

const ImageHistoryLeaseSeconds = 90
const ImageHistoryPageLimit = 1000

func LoadImageHistoryContract() error {
	data, err := readImageContractArtifact("history.json", 16*1024)
	if err != nil {
		return err
	}
	var contract struct {
		Contract        string `json:"contract"`
		Version         int    `json:"version"`
		StorageRevision int    `json:"storageRevision"`
		Limits          struct {
			PageItems      int `json:"pageItems"`
			ClaimScanItems int `json:"claimScanItems"`
			LeaseSeconds   int `json:"leaseSeconds"`
		} `json:"limits"`
		Scopes           []string `json:"scopes"`
		Provenances      []string `json:"provenances"`
		ObservationKinds []string `json:"observationKinds"`
		ReadResults      []string `json:"readResults"`
		VersionEvidence  []string `json:"versionEvidence"`
		WriterEvidence   []string `json:"writerEvidence"`
		ItemStates       []string `json:"itemStates"`
		Invariants       struct {
			ObservedSourceGrantsPut          bool  `json:"observedSourceGrantsPut"`
			HistoricalOverLimitAccounted     bool  `json:"historicalOverLimitAccounted"`
			UnknownWriteOutcomeImmutable     bool  `json:"unknownWriteOutcomeImmutable"`
			NegativeObservationReleasesBytes bool  `json:"negativeObservationReleasesBytes"`
			ReplayedCopyGrantsPut            bool  `json:"replayedCopyGrantsPut"`
			DefaultRetireSource              bool  `json:"defaultRetireSource"`
			ReferenceEpochLock               []int `json:"referenceEpochLock"`
		} `json:"invariants"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&contract) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid image history contract")
	}
	if contract.Contract != "narra.image.history" || contract.Version != ImageContractVersion || contract.StorageRevision != ImageStorageRevision || contract.Limits.PageItems != ImageHistoryPageLimit || contract.Limits.ClaimScanItems != 100 || contract.Limits.LeaseSeconds != ImageHistoryLeaseSeconds ||
		!slices.Equal(contract.Scopes, []string{"ALL", "GENERATED", "CANVAS_IMPORT", "REFERENCE_URL"}) || !slices.Equal(contract.Provenances, []string{"WRITE", "OBSERVED"}) ||
		!slices.Equal(contract.ObservationKinds, []string{"SOURCE", "TARGET_READBACK", "WRITE_RECONCILIATION"}) || !slices.Equal(contract.ReadResults, []string{"FULL", "DECLARED", "MISSING", "FAILED", "UNVERIFIED"}) ||
		!slices.Equal(contract.VersionEvidence, []string{"UNVERSIONED", "VERSIONED", "UNKNOWN"}) || !slices.Equal(contract.WriterEvidence, []string{"NOT_APPLICABLE", "QUIESCED", "UNKNOWN"}) ||
		!slices.Equal(contract.ItemStates, []string{"PENDING", "OBSERVED", "ADOPTED", "COPYING", "RECONCILING", "BLOCKED", "SOURCE_RETAINED", "RETIREMENT_REQUESTED", "EXCLUDED"}) ||
		contract.Invariants.ObservedSourceGrantsPut || !contract.Invariants.HistoricalOverLimitAccounted || !contract.Invariants.UnknownWriteOutcomeImmutable || contract.Invariants.NegativeObservationReleasesBytes || contract.Invariants.ReplayedCopyGrantsPut || contract.Invariants.DefaultRetireSource || !slices.Equal(contract.Invariants.ReferenceEpochLock, []int{182736, 3}) {
		return errors.New("unsupported image history contract")
	}
	return nil
}

type ImageHistorySourceBinding struct {
	SubjectKind          string `json:"subjectKind"`
	SubjectID            string `json:"subjectId"`
	ExpectedSnapshotHash string `json:"expectedSnapshotHash"`
	LocationID           string `json:"locationId"`
	Key                  string `json:"key"`
	OwnerID              string `json:"ownerId"`
}
type ImageHistoryCandidate struct {
	SubjectKind    string          `json:"subjectKind"`
	SubjectID      string          `json:"subjectId"`
	OwnerID        *string         `json:"ownerId"`
	ExactURL       *string         `json:"exactUrl"`
	Snapshot       json.RawMessage `json:"snapshot"`
	SnapshotHash   string          `json:"snapshotHash"`
	CreatedAt      string          `json:"createdAt"`
	Classification string          `json:"classification"`
}
type ImageHistoryScanInput struct {
	Scope      string `json:"scope,omitempty"`
	Cursor     string `json:"cursor,omitempty"`
	UpperBound string `json:"upperBound,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}
type ImageHistoryScanPage struct {
	Candidates []ImageHistoryCandidate `json:"candidates"`
	NextCursor *string                 `json:"nextCursor"`
	UpperBound string                  `json:"upperBound"`
}
type ImageHistoryObjectDescriptor struct {
	Asset    ImageAssetRecord  `json:"asset"`
	Object   ImageObjectRecord `json:"object"`
	Location ImageLocation     `json:"location"`
}
type ImageHistoryItem struct {
	ID                    string                        `json:"id"`
	JobID                 string                        `json:"jobId"`
	SubjectKind           string                        `json:"subjectKind"`
	SubjectID             string                        `json:"subjectId"`
	OwnerID               *string                       `json:"ownerId"`
	ExactURL              *string                       `json:"exactUrl"`
	Snapshot              json.RawMessage               `json:"snapshot"`
	SnapshotHash          string                        `json:"snapshotHash"`
	SourceBinding         *ImageHistorySourceBinding    `json:"sourceBinding"`
	State                 string                        `json:"state"`
	Token                 *string                       `json:"token"`
	LeaseExpiresAt        *string                       `json:"leaseExpiresAt"`
	SourceObservationID   *string                       `json:"sourceObservationId"`
	AssetID               *string                       `json:"assetId"`
	SourceObjectID        *string                       `json:"sourceObjectId"`
	TargetObjectID        *string                       `json:"targetObjectId"`
	ReservationID         *string                       `json:"reservationId"`
	Attempt               int                           `json:"attempt"`
	IntentKey             *string                       `json:"intentKey"`
	TargetKey             *string                       `json:"targetKey"`
	ReplicaVerificationID *string                       `json:"replicaVerificationId"`
	RetirementJobID       *string                       `json:"retirementJobId"`
	ErrorCode             *string                       `json:"errorCode"`
	CreatedAt             string                        `json:"createdAt"`
	UpdatedAt             string                        `json:"updatedAt"`
	Source                *ImageHistoryObjectDescriptor `json:"source"`
	Target                *ImageHistoryObjectDescriptor `json:"target"`
}
type ImageHistoryJob struct {
	ID               string                      `json:"id"`
	RequestID        string                      `json:"requestId"`
	ActorID          string                      `json:"actorId"`
	Mode             string                      `json:"mode"`
	Scope            string                      `json:"scope"`
	PlanDigest       string                      `json:"planDigest"`
	PublicURLBase    string                      `json:"publicUrlBase"`
	SourceBindings   []ImageHistorySourceBinding `json:"sourceBindings"`
	TargetLocationID *string                     `json:"targetLocationId"`
	RetireSource     bool                        `json:"retireSource"`
	UpperBound       string                      `json:"upperBound"`
	Cursor           *string                     `json:"cursor"`
	ScanComplete     bool                        `json:"scanComplete"`
	State            string                      `json:"state"`
	TotalItems       int                         `json:"totalItems"`
	CompletedItems   int                         `json:"completedItems"`
	BlockedItems     int                         `json:"blockedItems"`
	CreatedAt        string                      `json:"createdAt"`
	UpdatedAt        string                      `json:"updatedAt"`
}
type ImageHistoryBeginApplyInput struct {
	RequestID        string                      `json:"requestId"`
	ActorID          string                      `json:"actorId"`
	PlanDigest       string                      `json:"planDigest"`
	PublicURLBase    string                      `json:"publicUrlBase"`
	Scope            string                      `json:"scope"`
	SourceBindings   []ImageHistorySourceBinding `json:"sourceBindings"`
	TargetLocationID string                      `json:"targetLocationId,omitempty"`
	RetireSource     bool                        `json:"retireSource"`
	UpperBound       string                      `json:"upperBound"`
}
type ImageHistoryJobInput struct {
	JobID     string `json:"jobId,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}
type ImageHistoryItemsInput struct {
	JobID  string `json:"jobId"`
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}
type ImageHistoryItemsPage struct {
	Items      []ImageHistoryItem `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}
type ImageHistoryClaimInput struct {
	JobID    string `json:"jobId"`
	WorkerID string `json:"workerId"`
	Token    string `json:"token"`
	ItemID   string `json:"itemId,omitempty"`
}
type ImageHistoryItemInput struct {
	ItemID string `json:"itemId"`
}
type ImageHistoryAliasesInput struct {
	AssetID string `json:"assetId"`
}
type ImageHistoryBlockInput struct {
	ItemID    string `json:"itemId"`
	Token     string `json:"token"`
	ErrorCode string `json:"errorCode"`
}
type ImageObjectObservationInput struct {
	RequestID          string `json:"requestId"`
	ItemID             string `json:"itemId"`
	Token              string `json:"token"`
	Kind               string `json:"kind"`
	SourceSnapshotHash string `json:"sourceSnapshotHash"`
	LocationID         string `json:"locationId"`
	Key                string `json:"key"`
	ReadResult         string `json:"readResult"`
	ByteLength         int64  `json:"byteLength,string,omitempty"`
	SHA256             string `json:"sha256,omitempty"`
	MimeType           string `json:"mimeType,omitempty"`
	VersionEvidence    string `json:"versionEvidence"`
	VersionID          string `json:"versionId,omitempty"`
	ETag               string `json:"etag,omitempty"`
	LastModified       string `json:"lastModified,omitempty"`
	WriterEvidence     string `json:"writerEvidence"`
	OriginalWriteToken string `json:"originalWriteToken,omitempty"`
	WriterProofSHA256  string `json:"writerProofSha256,omitempty"`
}
type ImageObjectObservationResult struct {
	ID string `json:"id"`
}
type ImageHistoryAdoptInput struct {
	ItemID                       string `json:"itemId"`
	Token                        string `json:"token"`
	ObservationID                string `json:"observationId"`
	ExpectedBusinessSnapshotHash string `json:"expectedBusinessSnapshotHash"`
}
type ImageHistoryAdoptResult struct {
	Item           ImageHistoryItem `json:"item"`
	Replayed       bool             `json:"replayed"`
	AccountedDelta int64            `json:"accountedDelta,string"`
	OverLimit      bool             `json:"overLimit"`
}
type ImageHistoryPrepareCopyInput struct {
	ItemID                 string `json:"itemId"`
	Token                  string `json:"token"`
	ExpectedSourceObjectID string `json:"expectedSourceObjectId"`
	TargetLocationID       string `json:"targetLocationId"`
}
type ImageHistoryPrepareCopyResult struct {
	Item        ImageHistoryItem `json:"item"`
	Reservation ImageReservation `json:"reservation"`
	Ticket      ImageWriteTicket `json:"ticket"`
}
type ImageHistoryReconcileInput struct {
	ItemID                 string `json:"itemId"`
	Token                  string `json:"token"`
	ExpectedTargetObjectID string `json:"expectedTargetObjectId"`
}
type ImageHistoryReconcileRead struct {
	Item          ImageHistoryItem `json:"item"`
	ReadExpiresAt string           `json:"readExpiresAt"`
}
type ImageHistoryFinishReconciliationInput struct {
	ItemID                     string `json:"itemId"`
	Token                      string `json:"token"`
	ObservationID              string `json:"observationId"`
	ExpectedOriginalWriteToken string `json:"expectedOriginalWriteToken"`
}
type ImageHistoryFinishReconciliationResult struct {
	Accepted  bool             `json:"accepted"`
	State     string           `json:"state"`
	ByteDelta int64            `json:"byteDelta,string"`
	Item      ImageHistoryItem `json:"item"`
}
type ImageHistorySwitchInput struct {
	ItemID                      string   `json:"itemId"`
	Token                       string   `json:"token"`
	TargetReadbackObservationID string   `json:"targetReadbackObservationId"`
	ExpectedActiveObjectID      string   `json:"expectedActiveObjectId"`
	AliasURLs                   []string `json:"aliasUrls"`
	ReaderProtocolRevision      int      `json:"readerProtocolRevision"`
}
type ImageHistorySwitchResult struct {
	Switched              bool             `json:"switched"`
	Replayed              bool             `json:"replayed"`
	ReplicaVerificationID string           `json:"replicaVerificationId"`
	Item                  ImageHistoryItem `json:"item"`
}
type ImageHistoryRetireInput struct {
	ItemID string `json:"itemId"`
	Token  string `json:"token"`
}
type ImageHistoryRetireResult struct {
	Item ImageHistoryItem    `json:"item"`
	Job  ImageMaintenanceJob `json:"job"`
}

// Each method names one bundled SQL action. The planner only uses the SELECT
// methods and a read-only transaction; it never calls writer initialization.
func (r *ImageRepository) historyAction(ctx context.Context, name string, input any, result any, nullable bool) error {
	allowed := map[string]bool{
		"image_scan_history": true, "image_begin_history_apply": true, "image_get_history_job": true,
		"image_list_history_items": true, "image_claim_history_item": true, "image_get_history_item": true,
		"image_get_history_aliases": true, "image_block_history_item": true, "image_record_object_observation": true,
		"image_adopt_observed_object": true, "image_prepare_migration_copy": true, "image_prepare_copy_reconciliation": true,
		"image_finish_copy_reconciliation": true, "image_commit_migration_switch": true, "image_request_history_source_retirement": true,
	}
	if !allowed[name] {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT", Cause: err}
	}
	return r.query(ctx, "SELECT "+name+"($1::jsonb)", result, nullable, string(payload))
}
func (r *ImageRepository) ScanImageHistory(ctx context.Context, input ImageHistoryScanInput) (ImageHistoryScanPage, error) {
	var result ImageHistoryScanPage
	err := r.historyAction(ctx, "image_scan_history", input, &result, false)
	return result, err
}
func (r *ImageRepository) BeginImageHistoryApply(ctx context.Context, input ImageHistoryBeginApplyInput) (ImageHistoryJob, error) {
	var result ImageHistoryJob
	err := r.historyAction(ctx, "image_begin_history_apply", input, &result, false)
	return result, err
}
func (r *ImageRepository) GetImageHistoryJob(ctx context.Context, input ImageHistoryJobInput) (*ImageHistoryJob, error) {
	var result *ImageHistoryJob
	err := r.historyAction(ctx, "image_get_history_job", input, &result, true)
	return result, err
}
func (r *ImageRepository) ListImageHistoryItems(ctx context.Context, input ImageHistoryItemsInput) (ImageHistoryItemsPage, error) {
	var result ImageHistoryItemsPage
	err := r.historyAction(ctx, "image_list_history_items", input, &result, false)
	return result, err
}
func (r *ImageRepository) ClaimImageHistoryItem(ctx context.Context, input ImageHistoryClaimInput) (*ImageHistoryItem, error) {
	var result *ImageHistoryItem
	err := r.historyAction(ctx, "image_claim_history_item", input, &result, true)
	return result, err
}
func (r *ImageRepository) GetImageHistoryItem(ctx context.Context, input ImageHistoryItemInput) (*ImageHistoryItem, error) {
	var result *ImageHistoryItem
	err := r.historyAction(ctx, "image_get_history_item", input, &result, true)
	return result, err
}
func (r *ImageRepository) GetImageHistoryAliases(ctx context.Context, input ImageHistoryAliasesInput) ([]string, error) {
	var result []string
	err := r.historyAction(ctx, "image_get_history_aliases", input, &result, false)
	return result, err
}
func (r *ImageRepository) BlockImageHistoryItem(ctx context.Context, input ImageHistoryBlockInput) (ImageHistoryItem, error) {
	var result ImageHistoryItem
	err := r.historyAction(ctx, "image_block_history_item", input, &result, false)
	return result, err
}
func (r *ImageRepository) RecordImageObjectObservation(ctx context.Context, input ImageObjectObservationInput) (ImageObjectObservationResult, error) {
	var result ImageObjectObservationResult
	err := r.historyAction(ctx, "image_record_object_observation", input, &result, false)
	return result, err
}
func (r *ImageRepository) AdoptObservedImageObject(ctx context.Context, input ImageHistoryAdoptInput) (ImageHistoryAdoptResult, error) {
	var result ImageHistoryAdoptResult
	err := r.historyAction(ctx, "image_adopt_observed_object", input, &result, false)
	return result, err
}
func (r *ImageRepository) PrepareImageMigrationCopy(ctx context.Context, input ImageHistoryPrepareCopyInput) (ImageHistoryPrepareCopyResult, error) {
	var result ImageHistoryPrepareCopyResult
	err := r.historyAction(ctx, "image_prepare_migration_copy", input, &result, false)
	return result, err
}
func (r *ImageRepository) PrepareImageCopyReconciliation(ctx context.Context, input ImageHistoryReconcileInput) (ImageHistoryReconcileRead, error) {
	var result ImageHistoryReconcileRead
	err := r.historyAction(ctx, "image_prepare_copy_reconciliation", input, &result, false)
	return result, err
}
func (r *ImageRepository) FinishImageCopyReconciliation(ctx context.Context, input ImageHistoryFinishReconciliationInput) (ImageHistoryFinishReconciliationResult, error) {
	var result ImageHistoryFinishReconciliationResult
	err := r.historyAction(ctx, "image_finish_copy_reconciliation", input, &result, false)
	return result, err
}
func (r *ImageRepository) CommitImageMigrationSwitch(ctx context.Context, input ImageHistorySwitchInput) (ImageHistorySwitchResult, error) {
	var result ImageHistorySwitchResult
	err := r.historyAction(ctx, "image_commit_migration_switch", input, &result, false)
	return result, err
}
func (r *ImageRepository) RequestImageHistorySourceRetirement(ctx context.Context, input ImageHistoryRetireInput) (ImageHistoryRetireResult, error) {
	var result ImageHistoryRetireResult
	err := r.historyAction(ctx, "image_request_history_source_retirement", input, &result, false)
	return result, err
}

func validImageHistoryItem(i ImageHistoryItem) bool {
	if !imageUUIDPattern.MatchString(i.ID) || !imageUUIDPattern.MatchString(i.JobID) || !imagePublicTokenPattern.MatchString(i.SnapshotHash) || i.Attempt < 0 {
		return false
	}
	for _, d := range []*ImageHistoryObjectDescriptor{i.Source, i.Target} {
		if d != nil && (!validImageAsset(d.Asset) || !validImageObject(d.Object) || d.Object.AssetID != d.Asset.ID || d.Location.ID != d.Object.LocationID) {
			return false
		}
	}
	return true
}
func validateImageHistoryResult(target any) (bool, bool) {
	valid := true
	switch v := target.(type) {
	case *ImageHistoryScanPage:
		valid = len(v.Candidates) <= ImageHistoryPageLimit && v.UpperBound != ""
		for _, c := range v.Candidates {
			valid = valid && c.SubjectID != "" && imagePublicTokenPattern.MatchString(c.SnapshotHash) && json.Valid(c.Snapshot)
		}
	case *ImageHistoryJob:
		valid = imageUUIDPattern.MatchString(v.ID) && imageUUIDPattern.MatchString(v.RequestID) && v.TotalItems >= 0 && len(v.SourceBindings) <= ImageHistoryPageLimit
	case **ImageHistoryJob:
		if *v != nil {
			return validateImageHistoryResult(*v)
		}
	case *ImageHistoryItem:
		valid = validImageHistoryItem(*v)
	case **ImageHistoryItem:
		valid = *v == nil || validImageHistoryItem(**v)
	case *ImageHistoryItemsPage:
		valid = len(v.Items) <= ImageHistoryPageLimit
		for _, i := range v.Items {
			valid = valid && validImageHistoryItem(i)
		}
	case *ImageObjectObservationResult:
		valid = imageUUIDPattern.MatchString(v.ID)
	case *ImageHistoryAdoptResult:
		valid = validImageHistoryItem(v.Item) && v.AccountedDelta >= 0
	case *ImageHistoryPrepareCopyResult:
		valid = validImageHistoryItem(v.Item) && validImageReservation(v.Reservation) && validImageAsset(v.Ticket.Asset) && validImageObject(v.Ticket.Object) &&
			v.Item.TargetObjectID != nil && *v.Item.TargetObjectID == v.Ticket.Object.ID && v.Ticket.Asset.ID == v.Ticket.Object.AssetID &&
			v.Ticket.Asset.ByteLength == v.Ticket.Object.ByteLength && v.Ticket.Asset.SHA256 == v.Ticket.Object.SHA256 && v.Reservation.ID == v.Ticket.Object.ReservationID &&
			(!v.Ticket.WriteGranted || (v.Ticket.Object.Provenance == "WRITE" && v.Ticket.Object.State == "WRITING" && v.Ticket.Object.PutOutcome == "NOT_STARTED" && v.Ticket.Object.Accounted))
	case *ImageHistoryReconcileRead:
		valid = validImageHistoryItem(v.Item) && v.ReadExpiresAt != ""
	case *ImageHistoryFinishReconciliationResult:
		valid = validImageHistoryItem(v.Item) && v.ByteDelta == 0
	case *ImageHistorySwitchResult:
		valid = validImageHistoryItem(v.Item) && imageUUIDPattern.MatchString(v.ReplicaVerificationID)
	case *ImageHistoryRetireResult:
		valid = validImageHistoryItem(v.Item) && imageUUIDPattern.MatchString(v.Job.ID)
	case *[]string:
		valid = len(*v) <= ImageHistoryPageLimit
	default:
		return false, false
	}
	return valid, true
}
