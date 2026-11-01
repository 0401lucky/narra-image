package worker

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func loadTestCanvasContract(t *testing.T) CanvasContract {
	t.Helper()
	contract, err := LoadCanvasContract()
	if err != nil {
		t.Fatalf("LoadCanvasContract: %v", err)
	}
	return contract
}

func canvasFixtureRoot(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root, err := canvasContractRoot(cwd, executable)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func copyCanvasFixture(t *testing.T, target string) {
	t.Helper()
	source := canvasFixtureRoot(t)
	err := filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o700)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected non-regular fixture %s", relative)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, data, 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func changeCanvasFixture(t *testing.T, root, name string, change func(map[string]any)) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	change(value)
	data, err = json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCanvasContractLoadsActualSharedFiles(t *testing.T) {
	contract := loadTestCanvasContract(t)
	if contract.Schema.Contract != "narra.canvas.schema" || contract.Schema.Version != 1 || len(contract.Schema.Objects) != 180 {
		t.Fatalf("unexpected schema inventory: version=%d, objects=%d", contract.Schema.Version, len(contract.Schema.Objects))
	}
	functions := 0
	for _, object := range contract.Schema.Objects {
		if object.Kind == "function" {
			functions++
		}
	}
	if functions != 27 {
		t.Fatalf("loaded %d functions, want the complete 27-function inventory", functions)
	}
	data, err := os.ReadFile(filepath.Join(canvasFixtureRoot(t), "limits.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Limits map[string]int `json:"limits"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	projection, err := json.Marshal(contract.Limits)
	if err != nil {
		t.Fatal(err)
	}
	var limits map[string]int
	if err := json.Unmarshal(projection, &limits); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(limits, fixture.Limits) {
		t.Fatal("typed limits omit or alter a shared scalar")
	}
	if contract.Retention.GraceSeconds != 604800 || contract.Retention.Clock != "database" {
		t.Fatal("retention must remain exactly seven database-clock days")
	}
	if contract.Capability.ReadyCapability != (CanvasReadyCapability{Version: 1, Schema: "ready", Storage: "unversioned", GC: "running"}) ||
		!reflect.DeepEqual(contract.Capability.ReadyCapabilityPath, []string{"capabilities", "canvas"}) {
		t.Fatalf("unexpected readiness capability: %+v", contract.Capability.ReadyCapability)
	}
	for _, name := range []string{"catalog-expressions", "storage-location", "lifecycle", "retention"} {
		if len(contract.Scenarios[name]) == 0 {
			t.Errorf("missing shared scenario %s", name)
		}
	}
}

func TestCanvasContractFindsNativeProjectAndPackagedRoots(t *testing.T) {
	for _, mode := range []string{"project", "native-package", "executable", "app-container-layout"} {
		t.Run(mode, func(t *testing.T) {
			base := t.TempDir()
			project := filepath.Join(base, "app")
			root := filepath.Join(project, "contracts", "canvas", "v1")
			copyCanvasFixture(t, root)
			cwd := filepath.Join(base, "unrelated")
			executable := filepath.Join(base, "outside", "worker.exe")
			switch mode {
			case "project", "app-container-layout":
				cwd = project
			case "native-package":
				cwd = filepath.Join(project, "worker", "internal", "worker")
			case "executable":
				executable = filepath.Join(project, "bin", "narra-worker.exe")
			}
			if err := os.MkdirAll(cwd, 0o700); err != nil {
				t.Fatal(err)
			}
			resolved, err := canvasContractRoot(cwd, executable)
			if err != nil || resolved != root {
				t.Fatalf("resolved %q, %v; want %q", resolved, err, root)
			}
			if _, err := loadCanvasContractFrom(cwd, executable); err != nil {
				t.Fatalf("load resolved fixture: %v", err)
			}
		})
	}
}

func TestCanvasContractNeverFallsBackFromMissingOrInvalidInstallation(t *testing.T) {
	t.Run("no-source-path-or-embedded-fallback", func(t *testing.T) {
		base := t.TempDir()
		if contract, err := loadCanvasContractFrom(base, filepath.Join(base, "worker.exe")); err == nil || contract.Schema.Version != 0 {
			t.Fatal("missing packaged fixtures unexpectedly loaded a source-tree/fallback contract")
		}
	})
	t.Run("nearer-incomplete-root", func(t *testing.T) {
		base := t.TempDir()
		copyCanvasFixture(t, filepath.Join(base, "contracts", "canvas", "v1"))
		nested := filepath.Join(base, "nested")
		if err := os.MkdirAll(filepath.Join(nested, "contracts", "canvas", "v1"), 0o700); err != nil {
			t.Fatal(err)
		}
		if _, err := loadCanvasContractFrom(nested, filepath.Join(base, "worker.exe")); err == nil {
			t.Fatal("incomplete installation fell back to a different ancestor contract")
		}
	})
	t.Run("nearer-malformed-root", func(t *testing.T) {
		base := t.TempDir()
		copyCanvasFixture(t, filepath.Join(base, "contracts", "canvas", "v1"))
		nested := filepath.Join(base, "nested")
		root := filepath.Join(nested, "contracts", "canvas", "v1")
		copyCanvasFixture(t, root)
		changeCanvasFixture(t, root, "schema.json", func(value map[string]any) { value["version"] = 2 })
		if _, err := loadCanvasContractFrom(nested, filepath.Join(base, "worker.exe")); err == nil {
			t.Fatal("malformed installation fell back to a different ancestor contract")
		}
	})
	t.Run("explicit-root-missing", func(t *testing.T) {
		if _, err := loadCanvasContractAt(filepath.Join(t.TempDir(), "missing")); err == nil {
			t.Fatal("missing explicit fixture root was accepted")
		}
	})
}

func TestCanvasContractRejectsUnsupportedFileVersions(t *testing.T) {
	for _, name := range []string{"schema.json", "limits.json", "capability.json", "retention.json", "states.json", "scenarios/catalog-expressions.json", "scenarios/storage-location.json", "scenarios/retention.json", "scenarios/lifecycle.json"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			copyCanvasFixture(t, root)
			changeCanvasFixture(t, root, name, func(value map[string]any) { value["version"] = 2 })
			if _, err := loadCanvasContractAt(root); err == nil {
				t.Fatal("unsupported contract file version was accepted")
			}
		})
	}
}

func TestCanvasContractRequiresEveryTypedLimit(t *testing.T) {
	typeOfLimits := reflect.TypeFor[CanvasLimits]()
	for index := 0; index < typeOfLimits.NumField(); index++ {
		name := typeOfLimits.Field(index).Tag.Get("json")
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			copyCanvasFixture(t, root)
			changeCanvasFixture(t, root, "limits.json", func(value map[string]any) { delete(value["limits"].(map[string]any), name) })
			if _, err := loadCanvasContractAt(root); err == nil {
				t.Fatalf("missing required limit %s was accepted", name)
			}
		})
	}
}

