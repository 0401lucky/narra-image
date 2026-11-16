package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type historyPlanScanner struct {
	pages  []ImageHistoryScanPage
	inputs []ImageHistoryScanInput
}

func (scanner *historyPlanScanner) ScanImageHistory(_ context.Context, input ImageHistoryScanInput) (ImageHistoryScanPage, error) {
	scanner.inputs = append(scanner.inputs, input)
	if len(scanner.pages) == 0 {
		return ImageHistoryScanPage{}, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	page := scanner.pages[0]
	scanner.pages = scanner.pages[1:]
	return page, nil
}

type historyPlanInspector struct {
	data      []byte
	inspected int
	verified  int
}

func (inspector *historyPlanInspector) Verify(context.Context, ImageLocationInput) error {
	inspector.verified++
	return nil
}
func (inspector *historyPlanInspector) Inspect(ctx context.Context, _ ImageLocationInput, _ string, expected *ImageHistoryExpectedContent, keep bool) (ImageHistoryInspection, error) {
	inspector.inspected++
	result, err := readImageHistoryContent(ctx, bytes.NewReader(inspector.data), int64(len(inspector.data)), expected, keep)
	result.VersionEvidence = "UNVERSIONED"
	return result, err
}

func TestImageHistoryPlanStablePagesVisibleExclusionsAndNoImplicitSourceReads(t *testing.T) {
	classes := []string{"SOURCE_BINDING_REQUIRED", "ALREADY_MANAGED", "DATA_URL", "THIRD_PARTY_OR_UNKNOWN", "CANVAS_UNCERTAIN", "VIDEO_EXCLUDED"}
	owner := "known-owner"
	candidates := make([]ImageHistoryCandidate, 0, len(classes))
	for index, classification := range classes {
		candidates = append(candidates, ImageHistoryCandidate{SubjectKind: "GENERATED", SubjectID: "subject-" + string(rune('a'+index)), OwnerID: &owner,
			SnapshotHash: strings.Repeat("a", 64), Snapshot: json.RawMessage(`{"storageKey":"images/source.png"}`), Classification: classification})
	}
	cursor1, cursor2 := "opaque-page-one", "opaque-page-two"
	upperBound := "2026-11-15T00:00:00Z"
	scanner := &historyPlanScanner{pages: []ImageHistoryScanPage{
		{Candidates: candidates[:2], NextCursor: &cursor1, UpperBound: upperBound},
		{Candidates: candidates[2:4], NextCursor: &cursor2, UpperBound: upperBound},
		{Candidates: candidates[4:], UpperBound: upperBound},
	}}
	inspector := &historyPlanInspector{data: imageHistoryPNG(t)}
	manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: []ImageLocationInput{}, Bindings: []ImageHistorySourceBinding{}}
	plan, err := BuildImageHistoryPlan(context.Background(), scanner, inspector, manifest, ImageHistoryPlanOptions{Limit: 6})
	if err != nil || plan.Scanned != 6 || !plan.ScanComplete || plan.NextCursor != nil || inspector.inspected != 0 || inspector.verified != 0 || plan.VerifiedSourceBytes != 0 {
		t.Fatalf("unbound inventory inferred ownership or lost rows: %+v %v", plan, err)
	}
	for _, classification := range classes {
		if plan.Classifications[classification] != 1 {
			t.Fatalf("excluded/unknown class hidden: %s %+v", classification, plan.Classifications)
		}
	}
	if len(scanner.inputs) != 3 || scanner.inputs[1].Cursor != cursor1 || scanner.inputs[2].Cursor != cursor2 || scanner.inputs[1].UpperBound != upperBound || scanner.inputs[2].UpperBound != upperBound || scanner.inputs[2].Limit != 2 {
		t.Fatalf("pagination lost fixed source boundary: %+v", scanner.inputs)
	}
}

