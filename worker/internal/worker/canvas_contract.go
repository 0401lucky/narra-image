package worker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"
)

const canvasContractVersion = 1
const canvasContractFileLimit = 1 << 20

// CanvasContract projects the shared files; it does not carry fallback copies of
// schema objects, numeric limits, transition tables, or cleanup policy.
type CanvasContract struct {
	Schema             CanvasSchemaContract
	Limits             CanvasLimits
	VerifiedImageTypes []string
	Capability         CanvasCapability
	Retention          CanvasRetention
	States             CanvasStates
	Scenarios          map[string]json.RawMessage
}

type CanvasLimits struct {
	LiveCanvasesPerOwner          int `json:"liveCanvasesPerOwner"`
	SceneBytes                    int `json:"sceneBytes"`
	SceneNodes                    int `json:"sceneNodes"`
	SceneEdges                    int `json:"sceneEdges"`
	TitleCharacters               int `json:"titleCharacters"`
	CanonicalIDCharacters         int `json:"canonicalIdCharacters"`
	ImportBytes                   int `json:"importBytes"`
	OwnerImportBytes              int `json:"ownerImportBytes"`
	OwnerAccountedImports         int `json:"ownerAccountedImports"`
	ActiveUploadsPerOwner         int `json:"activeUploadsPerOwner"`
	ReferencesPerRun              int `json:"referencesPerRun"`
	TextOutputCount               int `json:"textOutputCount"`
	ImageOutputCount              int `json:"imageOutputCount"`
	DecodedInputBytes             int `json:"decodedInputBytes"`
	RuntimeIDSlots                int `json:"runtimeIdSlots"`
	DefaultPageSize               int `json:"defaultPageSize"`
	MaximumPageSize               int `json:"maximumPageSize"`
	MetadataBodyBytes             int `json:"metadataBodyBytes"`
	RunBodyBytes                  int `json:"runBodyBytes"`
	RunSnapshotBytes              int `json:"runSnapshotBytes"`
	ResolveBodyBytes              int `json:"resolveBodyBytes"`
	SnapshotBodyBytes             int `json:"snapshotBodyBytes"`
	UploadBodyBytes               int `json:"uploadBodyBytes"`
	UploadLeaseSeconds            int `json:"uploadLeaseSeconds"`
	PreparationLeaseSeconds       int `json:"preparationLeaseSeconds"`
	SweepLeaseSeconds             int `json:"sweepLeaseSeconds"`
	DeleteLeaseSeconds            int `json:"deleteLeaseSeconds"`
	DeleteTimeoutSeconds          int `json:"deleteTimeoutSeconds"`
	SweepTimeoutSeconds           int `json:"sweepTimeoutSeconds"`
	GcIntervalSeconds             int `json:"gcIntervalSeconds"`
	GcBatchSize                   int `json:"gcBatchSize"`
	MaximumGcBatchSize            int `json:"maximumGcBatchSize"`
	DeleteBackoffSeconds          int `json:"deleteBackoffSeconds"`
	MaximumDeleteBackoffSeconds   int `json:"maximumDeleteBackoffSeconds"`
	ReconciliationIntervalSeconds int `json:"reconciliationIntervalSeconds"`
}

type CanvasReadyCapability struct {
	Version int    `json:"version"`
	Schema  string `json:"schema"`
	Storage string `json:"storage"`
	GC      string `json:"gc"`
}

type CanvasCapability struct {
	Contract                         string                        `json:"contract"`
	Version                          int                           `json:"version"`
	FeatureFlag                      string                        `json:"featureFlag"`
	DefaultEnabled                   bool                          `json:"defaultEnabled"`
	ReadyCapabilityPath              []string                      `json:"readyCapabilityPath"`
	ReadyCapability                  CanvasReadyCapability         `json:"readyCapability"`
	VersioningStates                 []string                      `json:"versioningStates"`
	RequiredStorageVersioning        string                        `json:"requiredStorageVersioning"`
	StorageLocation                  CanvasStorageLocationContract `json:"storageLocation"`
	VerifyLocationBeforeClaim        bool                          `json:"verifyLocationBeforeClaim"`
	UnexpectedPutVersionQuarantined  bool                          `json:"unexpectedPutVersionQuarantined"`
	LatePutVersionReceipt            CanvasLatePutVersionReceipt   `json:"latePutVersionReceipt"`
	SchemaProbeMustVerifyGuardBodies bool                          `json:"schemaProbeMustVerifyGuardBodies"`
	UnknownCapabilityMayDelete       bool                          `json:"unknownCapabilityMayDelete"`
}