func TestCanvasContractRejectsMalformedShapeAndUnsafePolicy(t *testing.T) {
	cases := []struct {
		name   string
		file   string
		change func(map[string]any)
	}{
		{"missing-version", "schema.json", func(v map[string]any) { delete(v, "version") }},
		{"empty-inventory", "schema.json", func(v map[string]any) { v["objects"] = []any{} }},
		{"missing-query", "schema.json", func(v map[string]any) { delete(v, "catalogQuery") }},
		{"mutating-query", "schema.json", func(v map[string]any) {
			v["catalogQuery"] = "WITH x AS (DELETE FROM secrets RETURNING *) SELECT * FROM x"
		}},
		{"unknown-kind", "schema.json", func(v map[string]any) { v["objects"].([]any)[0].(map[string]any)["kind"] = "unknown" }},
		{"null-definition", "schema.json", func(v map[string]any) { v["objects"].([]any)[0].(map[string]any)["definition"] = nil }},
		{"duplicate-object", "schema.json", func(v map[string]any) { items := v["objects"].([]any); v["objects"] = append(items, items[0]) }},
		{"shortened-grace", "retention.json", func(v map[string]any) { v["graceSeconds"] = 604799 }},
		{"host-clock", "retention.json", func(v map[string]any) { v["clock"] = "worker" }},
		{"null-protected-roots", "retention.json", func(v map[string]any) { v["protectedRoots"] = nil }},
		{"generated-eligible", "retention.json", func(v map[string]any) { v["eligibleKind"] = "GENERATED" }},
		{"lost-inventory", "retention.json", func(v map[string]any) { v["retainInventoryAfterDelete"] = false }},
		{"default-enabled", "capability.json", func(v map[string]any) { v["defaultEnabled"] = true }},
		{"missing-false-flag", "capability.json", func(v map[string]any) { delete(v, "unknownCapabilityMayDelete") }},
		{"null-false-flag", "capability.json", func(v map[string]any) { v["defaultEnabled"] = nil }},
		{"missing-ready-path", "capability.json", func(v map[string]any) { delete(v, "readyCapabilityPath") }},
		{"missing-ready-gc", "capability.json", func(v map[string]any) { delete(v["readyCapability"].(map[string]any), "gc") }},
		{"unknown-ready-version", "capability.json", func(v map[string]any) { v["readyCapability"].(map[string]any)["version"] = 2 }},
		{"not-ready-schema", "capability.json", func(v map[string]any) { v["readyCapability"].(map[string]any)["schema"] = "unknown" }},
		{"not-running-gc", "capability.json", func(v map[string]any) { v["readyCapability"].(map[string]any)["gc"] = "stopped" }},
		{"unknown-may-delete", "capability.json", func(v map[string]any) { v["unknownCapabilityMayDelete"] = true }},
		{"wrong-location-prefix", "capability.json", func(v map[string]any) { v["storageLocation"].(map[string]any)["prefix"] = "s3-v0:" }},
		{"late-version-finalization", "capability.json", func(v map[string]any) {
			v["latePutVersionReceipt"].(map[string]any)["pendingFinalizationAllowed"] = true
		}},
		{"null-transition-list", "states.json", func(v map[string]any) { v["assetTransitions"].(map[string]any)["DELETED"] = nil }},
		{"unknown-transition", "states.json", func(v map[string]any) { v["assetTransitions"].(map[string]any)["READY"] = []string{"UNREGISTERED"} }},
		{"schema-enum-drift", "states.json", func(v map[string]any) { v["putOutcomes"] = []string{"UNKNOWN"} }},
		{"missing-transition-map", "states.json", func(v map[string]any) { delete(v, "runTransitions") }},
		{"zero-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcBatchSize"] = 0 }},
		{"negative-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["deleteTimeoutSeconds"] = -1 }},
		{"fractional-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcBatchSize"] = 1.5 }},
		{"string-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcBatchSize"] = "20" }},
		{"null-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcBatchSize"] = nil }},
		{"unknown-limit", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["retentionOverrideSeconds"] = 1 }},
		{"too-frequent-gc", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcIntervalSeconds"] = 59 }},
		{"unbounded-batch", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["gcBatchSize"] = 101 }},
		{"sweep-outlives-lease", "limits.json", func(v map[string]any) { v["limits"].(map[string]any)["sweepTimeoutSeconds"] = 90 }},
		{"duration-overflow", "limits.json", func(v map[string]any) {
			v["limits"].(map[string]any)["reconciliationIntervalSeconds"] = int64(10_000_000_000)
		}},
		{"missing-scenario-list", "scenarios/storage-location.json", func(v map[string]any) { delete(v, "vectors") }},
		{"null-scenario-list", "scenarios/catalog-expressions.json", func(v map[string]any) { v["unsupported"] = nil }},
		{"empty-scenario-list", "scenarios/lifecycle.json", func(v map[string]any) { v["assetVectors"] = []any{} }},
		{"missing-retention-facts", "scenarios/retention.json", func(v map[string]any) { delete(v, "facts") }},
		{"missing-database-now", "scenarios/retention.json", func(v map[string]any) { delete(v, "databaseNowMs") }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			copyCanvasFixture(t, root)
			changeCanvasFixture(t, root, test.file, test.change)
			if _, err := loadCanvasContractAt(root); err == nil {
				t.Fatal("invalid contract was accepted")
			}
		})
	}
}