func TestImageHistoryPlanBindingMustMatchOriginalSnapshotOwnerAndCanvasTuple(t *testing.T) {
	location, _ := NewImageS3Location("https://objects.invalid", "auto", "history", "https://public.invalid")
	owner, hash := "known-owner", strings.Repeat("a", 64)
	snapshot, _ := json.Marshal(map[string]any{"id": "canvas-original", "ownerId": owner, "sourceProvider": "S3", "storageLocation": location.ID,
		"storageEndpoint": location.Endpoint, "storageRegion": location.Region, "storageBucket": location.Bucket, "storageKey": "images/source.png"})
	candidate := ImageHistoryCandidate{SubjectKind: "CANVAS_IMPORT", SubjectID: "canvas-original", OwnerID: &owner, SnapshotHash: hash, Snapshot: snapshot, Classification: "SOURCE_BINDING_REQUIRED"}
	for _, conflict := range []string{"owner", "snapshot", "key", "location"} {
		t.Run(conflict, func(t *testing.T) {
			binding := ImageHistorySourceBinding{SubjectKind: candidate.SubjectKind, SubjectID: candidate.SubjectID, ExpectedSnapshotHash: hash, LocationID: location.ID, Key: "images/source.png", OwnerID: owner}
			locations := []ImageLocationInput{location}
			switch conflict {
			case "owner":
				binding.OwnerID = "another-owner"
			case "snapshot":
				binding.ExpectedSnapshotHash = strings.Repeat("b", 64)
			case "key":
				binding.Key = "images/other.png"
			case "location":
				other, _ := NewImageS3Location("https://other.invalid", "auto", "history", "")
				locations = append(locations, other)
				binding.LocationID = other.ID
			}
			manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: locations, Bindings: []ImageHistorySourceBinding{binding}}
			scanner := &historyPlanScanner{pages: []ImageHistoryScanPage{{Candidates: []ImageHistoryCandidate{candidate}, UpperBound: "2026-11-15T00:00:00Z"}}}
			inspector := &historyPlanInspector{data: imageHistoryPNG(t)}
			plan, err := BuildImageHistoryPlan(context.Background(), scanner, inspector, manifest, ImageHistoryPlanOptions{})
			if err != nil || len(plan.Items) != 1 || plan.Items[0].Code == "" || inspector.inspected != 0 {
				t.Fatalf("incompatible binding reached storage: %+v %v", plan, err)
			}
		})
	}
}

func TestImageHistoryPlanCountsSamePhysicalObjectOnceAndEncodesBytesAsStrings(t *testing.T) {
	location, _ := NewImageS3Location("https://objects.invalid", "auto", "history", "https://public.invalid")
	regionAlias, _ := NewImageS3Location("https://objects.invalid", "us-east-1", "history", "https://public.invalid")
	owner, hash := "known-owner", strings.Repeat("a", 64)
	manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: []ImageLocationInput{location, regionAlias}, Bindings: []ImageHistorySourceBinding{
		{SubjectKind: "GENERATED", SubjectID: "generation", ExpectedSnapshotHash: hash, LocationID: location.ID, Key: "images/source.png", OwnerID: owner},
		{SubjectKind: "REFERENCE_URL", SubjectID: strings.Repeat("b", 64), ExpectedSnapshotHash: hash, LocationID: regionAlias.ID, Key: "images/source.png", OwnerID: owner},
	}}
	candidates := []ImageHistoryCandidate{
		{SubjectKind: "GENERATED", SubjectID: "generation", OwnerID: &owner, SnapshotHash: hash, Snapshot: json.RawMessage(`{"storageKey":"images/source.png","url":"https://public.invalid/images/source.png"}`), Classification: "SOURCE_BINDING_REQUIRED"},
		{SubjectKind: "REFERENCE_URL", SubjectID: strings.Repeat("b", 64), SnapshotHash: hash, Snapshot: json.RawMessage(`{"url":"https://public.invalid/images/source.png"}`), Classification: "THIRD_PARTY_OR_UNKNOWN"},
	}
	scanner := &historyPlanScanner{pages: []ImageHistoryScanPage{{Candidates: candidates, UpperBound: "2026-11-15T00:00:00Z"}}}
	inspector := &historyPlanInspector{data: imageHistoryPNG(t)}
	plan, err := BuildImageHistoryPlan(context.Background(), scanner, inspector, manifest, ImageHistoryPlanOptions{})
	if err != nil || plan.VerifiedSourceBytes != int64(len(inspector.data)) || plan.Scanned != 2 {
		t.Fatalf("region alias double-counted source: %+v %v", plan, err)
	}
	encoded, err := json.Marshal(plan)
	if err != nil || !bytes.Contains(encoded, []byte(`"byteLength":"`)) || !bytes.Contains(encoded, []byte(`"verifiedSourceBytes":"`)) {
		t.Fatalf("bytes lost decimal-string wire: %s %v", encoded, err)
	}
}

