package worker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const ImageContractVersion = 1
const ImageDefaultQuotaBytes int64 = 5_000_000_000
const ImageMaxBytes int64 = 50 * 1024 * 1024
const ImageMaxOutputCount = 4
const ImageDefaultLeaseSeconds = 1200

var imageUUIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var imagePublicTokenPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

var imageErrorCodes = map[string]bool{
	"IMAGE_INVALID_INPUT": true, "IMAGE_QUOTA_EXCEEDED": true, "IMAGE_RESERVATION_CONFLICT": true,
	"IMAGE_RESERVATION_EXPIRED": true, "IMAGE_WRITE_CONFLICT": true, "IMAGE_UNAVAILABLE": true,
	"IMAGE_LOCATION_CONFLICT": true, "IMAGE_REFERENCE_CONFLICT": true,
	"IMAGE_STORAGE_UNAVAILABLE": true, "IMAGE_INTERNAL_ERROR": true,
	"IMAGE_POLICY_CONFLICT": true, "IMAGE_PREVIEW_EXPIRED": true,
	"IMAGE_MAINTENANCE_CONFLICT": true, "IMAGE_POLICY_DISABLED": true,
	"IMAGE_HISTORY_CONFLICT": true, "IMAGE_OBSERVATION_REQUIRED": true, "IMAGE_HISTORY_BLOCKED": true,
	"IMAGE_READER_INCOMPATIBLE": true,
}

type ImageStorageError struct {
	Code  string
	Cause error
}

func (failure ImageStorageError) Error() string { return failure.Code }
func (failure ImageStorageError) Unwrap() error { return failure.Cause }
func IsImageErrorCode(code string) bool         { return imageErrorCodes[code] }

func ImageOutputBudget(count int) (int64, error) {
	if count < 1 || count > ImageMaxOutputCount {
		return 0, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	return int64(count) * ImageMaxBytes, nil
}

type ImageLocationInput struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint,omitempty"`
	Region        string `json:"region,omitempty"`
	Bucket        string `json:"bucket,omitempty"`
	VolumeID      string `json:"volumeId,omitempty"`
	PublicBaseURL string `json:"publicBaseUrl,omitempty"`
}

type ImageLocation struct {
	ImageLocationInput
	PhysicalNamespace string `json:"physicalNamespace"`
	CreatedAt         string `json:"createdAt"`
}

func NewImageLocalLocation(volumeID string) (ImageLocationInput, error) {
	if !imageUUIDPattern.MatchString(volumeID) {
		return ImageLocationInput{}, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	return ImageLocationInput{ID: "local-v1:" + volumeID, Provider: "LOCAL", VolumeID: volumeID}, nil
}

func NewImageS3Location(endpoint, region, bucket, publicBaseURL string) (ImageLocationInput, error) {
	location, err := NewCanvasStorageLocation(endpoint, region, bucket)
	if err != nil {
		return ImageLocationInput{}, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
	}
	if publicBaseURL != "" {
		parsed, parseErr := url.Parse(strings.TrimSpace(publicBaseURL))
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return ImageLocationInput{}, ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"}
		}
		publicBaseURL = strings.TrimRight(parsed.String(), "/")
	}
	return ImageLocationInput{ID: location.ID, Provider: "S3", Endpoint: location.Endpoint, Region: location.Region, Bucket: location.Bucket, PublicBaseURL: publicBaseURL}, nil
}