func TestCanvasContractReadsAreBoundedAndRooted(t *testing.T) {
	base := t.TempDir()
	directory := filepath.Join(base, "root")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := os.WriteFile(filepath.Join(base, "outside.json"), []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../outside.json", filepath.Join(base, "outside.json"), "missing.json", "."} {
		var value json.RawMessage
		if err := readCanvasContractJSON(root, name, &value); err == nil {
			t.Fatalf("unsafe/unreadable file accepted: %s", name)
		}
	}
	for name, data := range map[string]string{
		"invalid.json":  `{broken`,
		"trailing.json": `{} {}`,
		"large.json":    strings.Repeat(" ", canvasContractFileLimit+1),
	} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		var value json.RawMessage
		if err := readCanvasContractJSON(root, name, &value); err == nil {
			t.Fatalf("invalid/unbounded file accepted: %s", name)
		}
	}
}

func TestCanvasContractSharedLifecycleScenarios(t *testing.T) {
	contract := loadTestCanvasContract(t)
	type transition struct {
		From    string `json:"from"`
		To      string `json:"to"`
		Allowed bool   `json:"allowed"`
	}
	var fixture struct {
		AssetVectors      []transition `json:"assetVectors"`
		RunVectors        []transition `json:"runVectors"`
		CapabilityVectors []struct {
			CanvasStorageCapabilityFacts
			Allowed bool `json:"allowed"`
		} `json:"capabilityVectors"`
	}
	if err := json.Unmarshal(contract.Scenarios["lifecycle"], &fixture); err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.AssetVectors {
		t.Run("asset/"+vector.From+"/"+vector.To, func(t *testing.T) {
			if got := contract.CanTransitionAsset(vector.From, vector.To); got != vector.Allowed {
				t.Fatalf("got %v, want %v", got, vector.Allowed)
			}
		})
	}
	for _, vector := range fixture.RunVectors {
		t.Run("run/"+vector.From+"/"+vector.To, func(t *testing.T) {
			if got := contract.CanTransitionRun(vector.From, vector.To); got != vector.Allowed {
				t.Fatalf("got %v, want %v", got, vector.Allowed)
			}
		})
	}
	for index, vector := range fixture.CapabilityVectors {
		t.Run(fmt.Sprintf("capability/%d/%s", index, vector.Versioning), func(t *testing.T) {
			if got := contract.IsStorageCapability(vector.CanvasStorageCapabilityFacts); got != vector.Allowed {
				t.Fatalf("got %v, want %v", got, vector.Allowed)
			}
		})
	}
	for _, state := range contract.States.AssetStates {
		if !contract.CanTransitionAsset(state, state) {
			t.Fatalf("same-state asset update must be idempotent: %s", state)
		}
	}
	for _, state := range contract.States.RunStates {
		if !contract.CanTransitionRun(state, state) {
			t.Fatalf("same-state run update must be idempotent: %s", state)
		}
	}
	if contract.CanTransitionAsset("unknown", "unknown") || contract.CanTransitionRun("unknown", "unknown") {
		t.Fatal("unknown states are not idempotent valid transitions")
	}
	if (CanvasContract{}).IsStorageCapability(CanvasStorageCapabilityFacts{Verified: true, LocationMatched: true}) {
		t.Fatal("an unloaded contract approved storage capability")
	}
}

