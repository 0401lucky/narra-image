package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const historyTestJobID = "11111111-1111-4111-8111-111111111111"
const historyTestItemID = "22222222-2222-4222-8222-222222222222"
const historyTestAssetID = "33333333-3333-4333-8333-333333333333"
const historyTestSourceID = "44444444-4444-4444-8444-444444444444"
const historyTestTargetID = "55555555-5555-4555-8555-555555555555"
const historyTestReservationID = "66666666-6666-4666-8666-666666666666"
const historyTestToken = "77777777-7777-4777-8777-777777777777"
const historyTestProofID = "88888888-8888-4888-8888-888888888888"
const historyTestWriteToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type historyRuntimeRepository struct {
	ImageHistoryApplyRepository
	item            ImageHistoryItem
	job             ImageHistoryJob
	reservation     ImageReservation
	targetLocation  ImageLocation
	observations    map[string]ImageObjectObservationInput
	unadoptedSource *ImageHistoryObjectDescriptor
	reuseTarget     *ImageHistoryObjectDescriptor
	usedBytes       int64
	adoptions       int
	prepares        int
	finishes        int
	reconciles      int
	switches        int
	retirements     int
	quotaExceeded   bool
	grantACKLost    bool
	finishACKLost   bool
	switchACKLost   bool
	retireACKLost   bool
	adoptACKLost    bool
	overLimit       bool
	lastBlockCode   string
	beforeFinish    func()
}