type CanvasStorageLocationContract struct {
	Prefix                                string   `json:"prefix"`
	Digest                                string   `json:"digest"`
	Encoding                              string   `json:"encoding"`
	Material                              string   `json:"material"`
	Endpoint                              string   `json:"endpoint"`
	RegionAndBucket                       string   `json:"regionAndBucket"`
	Excluded                              []string `json:"excluded"`
	RequireRecordedTupleMatchBeforeDelete bool     `json:"requireRecordedTupleMatchBeforeDelete"`
}

type CanvasLatePutVersionReceipt struct {
	States                     []string `json:"states"`
	RequiredPutOutcome         string   `json:"requiredPutOutcome"`
	ImmutableVersionID         bool     `json:"immutableVersionId"`
	StateTransitionAllowed     bool     `json:"stateTransitionAllowed"`
	PhysicalBytesAccounted     bool     `json:"physicalBytesAccounted"`
	NeedsReconciliation        bool     `json:"needsReconciliation"`
	ErrorCode                  string   `json:"errorCode"`
	FutureClaimsAllowed        bool     `json:"futureClaimsAllowed"`
	PendingFinalizationAllowed bool     `json:"pendingFinalizationAllowed"`
}

type CanvasRetention struct {
	Contract                              string   `json:"contract"`
	Version                               int      `json:"version"`
	GraceSeconds                          int      `json:"graceSeconds"`
	Clock                                 string   `json:"clock"`
	EligibleKind                          string   `json:"eligibleKind"`
	ProtectedRoots                        []string `json:"protectedRoots"`
	JobRootsSurvive                       []string `json:"jobRootsSurvive"`
	ExcludedKinds                         []string `json:"excludedKinds"`
	EligibilityStarts                     []string `json:"eligibilityStarts"`
	DeleteRecordedKeyOnly                 bool     `json:"deleteRecordedKeyOnly"`
	RetainInventoryAfterDelete            bool     `json:"retainInventoryAfterDelete"`
	UncertainPutRetainsPhysicalAccounting bool     `json:"uncertainPutRetainsPhysicalAccounting"`
	NeverReuseUploadIdentityOrKey         bool     `json:"neverReuseUploadIdentityOrKey"`
	LockOrder                             []string `json:"lockOrder"`
	GcLockOrder                           []string `json:"gcLockOrder"`
	PreparationProtectionOnlyIncreases    bool     `json:"preparationProtectionOnlyIncreases"`
}

type CanvasStates struct {
	Version                         int                 `json:"version"`
	AssetStates                     []string            `json:"assetStates"`
	AssetTransitions                map[string][]string `json:"assetTransitions"`
	RunStates                       []string            `json:"runStates"`
	RunTransitions                  map[string][]string `json:"runTransitions"`
	PutOutcomes                     []string            `json:"putOutcomes"`
	DeleteOutcomes                  []string            `json:"deleteOutcomes"`
	ActiveCanonicalJobStates        []string            `json:"activeCanonicalJobStates"`
	CommittedReplayBefore           []string            `json:"committedReplayBefore"`
	SameKeyNeverRecreatesMissingJob bool                `json:"sameKeyNeverRecreatesMissingJob"`
	SinglePutPerUploadIdentity      bool                `json:"singlePutPerUploadIdentity"`
}

func LoadCanvasContract() (CanvasContract, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return CanvasContract{}, errors.New("canvas contract working directory unavailable")
	}
	executable, err := os.Executable()
	if err != nil {
		return CanvasContract{}, errors.New("canvas contract executable location unavailable")
	}
	return loadCanvasContractFrom(cwd, executable)
}