func TestImageHistoryPlanRejectsRepeatingCursorAndFrozenIntentChanges(t *testing.T) {
	cursor := "repeated"
	upper := "2026-11-15T00:00:00Z"
	candidate := ImageHistoryCandidate{SubjectKind: "GENERATED", SubjectID: "image", SnapshotHash: strings.Repeat("a", 64), Snapshot: json.RawMessage(`{}`), Classification: "SOURCE_BINDING_REQUIRED"}
	scanner := &historyPlanScanner{pages: []ImageHistoryScanPage{{Candidates: []ImageHistoryCandidate{candidate}, UpperBound: upper, NextCursor: &cursor}, {Candidates: []ImageHistoryCandidate{candidate}, UpperBound: upper, NextCursor: &cursor}}}
	manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: []ImageLocationInput{}, Bindings: []ImageHistorySourceBinding{}}
	_, err := BuildImageHistoryPlan(context.Background(), scanner, &historyPlanInspector{}, manifest, ImageHistoryPlanOptions{Limit: 3})
	requireImageHistoryCode(t, err, "IMAGE_INTERNAL_ERROR")
	if len(scanner.inputs) != 2 {
		t.Fatal("repeating cursor caused an unbounded scan")
	}
	first, err := ImageHistoryPlanDigest(manifest, ImageHistoryPlanOptions{Scope: "ALL", UpperBound: upper})
	if err != nil {
		t.Fatal(err)
	}
	changed, err := ImageHistoryPlanDigest(manifest, ImageHistoryPlanOptions{Scope: "GENERATED", UpperBound: upper})
	if err != nil || changed == first {
		t.Fatal("changed scope did not change frozen intent")
	}
	changed, err = ImageHistoryPlanDigest(manifest, ImageHistoryPlanOptions{Scope: "ALL", UpperBound: "2026-11-16T00:00:00Z"})
	if err != nil || changed == first {
		t.Fatal("changed scan upper bound did not change frozen intent")
	}
}

func TestImageHistoryManifestRejectsUnknownFieldsAndUnsafeBindings(t *testing.T) {
	for _, encoded := range []string{
		`{"schemaVersion":1,"locations":[],"bindings":[],"allowUnknownSources":true}`,
		`{"schemaVersion":1,"locations":null,"bindings":[]}`,
		`{"schemaVersion":1,"locations":[],"bindings":[]} {}`,
	} {
		_, err := DecodeImageHistoryManifest(strings.NewReader(encoded))
		requireImageHistoryCode(t, err, "IMAGE_INVALID_INPUT")
	}
}

func TestImageHistoryPublishedURLProofDoesNotStripQueriesOrInferThirdPartyOwnership(t *testing.T) {
	location, _ := NewImageS3Location("https://objects.invalid", "auto", "history", "https://public.invalid")
	for _, rawURL := range []string{"https://public.invalid/images/source.png?signature=unknown", "https://external.invalid/images/source.png", "https://public.invalid/images/source.png#different"} {
		err := validateHistoryPublishedSource("REFERENCE_URL", imageHistorySnapshot{URL: rawURL}, location, "images/source.png", false)
		requireImageHistoryCode(t, err, "IMAGE_REFERENCE_CONFLICT")
	}
	for _, rawURL := range []string{"https://public.invalid/images/source.png", "https://objects.invalid/history/images/source.png"} {
		if err := validateHistoryPublishedSource("REFERENCE_URL", imageHistorySnapshot{URL: rawURL}, location, "images/source.png", false); err != nil {
			t.Fatalf("exact proven publication refused: %v", err)
		}
	}
}

