package worker

import (
	"context"
	"errors"
	"sort"
	"time"
)

type ImageHistoryReadRepository interface {
	ImageHistoryScanner
	GetImageHistoryJob(context.Context, ImageHistoryJobInput) (*ImageHistoryJob, error)
	ListImageHistoryItems(context.Context, ImageHistoryItemsInput) (ImageHistoryItemsPage, error)
	GetImageHistoryItem(context.Context, ImageHistoryItemInput) (*ImageHistoryItem, error)
}

type ImageHistoryApplyRepository interface {
	ImageHistoryReadRepository
	RegisterLocation(context.Context, ImageLocationInput) (ImageLocation, error)
	BeginImageHistoryApply(context.Context, ImageHistoryBeginApplyInput) (ImageHistoryJob, error)
	ClaimImageHistoryItem(context.Context, ImageHistoryClaimInput) (*ImageHistoryItem, error)
	BlockImageHistoryItem(context.Context, ImageHistoryBlockInput) (ImageHistoryItem, error)
	RecordImageObjectObservation(context.Context, ImageObjectObservationInput) (ImageObjectObservationResult, error)
	AdoptObservedImageObject(context.Context, ImageHistoryAdoptInput) (ImageHistoryAdoptResult, error)
	PrepareImageMigrationCopy(context.Context, ImageHistoryPrepareCopyInput) (ImageHistoryPrepareCopyResult, error)
	PrepareImageCopyReconciliation(context.Context, ImageHistoryReconcileInput) (ImageHistoryReconcileRead, error)
	FinishImageCopyReconciliation(context.Context, ImageHistoryFinishReconciliationInput) (ImageHistoryFinishReconciliationResult, error)
	CommitImageMigrationSwitch(context.Context, ImageHistorySwitchInput) (ImageHistorySwitchResult, error)
	RequestImageHistorySourceRetirement(context.Context, ImageHistoryRetireInput) (ImageHistoryRetireResult, error)
	GetImageHistoryAliases(context.Context, ImageHistoryAliasesInput) ([]string, error)
	BeginRead(context.Context, ImageReadInput) (*ImageReadLease, error)
	FinishObject(context.Context, ImageFinishObjectInput) (ImageObjectReceipt, error)
	CloseReservation(context.Context, ImageCloseReservationInput) (bool, error)
}

type ImageHistoryApplyOptions struct {
	ImageHistoryPlanOptions
	RequestID string
	JobID     string
	ItemID    string
	ActorID   string
	WorkerID  string
}

type ImageHistoryItemProgress struct {
	ID                string  `json:"id"`
	SubjectKind       string  `json:"subjectKind"`
	SubjectID         string  `json:"subjectId"`
	State             string  `json:"state"`
	StateAcknowledged bool    `json:"stateAcknowledged"`
	SourceObjectID    *string `json:"sourceObjectId"`
	TargetObjectID    *string `json:"targetObjectId"`
	RetirementJobID   *string `json:"retirementJobId"`
	AccountedDelta    *int64  `json:"accountedDelta,string,omitempty"`
	OverLimit         bool    `json:"overLimit"`
	PutAttempted      bool    `json:"putAttempted"`
	Switched          bool    `json:"switched"`
	ReaderVerified    bool    `json:"readerVerified"`
	Code              string  `json:"code,omitempty"`
}

type ImageHistoryJobProgress struct {
	ID             string  `json:"id"`
	RequestID      string  `json:"requestId"`
	Mode           string  `json:"mode"`
	Scope          string  `json:"scope"`
	State          string  `json:"state"`
	UpperBound     string  `json:"upperBound"`
	Cursor         *string `json:"cursor"`
	ScanComplete   bool    `json:"scanComplete"`
	TotalItems     int     `json:"totalItems"`
	CompletedItems int     `json:"completedItems"`
	BlockedItems   int     `json:"blockedItems"`
	RetireSource   bool    `json:"retireSource"`
	PlanDigest     string  `json:"planDigest"`
	PublicURLBase  string  `json:"publicUrlBase"`
}

type ImageHistoryApplyReport struct {
	SchemaVersion int                        `json:"schemaVersion"`
	DryRun        bool                       `json:"dryRun"`
	Job           ImageHistoryJobProgress    `json:"job"`
	Processed     int                        `json:"processed"`
	Blocked       int                        `json:"blocked"`
	HasMore       bool                       `json:"hasMore"`
	NextCursor    *string                    `json:"nextCursor"`
	Items         []ImageHistoryItemProgress `json:"items"`
}