func loadCanvasContractFrom(cwd, executable string) (CanvasContract, error) {
	root, err := canvasContractRoot(cwd, executable)
	if err != nil {
		return CanvasContract{}, err
	}
	return loadCanvasContractAt(root)
}

// Walking these two ancestor chains covers native package tests, project-root
// launches, and both /app deployments, without using a compiler's source path.
func canvasContractRoot(cwd, executable string) (string, error) {
	seen := make(map[string]bool)
	for _, start := range []string{cwd, filepath.Dir(executable)} {
		if start == "" || !filepath.IsAbs(start) {
			continue
		}
		for directory := filepath.Clean(start); ; directory = filepath.Dir(directory) {
			candidate := filepath.Join(directory, "contracts", "canvas", "v1")
			if !seen[candidate] {
				seen[candidate] = true
				info, err := os.Stat(candidate)
				if err == nil {
					if !info.IsDir() {
						return "", errors.New("canvas contract root is not a directory")
					}
					// An incomplete nearer installation is an error, not permission to
					// silently load a different contract from a farther ancestor.
					return candidate, nil
				}
				if !errors.Is(err, os.ErrNotExist) {
					return "", errors.New("canvas contract root cannot be inspected")
				}
			}
			if filepath.Dir(directory) == directory {
				break
			}
		}
	}
	return "", errors.New("canvas contract files not found")
}

func loadCanvasContractAt(directory string) (CanvasContract, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return CanvasContract{}, errors.New("canvas contract root cannot be opened")
	}
	defer root.Close()
	var contract CanvasContract
	var limitsFile struct {
		Version                    int          `json:"version"`
		Limits                     CanvasLimits `json:"limits"`
		VerifiedImageTypes         []string     `json:"verifiedImageTypes"`
		GenerationPromptLimitOwner string       `json:"generationPromptLimitOwner"`
	}
	for _, file := range []struct {
		name   string
		target any
	}{
		{"schema.json", &contract.Schema},
		{"limits.json", &limitsFile},
		{"capability.json", &contract.Capability},
		{"retention.json", &contract.Retention},
		{"states.json", &contract.States},
	} {
		if err := readCanvasContractJSON(root, file.name, file.target); err != nil {
			return CanvasContract{}, err
		}
	}
	if limitsFile.Version != canvasContractVersion || limitsFile.GenerationPromptLimitOwner == "" || !canvasUniqueStrings(limitsFile.VerifiedImageTypes, false) {
		return CanvasContract{}, errors.New("canvas contract limits.json has invalid version or metadata")
	}
	contract.Limits = limitsFile.Limits
	contract.VerifiedImageTypes = limitsFile.VerifiedImageTypes
	if err := contract.validate(); err != nil {
		return CanvasContract{}, err
	}
	contract.Scenarios = make(map[string]json.RawMessage)
	for _, name := range []string{"catalog-expressions", "storage-location", "retention", "lifecycle"} {
		var scenario json.RawMessage
		file := "scenarios/" + name + ".json"
		if err := readCanvasContractJSON(root, file, &scenario); err != nil {
			return CanvasContract{}, err
		}
		var header struct {
			Version int `json:"version"`
		}
		if err := json.Unmarshal(scenario, &header); err != nil || header.Version != canvasContractVersion {
			return CanvasContract{}, fmt.Errorf("canvas contract %s has invalid version", file)
		}
		if !canvasScenarioShapeValid(name, scenario) {
			return CanvasContract{}, fmt.Errorf("canvas contract %s has invalid scenario shape", file)
		}
		contract.Scenarios[name] = scenario
	}
	return contract, nil
}