func TestImageHistoryPublicationBaseIsNormalizedAndFrozenInDigest(t *testing.T) {
	manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: []ImageLocationInput{}, Bindings: []ImageHistorySourceBinding{}}
	options := ImageHistoryPlanOptions{UpperBound: "2026-11-15T00:00:00Z", PublicURLBase: "https://app.invalid/prefix/"}
	first, err := ImageHistoryPlanDigest(manifest, options)
	if err != nil {
		t.Fatal(err)
	}
	options.PublicURLBase = "https://app.invalid/prefix"
	equivalent, err := ImageHistoryPlanDigest(manifest, options)
	if err != nil || equivalent != first {
		t.Fatal("equivalent publication base changed intent")
	}
	options.PublicURLBase = "https://other.invalid/prefix"
	changed, err := ImageHistoryPlanDigest(manifest, options)
	if err != nil || changed == first {
		t.Fatal("changed publication base did not change frozen intent")
	}
	for _, bad := range []string{"", "http://localhost:3000", "http://127.0.0.1:3000", "https://app.invalid/?signed=1", "https://app.invalid/#fragment"} {
		if err := ValidateImageHistoryApplyConfig(Config{AppURL: bad, NodeEnv: "production", ImageStorageManagedEnabled: false}); err == nil {
			t.Fatalf("adoption published invalid production base while managed writes disabled: %q", bad)
		}
	}
	if err := ValidateImageHistoryApplyConfig(Config{AppURL: "https://app.invalid", NodeEnv: "production"}); err != nil {
		t.Fatal(err)
	}
}

type historyIntentRepository struct {
	ImageHistoryApplyRepository
	job    ImageHistoryJob
	claims int
}

func (repo *historyIntentRepository) GetImageHistoryJob(context.Context, ImageHistoryJobInput) (*ImageHistoryJob, error) {
	job := repo.job
	return &job, nil
}
func (repo *historyIntentRepository) ListImageHistoryItems(context.Context, ImageHistoryItemsInput) (ImageHistoryItemsPage, error) {
	return ImageHistoryItemsPage{Items: []ImageHistoryItem{}}, nil
}
func (repo *historyIntentRepository) ClaimImageHistoryItem(context.Context, ImageHistoryClaimInput) (*ImageHistoryItem, error) {
	repo.claims++
	return nil, nil
}

func TestImageHistoryRequestReplayRejectsChangedBaseAndExplicitJobResumeUsesFrozenBase(t *testing.T) {
	manifest := ImageHistoryManifest{SchemaVersion: 1, Locations: []ImageLocationInput{}, Bindings: []ImageHistorySourceBinding{}}
	options := ImageHistoryPlanOptions{Scope: "ALL", UpperBound: "2026-11-15T00:00:00Z", PublicURLBase: "https://original.invalid"}
	digest, err := ImageHistoryPlanDigest(manifest, options)
	if err != nil {
		t.Fatal(err)
	}
	repo := &historyIntentRepository{job: ImageHistoryJob{ID: historyTestJobID, RequestID: historyTestItemID, ActorID: "operator", Mode: "ADOPT", Scope: "ALL", PlanDigest: digest,
		PublicURLBase: options.PublicURLBase, UpperBound: options.UpperBound, State: "SUCCEEDED", ScanComplete: true, SourceBindings: []ImageHistorySourceBinding{}}}
	changed := options
	changed.PublicURLBase = "https://changed.invalid"
	_, err = ApplyImageHistory(context.Background(), repo, &historyRuntimeIO{}, manifest, ImageHistoryApplyOptions{ImageHistoryPlanOptions: changed, RequestID: repo.job.RequestID, ActorID: "operator"})
	requireImageHistoryCode(t, err, "IMAGE_RESERVATION_CONFLICT")
	if repo.claims != 0 {
		t.Fatal("changed intent reached an apply mutation")
	}
	resumed, err := ApplyImageHistory(context.Background(), repo, &historyRuntimeIO{}, manifest, ImageHistoryApplyOptions{ImageHistoryPlanOptions: changed, JobID: repo.job.ID, ActorID: "operator"})
	if err != nil || resumed.Job.PublicURLBase != "https://original.invalid" || resumed.Job.PlanDigest != digest || resumed.HasMore {
		t.Fatalf("explicit resume changed frozen publication: %+v %v", resumed, err)
	}
}
