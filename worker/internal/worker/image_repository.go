package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type ImageQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type ImageRepository struct{ db ImageQueryer }

func NewImageRepository(queryer ImageQueryer) *ImageRepository { return &ImageRepository{db: queryer} }

type ImageReserveOutputsInput struct {
	OwnerID      string
	IntentKey    string
	Count        int
	LeaseSeconds int
}
type ImageReserveInput struct {
	OwnerID      string
	IntentKey    string
	ByteLength   int64
	LeaseSeconds int
	Kind         string
}
type ImageBindReservationInput struct {
	ReservationID string `json:"reservationId"`
	Token         string `json:"token"`
	OwnerID       string `json:"ownerId"`
	JobID         string `json:"jobId"`
}
type ImageAcquireForJobInput struct {
	JobID        string `json:"jobId"`
	WorkerID     string `json:"workerId"`
	LeaseSeconds int    `json:"leaseSeconds,omitempty"`
}
type ImageCloseReservationInput struct {
	ReservationID string `json:"reservationId"`
	Token         string `json:"token"`
}
type ImageBeginObjectInput struct {
	ReservationID string `json:"reservationId"`
	Token         string `json:"token"`
	Slot          int    `json:"slot"`
	LocationID    string `json:"locationId"`
	Key           string `json:"key"`
	ByteLength    int64  `json:"byteLength,string"`
	MimeType      string `json:"mimeType"`
	SHA256        string `json:"sha256"`
	Purpose       string `json:"purpose"`
	OriginID      string `json:"originId,omitempty"`
	AssetID       string `json:"assetId,omitempty"`
}
type ImageFinishObjectInput struct {
	ObjectID   string `json:"objectId"`
	WriteToken string `json:"writeToken"`
	Outcome    string `json:"outcome"`
	VersionID  string `json:"versionId,omitempty"`
	ErrorCode  string `json:"errorCode,omitempty"`
}
type ImageReferenceInput struct {
	OwnerID      string   `json:"ownerId"`
	Kind         string   `json:"kind"`
	ReferenceKey string   `json:"referenceKey"`
	AssetIDs     []string `json:"assetIds"`
}
type ImageActivateObjectInput struct {
	AssetID          string  `json:"assetId"`
	ObjectID         string  `json:"objectId"`
	ExpectedObjectID *string `json:"expectedObjectId"`
}

var imageSQLActions = map[string]bool{
	"image_register_location": true, "image_reserve_write": true, "image_bind_reservation": true,
	"image_acquire_for_job": true, "image_close_reservation": true, "image_begin_object": true,
	"image_finish_object": true, "image_register_alias": true, "image_replace_references": true,
	"image_activate_object": true,
}

func imageRepositoryError(err error) error {
	if err == nil {
		return nil
	}
	var imageErr ImageStorageError
	if errors.As(err, &imageErr) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23514" || pgErr.Code == "P0001") && IsImageErrorCode(pgErr.Message) {
		return ImageStorageError{Code: pgErr.Message, Cause: err}
	}
	return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR", Cause: err}
}