func canvasScenarioShapeValid(name string, data json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return false
	}
	lists := []string{"vectors"}
	switch name {
	case "catalog-expressions":
		lists = []string{"equivalent", "different", "unsupported"}
	case "lifecycle":
		lists = []string{"assetVectors", "runVectors", "capabilityVectors"}
	case "retention":
		var facts CanvasAssetRetentionFacts
		var databaseNowMs int64
		if decodeCanvasContractJSON(fields["facts"], &facts) != nil || decodeCanvasContractJSON(fields["databaseNowMs"], &databaseNowMs) != nil {
			return false
		}
	}
	for _, name := range lists {
		var vectors []json.RawMessage
		if json.Unmarshal(fields[name], &vectors) != nil || len(vectors) == 0 {
			return false
		}
	}
	return true
}

func readCanvasContractJSON(root *os.Root, name string, target any) error {
	file, err := root.Open(name)
	if err != nil {
		return fmt.Errorf("canvas contract %s cannot be opened", name)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > canvasContractFileLimit {
		return fmt.Errorf("canvas contract %s is not a bounded regular file", name)
	}
	data, err := io.ReadAll(io.LimitReader(file, canvasContractFileLimit+1))
	if err != nil || len(data) > canvasContractFileLimit {
		return fmt.Errorf("canvas contract %s cannot be read within its limit", name)
	}
	if err := decodeCanvasContractJSON(data, target); err != nil {
		return fmt.Errorf("canvas contract %s has invalid JSON or shape", name)
	}
	return nil
}

// Struct tags are the required-field inventory. In particular, absent/null false
// booleans and zero-valued limits must not silently pass as decoded defaults.
func decodeCanvasContractJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("multiple JSON values")
	}
	return requireCanvasJSONShape(data, reflect.TypeOf(target).Elem())
}