func historyJobProgress(job ImageHistoryJob) ImageHistoryJobProgress {
	return ImageHistoryJobProgress{ID: job.ID, RequestID: job.RequestID, Mode: job.Mode, Scope: job.Scope, State: job.State,
		UpperBound: job.UpperBound, Cursor: job.Cursor, ScanComplete: job.ScanComplete, TotalItems: job.TotalItems,
		CompletedItems: job.CompletedItems, BlockedItems: job.BlockedItems, RetireSource: job.RetireSource, PlanDigest: job.PlanDigest, PublicURLBase: job.PublicURLBase}
}

func historyItemProgress(item ImageHistoryItem) ImageHistoryItemProgress {
	progress := ImageHistoryItemProgress{ID: item.ID, SubjectKind: item.SubjectKind, SubjectID: item.SubjectID, State: item.State, StateAcknowledged: true,
		SourceObjectID: item.SourceObjectID, TargetObjectID: item.TargetObjectID, RetirementJobID: item.RetirementJobID}
	if item.ErrorCode != nil {
		progress.Code = *item.ErrorCode
	}
	return progress
}

// ReadImageHistoryProgress is also used by --job-id without --apply. It only
// consumes SELECT methods; inspecting progress cannot renew a lease or retry IO.
func ReadImageHistoryProgress(ctx context.Context, repository ImageHistoryReadRepository, jobID, itemCursor string, limit int) (ImageHistoryApplyReport, error) {
	report := ImageHistoryApplyReport{SchemaVersion: 1, DryRun: true, Items: []ImageHistoryItemProgress{}}
	if !imageUUIDPattern.MatchString(jobID) || limit < 1 || limit > ImageHistoryMaxItems {
		return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	job, err := repository.GetImageHistoryJob(ctx, ImageHistoryJobInput{JobID: jobID})
	if err != nil {
		return report, err
	}
	if job == nil {
		return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	page, err := repository.ListImageHistoryItems(ctx, ImageHistoryItemsInput{JobID: jobID, Cursor: itemCursor, Limit: limit})
	if err != nil {
		return report, err
	}
	report.Job, report.NextCursor = historyJobProgress(*job), page.NextCursor
	report.HasMore = page.NextCursor != nil || !job.ScanComplete || job.BlockedItems > 0 || job.CompletedItems < job.TotalItems
	for _, item := range page.Items {
		report.Items = append(report.Items, historyItemProgress(item))
	}
	return report, nil
}

type imageHistoryRunner struct {
	repository ImageHistoryApplyRepository
	storage    ImageHistoryApplyIO
	locations  map[string]ImageLocationInput
	job        ImageHistoryJob
	workerID   string
	token      string
}

// ApplyImageHistory deliberately has no Delete capability. Explicit source
// retirement only creates the C2 maintenance request, whose finalizer alone
// can release the source's physical accounting.
func ApplyImageHistory(ctx context.Context, repository ImageHistoryApplyRepository, storage ImageHistoryApplyIO, manifest ImageHistoryManifest, options ImageHistoryApplyOptions) (ImageHistoryApplyReport, error) {
	report := ImageHistoryApplyReport{SchemaVersion: 1, Items: []ImageHistoryItemProgress{}}
	if repository == nil || storage == nil {
		return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if err := ValidateImageHistoryManifest(manifest); err != nil {
		return report, err
	}
	planOptions, err := normalizedHistoryPlanOptions(options.ImageHistoryPlanOptions)
	if err != nil || planOptions.Cursor != "" || (options.JobID == "" && !imageUUIDPattern.MatchString(options.RequestID)) || (options.JobID != "" && !imageUUIDPattern.MatchString(options.JobID)) ||
		(options.ItemID != "" && (!imageUUIDPattern.MatchString(options.ItemID) || options.JobID == "")) {
		return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	lookup := ImageHistoryJobInput{JobID: options.JobID}
	if lookup.JobID == "" {
		lookup.RequestID = options.RequestID
	}
	existing, err := repository.GetImageHistoryJob(ctx, lookup)
	if err != nil {
		return report, err
	}
	if options.JobID != "" && existing == nil {
		return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if existing != nil {
		// A request whose Begin ACK was lost selects its original upper bound.
		// Resuming by job ID adopts only that job's frozen mode, never new input.
		if options.JobID != "" {
			if (options.TargetLocationID != "" && (existing.TargetLocationID == nil || options.TargetLocationID != *existing.TargetLocationID)) || (options.RetireSource && !existing.RetireSource) {
				return report, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
			}
			planOptions.Scope, planOptions.RetireSource = existing.Scope, existing.RetireSource
			planOptions.PublicURLBase = existing.PublicURLBase
			planOptions.TargetLocationID = ""
			if existing.TargetLocationID != nil {
				planOptions.TargetLocationID = *existing.TargetLocationID
			}
		}
		if planOptions.PublicURLBase != existing.PublicURLBase {
			return report, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
		}
		if options.UpperBound != "" && options.UpperBound != existing.UpperBound {
			return report, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
		}
		planOptions.UpperBound = existing.UpperBound
		if options.ActorID != "" && options.ActorID != existing.ActorID {
			return report, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
		}
		options.ActorID = existing.ActorID
	} else {
		if len(manifest.Bindings) == 0 || !validHistoryTextID(options.ActorID, 255) || planOptions.PublicURLBase == "" {
			return report, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		if planOptions.UpperBound == "" {
			page, err := repository.ScanImageHistory(ctx, ImageHistoryScanInput{Scope: planOptions.Scope, Limit: 1})
			if err != nil {
				return report, err
			}
			planOptions.UpperBound = page.UpperBound
		}
	}
	digest, err := ImageHistoryPlanDigest(manifest, planOptions)
	if err != nil {
		return report, err
	}
	if existing != nil && digest != existing.PlanDigest {
		return report, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
	}
	locations, _ := historyManifestMaps(manifest)
	if planOptions.TargetLocationID != "" {
		target, exists := locations[planOptions.TargetLocationID]
		if !exists {
			return report, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		if err := storage.ProbeTarget(ctx, target); err != nil {
			return report, err
		}
	}
	if existing == nil {
		for _, location := range manifest.Locations {
			if _, err := repository.RegisterLocation(ctx, location); err != nil {
				return report, err
			}
		}
		bindings := append([]ImageHistorySourceBinding{}, manifest.Bindings...)
		sort.Slice(bindings, func(a, b int) bool {
			return historySubjectKey(bindings[a].SubjectKind, bindings[a].SubjectID) < historySubjectKey(bindings[b].SubjectKind, bindings[b].SubjectID)
		})
		job, err := repository.BeginImageHistoryApply(ctx, ImageHistoryBeginApplyInput{
			RequestID: options.RequestID, ActorID: options.ActorID, PlanDigest: digest, Scope: planOptions.Scope,
			SourceBindings: bindings, TargetLocationID: planOptions.TargetLocationID, RetireSource: planOptions.RetireSource, UpperBound: planOptions.UpperBound,
			PublicURLBase: planOptions.PublicURLBase,
		})
		if err != nil {
			// Read-only recovery uses the immutable request ID; no second job.
			recovered, readErr := repository.GetImageHistoryJob(ctx, ImageHistoryJobInput{RequestID: options.RequestID})
			if readErr != nil || recovered == nil || recovered.PlanDigest != digest || recovered.ActorID != options.ActorID {
				return report, err
			}
			job = *recovered
		}
		existing = &job
	}
	report.Job = historyJobProgress(*existing)
	token, err := newImageMaintenanceToken()
	if err != nil {
		return report, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	workerID := options.WorkerID
	if workerID == "" {
		workerID = "image-history:" + token
	}
	runner := &imageHistoryRunner{repository: repository, storage: storage, locations: locations, job: *existing, workerID: workerID, token: token}
	seen := make(map[string]bool)
	process := func(itemID string) (bool, error) {
		item, err := repository.ClaimImageHistoryItem(ctx, ImageHistoryClaimInput{JobID: existing.ID, WorkerID: workerID, Token: token, ItemID: itemID})
		if err != nil || item == nil {
			return false, err
		}
		if seen[item.ID] {
			return false, nil
		}
		seen[item.ID] = true
		progress := runner.process(ctx, *item)
		report.Items = append(report.Items, progress)
		report.Processed++
		if progress.State == "BLOCKED" || progress.Code != "" {
			report.Blocked++
		}
		return true, nil
	}
	if options.ItemID != "" {
		_, err = process(options.ItemID)
	} else {
		// Retry a bounded page of persisted blockers before discovering more
		// work. --item-id addresses any later blocker without an unbounded scan.
		page, listErr := repository.ListImageHistoryItems(ctx, ImageHistoryItemsInput{JobID: existing.ID, Limit: planOptions.Limit})
		if listErr != nil {
			return report, listErr
		}
		for _, item := range page.Items {
			if item.State == "BLOCKED" && report.Processed < planOptions.Limit {
				if _, err = process(item.ID); err != nil {
					break
				}
			}
		}
		for err == nil && report.Processed < planOptions.Limit {
			var claimed bool
			claimed, err = process("")
			if !claimed {
				break
			}
		}
	}
	if err != nil {
		return report, err
	}
	current, err := repository.GetImageHistoryJob(ctx, ImageHistoryJobInput{JobID: existing.ID})
	if err != nil || current == nil {
		if err == nil {
			err = ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
		}
		return report, err
	}
	report.Job = historyJobProgress(*current)
	report.HasMore = !current.ScanComplete || current.BlockedItems > 0 || current.CompletedItems < current.TotalItems
	return report, nil
}

func (runner *imageHistoryRunner) renew(ctx context.Context, item ImageHistoryItem) (ImageHistoryItem, error) {
	stepCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	renewed, err := runner.repository.ClaimImageHistoryItem(stepCtx, ImageHistoryClaimInput{JobID: runner.job.ID, WorkerID: runner.workerID, Token: runner.token, ItemID: item.ID})
	if err != nil {
		return item, err
	}
	if renewed == nil || renewed.ID != item.ID || renewed.Token == nil || *renewed.Token != runner.token {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	return *renewed, nil
}

func (runner *imageHistoryRunner) block(ctx context.Context, item ImageHistoryItem, progress ImageHistoryItemProgress, err error) ImageHistoryItemProgress {
	code := imageHistorySafeCode(err)
	durableCode := code
	switch durableCode {
	case "IMAGE_STORAGE_UNAVAILABLE", "IMAGE_WRITE_CONFLICT", "IMAGE_LOCATION_CONFLICT", "IMAGE_QUOTA_EXCEEDED", "IMAGE_HISTORY_CONFLICT", "IMAGE_OBSERVATION_REQUIRED", "IMAGE_HISTORY_BLOCKED", "IMAGE_UNAVAILABLE", "IMAGE_READER_INCOMPATIBLE":
	default:
		durableCode = "IMAGE_STORAGE_UNAVAILABLE"
	}
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	blocked, blockErr := runner.repository.BlockImageHistoryItem(finishCtx, ImageHistoryBlockInput{ItemID: item.ID, Token: runner.token, ErrorCode: durableCode})
	if blockErr == nil {
		progress.State, progress.SourceObjectID, progress.TargetObjectID, progress.RetirementJobID = blocked.State, blocked.SourceObjectID, blocked.TargetObjectID, blocked.RetirementJobID
	} else {
		progress.State, progress.StateAcknowledged = item.State, false
	}
	progress.Code = code
	return progress
}

func (runner *imageHistoryRunner) process(ctx context.Context, item ImageHistoryItem) ImageHistoryItemProgress {
	progress := historyItemProgress(item)
	progress.Code = ""
	if item.State == "EXCLUDED" || item.State == "RETIREMENT_REQUESTED" || (item.State == "SOURCE_RETAINED" && !runner.job.RetireSource) || (item.State == "ADOPTED" && runner.job.Mode == "ADOPT") {
		return progress
	}
	if item.Token == nil || *item.Token != runner.token {
		return runner.block(ctx, item, progress, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"})
	}
	if item.Source == nil {
		adopted, delta, overLimit, err := runner.adopt(ctx, item)
		if err != nil {
			return runner.block(ctx, adopted, progress, err)
		}
		item = adopted
		progress = historyItemProgress(item)
		progress.AccountedDelta, progress.OverLimit = delta, overLimit
	}
	if item.Source == nil || item.SourceObjectID == nil || item.AssetID == nil {
		return runner.block(ctx, item, progress, ImageStorageError{Code: "IMAGE_UNAVAILABLE"})
	}
	if item.Source.Asset.State != "AVAILABLE" || item.Source.Object.State != "READY" || !ImageObjectVerified(item.Source.Object) {
		return runner.block(ctx, item, progress, ImageStorageError{Code: "IMAGE_UNAVAILABLE"})
	}
	if runner.job.Mode == "ADOPT" {
		progress.State = item.State
		return progress
	}
	if item.ReplicaVerificationID == nil {
		var err error
		if item.Target == nil {
			item, err = runner.copy(ctx, item, &progress)
			if err != nil {
				return runner.block(ctx, item, progress, err)
			}
		}
		item, err = runner.verifyAndSwitch(ctx, item)
		if err != nil {
			return runner.block(ctx, item, progress, err)
		}
		progress.Switched = true
	}
	progress.State, progress.SourceObjectID, progress.TargetObjectID = item.State, item.SourceObjectID, item.TargetObjectID
	if runner.job.RetireSource {
		renewed, err := runner.renew(ctx, item)
		if err != nil {
			return runner.block(ctx, item, progress, err)
		}
		item = renewed
		if err := runner.verifyPublished(ctx, item); err != nil {
			return runner.block(ctx, item, progress, err)
		}
		progress.ReaderVerified = true
		item, err = runner.renew(ctx, item)
		if err != nil {
			return runner.block(ctx, item, progress, err)
		}
		retired, err := runner.repository.RequestImageHistorySourceRetirement(ctx, ImageHistoryRetireInput{ItemID: item.ID, Token: runner.token})
		if err != nil {
			// Request IDs are derived from this item in SQL. A missing ACK cannot
			// cause a second maintenance job or a direct source DELETE.
			current, readErr := runner.repository.GetImageHistoryItem(ctx, ImageHistoryItemInput{ItemID: item.ID})
			if readErr != nil || current == nil || current.RetirementJobID == nil {
				return runner.block(ctx, item, progress, err)
			}
			item = *current
		} else {
			item = retired.Item
		}
		progress.State, progress.RetirementJobID = item.State, item.RetirementJobID
	}
	return progress
}

func (runner *imageHistoryRunner) record(ctx context.Context, item ImageHistoryItem, kind string, location ImageLocationInput, key string, inspected ImageHistoryInspection, originalToken string) (ImageObjectObservationResult, error) {
	requestID, err := newImageMaintenanceToken()
	if err != nil {
		return ImageObjectObservationResult{}, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	input := ImageObjectObservationInput{RequestID: requestID, ItemID: item.ID, Token: runner.token, Kind: kind,
		SourceSnapshotHash: item.SnapshotHash, LocationID: location.ID, Key: key, ReadResult: inspected.ReadResult,
		SHA256: inspected.SHA256, MimeType: inspected.MimeType, VersionEvidence: inspected.VersionEvidence,
		VersionID: inspected.VersionID, ETag: inspected.ETag, LastModified: inspected.LastModified, WriterEvidence: "NOT_APPLICABLE"}
	if input.ReadResult == "" {
		input.ReadResult = "FAILED"
	}
	if input.VersionEvidence == "" {
		input.VersionEvidence = "UNKNOWN"
	}
	if inspected.ByteLength != nil && *inspected.ByteLength > 0 {
		input.ByteLength = *inspected.ByteLength
	}
	if kind == "WRITE_RECONCILIATION" {
		input.OriginalWriteToken, input.WriterEvidence = originalToken, "UNKNOWN"
		if location.Provider == "LOCAL" && inspected.ReadResult == "FULL" && inspected.LocalFinalImmutable && inspected.WriterProofSHA256 != "" && originalToken != "" {
			input.WriterEvidence = "QUIESCED"
			input.WriterProofSHA256 = imageHistoryProof(inspected.WriterProofSHA256, originalToken)
		}
	}
	return runner.repository.RecordImageObjectObservation(ctx, input)
}

func (runner *imageHistoryRunner) adopt(ctx context.Context, item ImageHistoryItem) (ImageHistoryItem, *int64, bool, error) {
	if item.SourceBinding == nil {
		return item, nil, false, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	snapshot, err := decodeHistorySnapshot(item.Snapshot)
	if err != nil {
		return item, nil, false, err
	}
	binding := *item.SourceBinding
	if err := validateHistoryBinding(item.SubjectKind, item.SubjectID, item.OwnerID, item.SnapshotHash, snapshot, binding, runner.locations); err != nil {
		return item, nil, false, err
	}
	item, err = runner.renew(ctx, item)
	if err != nil {
		return item, nil, false, err
	}
	location := runner.locations[binding.LocationID]
	observed, inspectErr := runner.storage.Inspect(ctx, location, binding.Key, historyExpectedSnapshot(item.SubjectKind, snapshot), false)
	if inspectErr != nil && item.SubjectKind == "CANVAS_IMPORT" && snapshot.PhysicalBytesAccounted && historyExpectedSnapshot(item.SubjectKind, snapshot) != nil &&
		(snapshot.PutOutcome == "UNKNOWN" || snapshot.NeedsReconciliation || snapshot.State != "READY" || snapshot.StorageVersionID != nil || snapshot.DeleteToken != nil) {
		// A historical Canvas unknown upload is an already-accounted physical
		// risk. Preserve its declared payload and original uncertainty; do not
		// turn a failed read into a FULL observation or a usable alias.
		observed.ReadResult, observed.ByteLength = "DECLARED", &snapshot.ByteLength
		observed.SHA256, observed.MimeType = snapshot.SHA256, snapshot.MimeType
		if snapshot.StorageVersionID != nil {
			observed.VersionEvidence, observed.VersionID = "VERSIONED", *snapshot.StorageVersionID
		}
	}
	observation, err := runner.record(ctx, item, "SOURCE", location, binding.Key, observed, "")
	if err != nil {
		return item, nil, false, err
	}
	if inspectErr != nil && observed.ReadResult != "DECLARED" {
		return item, nil, false, inspectErr
	}
	adopted, err := runner.repository.AdoptObservedImageObject(ctx, ImageHistoryAdoptInput{ItemID: item.ID, Token: runner.token, ObservationID: observation.ID, ExpectedBusinessSnapshotHash: item.SnapshotHash})
	if err != nil {
		current, readErr := runner.repository.GetImageHistoryItem(ctx, ImageHistoryItemInput{ItemID: item.ID})
		if readErr == nil && current != nil && current.Source != nil {
			// The delta's ACK was lost. Omit it instead of inventing a zero; the
			// persisted inventory and quota remain the accounting authority.
			return *current, nil, false, nil
		}
		return item, nil, false, err
	}
	return adopted.Item, &adopted.AccountedDelta, adopted.OverLimit, nil
}

func (runner *imageHistoryRunner) copy(ctx context.Context, item ImageHistoryItem, progress *ImageHistoryItemProgress) (ImageHistoryItem, error) {
	if runner.job.TargetLocationID == nil || item.Source == nil || item.SourceObjectID == nil || item.AssetID == nil {
		return item, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	target, exists := runner.locations[*runner.job.TargetLocationID]
	if !exists || target.ID == item.Source.Object.LocationID {
		return item, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	var err error
	item, err = runner.renew(ctx, item)
	if err != nil {
		return item, err
	}
	lease, err := runner.repository.BeginRead(ctx, ImageReadInput{AssetID: *item.AssetID})
	if err != nil {
		return item, err
	}
	if lease == nil || lease.Image.Object == nil || lease.Image.Location == nil {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	if lease.Image.Object.ID != *item.SourceObjectID {
		// A later explicit retirement job can reuse the verified active copy
		// from an earlier retain-source job. SQL must return that exact target
		// with writeGranted=false; no additional PUT/budget is permitted here.
		if lease.Image.Object.LocationID != target.ID || lease.Image.Object.SHA256 != item.Source.Object.SHA256 || lease.Image.Object.ByteLength != item.Source.Object.ByteLength {
			return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
		}
		prepared, err := runner.repository.PrepareImageMigrationCopy(ctx, ImageHistoryPrepareCopyInput{ItemID: item.ID, Token: runner.token, ExpectedSourceObjectID: *item.SourceObjectID, TargetLocationID: target.ID})
		if err != nil {
			return item, err
		}
		if prepared.Ticket.WriteGranted || prepared.Item.Target == nil || prepared.Ticket.Object.ID != lease.Image.Object.ID || prepared.Item.Target.Object.ID != lease.Image.Object.ID {
			return prepared.Item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
		}
		return prepared.Item, nil
	}
	if lease.Image.Object.LocationID != item.Source.Location.ID {
		return item, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	readCtx, readCancel := historyReadContext(ctx, lease.ReadExpiresAt)
	sourceObject := lease.Image.Object
	content, err := runner.storage.Inspect(readCtx, lease.Image.Location.ImageLocationInput, sourceObject.Key,
		&ImageHistoryExpectedContent{ByteLength: sourceObject.ByteLength, SHA256: sourceObject.SHA256, MimeType: sourceObject.MimeType}, true)
	readCancel()
	if err != nil {
		return item, err
	}
	if int64(len(content.Data)) != sourceObject.ByteLength || content.ReadResult != "FULL" {
		return item, ImageHistoryIOError{Code: "CONTENT_MISMATCH"}
	}
	item, err = runner.renew(ctx, item)
	if err != nil {
		return item, err
	}
	prepared, err := runner.repository.PrepareImageMigrationCopy(ctx, ImageHistoryPrepareCopyInput{ItemID: item.ID, Token: runner.token, ExpectedSourceObjectID: *item.SourceObjectID, TargetLocationID: target.ID})
	if err != nil {
		// If the atomic grant's ACK was lost, readback is the only path. Even
		// a durable WRITING descriptor does not grant this caller a new PUT.
		current, readErr := runner.repository.GetImageHistoryItem(ctx, ImageHistoryItemInput{ItemID: item.ID})
		if readErr == nil && current != nil && current.Target != nil {
			return *current, nil
		}
		return item, err
	}
	item = prepared.Item
	object := prepared.Ticket.Object
	if item.Target == nil || item.TargetObjectID == nil || object.ID != *item.TargetObjectID || object.LocationID != target.ID || object.ByteLength != sourceObject.ByteLength || object.SHA256 != sourceObject.SHA256 || object.MimeType != sourceObject.MimeType {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	if !prepared.Ticket.WriteGranted {
		return item, nil
	}
	writeExpiry, err := time.Parse(time.RFC3339Nano, object.WriteExpiresAt)
	if err != nil || time.Until(writeExpiry) < 5*time.Second {
		return item, ImageStorageError{Code: "IMAGE_RESERVATION_EXPIRED"}
	}
	putCtx, putCancel := historyReadContext(ctx, writeExpiry)
	progress.PutAttempted = true
	versionID, putErr := runner.storage.Put(putCtx, target, object, content.Data)
	putCancel()
	outcome := "CONFIRMED"
	if putErr != nil {
		outcome = "UNKNOWN"
	}
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	receipt, finishErr := runner.repository.FinishObject(finishCtx, ImageFinishObjectInput{ObjectID: object.ID, WriteToken: object.WriteToken, Outcome: outcome, VersionID: versionID})
	finishCancel()
	closeCtx, closeCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	_, closeErr := runner.repository.CloseReservation(closeCtx, ImageCloseReservationInput{ReservationID: prepared.Reservation.ID, Token: prepared.Reservation.Token})
	closeCancel()
	current, readErr := runner.repository.GetImageHistoryItem(ctx, ImageHistoryItemInput{ItemID: item.ID})
	if readErr == nil && current != nil && current.Target != nil {
		item = *current
	} else if finishErr == nil && receipt.Accepted && item.Target != nil {
		item.Target.Object = receipt.Object
		item.Target.Asset = receipt.Asset
	}
	if closeErr != nil {
		return item, closeErr
	}
	if item.Target == nil {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	// A completed local final can be reconciled after a publish/ACK failure;
	// an S3 unknown remains counted and blocked. Neither branch repeats PUT.
	if putErr != nil && target.Provider != "LOCAL" {
		return item, putErr
	}
	if finishErr != nil && item.Target.Object.State != "READY" && target.Provider != "LOCAL" {
		return item, finishErr
	}
	return item, nil
}

func historyReadContext(ctx context.Context, expiry time.Time) (context.Context, context.CancelFunc) {
	deadline := time.Now().Add(time.Duration(ImageReadTimeoutMilliseconds) * time.Millisecond)
	if protected := expiry.Add(-5 * time.Second); protected.Before(deadline) {
		deadline = protected
	}
	return context.WithDeadline(ctx, deadline)
}

func (runner *imageHistoryRunner) verifyAndSwitch(ctx context.Context, item ImageHistoryItem) (ImageHistoryItem, error) {
	if item.Target == nil || item.Source == nil || item.TargetObjectID == nil || item.SourceObjectID == nil || item.AssetID == nil {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	var err error
	item, err = runner.renew(ctx, item)
	if err != nil {
		return item, err
	}
	read, err := runner.repository.PrepareImageCopyReconciliation(ctx, ImageHistoryReconcileInput{ItemID: item.ID, Token: runner.token, ExpectedTargetObjectID: *item.TargetObjectID})
	if err != nil {
		return item, err
	}
	item = read.Item
	if item.Target == nil || item.Source == nil {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	expiry, err := time.Parse(time.RFC3339Nano, read.ReadExpiresAt)
	if err != nil {
		return item, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	readCtx, cancel := historyReadContext(ctx, expiry)
	object, source := item.Target.Object, item.Source.Object
	inspected, inspectErr := runner.storage.Inspect(readCtx, item.Target.Location.ImageLocationInput, object.Key,
		&ImageHistoryExpectedContent{ByteLength: source.ByteLength, SHA256: source.SHA256, MimeType: source.MimeType}, false)
	cancel()
	if inspectErr != nil {
		_, recordErr := runner.record(ctx, item, "TARGET_READBACK", item.Target.Location.ImageLocationInput, object.Key, inspected, "")
		if recordErr != nil {
			return item, recordErr
		}
		return item, inspectErr
	}
	if object.State != "READY" || object.NeedsReconciliation {
		observation, err := runner.record(ctx, item, "WRITE_RECONCILIATION", item.Target.Location.ImageLocationInput, object.Key, inspected, object.WriteToken)
		if err != nil {
			return item, err
		}
		if item.Target.Location.Provider != "LOCAL" || !inspected.LocalFinalImmutable {
			return item, ImageHistoryIOError{Code: "WRITER_OUTCOME_UNKNOWN"}
		}
		reconciled, err := runner.repository.FinishImageCopyReconciliation(ctx, ImageHistoryFinishReconciliationInput{ItemID: item.ID, Token: runner.token, ObservationID: observation.ID, ExpectedOriginalWriteToken: object.WriteToken})
		if err != nil {
			return item, err
		}
		item = reconciled.Item
		if !reconciled.Accepted || item.Target == nil || item.Target.Object.State != "READY" || reconciled.ByteDelta != 0 {
			return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
		}
	}
	if object.ReservationID != "" && object.WriteToken != "" {
		if _, err := runner.repository.CloseReservation(ctx, ImageCloseReservationInput{ReservationID: object.ReservationID, Token: object.WriteToken}); err != nil {
			return item, err
		}
	}
	observation, err := runner.record(ctx, item, "TARGET_READBACK", item.Target.Location.ImageLocationInput, object.Key, inspected, "")
	if err != nil {
		return item, err
	}
	aliases, err := runner.repository.GetImageHistoryAliases(ctx, ImageHistoryAliasesInput{AssetID: *item.AssetID})
	if err != nil {
		return item, err
	}
	if aliases == nil {
		aliases = []string{}
	}
	active := item.Source.Asset.ActiveObjectID
	if active == nil || (*active != *item.SourceObjectID && *active != object.ID) {
		return item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	switched, err := runner.repository.CommitImageMigrationSwitch(ctx, ImageHistorySwitchInput{ItemID: item.ID, Token: runner.token, TargetReadbackObservationID: observation.ID,
		ExpectedActiveObjectID: *active, AliasURLs: aliases, ReaderProtocolRevision: ImageReaderRevision})
	if err != nil {
		current, readErr := runner.repository.GetImageHistoryItem(ctx, ImageHistoryItemInput{ItemID: item.ID})
		if readErr == nil && current != nil && current.ReplicaVerificationID != nil && current.TargetObjectID != nil && *current.TargetObjectID == object.ID {
			return *current, nil
		}
		return item, err
	}
	if !switched.Switched && !switched.Replayed {
		return switched.Item, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	return switched.Item, nil
}

func ImageHistoryErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "IMAGE_HISTORY_INTERRUPTED"
	}
	return imageHistorySafeCode(err)
}