func TestCanvasContractSharedRetentionScenarios(t *testing.T) {
	contract := loadTestCanvasContract(t)
	var fixture struct {
		DatabaseNowMs int64           `json:"databaseNowMs"`
		Facts         json.RawMessage `json:"facts"`
		Vectors       []struct {
			ID       string          `json:"id"`
			Changes  json.RawMessage `json:"changes"`
			Eligible bool            `json:"eligible"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(contract.Scenarios["retention"], &fixture); err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.Vectors {
		t.Run(vector.ID, func(t *testing.T) {
			var facts CanvasAssetRetentionFacts
			if err := json.Unmarshal(fixture.Facts, &facts); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(vector.Changes, &facts); err != nil {
				t.Fatal(err)
			}
			if got := contract.AssetCleanupEligible(facts, fixture.DatabaseNowMs); got != vector.Eligible {
				t.Fatalf("got %v, want %v", got, vector.Eligible)
			}
		})
	}
	var facts CanvasAssetRetentionFacts
	if err := json.Unmarshal(fixture.Facts, &facts); err != nil {
		t.Fatal(err)
	}
	if (CanvasContract{}).AssetCleanupEligible(facts, fixture.DatabaseNowMs) {
		t.Fatal("an unloaded contract enabled cleanup")
	}
	oldest := int64(math.MinInt64)
	facts.DetachedAtMs = &oldest
	if contract.AssetCleanupEligible(facts, math.MinInt64+1) {
		t.Fatal("timestamp overflow shortened retention")
	}
}
