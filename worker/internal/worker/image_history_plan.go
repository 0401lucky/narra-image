package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strings"
	"time"
)

const ImageHistoryManifestMaxBytes = 1024 * 1024
const ImageHistoryMaxItems = ImageHistoryPageLimit
const ImageHistoryPageSize = 100

type ImageHistoryManifest struct {
	SchemaVersion int                         `json:"schemaVersion"`
	Locations     []ImageLocationInput        `json:"locations"`
	Bindings      []ImageHistorySourceBinding `json:"bindings"`
}

// DecodeImageHistoryManifest accepts only a bounded, explicit namespace and
// subject manifest. No endpoint/owner/key is inferred from an old public URL.
func DecodeImageHistoryManifest(reader io.Reader) (ImageHistoryManifest, error) {
	var manifest ImageHistoryManifest
	data, err := io.ReadAll(io.LimitReader(reader, ImageHistoryManifestMaxBytes+1))
	if err != nil || len(data) > ImageHistoryManifestMaxBytes {
		return manifest, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&manifest) != nil || decoder.Decode(new(any)) != io.EOF {
		return manifest, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if err := ValidateImageHistoryManifest(manifest); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func ValidateImageHistoryManifest(manifest ImageHistoryManifest) error {
	if manifest.SchemaVersion != 1 || len(manifest.Locations) > ImageHistoryMaxItems || len(manifest.Bindings) > ImageHistoryMaxItems || manifest.Locations == nil || manifest.Bindings == nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	locations := make(map[string]ImageLocationInput, len(manifest.Locations))
	for _, location := range manifest.Locations {
		if err := validateImageHistoryLocation(location); err != nil {
			return err
		}
		if _, duplicate := locations[location.ID]; duplicate {
			return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		locations[location.ID] = location
	}
	bound := make(map[string]bool, len(manifest.Bindings))
	for _, binding := range manifest.Bindings {
		if binding.SubjectKind != "GENERATED" && binding.SubjectKind != "CANVAS_IMPORT" && binding.SubjectKind != "REFERENCE_URL" {
			return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		identity := historySubjectKey(binding.SubjectKind, binding.SubjectID)
		if !validHistoryTextID(binding.SubjectID, 512) || !validHistoryTextID(binding.OwnerID, 255) || !imagePublicTokenPattern.MatchString(binding.ExpectedSnapshotHash) ||
			locations[binding.LocationID].ID == "" || bound[identity] {
			return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		if binding.SubjectKind == "REFERENCE_URL" && !imagePublicTokenPattern.MatchString(binding.SubjectID) {
			return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		if _, _, err := LocalImageObjectNames(binding.Key); err != nil {
			return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		bound[identity] = true
	}
	return nil
}

func validHistoryTextID(value string, limit int) bool {
	return value != "" && len(value) <= limit && !strings.ContainsAny(value, "\x00\r\n") && strings.TrimSpace(value) == value
}

func historySubjectKey(kind, id string) string { return kind + "\x00" + id }

type ImageHistoryPlanOptions struct {
	Scope            string
	Cursor           string
	UpperBound       string
	Limit            int
	TargetLocationID string
	RetireSource     bool
	PublicURLBase    string
}

type ImageHistoryScanner interface {
	ScanImageHistory(context.Context, ImageHistoryScanInput) (ImageHistoryScanPage, error)
}

type ImageHistoryPlanItem struct {
	SubjectKind      string  `json:"subjectKind"`
	SubjectID        string  `json:"subjectId"`
	OwnerID          *string `json:"ownerId"`
	SnapshotHash     string  `json:"snapshotHash"`
	Classification   string  `json:"classification"`
	DisplayURL       *string `json:"displayUrl,omitempty"`
	SourceLocationID string  `json:"sourceLocationId,omitempty"`
	SourceKey        string  `json:"sourceKey,omitempty"`
	ReadResult       string  `json:"readResult,omitempty"`
	ByteLength       *int64  `json:"byteLength,string,omitempty"`
	SHA256           string  `json:"sha256,omitempty"`
	MimeType         string  `json:"mimeType,omitempty"`
	VersionEvidence  string  `json:"versionEvidence,omitempty"`
	Code             string  `json:"code,omitempty"`
}

type ImageHistoryPlan struct {
	SchemaVersion          int                    `json:"schemaVersion"`
	DryRun                 bool                   `json:"dryRun"`
	Scope                  string                 `json:"scope"`
	UpperBound             string                 `json:"upperBound"`
	NextCursor             *string                `json:"nextCursor"`
	ScanComplete           bool                   `json:"scanComplete"`
	PlanDigest             string                 `json:"planDigest"`
	Scanned                int                    `json:"scanned"`
	Classifications        map[string]int         `json:"classifications"`
	VerifiedSourceBytes    int64                  `json:"verifiedSourceBytes,string"`
	KnownUnverifiedBytes   int64                  `json:"knownUnverifiedBytes,string"`
	CopyBytes              int64                  `json:"copyBytes,string"`
	TargetLocationID       string                 `json:"targetLocationId,omitempty"`
	PublicURLBase          string                 `json:"publicUrlBase,omitempty"`
	TargetReadVerified     bool                   `json:"targetReadVerified"`
	TargetWritableVerified bool                   `json:"targetWritableVerified"`
	TargetCode             string                 `json:"targetCode,omitempty"`
	Items                  []ImageHistoryPlanItem `json:"items"`
}

func normalizedHistoryPlanOptions(options ImageHistoryPlanOptions) (ImageHistoryPlanOptions, error) {
	options.Scope = strings.ToUpper(options.Scope)
	if options.Scope == "" {
		options.Scope = "ALL"
	}
	if options.Scope != "ALL" && options.Scope != "GENERATED" && options.Scope != "CANVAS_IMPORT" && options.Scope != "REFERENCE_URL" {
		return options, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if options.Limit == 0 {
		options.Limit = ImageHistoryPageSize
	}
	if options.Limit < 1 || options.Limit > ImageHistoryMaxItems || len(options.Cursor) > 8192 {
		return options, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if options.UpperBound != "" {
		if _, err := time.Parse(time.RFC3339Nano, options.UpperBound); err != nil {
			return options, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
	}
	if options.RetireSource && options.TargetLocationID == "" {
		return options, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if options.PublicURLBase != "" {
		if err := validateManagedImagePublicURL(Config{AppURL: options.PublicURLBase, ImageStorageManagedEnabled: true}); err != nil {
			return options, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
		}
		const suffix = "/media/images/0000000000000000000000000000000000000000000000000000000000000000"
		full, err := ImagePublicURL(options.PublicURLBase, strings.Repeat("0", 64))
		if err != nil {
			return options, err
		}
		options.PublicURLBase = strings.TrimSuffix(full, suffix)
	}
	return options, nil
}

// History adoption publishes canonical aliases even when new managed writes
// are disabled, so the producer APP_URL contract applies to explicit apply.
func ValidateImageHistoryApplyConfig(cfg Config) error {
	cfg.ImageStorageManagedEnabled = true
	if err := validateManagedImagePublicURL(cfg); err != nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	return nil
}

func ImageHistoryPlanDigest(manifest ImageHistoryManifest, options ImageHistoryPlanOptions) (string, error) {
	if err := ValidateImageHistoryManifest(manifest); err != nil {
		return "", err
	}
	options, err := normalizedHistoryPlanOptions(options)
	if err != nil || options.UpperBound == "" {
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	locations := append([]ImageLocationInput{}, manifest.Locations...)
	bindings := append([]ImageHistorySourceBinding{}, manifest.Bindings...)
	sort.Slice(locations, func(a, b int) bool { return locations[a].ID < locations[b].ID })
	sort.Slice(bindings, func(a, b int) bool {
		return historySubjectKey(bindings[a].SubjectKind, bindings[a].SubjectID) < historySubjectKey(bindings[b].SubjectKind, bindings[b].SubjectID)
	})
	encoded, err := json.Marshal(struct {
		Locations        []ImageLocationInput        `json:"locations"`
		Bindings         []ImageHistorySourceBinding `json:"bindings"`
		Scope            string                      `json:"scope"`
		UpperBound       string                      `json:"upperBound"`
		TargetLocationID string                      `json:"targetLocationId"`
		RetireSource     bool                        `json:"retireSource"`
		PublicURLBase    string                      `json:"publicUrlBase"`
	}{locations, bindings, options.Scope, options.UpperBound, options.TargetLocationID, options.RetireSource, options.PublicURLBase})
	if err != nil {
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func BuildImageHistoryPlan(ctx context.Context, scanner ImageHistoryScanner, inspector ImageHistoryReadOnlyIO, manifest ImageHistoryManifest, options ImageHistoryPlanOptions) (ImageHistoryPlan, error) {
	result := ImageHistoryPlan{SchemaVersion: 1, DryRun: true, Classifications: make(map[string]int), Items: []ImageHistoryPlanItem{}}
	if scanner == nil || inspector == nil {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	if err := ValidateImageHistoryManifest(manifest); err != nil {
		return result, err
	}
	options, err := normalizedHistoryPlanOptions(options)
	if err != nil {
		return result, err
	}
	result.Scope, result.UpperBound, result.TargetLocationID = options.Scope, options.UpperBound, options.TargetLocationID
	result.PublicURLBase = options.PublicURLBase
	locations, bindings := historyManifestMaps(manifest)
	if options.TargetLocationID != "" {
		target, exists := locations[options.TargetLocationID]
		if !exists {
			return result, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		if err := inspector.Verify(ctx, target); err != nil {
			result.TargetCode = imageHistorySafeCode(err)
		} else {
			result.TargetReadVerified = true
		}
	}
	cursor := options.Cursor
	seenCursors := map[string]bool{cursor: true}
	counted := make(map[string]bool)
	physicalBindings := make(map[string]ImageHistorySourceBinding)
	for result.Scanned < options.Limit {
		pageLimit := min(ImageHistoryPageSize, options.Limit-result.Scanned)
		page, err := scanner.ScanImageHistory(ctx, ImageHistoryScanInput{Scope: options.Scope, Cursor: cursor, UpperBound: result.UpperBound, Limit: pageLimit})
		if err != nil {
			return result, err
		}
		if len(page.Candidates) > pageLimit || page.UpperBound == "" || (result.UpperBound != "" && page.UpperBound != result.UpperBound) {
			return result, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
		}
		result.UpperBound = page.UpperBound
		for _, candidate := range page.Candidates {
			item := ImageHistoryPlanItem{SubjectKind: candidate.SubjectKind, SubjectID: candidate.SubjectID, OwnerID: candidate.OwnerID, SnapshotHash: candidate.SnapshotHash, Classification: candidate.Classification}
			if candidate.ExactURL != nil && validImageHistoryAlias(*candidate.ExactURL) {
				display := redactURL(*candidate.ExactURL)
				item.DisplayURL = &display
			}
			snapshot, snapshotErr := decodeHistorySnapshot(candidate.Snapshot)
			if snapshotErr == nil {
				item.SourceKey, item.SourceLocationID = snapshot.StorageKey, snapshot.StorageLocation
			}
			binding, bound := bindings[historySubjectKey(candidate.SubjectKind, candidate.SubjectID)]
			if bound && candidate.Classification != "VIDEO_EXCLUDED" && candidate.Classification != "DATA_URL" {
				if snapshotErr != nil {
					item.Code = "IMAGE_INTERNAL_ERROR"
				} else if err := validateHistoryBinding(candidate.SubjectKind, candidate.SubjectID, candidate.OwnerID, candidate.SnapshotHash, snapshot, binding, locations); err != nil {
					item.Code = imageHistorySafeCode(err)
				} else if err := validateHistoryPublishedSource(candidate.SubjectKind, snapshot, locations[binding.LocationID], binding.Key, candidate.Classification == "ALREADY_MANAGED"); err != nil {
					item.Code = imageHistorySafeCode(err)
				} else {
					location := locations[binding.LocationID]
					item.SourceLocationID, item.SourceKey = location.ID, binding.Key
					observed, inspectErr := inspector.Inspect(ctx, location, binding.Key, historyExpectedSnapshot(candidate.SubjectKind, snapshot), false)
					item.ReadResult, item.ByteLength, item.SHA256, item.MimeType, item.VersionEvidence = observed.ReadResult, observed.ByteLength, observed.SHA256, observed.MimeType, observed.VersionEvidence
					if inspectErr != nil {
						item.Code = imageHistorySafeCode(inspectErr)
					} else if candidate.Classification != "CANVAS_UNCERTAIN" && candidate.Classification != "ALREADY_MANAGED" {
						item.Classification = "VERIFIED_SOURCE"
					}
					physicalID := historyPhysicalIdentity(location, binding.Key)
					if prior, exists := physicalBindings[physicalID]; exists {
						if prior.OwnerID != binding.OwnerID || (prior.SubjectKind != "REFERENCE_URL" && binding.SubjectKind != "REFERENCE_URL" && historySubjectKey(prior.SubjectKind, prior.SubjectID) != historySubjectKey(binding.SubjectKind, binding.SubjectID)) {
							item.Classification, item.Code = "PHYSICAL_IDENTITY_CONFLICT", "PHYSICAL_IDENTITY_CONFLICT"
						}
					} else {
						physicalBindings[physicalID] = binding
					}
					if observed.ByteLength != nil && *observed.ByteLength > 0 && !counted[physicalID] {
						counted[physicalID] = true
						if inspectErr == nil && observed.ReadResult == "FULL" {
							if err := addHistoryBytes(&result.VerifiedSourceBytes, *observed.ByteLength); err != nil {
								return result, err
							}
							if options.TargetLocationID != "" && options.TargetLocationID != location.ID && *observed.ByteLength <= ImageMaxBytes && candidate.Classification != "CANVAS_UNCERTAIN" {
								if err := addHistoryBytes(&result.CopyBytes, *observed.ByteLength); err != nil {
									return result, err
								}
							}
						} else {
							if err := addHistoryBytes(&result.KnownUnverifiedBytes, *observed.ByteLength); err != nil {
								return result, err
							}
						}
					}
				}
			}
			result.Scanned++
			result.Classifications[item.Classification]++
			result.Items = append(result.Items, item)
		}
		result.NextCursor = page.NextCursor
		if page.NextCursor == nil {
			result.ScanComplete = true
			break
		}
		if len(page.Candidates) == 0 || *page.NextCursor == "" || seenCursors[*page.NextCursor] {
			return result, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
		}
		cursor = *page.NextCursor
		seenCursors[cursor] = true
	}
	options.UpperBound = result.UpperBound
	result.PlanDigest, err = ImageHistoryPlanDigest(manifest, options)
	return result, err
}

func historyManifestMaps(manifest ImageHistoryManifest) (map[string]ImageLocationInput, map[string]ImageHistorySourceBinding) {
	locations := make(map[string]ImageLocationInput, len(manifest.Locations))
	bindings := make(map[string]ImageHistorySourceBinding, len(manifest.Bindings))
	for _, location := range manifest.Locations {
		locations[location.ID] = location
	}
	for _, binding := range manifest.Bindings {
		bindings[historySubjectKey(binding.SubjectKind, binding.SubjectID)] = binding
	}
	return locations, bindings
}

type imageHistorySnapshot struct {
	ID                     string  `json:"id"`
	OwnerID                string  `json:"ownerId"`
	URL                    string  `json:"url"`
	MediaStorage           *string `json:"mediaStorage"`
	MediaAssetID           *string `json:"mediaAssetId"`
	SourceProvider         string  `json:"sourceProvider"`
	StorageLocation        string  `json:"storageLocation"`
	StorageEndpoint        *string `json:"storageEndpoint"`
	StorageRegion          *string `json:"storageRegion"`
	StorageBucket          *string `json:"storageBucket"`
	StorageKey             string  `json:"storageKey"`
	ByteLength             int64   `json:"byteLength,string"`
	SHA256                 string  `json:"sha256"`
	MimeType               string  `json:"mimeType"`
	State                  string  `json:"state"`
	PutOutcome             string  `json:"putOutcome"`
	StorageVersionID       *string `json:"storageVersionId"`
	NeedsReconciliation    bool    `json:"needsReconciliation"`
	PhysicalBytesAccounted bool    `json:"physicalBytesAccounted"`
	DeleteToken            *string `json:"deleteToken"`
}

func decodeHistorySnapshot(value any) (imageHistorySnapshot, error) {
	var snapshot imageHistorySnapshot
	encoded, err := json.Marshal(value)
	if err != nil || json.Unmarshal(encoded, &snapshot) != nil {
		return snapshot, ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	return snapshot, nil
}

func validateHistoryBinding(kind, subjectID string, ownerID *string, snapshotHash string, snapshot imageHistorySnapshot, binding ImageHistorySourceBinding, locations map[string]ImageLocationInput) error {
	if binding.SubjectKind != kind || binding.SubjectID != subjectID || binding.ExpectedSnapshotHash != snapshotHash || (ownerID != nil && kind != "REFERENCE_URL" && binding.OwnerID != *ownerID) {
		return ImageStorageError{Code: "IMAGE_REFERENCE_CONFLICT"}
	}
	location, exists := locations[binding.LocationID]
	if !exists || (snapshot.StorageKey != "" && snapshot.StorageKey != binding.Key) {
		return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	if kind == "CANVAS_IMPORT" {
		if snapshot.StorageLocation != binding.LocationID || snapshot.SourceProvider != location.Provider || snapshot.OwnerID != binding.OwnerID {
			return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		if location.Provider == "S3" && (snapshot.StorageEndpoint == nil || snapshot.StorageRegion == nil || snapshot.StorageBucket == nil || *snapshot.StorageEndpoint != location.Endpoint || *snapshot.StorageRegion != location.Region || *snapshot.StorageBucket != location.Bucket) {
			return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		if location.Provider == "LOCAL" && (snapshot.StorageEndpoint != nil || snapshot.StorageRegion != nil || snapshot.StorageBucket != nil) {
			return ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
	}
	return nil
}

func historyExpectedSnapshot(kind string, snapshot imageHistorySnapshot) *ImageHistoryExpectedContent {
	if kind == "CANVAS_IMPORT" && snapshot.ByteLength > 0 && imagePublicTokenPattern.MatchString(snapshot.SHA256) && snapshot.MimeType != "" {
		return &ImageHistoryExpectedContent{ByteLength: snapshot.ByteLength, SHA256: snapshot.SHA256, MimeType: snapshot.MimeType}
	}
	return nil
}

func validateHistoryPublishedSource(kind string, snapshot imageHistorySnapshot, location ImageLocationInput, key string, alreadyManaged bool) error {
	if kind == "CANVAS_IMPORT" || alreadyManaged || snapshot.MediaAssetID != nil {
		return nil
	}
	if location.Provider != "S3" || !validImageHistoryAlias(snapshot.URL) {
		return ImageStorageError{Code: "IMAGE_REFERENCE_CONFLICT"}
	}
	// Exact published names plus the explicit binding are required. Removing a
	// query, matching a prefix or treating an arbitrary URL as a download target
	// would falsely adopt third-party content into an unrelated owned namespace.
	if snapshot.URL == location.Endpoint+"/"+location.Bucket+"/"+key || (location.PublicBaseURL != "" && snapshot.URL == strings.TrimRight(location.PublicBaseURL, "/")+"/"+key) {
		return nil
	}
	return ImageStorageError{Code: "IMAGE_REFERENCE_CONFLICT"}
}

func historyPhysicalIdentity(location ImageLocationInput, key string) string {
	if location.Provider == "LOCAL" {
		return imageHistoryProof("LOCAL", location.ID, key)
	}
	// The same S3 bucket/key through a different region alias is one physical
	// object. This is only report deduplication; SQL owns actual accounting.
	return imageHistoryProof("S3", location.Endpoint, location.Bucket, key)
}

func addHistoryBytes(total *int64, count int64) error {
	if count < 0 || *total < 0 || *total > math.MaxInt64-count {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	*total += count
	return nil
}

func imageHistorySafeCode(err error) string {
	var historyErr ImageHistoryIOError
	if errors.As(err, &historyErr) {
		return historyErr.Code
	}
	var imageErr ImageStorageError
	if errors.As(err, &imageErr) && IsImageErrorCode(imageErr.Code) {
		return imageErr.Code
	}
	return "IMAGE_STORAGE_UNAVAILABLE"
}