func (repository *ImageRepository) query(ctx context.Context, query string, target any, nullable bool, args ...any) error {
	if repository == nil || repository.db == nil {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	var payload []byte
	if err := repository.db.QueryRow(ctx, query, args...).Scan(&payload); err != nil {
		return imageRepositoryError(err)
	}
	if len(payload) == 0 {
		payload = []byte("null")
	}
	if !nullable && bytes.Equal(bytes.TrimSpace(payload), []byte("null")) {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR", Cause: err}
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	if err := validateImageRepositoryResult(target); err != nil {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR", Cause: err}
	}
	return nil
}

func (repository *ImageRepository) action(ctx context.Context, name string, input any, target any) error {
	if !imageSQLActions[name] {
		return ImageStorageError{Code: "IMAGE_INTERNAL_ERROR"}
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return ImageStorageError{Code: "IMAGE_INVALID_INPUT", Cause: err}
	}
	return repository.query(ctx, "SELECT "+name+"($1::jsonb)", target, false, string(payload))
}

func (repository *ImageRepository) RegisterLocation(ctx context.Context, input ImageLocationInput) (ImageLocation, error) {
	var result ImageLocation
	err := repository.action(ctx, "image_register_location", input, &result)
	return result, err
}
func (repository *ImageRepository) ReserveOutputs(ctx context.Context, input ImageReserveOutputsInput) (ImageReservation, error) {
	var result ImageReservation
	if _, err := ImageOutputBudget(input.Count); err != nil {
		return result, err
	}
	slots := make([]string, input.Count)
	for i := range slots {
		slots[i] = strconv.FormatInt(ImageMaxBytes, 10)
	}
	lease := input.LeaseSeconds
	if lease == 0 {
		lease = ImageDefaultLeaseSeconds
	}
	err := repository.action(ctx, "image_reserve_write", map[string]any{"ownerId": input.OwnerID, "intentKey": input.IntentKey, "kind": "OUTPUT", "slotBytes": slots, "leaseSeconds": lease}, &result)
	return result, err
}
func (repository *ImageRepository) ReserveInput(ctx context.Context, input ImageReserveInput) (ImageReservation, error) {
	var result ImageReservation
	if input.ByteLength < 1 || input.ByteLength > ImageMaxBytes {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	kind := input.Kind
	if kind == "" {
		kind = "INPUT"
	}
	if kind != "INPUT" && kind != "COPY" {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	lease := input.LeaseSeconds
	if lease == 0 {
		lease = ImageDefaultLeaseSeconds
	}
	err := repository.action(ctx, "image_reserve_write", map[string]any{"ownerId": input.OwnerID, "intentKey": input.IntentKey, "kind": kind, "slotBytes": []string{strconv.FormatInt(input.ByteLength, 10)}, "leaseSeconds": lease}, &result)
	return result, err
}
func (repository *ImageRepository) BindReservation(ctx context.Context, input ImageBindReservationInput) (ImageReservation, error) {
	var result ImageReservation
	err := repository.action(ctx, "image_bind_reservation", input, &result)
	return result, err
}
func (repository *ImageRepository) AcquireForJob(ctx context.Context, input ImageAcquireForJobInput) (ImageReservation, error) {
	var result ImageReservation
	err := repository.action(ctx, "image_acquire_for_job", input, &result)
	return result, err
}
func (repository *ImageRepository) GetReservationByJob(ctx context.Context, jobID string) (*ImageReservation, error) {
	var result *ImageReservation
	err := repository.query(ctx, "SELECT image_get_reservation_by_job($1::text)", &result, true, jobID)
	return result, err
}
func (repository *ImageRepository) CloseReservation(ctx context.Context, input ImageCloseReservationInput) (bool, error) {
	var result bool
	err := repository.action(ctx, "image_close_reservation", input, &result)
	return result, err
}
func (repository *ImageRepository) BeginObject(ctx context.Context, input ImageBeginObjectInput) (ImageWriteTicket, error) {
	var result ImageWriteTicket
	if input.ByteLength < 1 || input.ByteLength > ImageMaxBytes {
		return result, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	err := repository.action(ctx, "image_begin_object", input, &result)
	return result, err
}
func (repository *ImageRepository) FinishObject(ctx context.Context, input ImageFinishObjectInput) (ImageObjectReceipt, error) {
	var result ImageObjectReceipt
	err := repository.action(ctx, "image_finish_object", input, &result)
	return result, err
}
func (repository *ImageRepository) GetByToken(ctx context.Context, token string) (*ManagedImage, error) {
	var result *ManagedImage
	err := repository.query(ctx, "SELECT image_get_by_token($1::text)", &result, true, token)
	return result, err
}
func (repository *ImageRepository) GetByAssetID(ctx context.Context, assetID, ownerID string) (*ManagedImage, error) {
	var result *ManagedImage
	if !imageUUIDPattern.MatchString(assetID) {
		return nil, ImageStorageError{Code: "IMAGE_INVALID_INPUT"}
	}
	var owner any
	if ownerID != "" {
		owner = ownerID
	}
	err := repository.query(ctx, "SELECT image_get_asset($1::uuid,$2::text)", &result, true, assetID, owner)
	return result, err
}
func (repository *ImageRepository) ResolveURL(ctx context.Context, rawURL, ownerID string) (*ManagedImage, error) {
	var result *ManagedImage
	var owner any
	if ownerID != "" {
		owner = ownerID
	}
	err := repository.query(ctx, "SELECT image_resolve_url($1::text,$2::text)", &result, true, rawURL, owner)
	return result, err
}
func (repository *ImageRepository) RegisterAlias(ctx context.Context, assetID, rawURL string) error {
	var result bool
	return repository.action(ctx, "image_register_alias", map[string]string{"assetId": assetID, "url": rawURL}, &result)
}
func (repository *ImageRepository) ReplaceReferences(ctx context.Context, input ImageReferenceInput) error {
	var result bool
	if input.AssetIDs == nil {
		input.AssetIDs = []string{}
	}
	return repository.action(ctx, "image_replace_references", input, &result)
}
func (repository *ImageRepository) ActivateObject(ctx context.Context, input ImageActivateObjectInput) (bool, error) {
	var result bool
	err := repository.action(ctx, "image_activate_object", input, &result)
	return result, err
}
func (repository *ImageRepository) GetUsage(ctx context.Context) (ImageUsage, error) {
	var result ImageUsage
	err := repository.query(ctx, "SELECT image_get_usage()", &result, false)
	return result, err
}

func validImageAsset(asset ImageAssetRecord) bool {
	validState := asset.State == "PENDING" || asset.State == "AVAILABLE" || asset.State == "QUARANTINED" || asset.State == "DELETING" || asset.State == "DELETED"
	validPurpose := asset.Purpose == "GENERATED" || asset.Purpose == "REFERENCE" || asset.Purpose == "CANVAS_IMPORT"
	return validState && validPurpose && imageUUIDPattern.MatchString(asset.ID) && imagePublicTokenPattern.MatchString(asset.PublicToken) && asset.OwnerID != "" && asset.ByteLength > 0 && imagePublicTokenPattern.MatchString(asset.SHA256)
}
func validImageObject(object ImageObjectRecord) bool {
	validState := object.State == "WRITING" || object.State == "READY" || object.State == "UNKNOWN" || object.State == "DELETING" || object.State == "DELETED"
	validWrite := object.Provenance == "WRITE" && object.SourceObservationID == nil && imageUUIDPattern.MatchString(object.ReservationID) && imageUUIDPattern.MatchString(object.WriteToken) && object.WriteExpiresAt != "" && object.Slot >= 0 && object.Slot <= 3 && object.ByteLength <= ImageMaxBytes && (object.PutOutcome == "NOT_STARTED" || object.PutOutcome == "CONFIRMED" || object.PutOutcome == "UNKNOWN")
	validObserved := object.Provenance == "OBSERVED" && object.SourceObservationID != nil && imageUUIDPattern.MatchString(*object.SourceObservationID) && object.ReconciliationObservationID == nil && object.ReservationID == "" && object.WriteToken == "" && object.WriteExpiresAt == "" && object.Slot == 0 && (object.PutOutcome == "NOT_APPLICABLE" || object.PutOutcome == "UNKNOWN")
	if object.ReconciliationObservationID != nil && !imageUUIDPattern.MatchString(*object.ReconciliationObservationID) {
		return false
	}
	validReady := object.State != "READY" || (object.Accounted && !object.NeedsReconciliation && (object.VersionID == nil || (object.Provenance == "WRITE" && object.PutOutcome == "CONFIRMED")) && object.ByteLength <= ImageMaxBytes && (object.PutOutcome == "CONFIRMED" || object.PutOutcome == "NOT_APPLICABLE" || object.ReconciliationObservationID != nil))
	return validState && (validWrite || validObserved) && validReady && imageUUIDPattern.MatchString(object.ID) && imageUUIDPattern.MatchString(object.AssetID) && object.ByteLength > 0 && object.LocationID != "" && object.Key != "" && imagePublicTokenPattern.MatchString(object.SHA256)
}
func validImageReservation(res ImageReservation) bool {
	if !imageUUIDPattern.MatchString(res.ID) || !imageUUIDPattern.MatchString(res.Token) || res.OwnerID == "" || res.RemainingBytes < 0 || len(res.SlotBytes) < 1 || len(res.SlotBytes) > ImageMaxOutputCount {
		return false
	}
	if (res.State != "ACTIVE" && res.State != "CLOSED") || (res.Kind != "OUTPUT" && res.Kind != "INPUT" && res.Kind != "COPY") {
		return false
	}
	for _, encoded := range res.SlotBytes {
		value, err := strconv.ParseInt(encoded, 10, 64)
		if err != nil || value < 1 || value > ImageMaxBytes || strconv.FormatInt(value, 10) != encoded {
			return false
		}
	}
	return true
}
func validateImageRepositoryResult(target any) error {
	valid := true
	switch value := target.(type) {
	case *ImageLocation:
		valid = value.ID != "" && value.PhysicalNamespace != "" && (value.Provider == "LOCAL" || value.Provider == "S3")
	case *ImageReservation:
		valid = validImageReservation(*value)
	case **ImageReservation:
		valid = *value == nil || validImageReservation(**value)
	case *ImageWriteTicket:
		valid = validImageAsset(value.Asset) && validImageObject(value.Object) && value.Asset.ID == value.Object.AssetID && value.Asset.ByteLength == value.Object.ByteLength && value.Asset.SHA256 == value.Object.SHA256 && (!value.WriteGranted || (value.Object.State == "WRITING" && value.Object.PutOutcome == "NOT_STARTED" && value.Object.Accounted))
	case *ImageObjectReceipt:
		valid = validImageAsset(value.Asset) && validImageObject(value.Object) && value.Asset.ID == value.Object.AssetID && value.Asset.ByteLength == value.Object.ByteLength && value.Asset.SHA256 == value.Object.SHA256
	case **ManagedImage:
		if *value != nil {
			image := *value
			valid = validImageAsset(image.Asset)
			if image.Asset.State == "AVAILABLE" {
				valid = valid && image.Object != nil && image.Location != nil && image.Asset.ActiveObjectID != nil && validImageObject(*image.Object) && image.Object.State == "READY" && image.Object.AssetID == image.Asset.ID && image.Object.ID == *image.Asset.ActiveObjectID && image.Object.LocationID == image.Location.ID && image.Object.ByteLength == image.Asset.ByteLength && image.Object.SHA256 == image.Asset.SHA256
			} else {
				valid = valid && image.Object == nil && image.Location == nil
			}
		}
	case *ImageUsage:
		valid = value.Policy.Scope == "images" && value.Policy.LimitBytes > 0 && value.UsedBytes >= 0 && value.ReservedBytes >= 0 && value.AssetCount >= 0 && value.ObjectCount >= 0
	case *bool:
	default:
		if historyValid, handled := validateImageHistoryResult(target); handled {
			valid = historyValid
		} else {
			valid = validateImageMaintenanceResult(target)
		}
	}
	if !valid {
		return errors.New("invalid image database result")
	}
	return nil
}