func (repo *historyRuntimeRepository) GetImageHistoryItem(context.Context, ImageHistoryItemInput) (*ImageHistoryItem, error) {
	item := repo.item
	return &item, nil
}
func (repo *historyRuntimeRepository) GetImageHistoryJob(context.Context, ImageHistoryJobInput) (*ImageHistoryJob, error) {
	job := repo.job
	return &job, nil
}
func (repo *historyRuntimeRepository) ClaimImageHistoryItem(_ context.Context, input ImageHistoryClaimInput) (*ImageHistoryItem, error) {
	if input.JobID != repo.item.JobID || (input.ItemID != "" && input.ItemID != repo.item.ID) {
		return nil, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	repo.item.Token = &input.Token
	expiry := time.Now().Add(90 * time.Second).UTC().Format(time.RFC3339Nano)
	repo.item.LeaseExpiresAt = &expiry
	item := repo.item
	return &item, nil
}
func (repo *historyRuntimeRepository) BlockImageHistoryItem(_ context.Context, input ImageHistoryBlockInput) (ImageHistoryItem, error) {
	repo.lastBlockCode = input.ErrorCode
	repo.item.State, repo.item.ErrorCode = "BLOCKED", &input.ErrorCode
	return repo.item, nil
}
func (repo *historyRuntimeRepository) BeginRead(context.Context, ImageReadInput) (*ImageReadLease, error) {
	source := repo.item.Source
	if source == nil {
		return nil, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	active := source
	if repo.item.Target != nil && source.Asset.ActiveObjectID != nil && *source.Asset.ActiveObjectID == repo.item.Target.Object.ID {
		active = repo.item.Target
	} else if repo.reuseTarget != nil && source.Asset.ActiveObjectID != nil && *source.Asset.ActiveObjectID == repo.reuseTarget.Object.ID {
		active = repo.reuseTarget
	}
	return &ImageReadLease{Image: ManagedImage{Asset: active.Asset, Object: &active.Object, Location: &active.Location}, ReadExpiresAt: time.Now().Add(45 * time.Second)}, nil
}
func (repo *historyRuntimeRepository) PrepareImageMigrationCopy(_ context.Context, input ImageHistoryPrepareCopyInput) (ImageHistoryPrepareCopyResult, error) {
	repo.prepares++
	if repo.quotaExceeded {
		return ImageHistoryPrepareCopyResult{}, ImageStorageError{Code: "IMAGE_QUOTA_EXCEEDED"}
	}
	if repo.item.Target != nil {
		return ImageHistoryPrepareCopyResult{Item: repo.item, Reservation: repo.reservation, Ticket: ImageWriteTicket{Asset: repo.item.Target.Asset, Object: repo.item.Target.Object}}, nil
	}
	if repo.reuseTarget != nil {
		repo.item.Target, repo.item.TargetObjectID, repo.item.ReservationID = repo.reuseTarget, &repo.reuseTarget.Object.ID, &repo.reservation.ID
		return ImageHistoryPrepareCopyResult{Item: repo.item, Reservation: repo.reservation, Ticket: ImageWriteTicket{Asset: repo.item.Target.Asset, Object: repo.item.Target.Object}}, nil
	}
	source := repo.item.Source
	if source == nil || input.ExpectedSourceObjectID != source.Object.ID || input.TargetLocationID != repo.targetLocation.ID {
		return ImageHistoryPrepareCopyResult{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	targetObject := ImageObjectRecord{ID: historyTestTargetID, AssetID: source.Asset.ID, Provenance: "WRITE", ReservationID: repo.reservation.ID,
		LocationID: repo.targetLocation.ID, PhysicalNamespace: repo.targetLocation.PhysicalNamespace, Key: "images/migration.png",
		ByteLength: source.Object.ByteLength, SHA256: source.Object.SHA256, MimeType: source.Object.MimeType,
		State: "WRITING", PutOutcome: "NOT_STARTED", WriteToken: repo.reservation.Token, WriteExpiresAt: repo.reservation.LeaseExpiresAt, Accounted: true}
	repo.item.Target = &ImageHistoryObjectDescriptor{Asset: source.Asset, Object: targetObject, Location: repo.targetLocation}
	repo.item.TargetObjectID, repo.item.ReservationID, repo.item.TargetKey = &targetObject.ID, &repo.reservation.ID, &targetObject.Key
	repo.item.Attempt, repo.item.State = 1, "COPYING"
	repo.usedBytes += targetObject.ByteLength
	result := ImageHistoryPrepareCopyResult{Item: repo.item, Reservation: repo.reservation, Ticket: ImageWriteTicket{Asset: source.Asset, Object: targetObject, WriteGranted: true}}
	if repo.grantACKLost {
		return ImageHistoryPrepareCopyResult{}, errors.New("simulated grant ACK loss")
	}
	return result, nil
}
func (repo *historyRuntimeRepository) FinishObject(_ context.Context, input ImageFinishObjectInput) (ImageObjectReceipt, error) {
	repo.finishes++
	if repo.beforeFinish != nil {
		repo.beforeFinish()
	}
	object := &repo.item.Target.Object
	if input.ObjectID != object.ID || input.WriteToken != object.WriteToken {
		return ImageObjectReceipt{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	if input.Outcome == "CONFIRMED" {
		object.State, object.PutOutcome = "READY", "CONFIRMED"
	} else {
		object.State, object.PutOutcome, object.NeedsReconciliation = "UNKNOWN", "UNKNOWN", true
	}
	receipt := ImageObjectReceipt{Asset: repo.item.Target.Asset, Object: *object, Accepted: true}
	if repo.finishACKLost {
		return ImageObjectReceipt{}, errors.New("simulated finish ACK loss")
	}
	return receipt, nil
}
func (repo *historyRuntimeRepository) CloseReservation(_ context.Context, input ImageCloseReservationInput) (bool, error) {
	if input.ReservationID != repo.reservation.ID || input.Token != repo.reservation.Token {
		return false, ImageStorageError{Code: "IMAGE_RESERVATION_CONFLICT"}
	}
	repo.reservation.State = "CLOSED"
	return true, nil
}
func (repo *historyRuntimeRepository) PrepareImageCopyReconciliation(_ context.Context, input ImageHistoryReconcileInput) (ImageHistoryReconcileRead, error) {
	if repo.item.Target == nil || repo.item.Target.Object.ID != input.ExpectedTargetObjectID {
		return ImageHistoryReconcileRead{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	return ImageHistoryReconcileRead{Item: repo.item, ReadExpiresAt: time.Now().Add(45 * time.Second).UTC().Format(time.RFC3339Nano)}, nil
}
func (repo *historyRuntimeRepository) RecordImageObjectObservation(_ context.Context, input ImageObjectObservationInput) (ImageObjectObservationResult, error) {
	id, _ := newImageMaintenanceToken()
	repo.observations[id] = input
	return ImageObjectObservationResult{ID: id}, nil
}
func (repo *historyRuntimeRepository) AdoptObservedImageObject(_ context.Context, input ImageHistoryAdoptInput) (ImageHistoryAdoptResult, error) {
	observation := repo.observations[input.ObservationID]
	if repo.unadoptedSource == nil || observation.Kind != "SOURCE" || observation.ReadResult != "FULL" || observation.VersionEvidence != "UNVERSIONED" || observation.SHA256 != repo.unadoptedSource.Object.SHA256 || observation.ByteLength != repo.unadoptedSource.Object.ByteLength || input.ExpectedBusinessSnapshotHash != repo.item.SnapshotHash {
		return ImageHistoryAdoptResult{}, ImageStorageError{Code: "IMAGE_REFERENCE_CONFLICT"}
	}
	repo.adoptions++
	delta := int64(0)
	if repo.item.Source == nil {
		delta = repo.unadoptedSource.Object.ByteLength
		repo.usedBytes += delta
	}
	repo.item.Source, repo.item.SourceObjectID, repo.item.AssetID, repo.item.SourceObservationID = repo.unadoptedSource, &repo.unadoptedSource.Object.ID, &repo.unadoptedSource.Asset.ID, &input.ObservationID
	repo.item.State = "ADOPTED"
	if repo.job.Mode == "ADOPT" {
		repo.item.State = "SOURCE_RETAINED"
	}
	result := ImageHistoryAdoptResult{Item: repo.item, AccountedDelta: delta, OverLimit: repo.overLimit}
	if repo.adoptACKLost {
		return ImageHistoryAdoptResult{}, errors.New("simulated adoption ACK loss")
	}
	return result, nil
}
func (repo *historyRuntimeRepository) FinishImageCopyReconciliation(_ context.Context, input ImageHistoryFinishReconciliationInput) (ImageHistoryFinishReconciliationResult, error) {
	repo.reconciles++
	observation := repo.observations[input.ObservationID]
	object := &repo.item.Target.Object
	if observation.Kind != "WRITE_RECONCILIATION" || observation.WriterEvidence != "QUIESCED" || observation.WriterProofSHA256 == "" || observation.OriginalWriteToken != input.ExpectedOriginalWriteToken || observation.ReadResult != "FULL" || observation.SHA256 != object.SHA256 || observation.ByteLength != object.ByteLength || observation.VersionEvidence != "UNVERSIONED" {
		return ImageHistoryFinishReconciliationResult{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	object.State, object.NeedsReconciliation = "READY", false
	object.ReconciliationObservationID = &input.ObservationID
	return ImageHistoryFinishReconciliationResult{Accepted: true, State: "READY", Item: repo.item}, nil
}
func (repo *historyRuntimeRepository) GetImageHistoryAliases(context.Context, ImageHistoryAliasesInput) ([]string, error) {
	return []string{"https://public.invalid/images/old.png?original=exact", "https://app.invalid/media/images/opaque"}, nil
}
func (repo *historyRuntimeRepository) CommitImageMigrationSwitch(_ context.Context, input ImageHistorySwitchInput) (ImageHistorySwitchResult, error) {
	observation := repo.observations[input.TargetReadbackObservationID]
	if observation.Kind != "TARGET_READBACK" || observation.ReadResult != "FULL" || observation.SHA256 != repo.item.Source.Object.SHA256 || observation.ByteLength != repo.item.Source.Object.ByteLength || observation.VersionEvidence != "UNVERSIONED" || len(input.AliasURLs) != 2 || input.AliasURLs[0] != "https://public.invalid/images/old.png?original=exact" || !ImageObjectVerified(repo.item.Target.Object) || input.ExpectedActiveObjectID != *repo.item.Source.Asset.ActiveObjectID {
		return ImageHistorySwitchResult{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	repo.switches++
	repo.item.Source.Asset.ActiveObjectID = repo.item.TargetObjectID
	repo.item.Target.Asset.ActiveObjectID = repo.item.TargetObjectID
	proof := historyTestProofID
	repo.item.ReplicaVerificationID, repo.item.State = &proof, "SOURCE_RETAINED"
	result := ImageHistorySwitchResult{Switched: true, ReplicaVerificationID: proof, Item: repo.item}
	if repo.switchACKLost {
		return ImageHistorySwitchResult{}, errors.New("simulated switch ACK loss")
	}
	return result, nil
}
func (repo *historyRuntimeRepository) RequestImageHistorySourceRetirement(context.Context, ImageHistoryRetireInput) (ImageHistoryRetireResult, error) {
	if !repo.job.RetireSource || repo.item.ReplicaVerificationID == nil {
		return ImageHistoryRetireResult{}, ImageStorageError{Code: "IMAGE_WRITE_CONFLICT"}
	}
	if repo.item.RetirementJobID == nil {
		repo.retirements++
		id := "99999999-9999-4999-8999-999999999999"
		repo.item.RetirementJobID = &id
	}
	repo.item.State = "RETIREMENT_REQUESTED"
	result := ImageHistoryRetireResult{Item: repo.item, Job: ImageMaintenanceJob{ID: *repo.item.RetirementJobID, Mode: "SOURCE_RETIREMENT", State: "QUEUED"}}
	if repo.retireACKLost {
		return ImageHistoryRetireResult{}, errors.New("simulated retirement ACK loss")
	}
	return result, nil
}

type historyRuntimeIO struct {
	ImageHistoryApplyIO
	puts             int
	afterPublication error
	putOverride      func(context.Context, ImageLocationInput, ImageObjectRecord, []byte) (string, error)
}

func (storage *historyRuntimeIO) Put(ctx context.Context, location ImageLocationInput, object ImageObjectRecord, data []byte) (string, error) {
	storage.puts++
	if storage.putOverride != nil {
		return storage.putOverride(ctx, location, object, data)
	}
	version, err := storage.ImageHistoryApplyIO.Put(ctx, location, object, data)
	if err == nil && storage.afterPublication != nil {
		return version, storage.afterPublication
	}
	return version, err
}

func historyRuntimeFixture(t *testing.T) (*imageHistoryRunner, *historyRuntimeRepository, *historyRuntimeIO, LocalImageStoreConfig, *imageHistoryS3Fixture) {
	t.Helper()
	sourceFixture, sourceLocation, cfg := newImageHistoryS3Fixture(t)
	_, localCfg := localImageFixture(t)
	targetLocation, _ := NewImageLocalLocation(localCfg.VolumeID)
	cfg.ImageStoragePath, cfg.ImageStorageVolumeID = localCfg.RootDirectory, localCfg.VolumeID
	writer, err := NewImageHistoryWriter(cfg, []ImageLocationInput{sourceLocation, targetLocation})
	if err != nil {
		t.Fatal(err)
	}
	sourceID, assetID, itemID, jobID, token, observationID := historyTestSourceID, historyTestAssetID, historyTestItemID, historyTestJobID, historyTestToken, historyTestProofID
	expected := imageHistoryExpected(sourceFixture.data)
	asset := ImageAssetRecord{ID: assetID, OwnerID: "original-owner", Purpose: "GENERATED", PublicToken: strings.Repeat("a", 64), ByteLength: expected.ByteLength,
		SHA256: expected.SHA256, MimeType: expected.MimeType, State: "AVAILABLE", ActiveObjectID: &sourceID}
	object := ImageObjectRecord{ID: sourceID, AssetID: assetID, Provenance: "OBSERVED", SourceObservationID: &observationID, LocationID: sourceLocation.ID,
		PhysicalNamespace: "fixture-s3-namespace", Key: "images/source.png", ByteLength: expected.ByteLength, SHA256: expected.SHA256, MimeType: expected.MimeType,
		State: "READY", PutOutcome: "NOT_APPLICABLE", Accounted: true}
	owner := asset.OwnerID
	item := ImageHistoryItem{ID: itemID, JobID: jobID, SubjectKind: "GENERATED", SubjectID: "old-generation", OwnerID: &owner, State: "ADOPTED", Token: &token,
		Snapshot: json.RawMessage(`{"id":"old-generation","ownerId":"original-owner","storageKey":"images/source.png"}`), SnapshotHash: strings.Repeat("b", 64),
		AssetID: &assetID, SourceObjectID: &sourceID, SourceObservationID: &observationID,
		Source: &ImageHistoryObjectDescriptor{Asset: asset, Object: object, Location: ImageLocation{ImageLocationInput: sourceLocation, PhysicalNamespace: object.PhysicalNamespace}}}
	job := ImageHistoryJob{ID: jobID, Mode: "COPY", Scope: "GENERATED", TargetLocationID: &targetLocation.ID}
	repo := &historyRuntimeRepository{item: item, job: job, observations: make(map[string]ImageObjectObservationInput), usedBytes: expected.ByteLength,
		targetLocation: ImageLocation{ImageLocationInput: targetLocation, PhysicalNamespace: targetLocation.ID},
		reservation:    ImageReservation{ID: historyTestReservationID, Token: historyTestWriteToken, OwnerID: owner, State: "ACTIVE", Kind: "COPY", LeaseExpiresAt: time.Now().Add(20 * time.Minute).UTC().Format(time.RFC3339Nano)}}
	storage := &historyRuntimeIO{ImageHistoryApplyIO: writer}
	runner := &imageHistoryRunner{repository: repo, storage: storage, job: job, token: token, workerID: "isolated-history-test",
		locations: map[string]ImageLocationInput{sourceLocation.ID: sourceLocation, targetLocation.ID: targetLocation}}
	return runner, repo, storage, localCfg, sourceFixture
}

func assertHistorySourcePreserved(t *testing.T, repo *historyRuntimeRepository, fixture *imageHistoryS3Fixture) {
	t.Helper()
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.puts != 0 || fixture.deletes != 0 || repo.item.Source.Object.State != "READY" || !repo.item.Source.Object.Accounted {
		t.Fatal("migration mutated/unaccounted the source")
	}
}

func TestImageHistoryCopyRetainsSourceAndReplayNeverPutsAgain(t *testing.T) {
	runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
	result := runner.process(context.Background(), repo.item)
	if result.State != "SOURCE_RETAINED" || result.Code != "" || storage.puts != 1 || repo.prepares != 1 || repo.switches != 1 || repo.usedBytes != 2*repo.item.Source.Object.ByteLength {
		t.Fatalf("migration did not complete once: result=%+v puts=%d prepares=%d switches=%d bytes=%d", result, storage.puts, repo.prepares, repo.switches, repo.usedBytes)
	}
	local, err := NewLocalImageStore(localCfg)
	if err != nil {
		t.Fatal(err)
	}
	got, err := local.Read(context.Background(), LocalImageObject{Key: repo.item.Target.Object.Key, ByteLength: repo.item.Target.Object.ByteLength, SHA256: repo.item.Target.Object.SHA256})
	if err != nil || !bytes.Equal(got, source.data) {
		t.Fatalf("persisted copy mismatch: %v", err)
	}
	for range 2 {
		_ = runner.process(context.Background(), repo.item)
	}
	if storage.puts != 1 || repo.prepares != 1 || repo.usedBytes != 2*repo.item.Source.Object.ByteLength || repo.retirements != 0 {
		t.Fatal("retained-source replay repeated PUT/accounting or requested deletion")
	}
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryRecoversReadyAndSwitchAcknowledgementLoss(t *testing.T) {
	for _, boundary := range []string{"ready-ack", "switch-ack"} {
		t.Run(boundary, func(t *testing.T) {
			runner, repo, storage, _, source := historyRuntimeFixture(t)
			repo.finishACKLost, repo.switchACKLost = boundary == "ready-ack", boundary == "switch-ack"
			result := runner.process(context.Background(), repo.item)
			if result.Code != "" || result.State != "SOURCE_RETAINED" || storage.puts != 1 || repo.switches != 1 {
				t.Fatalf("lost ACK caused failure or second IO: %+v", result)
			}
			_ = runner.process(context.Background(), repo.item)
			if storage.puts != 1 || repo.switches != 1 {
				t.Fatal("replay did not retain exact original target")
			}
			assertHistorySourcePreserved(t, repo, source)
		})
	}
}

func TestImageHistoryGrantAckLossAndMissingTargetNeverReauthorizePut(t *testing.T) {
	runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
	repo.grantACKLost = true
	for range 2 {
		result := runner.process(context.Background(), repo.item)
		if result.State != "BLOCKED" || result.Code != "SOURCE_MISSING" {
			t.Fatalf("missing unknown write was not blocked: %+v", result)
		}
	}
	if storage.puts != 0 || repo.prepares != 1 || repo.usedBytes != 2*repo.item.Source.Object.ByteLength || repo.item.Target.Object.State != "WRITING" {
		t.Fatal("missing grant replay repeated PUT or freed unknown bytes")
	}
	assertLocalImageFiles(t, localCfg.RootDirectory, 1)
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryReconcilesImmutableLocalPublicationWithoutErasingUnknown(t *testing.T) {
	runner, repo, storage, _, source := historyRuntimeFixture(t)
	storage.afterPublication = errors.New("simulated crash after hardlink publication")
	result := runner.process(context.Background(), repo.item)
	if result.Code != "" || result.State != "SOURCE_RETAINED" || storage.puts != 1 || repo.reconciles != 1 || repo.item.Target.Object.PutOutcome != "UNKNOWN" || repo.item.Target.Object.ReconciliationObservationID == nil || repo.usedBytes != 2*repo.item.Source.Object.ByteLength {
		t.Fatalf("local positive recovery lost evidence/accounting: %+v target=%+v", result, repo.item.Target.Object)
	}
	if repo.item.Target.Object.WriteToken != historyTestWriteToken || repo.item.Target.Object.WriteExpiresAt != repo.reservation.LeaseExpiresAt {
		t.Fatal("reconciliation replaced original writer identity or expiry")
	}
	_ = runner.process(context.Background(), repo.item)
	if storage.puts != 1 {
		t.Fatal("positive recovery re-PUT target")
	}
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryWrongTargetAndStaleStagingKeepSourceActiveAndCounted(t *testing.T) {
	for _, fault := range []string{"content", "staging"} {
		t.Run(fault, func(t *testing.T) {
			runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
			if fault == "content" {
				repo.beforeFinish = func() {
					name, _, _ := LocalImageObjectNames(repo.item.Target.Object.Key)
					wrong := bytes.Clone(source.data)
					wrong[len(wrong)-1] ^= 1
					if err := os.WriteFile(filepath.Join(localCfg.RootDirectory, name), wrong, 0o600); err != nil {
						t.Fatal(err)
					}
				}
			} else {
				storage.putOverride = func(_ context.Context, _ ImageLocationInput, object ImageObjectRecord, _ []byte) (string, error) {
					_, staging, _ := LocalImageObjectNames(object.Key)
					if err := os.WriteFile(filepath.Join(localCfg.RootDirectory, staging), []byte("incomplete"), 0o600); err != nil {
						t.Fatal(err)
					}
					return "", errors.New("simulated stopped staging writer")
				}
			}
			for range 2 {
				result := runner.process(context.Background(), repo.item)
				if result.State != "BLOCKED" || result.Code == "" {
					t.Fatalf("bad target was published: %+v", result)
				}
			}
			if storage.puts != 1 || repo.switches != 0 || *repo.item.Source.Asset.ActiveObjectID != historyTestSourceID || repo.usedBytes != 2*repo.item.Source.Object.ByteLength {
				t.Fatal("bad target was retried, activated, or undercounted")
			}
			assertLocalImageFiles(t, localCfg.RootDirectory, 2)
			assertHistorySourcePreserved(t, repo, source)
		})
	}
}

func TestImageHistoryQuotaFailureDoesNotCreateTargetOrPut(t *testing.T) {
	runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
	repo.quotaExceeded = true
	result := runner.process(context.Background(), repo.item)
	if result.State != "BLOCKED" || result.Code != "IMAGE_QUOTA_EXCEEDED" || repo.item.Target != nil || storage.puts != 0 || repo.usedBytes != repo.item.Source.Object.ByteLength {
		t.Fatalf("copy bypassed capacity gate: %+v", result)
	}
	assertLocalImageFiles(t, localCfg.RootDirectory, 1)
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryExplicitRetirementOnlyQueuesSameC2Job(t *testing.T) {
	runner, repo, storage, cfg, source := historyRuntimeFixture(t)
	reader := historyRuntimePublishedReader(t, runner, repo, cfg)
	runner.job.RetireSource, repo.job.RetireSource, repo.retireACKLost = true, true, true
	result := runner.process(context.Background(), repo.item)
	if result.Code != "" || result.State != "RETIREMENT_REQUESTED" || result.RetirementJobID == nil || repo.retirements != 1 || !result.ReaderVerified || reader.hits.Load() != 1 {
		t.Fatalf("retirement ACK recovery failed: %+v", result)
	}
	_ = runner.process(context.Background(), repo.item)
	if repo.retirements != 1 || storage.puts != 1 || repo.usedBytes != 2*repo.item.Source.Object.ByteLength {
		t.Fatal("retirement request performed/double-counted actual deletion")
	}
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryFullS3ReadbackCannotReconcileAnUnknownWriter(t *testing.T) {
	runner, repo, storage, _, source := historyRuntimeFixture(t)
	targetFixture, targetLocation, cfg := newImageHistoryS3Fixture(t)
	writer, err := NewImageHistoryWriter(cfg, []ImageLocationInput{repo.item.Source.Location.ImageLocationInput, targetLocation})
	if err != nil {
		t.Fatal(err)
	}
	storage.ImageHistoryApplyIO = writer
	runner.locations[targetLocation.ID] = targetLocation
	runner.job.TargetLocationID = &targetLocation.ID
	object := repo.item.Source.Object
	object.ID, object.Provenance, object.SourceObservationID = historyTestTargetID, "WRITE", nil
	object.LocationID, object.ReservationID, object.WriteToken, object.WriteExpiresAt = targetLocation.ID, repo.reservation.ID, repo.reservation.Token, repo.reservation.LeaseExpiresAt
	object.State, object.PutOutcome, object.NeedsReconciliation = "UNKNOWN", "UNKNOWN", true
	repo.item.Target = &ImageHistoryObjectDescriptor{Asset: repo.item.Source.Asset, Object: object, Location: ImageLocation{ImageLocationInput: targetLocation, PhysicalNamespace: "target-namespace"}}
	repo.item.TargetObjectID, repo.item.State = &object.ID, "BLOCKED"
	repo.usedBytes += object.ByteLength
	result := runner.process(context.Background(), repo.item)
	if result.State != "BLOCKED" || result.Code != "WRITER_OUTCOME_UNKNOWN" || repo.reconciles != 0 || repo.switches != 0 || storage.puts != 0 || repo.item.Target.Object.PutOutcome != "UNKNOWN" {
		t.Fatalf("S3 GET incorrectly proved writer termination: %+v", result)
	}
	targetFixture.mu.Lock()
	if targetFixture.puts != 0 || targetFixture.deletes != 0 || targetFixture.gets != 1 {
		t.Error("S3 recovery performed a mutation or skipped real readback")
	}
	targetFixture.mu.Unlock()
	assertHistorySourcePreserved(t, repo, source)
}

func TestImageHistoryObservedAdoptionDoesNotReserveOrPutAndRecoversAck(t *testing.T) {
	for _, lostACK := range []bool{false, true} {
		t.Run(map[bool]string{false: "observed-overquota", true: "adopt-ack-loss"}[lostACK], func(t *testing.T) {
			runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
			repo.unadoptedSource = repo.item.Source
			repo.item.Source, repo.item.SourceObjectID, repo.item.AssetID, repo.item.SourceObservationID = nil, nil, nil, nil
			repo.item.State, repo.usedBytes, repo.overLimit, repo.adoptACKLost = "PENDING", 0, true, lostACK
			runner.job.Mode, repo.job.Mode = "ADOPT", "ADOPT"
			location := repo.unadoptedSource.Location
			snapshot, _ := json.Marshal(map[string]any{"id": repo.item.SubjectID, "ownerId": *repo.item.OwnerID, "url": location.Endpoint + "/" + location.Bucket + "/images/source.png", "storageKey": "images/source.png", "mediaAssetId": nil})
			repo.item.Snapshot = snapshot
			repo.item.SourceBinding = &ImageHistorySourceBinding{SubjectKind: repo.item.SubjectKind, SubjectID: repo.item.SubjectID, OwnerID: *repo.item.OwnerID,
				ExpectedSnapshotHash: repo.item.SnapshotHash, LocationID: location.ID, Key: "images/source.png"}
			result := runner.process(context.Background(), repo.item)
			if result.State != "SOURCE_RETAINED" || result.Code != "" || repo.usedBytes != int64(len(source.data)) || storage.puts != 0 || repo.prepares != 0 || repo.finishes != 0 || !bytes.Equal(repo.item.Snapshot, snapshot) {
				t.Fatalf("observed source was treated as a new write or lost its snapshot: %+v", result)
			}
			if lostACK && result.AccountedDelta != nil {
				t.Fatal("lost accounting ACK was reported as a known delta")
			}
			if !lostACK && (!result.OverLimit || result.AccountedDelta == nil || *result.AccountedDelta != int64(len(source.data))) {
				t.Fatal("preexisting overquota bytes were hidden")
			}
			_ = runner.process(context.Background(), repo.item)
			if repo.adoptions != 1 || repo.usedBytes != int64(len(source.data)) {
				t.Fatal("adoption replay double-counted physical source")
			}
			assertLocalImageFiles(t, localCfg.RootDirectory, 1)
			assertHistorySourcePreserved(t, repo, source)
		})
	}
}

func TestImageHistoryBindingConflictPersistsSupportedBlockCodeBeforeIO(t *testing.T) {
	runner, repo, storage, _, source := historyRuntimeFixture(t)
	repo.unadoptedSource = repo.item.Source
	repo.item.Source, repo.item.SourceObjectID, repo.item.AssetID = nil, nil, nil
	repo.item.State = "PENDING"
	repo.item.SourceBinding = &ImageHistorySourceBinding{SubjectKind: repo.item.SubjectKind, SubjectID: repo.item.SubjectID,
		OwnerID: *repo.item.OwnerID, LocationID: repo.unadoptedSource.Location.ID, Key: repo.unadoptedSource.Object.Key, ExpectedSnapshotHash: strings.Repeat("f", 64)}
	result := runner.process(context.Background(), repo.item)
	if result.State != "BLOCKED" || !result.StateAcknowledged || result.Code != "IMAGE_REFERENCE_CONFLICT" || repo.lastBlockCode != "IMAGE_STORAGE_UNAVAILABLE" || storage.puts != 0 {
		t.Fatalf("safe binding failure was not persisted through block allowlist: %+v durable=%s", result, repo.lastBlockCode)
	}
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.heads != 0 || source.gets != 0 {
		t.Fatal("invalid binding performed source IO")
	}
}

func TestImageHistoryLaterRetirementReusesExistingTargetWithFreshReadback(t *testing.T) {
	runner, repo, storage, localCfg, source := historyRuntimeFixture(t)
	reader := historyRuntimePublishedReader(t, runner, repo, localCfg)
	first := runner.process(context.Background(), repo.item)
	if first.State != "SOURCE_RETAINED" || first.Code != "" {
		t.Fatalf("initial retain migration failed: %+v", first)
	}
	if reader.hits.Load() != 0 {
		t.Fatal("copy/retain depended on public reader connectivity")
	}
	repo.reuseTarget = repo.item.Target
	name, _, _ := LocalImageObjectNames(repo.reuseTarget.Object.Key)
	before, err := os.Stat(filepath.Join(localCfg.RootDirectory, name))
	if err != nil {
		t.Fatal(err)
	}
	repo.item.Target, repo.item.TargetObjectID, repo.item.ReplicaVerificationID = nil, nil, nil
	repo.item.State = "ADOPTED"
	repo.item.JobID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	repo.item.ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	repo.job.ID, runner.job.ID = repo.item.JobID, repo.item.JobID
	repo.job.RetireSource, runner.job.RetireSource = true, true
	result := runner.process(context.Background(), repo.item)
	if result.State != "RETIREMENT_REQUESTED" || result.Code != "" || !result.ReaderVerified || reader.hits.Load() != 1 || storage.puts != 1 || repo.prepares != 2 || repo.switches != 2 || repo.retirements != 1 || repo.usedBytes != 2*int64(len(source.data)) {
		t.Fatalf("later retirement allocated another replica or skipped proof: %+v puts=%d prepares=%d", result, storage.puts, repo.prepares)
	}
	after, err := os.Stat(filepath.Join(localCfg.RootDirectory, name))
	if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("existing active target was overwritten")
	}
	assertHistorySourcePreserved(t, repo, source)
}