func ImagePublicURL(appURL, token string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(appURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || !imagePublicTokenPattern.MatchString(token) {
		return "", ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	return strings.TrimRight(parsed.String(), "/") + "/media/images/" + token, nil
}

type ImageAssetRecord struct {
	ID             string  `json:"id"`
	OwnerID        string  `json:"ownerId"`
	Purpose        string  `json:"purpose"`
	OriginID       *string `json:"originId"`
	PublicToken    string  `json:"publicToken"`
	ByteLength     int64   `json:"byteLength,string"`
	MimeType       string  `json:"mimeType"`
	SHA256         string  `json:"sha256"`
	State          string  `json:"state"`
	ActiveObjectID *string `json:"activeObjectId"`
	DetachedAt     *string `json:"detachedAt"`
	DeletedAt      *string `json:"deletedAt"`
	DeleteReason   *string `json:"deleteReason"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

type ImageObjectRecord struct {
	ID                          string  `json:"id"`
	AssetID                     string  `json:"assetId"`
	Provenance                  string  `json:"provenance"`
	SourceObservationID         *string `json:"sourceObservationId"`
	ReconciliationObservationID *string `json:"reconciliationObservationId"`
	ReservationID               string  `json:"reservationId"`
	Slot                        int     `json:"slot"`
	LocationID                  string  `json:"locationId"`
	PhysicalNamespace           string  `json:"physicalNamespace"`
	Key                         string  `json:"key"`
	ByteLength                  int64   `json:"byteLength,string"`
	MimeType                    string  `json:"mimeType"`
	SHA256                      string  `json:"sha256"`
	State                       string  `json:"state"`
	WriteToken                  string  `json:"writeToken"`
	WriteExpiresAt              string  `json:"writeExpiresAt"`
	PutOutcome                  string  `json:"putOutcome"`
	VersionID                   *string `json:"versionId"`
	Accounted                   bool    `json:"accounted"`
	NeedsReconciliation         bool    `json:"needsReconciliation"`
	DeleteToken                 *string `json:"deleteToken"`
	DeleteExpiresAt             *string `json:"deleteExpiresAt"`
	DeleteOutcome               string  `json:"deleteOutcome"`
	DeleteAttempts              int     `json:"deleteAttempts"`
	NextDeleteAt                *string `json:"nextDeleteAt"`
	DeletedAt                   *string `json:"deletedAt"`
	LastErrorCode               *string `json:"lastErrorCode"`
	CreatedAt                   string  `json:"createdAt"`
	UpdatedAt                   string  `json:"updatedAt"`
}

// The wire discriminant owns nullability. Existing WRITE callers retain scalar
// identity fields; OBSERVED represents their absence as zero values, validated
// against the actual JSON nulls here (not an absent/empty fake write identity).
func (object *ImageObjectRecord) UnmarshalJSON(data []byte) error {
	type wire ImageObjectRecord
	var decoded wire
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, key := range []string{"reservationId", "slot", "writeToken", "writeExpiresAt", "sourceObservationId", "reconciliationObservationId"} {
		value, exists := fields[key]
		if !exists {
			return errors.New("incomplete image provenance")
		}
		null := bytes.Equal(bytes.TrimSpace(value), []byte("null"))
		if key == "reconciliationObservationId" {
			continue
		}
		if key == "sourceObservationId" {
			if (decoded.Provenance == "WRITE") != null {
				return errors.New("invalid source observation")
			}
		} else if (decoded.Provenance == "OBSERVED") != null {
			return errors.New("invalid image write identity")
		}
	}
	*object = ImageObjectRecord(decoded)
	if !validImageObject(*object) {
		return errors.New("invalid image object provenance")
	}
	return nil
}

func (object ImageObjectRecord) MarshalJSON() ([]byte, error) {
	type wire ImageObjectRecord
	data, err := json.Marshal(wire(object))
	if err != nil || object.Provenance != "OBSERVED" {
		return data, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for _, key := range []string{"reservationId", "slot", "writeToken", "writeExpiresAt"} {
		fields[key] = json.RawMessage("null")
	}
	return json.Marshal(fields)
}

// The repository validates the immutable observation links in PostgreSQL. IO
// consumers must still reject an unresolved/oversized/versioned descriptor.
func ImageObjectVerified(object ImageObjectRecord) bool {
	if object.NeedsReconciliation || object.VersionID != nil || object.ByteLength < 1 || object.ByteLength > ImageMaxBytes {
		return false
	}
	if object.Provenance == "OBSERVED" {
		return object.PutOutcome == "NOT_APPLICABLE" && object.SourceObservationID != nil && imageUUIDPattern.MatchString(*object.SourceObservationID)
	}
	return object.Provenance == "WRITE" && (object.PutOutcome == "CONFIRMED" || (object.ReconciliationObservationID != nil && imageUUIDPattern.MatchString(*object.ReconciliationObservationID)))
}

type ImageReservation struct {
	ID             string   `json:"id"`
	Token          string   `json:"token"`
	OwnerID        string   `json:"ownerId"`
	IntentKey      string   `json:"intentKey"`
	Kind           string   `json:"kind"`
	SlotBytes      []string `json:"slotBytes"`
	RemainingBytes int64    `json:"remainingBytes,string"`
	State          string   `json:"state"`
	OutputJobID    *string  `json:"outputJobId"`
	WorkerID       *string  `json:"workerId"`
	LeaseExpiresAt string   `json:"leaseExpiresAt"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type ImagePolicy struct {
	Scope               string  `json:"scope"`
	Version             int     `json:"version"`
	LimitBytes          int64   `json:"limitBytes,string"`
	Enabled             bool    `json:"enabled"`
	QuotaCleanupEnabled bool    `json:"quotaCleanupEnabled"`
	ScheduleEnabled     bool    `json:"scheduleEnabled"`
	RetentionDays       int     `json:"retentionDays"`
	IntervalSeconds     int     `json:"intervalSeconds"`
	NextRunAt           *string `json:"nextRunAt"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

type ImageUsage struct {
	Policy        ImagePolicy `json:"policy"`
	UsedBytes     int64       `json:"usedBytes,string"`
	ReservedBytes int64       `json:"reservedBytes,string"`
	AssetCount    int64       `json:"assetCount,string"`
	ObjectCount   int64       `json:"objectCount,string"`
}

type ManagedImage struct {
	Asset    ImageAssetRecord   `json:"asset"`
	Object   *ImageObjectRecord `json:"object"`
	Location *ImageLocation     `json:"location"`
}

type ImageWriteTicket struct {
	Asset        ImageAssetRecord  `json:"asset"`
	Object       ImageObjectRecord `json:"object"`
	WriteGranted bool              `json:"writeGranted"`
}

type ImageObjectReceipt struct {
	Asset    ImageAssetRecord  `json:"asset"`
	Object   ImageObjectRecord `json:"object"`
	Accepted bool              `json:"accepted"`
}

// LoadImageContract checks the shipped shared limits instead of silently
// accepting a mismatched deployment. The image module has no environment reads.
func LoadImageContract() error {
	data, err := readImageContractArtifact("contract.json", 64*1024)
	if err != nil {
		return err
	}
	return validateImageContract(data)
}

func readImageContractArtifact(name string, maximumBytes int64) ([]byte, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, errors.New("image contract working directory unavailable")
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, errors.New("image contract executable location unavailable")
	}
	directory, err := imageContractRoot(cwd, executable)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, errors.New("image contract root cannot be opened")
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		return nil, errors.New("image contract artifact cannot be opened")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maximumBytes+1))
	if err != nil || int64(len(data)) > maximumBytes {
		return nil, errors.New("image contract artifact cannot be read")
	}
	return data, nil
}

func imageContractRoot(cwd, executable string) (string, error) {
	seen := make(map[string]bool)
	starts := []string{cwd, filepath.Dir(executable)}
	// Match Canvas discovery: project/app root, worker/internal/worker (three
	// parents), and a binary in bin/. Prefer the nearest candidate across both
	// starts; a distant checkout must not replace a packaged installation.
	for depth := 0; depth <= 3; depth++ {
		for _, start := range starts {
			if start == "" || !filepath.IsAbs(start) {
				continue
			}
			directory := filepath.Clean(start)
			for level := 0; level < depth; level++ {
				directory = filepath.Dir(directory)
			}
			candidate := filepath.Join(directory, "contracts", "media", "v1")
			if !seen[candidate] {
				seen[candidate] = true
				info, inspectErr := os.Stat(candidate)
				if inspectErr == nil {
					if !info.IsDir() {
						return "", errors.New("image contract root is not a directory")
					}
					// Never hide an incomplete nearer deployment with a farther
					// ancestor's contract. Both schema and limits share this root.
					return candidate, nil
				}
				if !errors.Is(inspectErr, os.ErrNotExist) {
					return "", errors.New("image contract root cannot be inspected")
				}
			}
		}
	}
	return "", errors.New("image contract not found")
}

func validateImageContract(data []byte) error {
	var contract struct {
		Contract string `json:"contract"`
		Version  int    `json:"version"`
		Limits   struct {
			DefaultQuotaBytes   string `json:"defaultQuotaBytes"`
			ImageBytes          int64  `json:"imageBytes"`
			OutputCount         int    `json:"outputCount"`
			DefaultLeaseSeconds int    `json:"defaultLeaseSeconds"`
		} `json:"limits"`
		Errors map[string]json.RawMessage `json:"errors"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&contract); err != nil {
		return fmt.Errorf("invalid image contract: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("image contract has trailing JSON")
	}
	if contract.Contract != "narra.image.storage" || contract.Version != ImageContractVersion || contract.Limits.DefaultQuotaBytes != strconv.FormatInt(ImageDefaultQuotaBytes, 10) ||
		contract.Limits.ImageBytes != ImageMaxBytes || contract.Limits.OutputCount != ImageMaxOutputCount || contract.Limits.DefaultLeaseSeconds != ImageDefaultLeaseSeconds || len(contract.Errors) != len(imageErrorCodes) {
		return errors.New("unsupported image contract")
	}
	for code := range imageErrorCodes {
		if _, ok := contract.Errors[code]; !ok {
			return errors.New("image contract missing error")
		}
	}
	return nil
}