func requireCanvasJSONShape(data json.RawMessage, kind reflect.Type) error {
	data = bytes.TrimSpace(data)
	if kind == reflect.TypeFor[json.RawMessage]() {
		return nil
	}
	if kind.Kind() == reflect.Pointer {
		if bytes.Equal(data, []byte("null")) {
			return nil
		}
		return requireCanvasJSONShape(data, kind.Elem())
	}
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		return errors.New("required JSON value is null")
	}
	switch kind.Kind() {
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		for index := 0; index < kind.NumField(); index++ {
			field := kind.Field(index)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if name == "-" || !field.IsExported() {
				continue
			}
			if name == "" {
				name = field.Name
			}
			value, exists := fields[name]
			if !exists {
				return errors.New("required JSON field is missing")
			}
			if err := requireCanvasJSONShape(value, field.Type); err != nil {
				return err
			}
		}
	case reflect.Slice:
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil {
			return err
		}
		for _, item := range items {
			if err := requireCanvasJSONShape(item, kind.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		for _, value := range fields {
			if err := requireCanvasJSONShape(value, kind.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c CanvasContract) validate() error {
	if err := validateCanvasSchemaContract(c.Schema); err != nil {
		return err
	}
	values := reflect.ValueOf(c.Limits)
	for index := 0; index < values.NumField(); index++ {
		value := values.Field(index).Int()
		name := values.Type().Field(index).Tag.Get("json")
		if value <= 0 || value > 1<<53-1 || (strings.HasSuffix(name, "Seconds") && value > math.MaxInt64/int64(time.Second)) {
			return fmt.Errorf("canvas contract limits.json has invalid %s", name)
		}
	}
	l := c.Limits
	if l.DefaultPageSize > l.MaximumPageSize || l.ImportBytes > l.OwnerImportBytes || l.ImportBytes >= l.UploadBodyBytes || l.SceneBytes >= l.SnapshotBodyBytes ||
		l.GcIntervalSeconds < 60 || l.GcBatchSize > l.MaximumGcBatchSize || l.MaximumGcBatchSize > 100 ||
		l.DeleteTimeoutSeconds > l.SweepTimeoutSeconds || l.SweepTimeoutSeconds >= l.SweepLeaseSeconds || l.SweepTimeoutSeconds >= l.DeleteLeaseSeconds ||
		l.DeleteBackoffSeconds > l.MaximumDeleteBackoffSeconds {
		return errors.New("canvas contract limits.json has inconsistent bounds")
	}
	capability := c.Capability
	location := capability.StorageLocation
	late := capability.LatePutVersionReceipt
	if capability.Contract != "narra.canvas.capability" || capability.Version != canvasContractVersion || capability.FeatureFlag != "CANVAS_ENABLED" || capability.DefaultEnabled ||
		!slices.Equal(capability.ReadyCapabilityPath, []string{"capabilities", "canvas"}) ||
		capability.ReadyCapability != (CanvasReadyCapability{Version: canvasContractVersion, Schema: "ready", Storage: "unversioned", GC: "running"}) ||
		!canvasUniqueStrings(capability.VersioningStates, false) || !slices.Contains(capability.VersioningStates, capability.RequiredStorageVersioning) || capability.RequiredStorageVersioning != "UNVERSIONED" ||
		!capability.VerifyLocationBeforeClaim || !capability.UnexpectedPutVersionQuarantined || !capability.SchemaProbeMustVerifyGuardBodies || capability.UnknownCapabilityMayDelete ||
		location.Prefix != canvasStorageLocationPrefix || location.Digest != "SHA-256" || location.Encoding != "UTF-8" || location.Material == "" || location.Endpoint == "" || location.RegionAndBucket == "" ||
		!slices.Equal(location.Excluded, []string{"credentials", "publicUrl"}) || !location.RequireRecordedTupleMatchBeforeDelete ||
		!slices.Equal(late.States, []string{"DELETING", "DELETED"}) || late.RequiredPutOutcome != "UNKNOWN" || !late.ImmutableVersionID || late.StateTransitionAllowed ||
		!late.PhysicalBytesAccounted || !late.NeedsReconciliation || late.ErrorCode != "CANVAS_STORAGE_CAPABILITY_INVALID" || late.FutureClaimsAllowed || late.PendingFinalizationAllowed {
		return errors.New("canvas contract capability.json is unsupported or incomplete")
	}
	r := c.Retention
	if r.Contract != "narra.canvas.retention" || r.Version != canvasContractVersion || r.GraceSeconds != 604800 || r.Clock != "database" || r.EligibleKind != "IMPORT" ||
		!slices.Equal(r.ProtectedRoots, []string{"CanvasSavedAssetUse", "CanvasJobAssetUse"}) || !canvasUniqueStrings(r.JobRootsSurvive, false) ||
		!slices.Equal(r.ExcludedKinds, []string{"GENERATED", "LEGACY"}) || !canvasUniqueStrings(r.EligibilityStarts, false) ||
		!r.DeleteRecordedKeyOnly || !r.RetainInventoryAfterDelete || !r.UncertainPutRetainsPhysicalAccounting || !r.NeverReuseUploadIdentityOrKey ||
		!canvasUniqueStrings(r.LockOrder, false) || !canvasUniqueStrings(r.GcLockOrder, false) || !r.PreparationProtectionOnlyIncreases {
		return errors.New("canvas contract retention.json is unsupported or incomplete")
	}
	states := c.States
	if states.Version != canvasContractVersion || !canvasTransitionsValid(states.AssetStates, states.AssetTransitions) || !canvasTransitionsValid(states.RunStates, states.RunTransitions) ||
		!canvasUniqueStrings(states.ActiveCanonicalJobStates, false) || !canvasUniqueStrings(states.CommittedReplayBefore, false) || !states.SameKeyNeverRecreatesMissingJob || !states.SinglePutPerUploadIdentity {
		return errors.New("canvas contract states.json is unsupported or incomplete")
	}
	for name, expected := range map[string][]string{
		"CanvasImportAssetState": states.AssetStates,
		"CanvasRunState":         states.RunStates,
		"CanvasPutOutcome":       states.PutOutcomes,
		"CanvasDeleteOutcome":    states.DeleteOutcomes,
	} {
		var found []string
		for _, object := range c.Schema.Objects {
			if object.Kind == "enum" && object.Name == name {
				if err := json.Unmarshal(object.Definition, &found); err != nil {
					return errors.New("canvas contract enum definition is invalid")
				}
				break
			}
		}
		if !canvasUniqueStrings(expected, false) || !slices.Equal(found, expected) {
			return fmt.Errorf("canvas contract states.json disagrees with schema enum %s", name)
		}
	}
	return nil
}

func canvasUniqueStrings(values []string, emptyAllowed bool) bool {
	if len(values) == 0 && !emptyAllowed {
		return false
	}
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func canvasTransitionsValid(states []string, transitions map[string][]string) bool {
	if !canvasUniqueStrings(states, false) || len(transitions) != len(states) {
		return false
	}
	for _, state := range states {
		targets, exists := transitions[state]
		if !exists || !canvasUniqueStrings(targets, true) {
			return false
		}
		for _, target := range targets {
			if !slices.Contains(states, target) {
				return false
			}
		}
	}
	return true
}

func (c CanvasContract) CanTransitionAsset(from, to string) bool {
	targets, exists := c.States.AssetTransitions[from]
	return exists && slices.Contains(c.States.AssetStates, to) && (from == to || slices.Contains(targets, to))
}

func (c CanvasContract) CanTransitionRun(from, to string) bool {
	targets, exists := c.States.RunTransitions[from]
	return exists && slices.Contains(c.States.RunStates, to) && (from == to || slices.Contains(targets, to))
}

type CanvasStorageCapabilityFacts struct {
	Verified        bool    `json:"verified"`
	LocationMatched bool    `json:"locationMatched"`
	Versioning      string  `json:"versioning"`
	PutVersionID    *string `json:"putVersionId"`
}

func (c CanvasContract) IsStorageCapability(facts CanvasStorageCapabilityFacts) bool {
	return c.Capability.Version == canvasContractVersion && c.Capability.RequiredStorageVersioning == "UNVERSIONED" && facts.Verified && facts.LocationMatched &&
		facts.Versioning == c.Capability.RequiredStorageVersioning && (facts.PutVersionID == nil || *facts.PutVersionID == "")
}

type CanvasAssetRetentionFacts struct {
	Kind                   string `json:"kind"`
	Registered             bool   `json:"registered"`
	KnownKey               bool   `json:"knownKey"`
	State                  string `json:"state"`
	SavedRoots             int    `json:"savedRoots"`
	JobRoots               int    `json:"jobRoots"`
	DetachedAtMs           *int64 `json:"detachedAtMs"`
	UploadExpiresAtMs      *int64 `json:"uploadExpiresAtMs"`
	PreparationExpiresAtMs *int64 `json:"preparationExpiresAtMs"`
	DeleteExpiresAtMs      *int64 `json:"deleteExpiresAtMs"`
	NextDeleteAtMs         *int64 `json:"nextDeleteAtMs"`
	NeedsReconciliation    bool   `json:"needsReconciliation"`
}

// This pure projection shares Node's fixture semantics. Live claims still use
// the database clock, root locks and SQL fences, never a worker-host clock.
func (c CanvasContract) AssetCleanupEligible(facts CanvasAssetRetentionFacts, databaseNowMs int64) bool {
	if c.Retention.GraceSeconds != 604800 || facts.Kind != c.Retention.EligibleKind || !facts.Registered || !facts.KnownKey || facts.SavedRoots != 0 || facts.JobRoots != 0 {
		return false
	}
	for _, expiry := range []*int64{facts.UploadExpiresAtMs, facts.PreparationExpiresAtMs, facts.DeleteExpiresAtMs, facts.NextDeleteAtMs} {
		if expiry != nil && *expiry > databaseNowMs {
			return false
		}
	}
	if facts.State == "DELETING" || (facts.State == "DELETED" && facts.NeedsReconciliation) {
		return true
	}
	if facts.State != "READY" && facts.State != "QUARANTINED" {
		return false
	}
	graceMs := int64(c.Retention.GraceSeconds) * 1000
	return facts.DetachedAtMs != nil && databaseNowMs >= math.MinInt64+graceMs && *facts.DetachedAtMs <= databaseNowMs-graceMs
}
